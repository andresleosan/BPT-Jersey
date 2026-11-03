import { z } from "zod";
import { dateKeyInJersey } from "../schedule/member-calendar-contracts";
import type { BillingPeriod } from "./plan-contracts";
import type { MembershipStatus } from "./membership-contracts";

// Same as subscription-admin-contracts.ts, private there. This file must never import it: the
// dependency goes one way only, and a cycle would leave `instant` uninitialised at load time.
const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u);
const instant = z.iso.datetime();

export const paymentReminderSteps = Object.freeze([
  "ends-in-7",
  "ends-tomorrow",
  "payment-due",
  "final-reminder",
] as const);
export type PaymentReminderStep = (typeof paymentReminderSteps)[number];

/** `dry-run` is a rehearsal and does not count as processed; the other three do. */
export const paymentReminderOutcomes = Object.freeze([
  "sent",
  "no-email",
  "dry-run",
  "failed",
] as const);
export type PaymentReminderOutcome = (typeof paymentReminderOutcomes)[number];

export function paymentReminderStepNumber(step: PaymentReminderStep): 1 | 2 | 3 | 4 {
  return (paymentReminderSteps.indexOf(step) + 1) as 1 | 2 | 3 | 4;
}

function dayNumber(dateKey: string): number {
  const [year, month, day] = dateKey.split("-").map(Number);
  return Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1) / 86_400_000;
}

/**
 * Jersey end date minus Jersey run date, in whole calendar days. Both instants are turned into
 * Jersey dates first, so an `endsAt` near midnight UTC in summer (BST) counts on the date members
 * see: `2026-06-11T23:30:00Z` is Jersey date `2026-06-12`.
 */
export function daysUntilJerseyDate(endsAt: string, now: Date): number {
  return dayNumber(dateKeyInJersey(new Date(endsAt))) - dayNumber(dateKeyInJersey(now));
}

/** The step whose window holds `days` (Jersey end date minus Jersey run date), or null. */
export function dueReminderStep(days: number): PaymentReminderStep | null {
  if (days >= 2 && days <= 7) return "ends-in-7";
  if (days === 1) return "ends-tomorrow";
  if (days >= -6 && days <= -1) return "payment-due";
  if (days >= -13 && days <= -7) return "final-reminder";
  return null;
}

/**
 * Paid, recurring memberships that are running or overdue and end on or after the start date
 * (`YYYY-MM-DD`, Jersey). Per-session, free and complimentary memberships never get reminders.
 */
export function isPaymentReminderCandidate(input: {
  status: MembershipStatus;
  endsAt: string | null;
  billingPeriod: BillingPeriod;
  priceMinor: number;
  complimentary: boolean;
  startDateKey: string;
}): boolean {
  return (
    (input.status === "active" || input.status === "overdue") &&
    input.endsAt !== null &&
    (input.billingPeriod === "monthly" || input.billingPeriod === "term") &&
    input.priceMinor > 0 &&
    !input.complimentary &&
    dateKeyInJersey(new Date(input.endsAt)) >= input.startDateKey
  );
}

const stepRecordSchema = z.strictObject({
  at: instant,
  outcome: z.enum(paymentReminderOutcomes),
});

/** One document per membership: which steps ran for the current `endsAt`. */
export const membershipReminderStateSchema = z.strictObject({
  membershipId: id,
  endsAt: z.string(),
  steps: z.strictObject({
    "ends-in-7": stepRecordSchema.optional(),
    "ends-tomorrow": stepRecordSchema.optional(),
    "payment-due": stepRecordSchema.optional(),
    "final-reminder": stepRecordSchema.optional(),
  }),
  schemaVersion: z.literal("1"),
});
export type MembershipReminderState = z.infer<typeof membershipReminderStateSchema>;

/** The latest reminder for a membership, as the office sees it in the Payments tab. */
export const paymentReminderSummarySchema = z.strictObject({
  endsAt: z.string(),
  step: z.enum(paymentReminderSteps),
  stepNumber: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  at: instant,
  outcome: z.enum(paymentReminderOutcomes),
});
export type PaymentReminderSummary = z.infer<typeof paymentReminderSummarySchema>;

export function isProcessedOutcome(outcome: PaymentReminderOutcome): boolean {
  return outcome !== "dry-run";
}

/** The step with the latest `at`, or null when nothing has run. */
export function lastReminderOf(
  state: MembershipReminderState | null,
): PaymentReminderSummary | null {
  if (state === null) return null;
  let latest: PaymentReminderSummary | null = null;
  for (const step of paymentReminderSteps) {
    const record = state.steps[step];
    if (record === undefined) continue;
    if (latest !== null && Date.parse(record.at) <= Date.parse(latest.at)) continue;
    latest = {
      endsAt: state.endsAt,
      step,
      stepNumber: paymentReminderStepNumber(step),
      at: record.at,
      outcome: record.outcome,
    };
  }
  return latest;
}
