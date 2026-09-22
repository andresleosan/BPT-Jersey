import { createHash } from "node:crypto";
import { getFirestore, type DocumentData, type Firestore } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { z } from "zod";
import { buildBookingId, buildBookingIdCandidates, type PaygBookingPayment } from "@bpt-jersey/domain/schedule";
import { groupIdSchema } from "@bpt-jersey/domain/schedule/groups";
import { parsePlanRecord } from "@bpt-jersey/domain/memberships";
import { parseMembershipRecord } from "@bpt-jersey/domain/memberships/lifecycle";
import { parseInvoiceRecord, type InvoiceRecord } from "@bpt-jersey/domain/finance";
import type { AuditEventDraft } from "@bpt-jersey/domain/audit";
import { appendAuditEventInTransaction } from "../audit/audit-writer.js";
import { requireActiveOfficeActor } from "../auth/office-actor.js";
import { requireUserActor } from "../auth/user-authorization.js";
import { createFinanceStore, type FinanceStore } from "../finance/finance-service.js";
import { requireMemberAccountActor } from "../members/member-access-callables.js";
import { enrolmentStorageSecrets } from "../members/enrolment-payment-proof.js";
import { validateIntroProof } from "../memberships/intro-payment-proof.js";
import { createPrivateStorageR2Client, type R2Client } from "../storage/r2-client.js";
import { createFirestoreCanonicalClientStudentScopeResolver } from "./canonical-client-student-scope.js";
import { scheduleCallableOptions } from "./schedule-callable-options.js";
import { groupKey } from "./group-keys.js";

const staffRoles = Object.freeze(["owner", "administrator", "headCoach", "coach"] as const);
const classPaymentSchema = z.object({ sessionId: groupIdSchema, studentId: groupIdSchema }).strict();
const pngMagic = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
/**
 * `requireStudentScope` lives in `schedule-callables.ts`, which imports this module's helpers
 * through `payg-booking-payment.ts`; resolving the member's scope here directly keeps that import
 * a straight line. `requireMemberAccountActor` already narrows the caller to a member account.
 */
const resolveMemberStudentScope = createFirestoreCanonicalClientStudentScopeResolver();

export function paygFinanceStore(db: Firestore): FinanceStore {
  return createFinanceStore({
    firestore: db as unknown as Parameters<typeof createFinanceStore>[0]["firestore"],
    appendAudit: (tx, ref, draft) => appendAuditEventInTransaction(tx, ref, draft as unknown as AuditEventDraft),
  });
}

export function paygProofKey(academyId: string, userId: string, bookingId: string, proofId: string): string {
  const owner = createHash("sha256").update(userId).digest("hex");
  return `academies/${academyId}/payg-proofs/${owner}/${bookingId}/${proofId}`;
}

/** Deterministic per class and membership, so concurrent callers settle on one invoice. A voided
 *  generation is never reused: the store returns an invoice by reference whatever its status. */
export function paygInvoiceReference(sessionId: string, membershipId: string, generation = 0): string {
  return `payg-${groupKey(sessionId, membershipId)}${generation === 0 ? "" : `-r${generation + 1}`}`;
}

/**
 * Every account that could have uploaded this booking's screenshot. A guardian and their teen are
 * both authorised to book for the same student, so either may have paid; the bytes still have to
 * hash to the declared proof id, which is what actually admits the evidence.
 */
export function paygProofOwners(booking: Readonly<{ createdBy?: unknown; updatedBy?: unknown }>, ...also: readonly string[]): readonly string[] {
  return [...new Set([...also, booking.updatedBy, booking.createdBy].filter((value): value is string => typeof value === "string" && value.length > 0))];
}

/** The first stored object under any owner whose bytes hash to `proofId`; undefined if there is none. */
export async function findPaygProof(storage: R2Client, academyId: string, bookingId: string, proofId: string, owners: readonly string[]): Promise<{ objectKey: string; bytes: Buffer } | undefined> {
  for (const owner of owners) {
    const objectKey = paygProofKey(academyId, owner, bookingId, proofId);
    const bytes = await storage.readObject(objectKey).then((value) => Buffer.from(value)).catch(() => undefined);
    if (bytes?.length && createHash("sha256").update(bytes).digest("hex") === proofId) return { objectKey, bytes };
  }
  return undefined;
}

