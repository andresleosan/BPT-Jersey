import { createHash } from "node:crypto";
import type { DeliveryHistoryRecord, ExternalDeliveryRequest } from "@bpt-jersey/domain/delivery";
import type { BillingPeriod, PlanId } from "@bpt-jersey/domain/memberships";
import type { MembershipStatus } from "@bpt-jersey/domain/memberships/lifecycle";
import {
  daysUntilJerseyDate,
  dueReminderStep,
  isPaymentReminderCandidate,
  isProcessedOutcome,
  paymentReminderSteps,
  type MembershipReminderState,
  type PaymentReminderOutcome,
  type PaymentReminderStep,
} from "@bpt-jersey/domain/memberships/payment-reminders";
import { dateKeyInJersey } from "@bpt-jersey/domain/schedule/member-calendar";
import * as logger from "firebase-functions/logger";
import { formatReminderDates, paymentReminderTemplateId } from "./payment-reminder-emails.js";

/**
 * The daily membership payment reminder run, as pure orchestration over injected ports. The
 * rules are in docs/superpowers/specs/2026-11-03-membership-payment-reminders-design.md, "The
 * sequence". Logs carry ids, steps, outcomes, counts and `err.name` only, never names, addresses
 * or `err.message`.
 */

export type ReminderCandidate = {
  membershipId: string;
  studentId: string;
  familyId: string;
  status: MembershipStatus;
  endsAt: string;
  planId: PlanId;
};

/** `memberFirstName` is set for guardians only. */
export type ReminderRecipient = {
  email: string;
  recipientFirstName: string;
  memberFirstName: string | null;
};

export type PaymentReminderPorts = {
  listCandidates(fromIso: string, toIso: string): Promise<readonly ReminderCandidate[]>;
  loadPendingStudentIds(): Promise<ReadonlySet<string>>;
  loadPlans(): Promise<
    ReadonlyMap<string, { displayName: string; billingPeriod: BillingPeriod; priceMinor: number }>
  >;
  loadComplimentaryIds(ids: readonly string[]): Promise<ReadonlySet<string>>;
  loadStates(ids: readonly string[]): Promise<ReadonlyMap<string, MembershipReminderState>>;
  /** `null` means no email on file; `"out-of-scope"` means the student cannot renew. */
  resolveRecipient(
    candidate: ReminderCandidate,
    todayKey: string,
  ): Promise<ReminderRecipient | null | "out-of-scope">;
  dispatch(request: ExternalDeliveryRequest): Promise<DeliveryHistoryRecord>;
  saveStep(
    previous: MembershipReminderState | null,
    membershipId: string,
    endsAt: string,
    step: PaymentReminderStep,
    outcome: PaymentReminderOutcome,
    at: string,
  ): Promise<void>;
  notifyOfficeUnpaid(candidate: ReminderCandidate, planName: string): Promise<void>;
};

export type PaymentReminderRunSummary = {
  considered: number;
  byStep: Record<PaymentReminderStep, Partial<Record<PaymentReminderOutcome, number>>>;
  skipped: Record<
    "out-of-scope" | "pending-review" | "already-processed" | "no-step" | "capped",
    number
  >;
  /** Dry-run entries whose recipient resolved to no address. */
  dryRunNoEmail: number;
  /** Candidates whose evaluation threw before a step was chosen, or whose recipient lookup threw. */
  errors: number;
  /** Live candidates left for a later run after sending was paused for this one. */
  deferred: number;
};

const dayMs = 86_400_000;

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/**
 * The cycle identity of an `endsAt`: two spellings of the same instant are one cycle. Throws on
 * an unparsable value, so callers check `Date.parse` first.
 */
export function canonicalEndsAt(endsAt: string): string {
  return new Date(endsAt).toISOString();
}

/** True when a stored `endsAt` is the same cycle as `endsAt`; an unparsable one never is. */
export function sameReminderCycle(stored: string, endsAt: string): boolean {
  return (
    !Number.isNaN(Date.parse(stored)) &&
    !Number.isNaN(Date.parse(endsAt)) &&
    canonicalEndsAt(stored) === canonicalEndsAt(endsAt)
  );
}

