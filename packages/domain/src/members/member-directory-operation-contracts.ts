import { z } from "zod";

import {
  memberDirectoryOperationReceiptSchema,
  type MemberDirectoryMigrationPhase,
} from "./member-directory-migration-contracts";

/**
 * Operation lifecycle and lease rules for the member directory v1 migration (T108).
 *
 * This is the layer between the chunk contracts and the executors: it says which status a migration
 * operation may move to, and when a lease is still yours. Both are pure functions over values, so
 * they are provable without Firestore and the executors can call them inside a transaction.
 *
 * The rule that shapes everything here is from `docs/data/migrations/member-directory-v1.md`: an
 * expired lease never unfreezes anything automatically. Expiry is not an authorization bypass, so
 * every recovery path below still demands an explicit, audited step rather than letting the clock
 * hand the operation to whoever asks next.
 */

const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const opaqueIdentifierSchema = z.string().regex(identifierPattern);

export const memberDirectoryOperationTypes = Object.freeze([
  "identity-key-bootstrap",
  "identity-key-reconcile",
  "directory-forward",
  "post-cutover-rollback",
  "canonical-recovery",
  "member-directory-restore-recovery",
  "global-legacy-elimination",
] as const);

export type MemberDirectoryOperationType = (typeof memberDirectoryOperationTypes)[number];

export const memberDirectoryOperationStatuses = Object.freeze([
  "planned",
  "frozen",
  "applying",
  "verified",
  "completed",
  "failed",
  "compensating",
  "aborted",
] as const);

export type MemberDirectoryOperationStatus = (typeof memberDirectoryOperationStatuses)[number];

/** `completed` and `aborted` are terminal: nothing leaves them, including a replay. */
export const memberDirectoryTerminalStatuses: ReadonlySet<MemberDirectoryOperationStatus> = new Set(
  ["completed", "aborted"],
);

type TransitionRule = Readonly<{
  to: MemberDirectoryOperationStatus;
  /** When present, only these operation types may take the transition. */
  onlyFor?: readonly MemberDirectoryOperationType[];
  reason: string;
}>;

/**
 * The complete transition table. Anything not listed is rejected - a closed table rather than a set
 * of forbidden edges, so a new status cannot become reachable by omission.
 */
const transitions: Readonly<Record<MemberDirectoryOperationStatus, readonly TransitionRule[]>> = {
  planned: [
    { to: "frozen", reason: "normal acquisition" },
    {
      to: "completed",
      onlyFor: ["global-legacy-elimination"],
      reason: "the only short success path, atomic with its marker and proof checks",
    },
  ],
  frozen: [
    { to: "applying", reason: "first committed chunk" },
    { to: "failed", reason: "failure while frozen" },
  ],
  applying: [
    { to: "verified", reason: "verification transaction" },
    { to: "failed", reason: "failure while applying" },
  ],
  verified: [
    { to: "completed", reason: "completion transaction" },
    { to: "failed", reason: "failure after verification" },
  ],
  failed: [
    { to: "applying", reason: "exact-plan resume" },
    {
      to: "compensating",
      onlyFor: ["directory-forward"],
      reason: "same-plan reverse path",
    },
    {
      to: "aborted",
      onlyFor: ["identity-key-bootstrap"],
      reason: "metadata-only abandonment that preserves every key and domain document",
    },
  ],
  compensating: [
    { to: "aborted", reason: "compensation finished after exact prior-state verification" },
  ],
  completed: [],
  aborted: [],
};

export function isMemberDirectoryOperationStatusTransitionAllowed(
  input: Readonly<{
    operationType: MemberDirectoryOperationType;
    from: MemberDirectoryOperationStatus;
    to: MemberDirectoryOperationStatus;
  }>,
): boolean {
  const rule = transitions[input.from].find((candidate) => candidate.to === input.to);
  if (rule === undefined) {
    return false;
  }
  return rule.onlyFor === undefined || rule.onlyFor.includes(input.operationType);
}