/** The single confirmed regular-class booking behind a PAYG payment action. */
async function readConfirmedPaygBooking(db: Firestore, academyId: string, sessionId: string, studentId: string): Promise<DocumentData> {
  const root = `academies/${academyId}`;
  const bookingDocs = await db.getAll(...buildBookingIdCandidates(sessionId, studentId).map((id) => db.doc(`${root}/bookings/${id}`)));
  const confirmed = bookingDocs.filter((doc) => doc.get("status") === "confirmed");
  const booking = confirmed[0]?.data();
  if (confirmed.length !== 1 || booking?.academyId !== academyId || booking.studentId !== studentId || booking.sessionId !== sessionId || booking.schemaVersion !== "1" || !groupIdSchema.safeParse(booking.membershipId).success) throw new HttpsError("failed-precondition", "A regular class booking is required.");
  return booking;
}

/**
 * The class invoice for one PAYG booking, issued once. Existing partial payments continue on the
 * same invoice, never a second charge, whoever asks for it.
 */
export async function ensurePaygClassInvoice(db: Firestore, input: Readonly<{ academyId: string; actorId: string; sessionId: string; studentId: string; membershipId: string }>): Promise<InvoiceRecord> {
  const root = `academies/${input.academyId}`;
  const membershipId = groupIdSchema.safeParse(input.membershipId);
  if (!membershipId.success) throw new HttpsError("failed-precondition", "Membership is unavailable.");
  const membership = parseMembershipRecord((await db.doc(`${root}/memberships/${membershipId.data}`).get()).data());
  if (!membership.ok || membership.value.academyId !== input.academyId || membership.value.studentId !== input.studentId) throw new HttpsError("failed-precondition", "Membership is unavailable.");
  const [planDoc, sessionDoc] = await Promise.all([db.doc(`${root}/plans/${membership.value.planId}`).get(), db.doc(`${root}/sessions/${input.sessionId}`).get()]);
  const plan = parsePlanRecord(planDoc.data());
  if (!plan.ok || plan.value.academyId !== input.academyId || plan.value.billingPeriod !== "per-session" || !sessionDoc.exists || sessionDoc.get("academyId") !== input.academyId) throw new HttpsError("failed-precondition", "This booking does not use a PAYG plan.");
  const sourceRef = `${root}/sessions/${input.sessionId}`;
  const existing = await db.collection(`${root}/invoices`).where("sourceRef", "==", sourceRef).get();
  const forThisClass = existing.docs.flatMap((doc) => {
    const parsed = parseInvoiceRecord(doc.data());
    return parsed.ok && parsed.value.academyId === input.academyId && parsed.value.invoiceId === doc.id && parsed.value.membershipId === membership.value.membershipId && parsed.value.familyId === membership.value.familyId && parsed.value.chargeKind === "payg_session" ? [parsed.value] : [];
  });
  const live = forThisClass.filter((invoice) => invoice.status !== "void");
  const existingInvoice = live.find((invoice) => invoice.status !== "paid") ?? live[0];
  // Cancelling voids the class invoice, and the finance store hands back whatever invoice already
  // holds a reference, void or not. Re-booking therefore needs a NEW reference, counted from the
  // voided invoices already there so that two racing re-bookings still derive the same one and
  // settle on a single invoice.
  const generation = forThisClass.length - live.length;
  const invoice = existingInvoice ?? await paygFinanceStore(db).issuePaygInvoice({
    academyId: input.academyId, actorId: input.actorId, familyId: membership.value.familyId,
    membershipId: membership.value.membershipId, totalMinor: plan.value.priceMinor,
    dueAt: String(sessionDoc.get("startAt")), chargeKind: "payg_session", sourceRef,
    invoiceReference: paygInvoiceReference(input.sessionId, membership.value.membershipId, generation), description: `PAYG class: ${String(sessionDoc.get("startAt")).slice(0, 10)}`,
  });
  if (invoice.status === "void") throw new HttpsError("failed-precondition", "This class invoice was voided. Review it in Billing.");
  return invoice;
}

/** Preparing an invoice never records a payment. The existing office payment form does that. */
export const preparePaygClassPayment = onCall(scheduleCallableOptions, async (request) => {
  const actor = await requireActiveOfficeActor(request);
  const input = classPaymentSchema.safeParse(request.data);
  if (!input.success) throw new HttpsError("invalid-argument", "Choose a member and class.");
  const db = getFirestore();
  const booking = await readConfirmedPaygBooking(db, actor.academyId, input.data.sessionId, input.data.studentId);
  const invoice = await ensurePaygClassInvoice(db, { academyId: actor.academyId, actorId: actor.userId, ...input.data, membershipId: String(booking.membershipId) });
  return { invoice: await paygFinanceStore(db).getInvoice({ academyId: actor.academyId }, invoice.invoiceId) };
});

