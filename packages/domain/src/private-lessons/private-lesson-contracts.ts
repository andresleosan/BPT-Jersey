import { z } from "zod";
import { addSubscriptionMonth } from "../memberships/subscription-admin-contracts";

export const privateLessonOptionIds = Object.freeze(["single", "monthly", "pack-10"] as const);
export type PrivateLessonOptionId = (typeof privateLessonOptionIds)[number];

export type PrivateLessonOption = Readonly<{
  displayName: string;
  priceMinor: number;
  credits: number;
  validityMonths: number;
}>;

/** Fixed catalogue: the server reads price, credits and validity from here, never from the client. */
export const PRIVATE_LESSON_OPTIONS: Readonly<Record<PrivateLessonOptionId, PrivateLessonOption>> =
  Object.freeze({
    single: Object.freeze({
      displayName: "Private lesson",
      priceMinor: 6500,
      credits: 1,
      validityMonths: 3,
    }),
    monthly: Object.freeze({
      displayName: "Private lessons monthly (4 sessions)",
      priceMinor: 20000,
      credits: 4,
      validityMonths: 1,
    }),
    "pack-10": Object.freeze({
      displayName: "Private lessons pack of 10",
      priceMinor: 50000,
      credits: 10,
      validityMonths: 6,
    }),
  });

/** Adds the option's validity in UTC calendar months, clamping to the end of short months. */
export function privateLessonExpiry(optionId: PrivateLessonOptionId, approvedAt: string): string {
  const start = new Date(approvedAt);
  const day = start.getUTCDate();
  // Step from the first of the month so the original day is clamped once, at the end.
  start.setUTCDate(1);
  let expiry = start.toISOString();
  for (let month = 0; month < PRIVATE_LESSON_OPTIONS[optionId].validityMonths; month += 1) {
    expiry = addSubscriptionMonth(expiry);
  }
  const result = new Date(expiry);
  const lastDay = new Date(
    Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0),
  ).getUTCDate();
  result.setUTCDate(Math.min(day, lastDay));
  return result.toISOString();
}

const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u);
const instant = z.iso.datetime();
const optionId = z.enum(privateLessonOptionIds);
const reference = z.string().trim().min(2).max(80);
export const privateLessonPaymentMethods = Object.freeze([
  "bank_transfer",
  "cash",
  "other",
] as const);
const method = z.enum(privateLessonPaymentMethods);

export const privateLessonPurchaseStatuses = Object.freeze([
  "pending",
  "approved",
  "rejected",
] as const);
export type PrivateLessonPurchaseStatus = (typeof privateLessonPurchaseStatuses)[number];

export const privateLessonPurchaseSchema = z.strictObject({
  purchaseId: id,
  studentId: id,
  accountUid: id.nullable(),
  optionId,
  priceMinor: z.number().int().positive(),
  creditsGranted: z.number().int().positive(),
  creditsRemaining: z.number().int().nonnegative(),
  status: z.enum(privateLessonPurchaseStatuses),
  source: z.enum(["member", "office"]),
  method,
  proofId: id.nullable(),
  bankReference: reference.nullable(),
  submittedAt: instant,
  decidedAt: instant.nullable(),
  decidedBy: id.nullable(),
  decisionReason: z.string().trim().max(300).nullable(),
  expiresAt: instant.nullable(),
  invoiceId: id.nullable(),
  schemaVersion: z.literal("1"),
});
export type PrivateLessonPurchase = z.infer<typeof privateLessonPurchaseSchema>;

export const privateLessonCreditUseSchema = z.strictObject({
  bookingId: id,
  purchaseId: id,
  studentId: id,
  sessionId: id,
  state: z.enum(["consumed", "restored"]),
  consumedAt: instant,
  restoredAt: instant.nullable(),
});
export type PrivateLessonCreditUse = z.infer<typeof privateLessonCreditUseSchema>;

export const submitPrivateLessonPurchaseInputSchema = z.strictObject({
  /** Same request id the payment proof was uploaded under; it also makes the submit replay-safe. */
  requestId: z.uuid(),
  studentId: id,
  optionId,
  proofId: id,
  bankReference: reference,
});
export type SubmitPrivateLessonPurchaseInput = z.infer<
  typeof submitPrivateLessonPurchaseInputSchema
