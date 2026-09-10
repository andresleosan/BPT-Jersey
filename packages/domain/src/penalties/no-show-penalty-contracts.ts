import { err, ok, type Result } from "../result";

/**
 * T111: the manual, auditable no-show penalty of BRIEF decision 2.
 *
 * "Un no-show de Town genera una penalizacion manual auditable de GBP 15, con resolucion por office."
 * The platform proposes; office decides. Nothing is charged automatically: a proposal is a queue
 * entry that office either charges through the manual billing cycle or waives with a reason, and
 * both decisions keep the author and the moment.
 */
export const noShowPenaltyAmountMinor = 1_500;
export const noShowPenaltyCurrency = "GBP" as const;
/** Only Town no-shows are penalised (BRIEF decision 2). West is out of scope by the decision. */
export const noShowPenaltyLocationId = "town" as const;

export const noShowPenaltyStatuses = Object.freeze(["proposed", "charged", "waived"] as const);
export type NoShowPenaltyStatus = (typeof noShowPenaltyStatuses)[number];

export const noShowPenaltyDecisions = Object.freeze(["charge", "waive"] as const);
export type NoShowPenaltyDecision = (typeof noShowPenaltyDecisions)[number];

export type NoShowPenaltyResolution = Readonly<{
  decision: NoShowPenaltyDecision;
  reason: string;
  /** The manual invoice office issued in Billing for a charged penalty; null for a waiver. */
  invoiceId: string | null;
  resolvedAt: string;
  resolvedBy: string;
}>;

export type NoShowPenaltyRecord = Readonly<{
  penaltyId: string;
  academyId: string;
  sessionId: string;
  studentId: string;
  locationId: string;
  amountMinor: number;
  currency: typeof noShowPenaltyCurrency;
  status: NoShowPenaltyStatus;
  sessionStartAt: string;
  proposedAt: string;
  proposedBy: string;
  resolution: NoShowPenaltyResolution | null;
  schemaVersion: "1";
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
}>;

export const noShowPenaltySkipReasons = Object.freeze([
  "otherSite",
  "notNoShow",
  "medicalLeave",
] as const);
export type NoShowPenaltySkipReason = (typeof noShowPenaltySkipReasons)[number];

export type NoShowPenaltyProposal =
  | Readonly<{ propose: true; amountMinor: number }>
  | Readonly<{ propose: false; skipReason: NoShowPenaltySkipReason }>;

/** Deterministic identifier, so proposing twice for the same absence is the same document. */
export function buildNoShowPenaltyId(sessionId: string, studentId: string): string {
  return `${sessionId.trim()}__${studentId.trim()}`;
}

const dateOnlyPattern = /^\d{4}-\d{2}-\d{2}$/u;

/** True when an approved medical leave covers the day of the session. */
export function isCoveredByMedicalLeave(
  sessionStartAtIso: string,
  leaves: readonly Readonly<{ startDate: string; endDate: string; status: string }>[],
): boolean {
  const startMs = Date.parse(sessionStartAtIso);
  if (Number.isNaN(startMs)) return false;
  const day = new Date(startMs).toISOString().slice(0, 10);
  return leaves.some(
    (leave) =>
      leave.status === "active" &&
      dateOnlyPattern.test(leave.startDate) &&
      dateOnlyPattern.test(leave.endDate) &&
      leave.startDate <= day &&
      leave.endDate >= day,
  );
}

/**
 * Decides whether one absence earns a penalty proposal. An approved medical leave never does: the
 * MVP rule that medical absence must not cost a student a recognition would be hollow if the same
 * absence produced a charge.
 */
export function decideNoShowPenalty(
  input: Readonly<{
    locationId: string;
    attendanceState: string;
    sessionStartAt: string;
    medicalLeaves?: readonly Readonly<{ startDate: string; endDate: string; status: string }>[];
  }>,
): NoShowPenaltyProposal {
  if (input.attendanceState !== "no_show") {
    return Object.freeze({ propose: false as const, skipReason: "notNoShow" as const });
  }
  if (input.locationId !== noShowPenaltyLocationId) {
    return Object.freeze({ propose: false as const, skipReason: "otherSite" as const });
  }
  if (isCoveredByMedicalLeave(input.sessionStartAt, input.medicalLeaves ?? [])) {
    return Object.freeze({ propose: false as const, skipReason: "medicalLeave" as const });
  }
  return Object.freeze({ propose: true as const, amountMinor: noShowPenaltyAmountMinor });
}

export const noShowPenaltyReasonMinLength = 10;
export const noShowPenaltyReasonMaxLength = 280;

export type ResolveNoShowPenaltyInput = Readonly<{
  penaltyId: string;
  decision: NoShowPenaltyDecision;
  reason: string;
  invoiceId?: string;
}>;

const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseResolveNoShowPenaltyInput(
  input: unknown,
): Result<ResolveNoShowPenaltyInput, string> {
  if (!isRecord(input)) return err("Penalty resolution must be an object");
  const keys = Object.keys(input);
  const permitted = ["penaltyId", "decision", "reason", "invoiceId"];
  if (keys.some((key) => !permitted.includes(key))) {
    return err("Penalty resolution accepts only penaltyId, decision, reason and invoiceId");
  }
  const { penaltyId, decision, reason, invoiceId } = input;
  if (typeof penaltyId !== "string" || !identifierPattern.test(penaltyId)) {
    return err("penaltyId is invalid");
  }
  if (
    typeof decision !== "string" ||
    !noShowPenaltyDecisions.includes(decision as NoShowPenaltyDecision)
  ) {
    return err("decision must be charge or waive");
  }
  if (typeof reason !== "string") return err("reason is required");
  const trimmedReason = reason.trim();
  if (
    trimmedReason.length < noShowPenaltyReasonMinLength ||
    trimmedReason.length > noShowPenaltyReasonMaxLength
  ) {
    return err("reason length is out of range");
  }
  // An invoice belongs to a charge: office issues it in Billing and links it here. A waiver has no
  // invoice by definition.
  if (invoiceId !== undefined) {
    if (decision !== "charge") return err("invoiceId is only accepted when charging");
    if (typeof invoiceId !== "string" || !identifierPattern.test(invoiceId)) {
      return err("invoiceId is invalid");
    }
  }
  return ok(
    Object.freeze({
      penaltyId,
      decision: decision as NoShowPenaltyDecision,
      reason: trimmedReason,
      ...(invoiceId === undefined ? {} : { invoiceId }),
    }),
  );
}

/** The status a resolved penalty takes. */
export function resolvedPenaltyStatus(decision: NoShowPenaltyDecision): NoShowPenaltyStatus {
  return decision === "charge" ? "charged" : "waived";
}