/**
 * One action on the session roster: the class invoice exists from the booking, so confirming a
 * payment only settles what is still owed. Staff confirm before or after the class — a member who
 * pays at reception on arrival is the ordinary case — so the session's start time is not a gate.
 */
export const confirmPaygClassPayment = onCall(scheduleCallableOptions, async (request) => {
  const actor = requireUserActor(request);
  if (!staffRoles.includes(actor.role as (typeof staffRoles)[number])) throw new HttpsError("permission-denied", "Staff access required to confirm payment.");
  const input = classPaymentSchema.safeParse(request.data);
  if (!input.success) throw new HttpsError("invalid-argument", "Choose a member and class.");
  const db = getFirestore();
  const booking = await readConfirmedPaygBooking(db, actor.academyId, input.data.sessionId, input.data.studentId);
  const membershipId = String(booking.membershipId);
  const invoice = await ensurePaygClassInvoice(db, { academyId: actor.academyId, actorId: actor.userId, ...input.data, membershipId });
  const store = paygFinanceStore(db);
  const view = await store.getInvoice({ academyId: actor.academyId }, invoice.invoiceId);
  if (view.balanceMinor === 0) return { status: "paid" as const };
  const transfer = (booking.paygPayment as PaygBookingPayment | undefined)?.method === "bank_transfer";
  await store.recordManualPayment({
    academyId: actor.academyId, actorId: actor.userId, invoiceId: invoice.invoiceId,
    amountMinor: view.balanceMinor, method: transfer ? "bank_transfer" : "cash",
    // Same shape as before, taken from the invoice so a re-booked generation gets its own
    // reference. Manual references carry no underscore, so the method reads as a plain word.
    manualReference: `${invoice.invoiceReference}-${transfer ? "transfer" : "cash"}`,
    occurredAt: new Date().toISOString(),
  });
  return { status: "paid" as const };
});

/** A member uploads the transfer screenshot before asking for the booking that will carry it. */
export const uploadPaygClassProof = onCall({ ...scheduleCallableOptions, secrets: enrolmentStorageSecrets }, async (request) => {
  const actor = await requireMemberAccountActor(request);
  const input = classPaymentSchema.extend({ contentType: z.enum(["image/png", "image/jpeg"]), base64: z.string().min(4).max(Math.ceil((2 * 1024 * 1024) / 3) * 4) }).strict().safeParse(request.data);
  if (!input.success) throw new HttpsError("invalid-argument", "Choose a PNG or JPEG screenshot up to 2 MB.");
  const allowed = await resolveMemberStudentScope({ academyId: actor.academyId, actorUserId: actor.userId, actorRole: actor.role as "guardian" | "adultStudent" | "teenStudent", requestedStudentId: input.data.studentId });
  if (!allowed) throw new HttpsError("permission-denied", "Access denied for this student");
  const validated = validateIntroProof(input.data.contentType, input.data.base64);
  await createPrivateStorageR2Client().putObject(paygProofKey(actor.academyId, actor.userId, buildBookingId(input.data.sessionId, input.data.studentId), validated.proofId), validated.bytes, input.data.contentType);
  return { proofId: validated.proofId };
});

/** Office-only, 60-second signed view of the member's transfer screenshot. */
export const getPaygClassProofUrl = onCall({ ...scheduleCallableOptions, secrets: enrolmentStorageSecrets }, async (request) => {
  const actor = await requireActiveOfficeActor(request);
  const input = classPaymentSchema.safeParse(request.data);
  if (!input.success) throw new HttpsError("invalid-argument", "Choose a member and class.");
  const db = getFirestore();
  const booking = await readConfirmedPaygBooking(db, actor.academyId, input.data.sessionId, input.data.studentId);
  const payment = booking.paygPayment as PaygBookingPayment | undefined;
  if (payment?.method !== "bank_transfer") throw new HttpsError("failed-precondition", "Payment evidence is unavailable.");
  const storage = createPrivateStorageR2Client();
  const proof = await findPaygProof(storage, actor.academyId, String(booking.bookingId), payment.proofId, paygProofOwners(booking));
  const contentType = proof === undefined ? null : proof.bytes.subarray(0, 8).equals(pngMagic) ? ("image/png" as const) : proof.bytes[0] === 255 && proof.bytes[1] === 216 && proof.bytes[2] === 255 ? ("image/jpeg" as const) : null;
  if (!proof || !contentType || !storage.createPrivateImageUrl) throw new HttpsError("failed-precondition", "Payment evidence is unavailable.");
  return { url: await storage.createPrivateImageUrl({ objectKey: proof.objectKey, expiresInSeconds: 60, contentType }), expiresAt: new Date(Date.now() + 60_000).toISOString() };
});
