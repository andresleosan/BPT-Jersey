import { getFirestore } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { z } from "zod";
import { buildBookingIdCandidates } from "@bpt-jersey/domain/schedule";
import { groupIdSchema } from "@bpt-jersey/domain/schedule/groups";
import { parsePlanRecord } from "@bpt-jersey/domain/memberships";
import { parseMembershipRecord } from "@bpt-jersey/domain/memberships/lifecycle";
import { parseInvoiceRecord } from "@bpt-jersey/domain/finance";
import type { AuditEventDraft } from "@bpt-jersey/domain/audit";
import { appendAuditEventInTransaction } from "../audit/audit-writer.js";
import { requireActiveOfficeActor } from "../auth/office-actor.js";
import { createFinanceStore } from "../finance/finance-service.js";
import { scheduleCallableOptions } from "./schedule-callable-options.js";
import { groupKey } from "./group-keys.js";

/** Preparing an invoice never records a payment. The existing office payment form does that. */
export const preparePaygClassPayment = onCall(scheduleCallableOptions, async (request) => {
  const actor = await requireActiveOfficeActor(request);
  const input = z.object({ sessionId: groupIdSchema, studentId: groupIdSchema }).strict().safeParse(request.data);
  if (!input.success) throw new HttpsError("invalid-argument", "Choose a member and class.");
  const { sessionId, studentId } = input.data;
  const db = getFirestore();
  const root = `academies/${actor.academyId}`;
  const bookingDocs = await db.getAll(...buildBookingIdCandidates(sessionId, studentId).map((id) => db.doc(`${root}/bookings/${id}`)));
  const confirmed = bookingDocs.filter((doc) => doc.get("status") === "confirmed");
  const booking = confirmed[0]?.data();
  if (confirmed.length !== 1 || booking?.academyId !== actor.academyId || booking.studentId !== studentId || booking.sessionId !== sessionId || booking.schemaVersion !== "1") throw new HttpsError("failed-precondition", "A regular class booking is required.");
  const membership = parseMembershipRecord((await db.doc(`${root}/memberships/${groupIdSchema.parse(booking.membershipId)}`).get()).data());
  if (!membership.ok || membership.value.academyId !== actor.academyId || membership.value.studentId !== studentId) throw new HttpsError("failed-precondition", "Membership is unavailable.");
  const [planDoc, sessionDoc] = await Promise.all([db.doc(`${root}/plans/${membership.value.planId}`).get(), db.doc(`${root}/sessions/${sessionId}`).get()]);
  const plan = parsePlanRecord(planDoc.data());
  if (!plan.ok || plan.value.academyId !== actor.academyId || plan.value.billingPeriod !== "per-session" || !sessionDoc.exists || sessionDoc.get("academyId") !== actor.academyId) throw new HttpsError("failed-precondition", "This booking does not use a PAYG plan.");
  const store = createFinanceStore({ firestore: db as unknown as Parameters<typeof createFinanceStore>[0]["firestore"], appendAudit: (tx, ref, draft) => appendAuditEventInTransaction(tx, ref, draft as unknown as AuditEventDraft) });
  const sourceRef = `${root}/sessions/${sessionId}`;
  const existing = await db.collection(`${root}/invoices`).where("sourceRef", "==", sourceRef).get();
  const invoices = existing.docs.flatMap((doc) => {
    const parsed = parseInvoiceRecord(doc.data());
    return parsed.ok && parsed.value.academyId === actor.academyId && parsed.value.invoiceId === doc.id && parsed.value.membershipId === membership.value.membershipId && parsed.value.familyId === membership.value.familyId && parsed.value.chargeKind === "payg_session" && parsed.value.status !== "void" ? [parsed.value] : [];
  });
  // Existing partial payments continue on the same invoice, never a second charge.
  const existingInvoice = invoices.find((invoice) => invoice.status !== "paid") ?? invoices[0];
  const invoice = existingInvoice ?? await store.issuePaygInvoice({
    academyId: actor.academyId, actorId: actor.userId, familyId: membership.value.familyId,
    membershipId: membership.value.membershipId, totalMinor: plan.value.priceMinor,
    dueAt: String(sessionDoc.get("startAt")), chargeKind: "payg_session", sourceRef,
    invoiceReference: `payg-${groupKey(sessionId, membership.value.membershipId)}`, description: `PAYG class: ${String(sessionDoc.get("startAt")).slice(0, 10)}`,
  });
  if (invoice.status === "void") throw new HttpsError("failed-precondition", "This class invoice was voided. Review it in Billing.");
  return { invoice: await store.getInvoice({ academyId: actor.academyId }, invoice.invoiceId) };
});