export function assertMemberDirectoryOperationStatusTransition(
  input: Readonly<{
    operationType: MemberDirectoryOperationType;
    from: MemberDirectoryOperationStatus;
    to: MemberDirectoryOperationStatus;
  }>,
): void {
  if (!isMemberDirectoryOperationStatusTransitionAllowed(input)) {
    throw new Error(
      `Member directory operation ${input.operationType} cannot move from ${input.from} to ${input.to}`,
    );
  }
}

/** A lease lasts 120 server-clock seconds. Not configurable: the executors depend on the bound. */
export const memberDirectoryLeaseDurationSeconds = 120;

const thirtyMinutesMs = 30 * 60 * 1000;
const twoHoursMs = 2 * 60 * 60 * 1000;

/**
 * The receipt fixes a maximum initial deadline of 30 minutes, except the paged identity-reconcile
 * mode, whose unextended run may last two hours. Every later attempt is still bounded at 30 minutes
 * and needs its own non-replayable approval, which is why recovery below does not take this mode.
 */
export function maxInitialOperationDeadlineMs(
  input: Readonly<{ operationType: MemberDirectoryOperationType; pagedV2: boolean }>,
): number {
  if (input.pagedV2) {
    if (input.operationType !== "identity-key-reconcile") {
      throw new Error("Only identity-key-reconcile has a paged-v2 mode");
    }
    return twoHoursMs;
  }
  return thirtyMinutesMs;
}

