import { calculateInvoiceBalance, parseInvoiceRecord, parseManualPaymentRecord } from "@bpt-jersey/domain/finance";
import type { AttendanceFirestore, AttendanceTransaction } from "./attendance-transaction-service.js";
import type { BookingDocumentSnapshot } from "./booking-transaction-service.js";

/** Payment evidence is read in the same transaction as attendance, including corrections. */
export async function isClassPaymentSettled(
  db: AttendanceFirestore, tx: AttendanceTransaction, academyId: string, sessionId: string,
  bookings: readonly BookingDocumentSnapshot[],
): Promise<boolean> {
  const booking = bookings.find((doc) => doc.exists && doc.data()?.status === "confirmed")?.data();
  if (!booking) return false;
  // Course, intro and private lesson (paid by a credit) bookings carry no per-class invoice.
  if (booking.schemaVersion === "2" || booking.schemaVersion === "3" || booking.schemaVersion === "4") return true;
  const root = `academies/${academyId}`;
  if (typeof booking.membershipId !== "string" || booking.membershipId.includes("/")) return false;
  const membership = (await tx.get(db.doc(`${root}/memberships/${booking.membershipId}`))).data();
  if (!membership || membership.academyId !== academyId || membership.studentId !== booking.studentId || typeof membership.planId !== "string" || membership.planId.includes("/")) return false;
  const plan = (await tx.get(db.doc(`${root}/plans/${membership.planId}`))).data();
  if (!plan || plan.academyId !== academyId) return false;
  if (plan.billingPeriod === "monthly" || plan.billingPeriod === "term") return true;
  if (plan.billingPeriod !== "per-session") return false;
  const snapshots = await tx.get(db.collection(`${root}/invoices`).where("sourceRef", "==", `${root}/sessions/${sessionId}`));
  const invoices = snapshots.docs.flatMap((doc) => {
    const parsed = parseInvoiceRecord(doc.data());
    return parsed.ok && parsed.value.academyId === academyId && parsed.value.invoiceId === doc.id &&
      parsed.value.membershipId === booking.membershipId && parsed.value.familyId === membership.familyId &&
      parsed.value.chargeKind === "payg_session" && parsed.value.status !== "void" ? [parsed.value] : [];
  });
  if (!invoices.length) return false;
  for (const invoice of invoices) {
    const snapshots = await tx.get(db.collection(`${root}/payments`).where("invoiceId", "==", invoice.invoiceId));
    const payments = snapshots.docs.flatMap((doc) => {
      const parsed = parseManualPaymentRecord(doc.data());
      return parsed.ok && parsed.value.paymentId === doc.id && parsed.value.academyId === academyId ? [parsed.value] : [];
    });
    if (calculateInvoiceBalance(invoice, payments) !== 0) return false;
  }
  return true;
}
