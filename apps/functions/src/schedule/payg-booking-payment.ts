import type { Firestore } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import { parseInvoiceRecord, parseManualPaymentRecord } from "@bpt-jersey/domain/finance";
import { parsePlanRecord } from "@bpt-jersey/domain/memberships";
import { parseMembershipRecord } from "@bpt-jersey/domain/memberships/lifecycle";
import type { BookingRecord, PaygBookingPayment } from "@bpt-jersey/domain/schedule";
import { groupIdSchema } from "@bpt-jersey/domain/schedule/groups";
import type { R2Client } from "../storage/r2-client.js";
import { ensurePaygClassInvoice, findPaygProof, paygFinanceStore, paygProofOwners } from "./payg-class-payment.js";

/**
 * D14/D15: a pay-as-you-go member chooses at booking time how they pay, and the class invoice is
 * issued there and then instead of being prepared later by the office.
 */
export async function attachPaygBookingPayment(
  db: Firestore,
  storage: R2Client | null,
  input: Readonly<{ academyId: string; actorId: string; booking: BookingRecord; paygPayment: PaygBookingPayment }>,
): Promise<void> {
  const { academyId, actorId, booking, paygPayment } = input;
  const root = `academies/${academyId}`;
  if (booking.schemaVersion !== "1" || !groupIdSchema.safeParse(booking.membershipId).success) {
    throw new HttpsError("failed-precondition", "A regular class booking is required.");
  }
  const membership = parseMembershipRecord((await db.doc(`${root}/memberships/${booking.membershipId}`).get()).data());
  if (!membership.ok || membership.value.academyId !== academyId || membership.value.studentId !== booking.studentId) {
    throw new HttpsError("failed-precondition", "Membership is unavailable.");
  }
  const plan = parsePlanRecord((await db.doc(`${root}/plans/${membership.value.planId}`).get()).data());
  if (!plan.ok || plan.value.academyId !== academyId || plan.value.billingPeriod !== "per-session") {
    throw new HttpsError("failed-precondition", "This plan does not pay per class");
  }
  // Private storage is external I/O: the screenshot is proven before any transaction is opened,
  // because the Admin SDK re-runs a transaction callback on contention.
  if (paygPayment.method === "bank_transfer") {
    const owners = paygProofOwners(booking, actorId);
    const proof = storage === null
      ? undefined
      : await findPaygProof(storage, academyId, booking.bookingId, paygPayment.proofId, owners);
    if (proof === undefined) throw new HttpsError("failed-precondition", "Payment evidence is unavailable.");
  }
  await ensurePaygClassInvoice(db, {
    academyId, actorId, sessionId: booking.sessionId, studentId: booking.studentId,
    membershipId: booking.membershipId,
  });
  await db.doc(`${root}/bookings/${booking.bookingId}`).update({
    paygPayment, updatedAt: new Date().toISOString(), updatedBy: actorId,
  });
}

/**
 * D16: a cancelled class must stop counting as debt, but only while nobody has paid for it. A
 * settled or part-settled invoice stays on the account for the office to refund deliberately.
 */
export async function voidUnpaidPaygInvoice(
  db: Firestore,
  input: Readonly<{ academyId: string; actorId: string; sessionId: string; membershipId: string }>,
): Promise<void> {
  const root = `academies/${input.academyId}`;
  const snapshots = await db.collection(`${root}/invoices`).where("sourceRef", "==", `${root}/sessions/${input.sessionId}`).get();
  const open = snapshots.docs.flatMap((doc) => {
    const parsed = parseInvoiceRecord(doc.data());
    return parsed.ok && parsed.value.academyId === input.academyId && parsed.value.invoiceId === doc.id &&
      parsed.value.membershipId === input.membershipId && parsed.value.chargeKind === "payg_session" &&
      parsed.value.status === "open" ? [parsed.value] : [];
  });
  const store = paygFinanceStore(db);
  for (const invoice of open) {
    const payments = await db.collection(`${root}/payments`).where("invoiceId", "==", invoice.invoiceId).get();
    const recorded = payments.docs.some((doc) => {
      const parsed = parseManualPaymentRecord(doc.data());
      return parsed.ok && parsed.value.paymentId === doc.id;
    });
    if (!recorded) await store.voidManualInvoice({ academyId: input.academyId, actorId: input.actorId, invoiceId: invoice.invoiceId });
  }
}