function parseInstant(value: string, label: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid ${label} timestamp`);
  }
  return parsed;
}

/**
 * Expiry is inclusive of the boundary: at exactly `leaseExpiresAt` the lease is gone. A lease that
 * is "still valid at its expiry instant" is the kind of off-by-one that lets two writers overlap
 * for a tick, and the whole freeze exists to make that impossible.
 */
export function isLeaseExpired(input: Readonly<{ leaseExpiresAt: string; now: string }>): boolean {
  return parseInstant(input.now, "now") >= parseInstant(input.leaseExpiresAt, "leaseExpiresAt");
}

/**
 * Only the same operation and the same owner may renew, and only before expiry. A live lease cannot
 * be stolen, and an expired one cannot be renewed - it needs the audited recovery path instead,
 * which is a different thing with a different approval.
 */
export function assertLeaseRenewable(
  input: Readonly<{
    currentOperationId: string;
    currentLeaseOwner: string;
    currentLeaseExpiresAt: string;
    operationDeadline: string;
    requestedBy: string;
    requestedOperationId: string;
    now: string;
  }>,
): void {
  opaqueIdentifierSchema.parse(input.requestedOperationId);
  opaqueIdentifierSchema.parse(input.requestedBy);
  if (input.requestedOperationId !== input.currentOperationId) {
    throw new Error("A member directory lease cannot be renewed by a different operation");
  }
  if (input.requestedBy !== input.currentLeaseOwner) {
    throw new Error("A member directory lease cannot be renewed by a different owner");
  }
  if (isLeaseExpired({ leaseExpiresAt: input.currentLeaseExpiresAt, now: input.now })) {
    throw new Error(
      "An expired member directory lease cannot be renewed; it requires audited recovery",
    );
  }
  const renewedUntil = parseInstant(input.now, "now") + memberDirectoryLeaseDurationSeconds * 1000;
  if (renewedUntil > parseInstant(input.operationDeadline, "operationDeadline")) {
    throw new Error("A renewed member directory lease cannot outlive the operation deadline");
  }
}

/**
 * Recovery of an expired lease that is still inside the operation deadline. It issues a new lease
 * but changes no domain document, and it is never automatic: the caller has already verified the
 * exact operation, receipts and state.
 */
export function assertLeaseRecoveryWithinDeadline(
  input: Readonly<{ operationDeadline: string; now: string }>,
): void {
  const now = parseInstant(input.now, "now");
  if (
    now + memberDirectoryLeaseDurationSeconds * 1000 >
    parseInstant(input.operationDeadline, "operationDeadline")
  ) {
    throw new Error(
      "The operation deadline has passed or leaves no room for a lease; this needs post-deadline recovery",
    );
  }
}

/**
 * Post-deadline recovery, the escape hatch that prevents a permanent freeze. It grants a fresh
 * deadline no later than 30 minutes after server now - never an extension of the original, and
 * never the two-hour paged bound, which applies only to an initial unextended run.
 */
export function assertPostDeadlineRecoveryDeadline(
  input: Readonly<{ now: string; recoveryDeadline: string }>,
): void {
  const now = parseInstant(input.now, "now");
  const recovery = parseInstant(input.recoveryDeadline, "recoveryDeadline");
  if (recovery <= now) {
    throw new Error("A post-deadline recovery deadline must be in the future");
  }
  if (recovery > now + thirtyMinutesMs) {
    throw new Error("A post-deadline recovery deadline must be within 30 minutes of server now");
  }
}

/**
 * The parent operation document, `academies/{academyId}/memberDirectoryMigrations/{operationId}`.
 *
 * The chunk runner advances the control-plane state; this is the other half the spec asks for, and
 * until now it did not exist: the record that says which operation is running, what it was
 * authorised to do, and how far through its lifecycle it is.
 *
 * Its shape encodes the rule that matters most - "identity, versions, MACs and counts are
 * immutable". The dry-run receipt is nested whole rather than spread into the document, so a status
 * transition copies it by reference and there is no field a transition could quietly rewrite. What
 * a transition may touch is exactly the status and the audit envelope that records who moved it.
 *
 * `global-legacy-elimination` is deliberately outside this contract. It is the one operation type
 * that owns no chunk phase, and its planned receipt binds a different proof set entirely -
 * dependency registry, backup manifest, cross-project attestation - so folding it in here would
 * mean a document whose `phase` is a fiction. It gets its own contract when T097's marker path is
 * built.
 */
const chunkedOperationTypes = Object.freeze([
  "identity-key-bootstrap",
  "identity-key-reconcile",
  "directory-forward",
  "post-cutover-rollback",
  "canonical-recovery",
  "member-directory-restore-recovery",
] as const);

export type MemberDirectoryChunkedOperationType = (typeof chunkedOperationTypes)[number];

/**
 * Which chunk phases each operation type may own. `directory-forward` has two because compensation
 * runs under the same operation, which is why the phase change is an audited transition rather than
 * a new operation.
 */
const phasesByOperationType: Readonly<
  Record<MemberDirectoryChunkedOperationType, readonly MemberDirectoryMigrationPhase[]>
> = {
  "identity-key-bootstrap": ["bootstrap"],
  "identity-key-reconcile": ["identity-reconcile"],
  "directory-forward": ["forward", "compensation"],
  "post-cutover-rollback": ["rollback-projection"],
  "canonical-recovery": ["canonical-recovery"],
  "member-directory-restore-recovery": ["restore-recovery"],
};

const auditDateTimeSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u)
  .refine((value) => {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
  }, "Expected an RFC 3339 UTC timestamp with millisecond precision");

export const memberDirectoryOperationDocumentSchema = z
  .strictObject({
    operationId: opaqueIdentifierSchema,
    academyId: opaqueIdentifierSchema,
    operationType: z.enum(chunkedOperationTypes),
    status: z.enum(memberDirectoryOperationStatuses),
    /** The frozen dry-run receipt. Nothing in a transition may touch it. */
    receipt: memberDirectoryOperationReceiptSchema,
    /** The append-only audit event that recorded the transition into this status. */
    statusAuditEventId: opaqueIdentifierSchema,
    statusChangedAt: auditDateTimeSchema,
    statusChangedBy: opaqueIdentifierSchema,
    schemaVersion: z.literal("1"),
    createdAt: auditDateTimeSchema,
    createdBy: opaqueIdentifierSchema,
  })
  .superRefine((operation, context) => {
    if (operation.receipt.operationId !== operation.operationId) {
      context.addIssue({
        code: "custom",
        path: ["receipt", "operationId"],
        message: "The receipt must belong to its own operation",
      });
    }
    if (operation.receipt.academyId !== operation.academyId) {
      context.addIssue({
        code: "custom",
        path: ["receipt", "academyId"],
        message: "The receipt must belong to its own academy",
      });
    }
    if (!phasesByOperationType[operation.operationType].includes(operation.receipt.phase)) {
      context.addIssue({
        code: "custom",
        path: ["receipt", "phase"],
        message: `A ${operation.operationType} operation cannot run the ${operation.receipt.phase} phase`,
      });
    }
    if (Date.parse(operation.statusChangedAt) < Date.parse(operation.createdAt)) {
      context.addIssue({
        code: "custom",
        path: ["statusChangedAt"],
        message: "An operation cannot change status before it was created",
      });
    }
  });

export type MemberDirectoryOperationDocument = Readonly<
  z.infer<typeof memberDirectoryOperationDocumentSchema>
>;

/**
 * Moves the parent operation to another status, and nothing else.
 *
 * The transition table above already says which moves exist; this is what applies one to a real
 * document. Everything except the status and its audit envelope is carried over untouched, so a
 * "transition" that also edited a MAC or a count is not expressible rather than merely forbidden.
 */
export function planMemberDirectoryOperationStatusChange(
  input: Readonly<{
    current: MemberDirectoryOperationDocument;
    toStatus: MemberDirectoryOperationStatus;
    auditEventId: string;
    now: string;
    actorId: string;
  }>,
): MemberDirectoryOperationDocument {
  const current = memberDirectoryOperationDocumentSchema.parse(input.current);
  assertMemberDirectoryOperationStatusTransition({
    operationType: current.operationType,
    from: current.status,
    to: input.toStatus,
  });
  if (Date.parse(input.now) < Date.parse(current.statusChangedAt)) {
    // The audit trail of an operation has to read forwards. A transition stamped before the one it
    // follows would make the history unorderable, and status alone cannot recover the order.
    throw new Error("A member directory operation cannot transition backwards in time");
  }
  return memberDirectoryOperationDocumentSchema.parse({
    ...current,
    status: input.toStatus,
    statusAuditEventId: input.auditEventId,
    statusChangedAt: input.now,
    statusChangedBy: input.actorId,
  });
}

/**
 * The parent's half of a chunk commit.
 *
 * The spec ties `frozen -> applying` to the first committed chunk, in the same transaction, which
 * is what stops an operation from looking untouched after it has already written domain documents.
 * Later chunks change nothing, and compensation chunks run under `compensating` rather than moving
 * the parent at all - the phase change is what authorised them, and it happened earlier.
 *
 * Returning `undefined` for "no parent change" rather than the unchanged document is deliberate:
 * the caller then has nothing to write, instead of writing the same document again and having to
 * prove that rewrite was harmless.
 */
export function planMemberDirectoryOperationChunkStatus(
  input: Readonly<{
    current: MemberDirectoryOperationDocument;
    phase: MemberDirectoryMigrationPhase;
    chunkNo: number;
    auditEventId: string;
    now: string;
    actorId: string;
  }>,
): MemberDirectoryOperationDocument | undefined {
  const current = memberDirectoryOperationDocumentSchema.parse(input.current);
  if (!phasesByOperationType[current.operationType].includes(input.phase)) {
    throw new Error(`A ${current.operationType} operation cannot commit a ${input.phase} chunk`);
  }
  if (current.status === "frozen") {
    if (input.chunkNo !== 1) {
      throw new Error("A frozen member directory operation can only be moved by its first chunk");
    }
    return planMemberDirectoryOperationStatusChange({
      current,
      toStatus: "applying",
      auditEventId: input.auditEventId,
      now: input.now,
      actorId: input.actorId,
    });
  }
  if (current.status === "applying" || current.status === "compensating") {
    return undefined;
  }
  throw new Error(
    `A member directory chunk cannot commit while its operation is ${current.status}`,
  );
}