/** sha256 hex of `${membershipId}|${endsAt}|${step}`, using the canonical `endsAt`. */
export function paymentReminderDeliveryId(
  membershipId: string,
  endsAt: string,
  step: PaymentReminderStep,
): string {
  return sha256Hex(`${membershipId}|${canonicalEndsAt(endsAt)}|${step}`);
}

/** Failures that would hit every later send of the run too: SES down, throttled or misconfigured. */
const pausingFailureCodes = new Set([
  "ses_unavailable",
  "ses_throttled",
  "provider_error",
  "ses_account",
]);

function zeroSummary(): PaymentReminderRunSummary {
  return {
    considered: 0,
    byStep: {
      "ends-in-7": {},
      "ends-tomorrow": {},
      "payment-due": {},
      "final-reminder": {},
    },
    skipped: {
      "out-of-scope": 0,
      "pending-review": 0,
      "already-processed": 0,
      "no-step": 0,
      capped: 0,
    },
    dryRunNoEmail: 0,
    errors: 0,
    deferred: 0,
  };
}

function countOutcome(
  summary: PaymentReminderRunSummary,
  step: PaymentReminderStep,
  outcome: PaymentReminderOutcome,
): void {
  const counts = summary.byStep[step];
  counts[outcome] = (counts[outcome] ?? 0) + 1;
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : "UnknownError";
}

function logStepError(
  stage: string,
  membershipId: string,
  step: PaymentReminderStep,
  error: unknown,
): void {
  logger.error("Payment reminder step failed", {
    stage,
    membershipId,
    step,
    errorName: errorName(error),
  });
}

function reminderVariables(
  recipient: ReminderRecipient,
  planName: string,
  endsAt: string,
): Record<string, string> {
  const { endDateLong, endDateShort } = formatReminderDates(endsAt);
  return {
    recipientFirstName: recipient.recipientFirstName,
    // Omitted for the member themself: the dispatcher rejects empty-string values.
    ...(recipient.memberFirstName !== null ? { memberFirstName: recipient.memberFirstName } : {}),
    planName,
    endDateLong,
    endDateShort,
  };
}

/** True when this step already ran for this `endsAt`, or any step ran today (one email a day). */
function alreadyProcessed(
  state: MembershipReminderState | null,
  endsAt: string,
  step: PaymentReminderStep,
  todayKey: string,
): { sameStep: boolean; today: boolean } {
  if (state === null) return { sameStep: false, today: false };
  const record = sameReminderCycle(state.endsAt, endsAt) ? state.steps[step] : undefined;
  const sameStep = record !== undefined && isProcessedOutcome(record.outcome);
  const today = paymentReminderSteps.some((candidateStep) => {
    const other = state.steps[candidateStep];
    return (
      other !== undefined &&
      isProcessedOutcome(other.outcome) &&
      dateKeyInJersey(new Date(other.at)) === todayKey
    );
  });
  return { sameStep, today };
}

/** The office notice for a final reminder that is not recorded this run; a failure is logged. */
async function notifyUnrecorded(
  ports: PaymentReminderPorts,
  candidate: ReminderCandidate,
  planName: string,
  step: PaymentReminderStep,
): Promise<void> {
  try {
    await ports.notifyOfficeUnpaid(candidate, planName);
  } catch (error) {
    logStepError("notify", candidate.membershipId, step, error);
  }
}