>;
export const listMyPrivateLessonsInputSchema = z.strictObject({ studentId: id });
export const listPrivateLessonPurchasesInputSchema = z.strictObject({
  status: z.enum(privateLessonPurchaseStatuses),
});
export const reviewPrivateLessonPurchaseInputSchema = z.strictObject({
  purchaseId: id,
  decision: z.enum(["approve", "reject"]),
  reason: z.string().trim().max(300).nullable(),
});
export type ReviewPrivateLessonPurchaseInput = z.infer<
  typeof reviewPrivateLessonPurchaseInputSchema
>;
export const recordPrivateLessonPurchaseInputSchema = z.strictObject({
  studentId: id,
  /** One per office form submission, so a retried save never records the purchase twice. */
  requestId: z.uuid(),
  optionId,
  method,
  reference: reference.nullable(),
});
export type RecordPrivateLessonPurchaseInput = z.infer<
  typeof recordPrivateLessonPurchaseInputSchema
>;
/** Office opens a member's transfer proof; the server finds the object from the stored purchase. */
export const privateLessonProofUrlInputSchema = z.strictObject({ purchaseId: id });
export const privateLessonProofUrlSchema = z.strictObject({
  url: z.url().refine((value) => value.startsWith("https://")),
  expiresAt: instant,
});
export type PrivateLessonProofUrl = z.infer<typeof privateLessonProofUrlSchema>;
export const privateLessonBookingInputSchema = z.strictObject({ sessionId: id, studentId: id });
export type PrivateLessonBookingInput = z.infer<typeof privateLessonBookingInputSchema>;
export const cancelPrivateLessonBookingInputSchema = z.strictObject({
  bookingId: id,
  reason: z.string().trim().min(2).max(300),
});
export type CancelPrivateLessonBookingInput = z.infer<typeof cancelPrivateLessonBookingInputSchema>;

/** Office list row: the purchase plus the member's name for the review table. */
export const privateLessonPurchaseRowSchema = privateLessonPurchaseSchema.extend({
  studentName: z.string().max(200).nullable(),
});
export type PrivateLessonPurchaseRow = z.infer<typeof privateLessonPurchaseRowSchema>;

/** Output of `listMyPrivateLessons`: usable credits plus the member's purchase history. */
export const myPrivateLessonsSchema = z.strictObject({
  purchases: z.array(privateLessonPurchaseSchema),
  creditsAvailable: z.number().int().nonnegative(),
  nextExpiry: instant.nullable(),
});
export type MyPrivateLessons = z.infer<typeof myPrivateLessonsSchema>;

function isUsable(purchase: PrivateLessonPurchase, nowMs: number): boolean {
  return (
    purchase.status === "approved" &&
    purchase.creditsRemaining > 0 &&
    purchase.expiresAt !== null &&
    Date.parse(purchase.expiresAt) > nowMs
  );
}

/** FIFO by expiry: the approved purchase with credit that expires first, or null. */
export function pickCreditPurchase(
  purchases: readonly PrivateLessonPurchase[],
  now: string,
): PrivateLessonPurchase | null {
  const nowMs = Date.parse(now);
  const usable = purchases.filter((purchase) => isUsable(purchase, nowMs));
  usable.sort(
    (a, b) =>
      Date.parse(a.expiresAt!) - Date.parse(b.expiresAt!) ||
      a.purchaseId.localeCompare(b.purchaseId),
  );
  return usable[0] ?? null;
}

/** Totals the member-facing credit summary from the stored purchases. */
export function summarisePrivateLessonCredits(
  purchases: readonly PrivateLessonPurchase[],
  now: string,
): Readonly<{ creditsAvailable: number; nextExpiry: string | null }> {
  const nowMs = Date.parse(now);
  let creditsAvailable = 0;
  let nextExpiry: string | null = null;
  for (const purchase of purchases) {
    if (!isUsable(purchase, nowMs)) continue;
    creditsAvailable += purchase.creditsRemaining;
    if (nextExpiry === null || Date.parse(purchase.expiresAt!) < Date.parse(nextExpiry)) {
      nextExpiry = purchase.expiresAt;
    }
  }
  return { creditsAvailable, nextExpiry };
}