export async function runPaymentReminders(
  ports: PaymentReminderPorts,
  options: {
    academyId: string;
    now: Date;
    mode: "dry-run" | "live";
    startDateKey: string;
    cap: number;
  },
): Promise<PaymentReminderRunSummary> {
  const { academyId, now, mode, startDateKey, cap } = options;
  const summary = zeroSummary();
  const fromIso = new Date(now.getTime() - 14 * dayMs).toISOString();
  const toIso = new Date(now.getTime() + 8 * dayMs).toISOString();

  const candidates = await ports.listCandidates(fromIso, toIso);
  // Firestore.getAll throws when it gets no references, so stop before any load.
  if (candidates.length === 0) return summary;

  const membershipIds = candidates.map((candidate) => candidate.membershipId);
  const pendingStudentIds = await ports.loadPendingStudentIds();
  const plans = await ports.loadPlans();
  const complimentaryIds = await ports.loadComplimentaryIds(membershipIds);
  const states = await ports.loadStates(membershipIds);

  const todayKey = dateKeyInJersey(now);
  const at = now.toISOString();
  let used = 0;
  let capLogged = false;
  // Live only: once a send fails in a way every later send would too, the run stops sending.
  let paused = false;

  for (const candidate of candidates) {
    summary.considered += 1;
    const { membershipId, endsAt } = candidate;
    let step: PaymentReminderStep | null = null;
    try {
      if (Number.isNaN(Date.parse(endsAt))) {
        summary.skipped["out-of-scope"] += 1;
        continue;
      }
      // 1. Plan lookup.
      const plan = plans.get(candidate.planId);
      if (plan === undefined) {
        summary.skipped["out-of-scope"] += 1;
        continue;
      }
      // 2. Scope.
      if (
        !isPaymentReminderCandidate({
          status: candidate.status,
          endsAt,
          billingPeriod: plan.billingPeriod,
          priceMinor: plan.priceMinor,
          complimentary: complimentaryIds.has(membershipId),
          startDateKey,
        })
      ) {
        summary.skipped["out-of-scope"] += 1;
        continue;
      }
      // 3. Pending review: skipped and not recorded, so the step can still go out later.
      if (pendingStudentIds.has(candidate.studentId)) {
        summary.skipped["pending-review"] += 1;
        continue;
      }
      // 4. The latest step whose window holds today.
      const dueStep = dueReminderStep(daysUntilJerseyDate(endsAt, now));
      if (dueStep === null) {
        summary.skipped["no-step"] += 1;
        continue;
      }
      step = dueStep;
      const planName = plan.displayName;
      const previous = states.get(membershipId) ?? null;

      // 5. Already processed. Only processed outcomes block, so dry-run never blocks live.
      const processed = alreadyProcessed(previous, endsAt, step, todayKey);
      if (processed.sameStep || processed.today) {
        summary.skipped["already-processed"] += 1;
        if (mode === "live" && processed.sameStep && step === "final-reminder") {
          // Idempotent: repairs a notice an earlier run failed to create.
          try {
            await ports.notifyOfficeUnpaid(candidate, planName);
          } catch (error) {
            logStepError("notify-repair", membershipId, step, error);
          }
        }
        continue;
      }

      // 6. Cap: would-send entries in dry-run, dispatch attempts in live.
      if (used >= cap) {
        summary.skipped.capped += 1;
        if (!capLogged) {
          capLogged = true;
          logger.warn("Payment reminder cap reached", { cap, mode });
        }
        continue;
      }

      // 7. Dry-run: resolve only to count, save `dry-run`, never notify.
      if (mode === "dry-run") {
        const recipient = await ports.resolveRecipient(candidate, todayKey);
        if (recipient === "out-of-scope") {
          summary.skipped["out-of-scope"] += 1;
          continue;
        }
        if (recipient === null) summary.dryRunNoEmail += 1;
        else used += 1;
        await ports.saveStep(previous, membershipId, endsAt, step, "dry-run", at);
        countOutcome(summary, step, "dry-run");
        continue;
      }

      // 8. Live: resolve. A lookup that throws (an Auth outage) is not recorded, so the step can
      // still go out on a later run; a final reminder still notifies the office.
      let recipient: ReminderRecipient | null | "out-of-scope";
      try {
        recipient = await ports.resolveRecipient(candidate, todayKey);
      } catch (error) {
        logStepError("resolve", membershipId, step, error);
        summary.errors += 1;
        if (step === "final-reminder") await notifyUnrecorded(ports, candidate, planName, step);
        continue;
      }
      if (recipient === "out-of-scope") {
        summary.skipped["out-of-scope"] += 1;
        continue;
      }

      // 9. Paused: no dispatch and no record, so the step can still go out on a later run.
      if (paused) {
        summary.deferred += 1;
        if (step === "final-reminder") await notifyUnrecorded(ports, candidate, planName, step);
        continue;
      }

      // 10. Dispatch. A failure that would repeat for everyone pauses the rest of the run.
      let outcome: PaymentReminderOutcome;
      if (recipient === null) {
        outcome = "no-email";
      } else {
        const audience = recipient.memberFirstName !== null ? "guardian" : "self";
        const variables = reminderVariables(recipient, planName, endsAt);
        used += 1;
        let pauseCode: string | null = null;
        try {
          const record = await ports.dispatch({
            deliveryId: paymentReminderDeliveryId(membershipId, endsAt, step),
            academyId,
            channel: "email",
            recipient: recipient.email,
            templateId: paymentReminderTemplateId(step, audience),
            variables,
            requestedAt: now.toISOString(),
          });
          outcome =
            record.status === "accepted" || record.status === "delivered" ? "sent" : "failed";
          if (
            record.status === "failed" &&
            record.failureCode !== null &&
            pausingFailureCodes.has(record.failureCode)
          ) {
            pauseCode = record.failureCode;
          }
        } catch (error) {
          logStepError("send", membershipId, step, error);
          outcome = "failed";
          pauseCode = "dispatch_threw";
        }
        if (pauseCode !== null) {
          paused = true;
          logger.warn("Payment reminders: sending paused for this run", { failureCode: pauseCode });
        }
      }

      // 11. Final reminder: the office notice comes before the save, whatever the outcome.
      if (step === "final-reminder") {
        try {
          await ports.notifyOfficeUnpaid(candidate, planName);
        } catch (error) {
          logStepError("notify", membershipId, step, error);
          countOutcome(summary, step, "failed");
          continue;
        }
      }

      // 12. Save the step.
      try {
        await ports.saveStep(previous, membershipId, endsAt, step, outcome, at);
      } catch (error) {
        logStepError("save", membershipId, step, error);
        countOutcome(summary, step, "failed");
        continue;
      }
      countOutcome(summary, step, outcome);
    } catch (error) {
      // A run never aborts: anything else that throws is logged by id and counted.
      if (step === null) {
        logger.error("Payment reminder candidate failed", {
          membershipId,
          errorName: errorName(error),
        });
        summary.errors += 1;
      } else {
        logStepError("evaluate", membershipId, step, error);
        countOutcome(summary, step, "failed");
      }
    }
  }

  return summary;
}

/**
 * Sends every step to `recipient` for both audiences (4 × 2) with synthetic values, so the
 * office can review the emails. Reads no member data. Returns how many were accepted or
 * delivered.
 */
export async function sendPaymentReminderSamples(
  dispatch: PaymentReminderPorts["dispatch"],
  options: { academyId: string; recipient: string; now: Date },
): Promise<number> {
  const { academyId, recipient, now } = options;
  const endsAt = new Date(now.getTime() + 7 * dayMs).toISOString();
  const samples: readonly { audience: "self" | "guardian"; person: ReminderRecipient }[] = [
    {
      audience: "self",
      person: { email: recipient, recipientFirstName: "Sam", memberFirstName: null },
    },
    {
      audience: "guardian",
      person: { email: recipient, recipientFirstName: "Ana", memberFirstName: "Leo" },
    },
  ];
  let sent = 0;
  for (const step of paymentReminderSteps) {
    for (const { audience, person } of samples) {
      const templateId = paymentReminderTemplateId(step, audience);
      const record = await dispatch({
        deliveryId: sha256Hex(`sample|${now.toISOString()}|${templateId}`),
        academyId,
        channel: "email",
        recipient,
        templateId,
        variables: reminderVariables(person, "Adults Unlimited", endsAt),
        requestedAt: now.toISOString(),
      });
      if (record.status === "accepted" || record.status === "delivered") sent += 1;
    }
  }
  return sent;
}
