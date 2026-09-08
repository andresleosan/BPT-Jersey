import {
  memberDirectoryStateSchema,
  type MemberDirectoryState,
} from "./member-directory-contracts";
import {
  isLeaseExpired,
  maxInitialOperationDeadlineMs,
  memberDirectoryLeaseDurationSeconds,
} from "./member-directory-operation-contracts";

/**
 * Acquisition planning for the member directory control plane (T108).
 *
 * `memberDirectoryStateSchema` already rejects an invalid state tuple. What it cannot say is which
 * tuple may become which, and under whose lease - that is here, as an explicit table rather than a
 * chain of conditionals, so an acquisition that is not listed simply has no rule and fails.
 *
 * The shape of the table comes straight from the spec: a normal acquisition moves from an *open*
 * tuple to its frozen operation tuple in one transaction. There are exactly two exceptions that
 * start already frozen, and they exist for a reason worth keeping visible - canonical recovery must
 * not briefly reopen writes on its way out of read-only, and restore acquire must consume the
 * prepared operation atomically rather than in two steps someone could interleave.
 */

export const memberDirectoryAcquirablePhases = Object.freeze([
  "bootstrap",
  "forward",
  "identity-reconcile",
  "rollback-projection",
  "canonical-recovery",
  "restore-recovery",
] as const);

export type MemberDirectoryAcquirablePhase = (typeof memberDirectoryAcquirablePhases)[number];

type TupleShape = Readonly<{
  readerVersion: MemberDirectoryState["readerVersion"];
  directoryWriteMode: MemberDirectoryState["directoryWriteMode"];
  freezeStatus: MemberDirectoryState["freezeStatus"];
  operationPhase: MemberDirectoryState["operationPhase"];
}>;

type AcquisitionRule = Readonly<{
  from: TupleShape;
  to: TupleShape;
  /** When set, the global marker must hold this exact value in the source state. */
  requiresMarker?: boolean;
  /** The two exceptions that start from an already-frozen stable tuple. */
  alreadyFrozen: boolean;
  /** Restore acquire alone consumes a prepared operation. */
  consumesPreparedOperation: boolean;
}>;

const preCutoverBaseline: TupleShape = {
  readerVersion: "legacy-v1",
  directoryWriteMode: "legacy-v1",
  freezeStatus: "open",
  operationPhase: "idle",
};

const canonicalOpen: TupleShape = {
  readerVersion: "canonical-v1",
  directoryWriteMode: "canonical-v1",
  freezeStatus: "open",
  operationPhase: "idle",
};

function frozen(
  readerVersion: MemberDirectoryState["readerVersion"],
  operationPhase: MemberDirectoryState["operationPhase"],
): TupleShape {
  return {
    readerVersion,
    directoryWriteMode: "blocked",
    freezeStatus: "frozen",
    operationPhase,
  };
}

const acquisitions: Readonly<Record<MemberDirectoryAcquirablePhase, AcquisitionRule>> = {
  bootstrap: {
    from: preCutoverBaseline,
    to: frozen("legacy-v1", "bootstrap"),
    requiresMarker: false,
    alreadyFrozen: false,
    consumesPreparedOperation: false,
  },
  forward: {
    from: preCutoverBaseline,
    to: frozen("legacy-v1", "forward"),
    requiresMarker: false,
    alreadyFrozen: false,
    consumesPreparedOperation: false,
  },
  "identity-reconcile": {
    from: canonicalOpen,
    to: frozen("canonical-v1", "identity-reconcile"),
    alreadyFrozen: false,
    consumesPreparedOperation: false,
  },
  /**
   * Rollback projection exists only while the legacy readers still do. Once the global marker is
   * true the protocol is disabled for good, so this acquisition must refuse rather than build a
   * projection nothing may ever read.
   */
  "rollback-projection": {
    from: canonicalOpen,
    to: frozen("canonical-v1", "rollback-projection"),
    requiresMarker: false,
    alreadyFrozen: false,
    consumesPreparedOperation: false,
  },
  "canonical-recovery": {
    from: frozen("legacy-rollback-v1", "rollback-readonly"),
    to: frozen("legacy-rollback-v1", "canonical-recovery"),
    requiresMarker: false,
    alreadyFrozen: true,
    consumesPreparedOperation: false,
  },
  "restore-recovery": {
    from: frozen("canonical-v1", "restore-prepared"),
    to: frozen("canonical-v1", "restore-recovery"),
    alreadyFrozen: true,
    consumesPreparedOperation: true,
  },
};

/**
 * Checks the table against its own documentation once, at import: exactly two rules may start from
 * an already-frozen tuple, and `alreadyFrozen` must agree with the source tuple it names. Without
 * this the flag would be a comment that can drift from the rule it sits next to.
 */
for (const [phase, rule] of Object.entries(acquisitions)) {
  if (rule.alreadyFrozen !== (rule.from.freezeStatus === "frozen")) {
    throw new Error(`Member directory acquisition rule ${phase} disagrees about its source freeze`);
  }
  if (!rule.alreadyFrozen && rule.from.freezeStatus !== "open") {
    throw new Error(`Member directory acquisition rule ${phase} must start from an open tuple`);
  }
}

if (Object.values(acquisitions).filter((rule) => rule.alreadyFrozen).length !== 2) {
  throw new Error("There are exactly two already-frozen member directory acquisition exceptions");
}

function matchesTuple(state: MemberDirectoryState, shape: TupleShape): boolean {
  return (
    state.readerVersion === shape.readerVersion &&
    state.directoryWriteMode === shape.directoryWriteMode &&
    state.freezeStatus === shape.freezeStatus &&
    state.operationPhase === shape.operationPhase
  );
}

function parseInstant(value: string, label: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid ${label} timestamp`);
  }
  return parsed;
}

export type MemberDirectoryAcquisitionInput = Readonly<{
  currentState: MemberDirectoryState;
  phase: MemberDirectoryAcquirablePhase;
  operationId: string;
  leaseId: string;
  leaseOwner: string;
  operationDeadline: string;
  now: string;
  actorId: string;
  pagedV2?: boolean;
}>;

/**
 * Plans the one transaction that takes the control plane from a stable tuple into a frozen
 * operation. It returns the next state; the caller writes it, the guard event and the audit entry
 * in the same transaction.
 */
export function planMemberDirectoryAcquisition(
  input: MemberDirectoryAcquisitionInput,
): MemberDirectoryState {
  const current = memberDirectoryStateSchema.parse(input.currentState);
  const rule = acquisitions[input.phase];

  if (!matchesTuple(current, rule.from)) {
    throw new Error(
      `Member directory ${input.phase} cannot be acquired from ${current.readerVersion}/${current.directoryWriteMode}/${current.freezeStatus}/${current.operationPhase}`,
    );
  }
  if (
    rule.requiresMarker !== undefined &&
    current.globalLegacyReadEliminated !== rule.requiresMarker
  ) {
    throw new Error(
      `Member directory ${input.phase} requires globalLegacyReadEliminated=${String(rule.requiresMarker)}`,
    );
  }

  /**
   * A source tuple that already carries an operation or lease is not a stable tuple, whatever its
   * phase says. Both already-frozen exceptions start from tuples that hold none, so this is also
   * how "neither exception permits an expired prior lease" is enforced: there must be no prior
   * lease at all, expired or otherwise.
   */
  if (
    current.activeOperationId !== undefined ||
    current.leaseId !== undefined ||
    current.leaseOwner !== undefined ||
    current.leaseExpiresAt !== undefined ||
    current.operationDeadline !== undefined
  ) {
    throw new Error("Member directory acquisition requires a stable tuple with no active lease");
  }
  if (current.lastCommittedChunkNo !== 0) {
    throw new Error("A stable member directory tuple must have lastCommittedChunkNo=0");
  }

  if (rule.consumesPreparedOperation) {
    if (current.preparedOperationId === undefined) {
      throw new Error("Restore acquire requires a prepared operation");
    }
    if (current.preparedOperationId !== input.operationId) {
      throw new Error("Restore acquire must consume its own prepared operation");
    }
  } else if (current.preparedOperationId !== undefined) {
    throw new Error("Only the restore-prepared tuple may carry a prepared operation");
  }

  const now = parseInstant(input.now, "now");
  const deadline = parseInstant(input.operationDeadline, "operationDeadline");
  const leaseExpiresAtMs = now + memberDirectoryLeaseDurationSeconds * 1000;
  if (deadline <= now) {
    throw new Error("A member directory operation deadline must be in the future");
  }
  const maximum = maxInitialOperationDeadlineMs({
    operationType:
      input.phase === "identity-reconcile" ? "identity-key-reconcile" : "directory-forward",
    pagedV2: input.pagedV2 === true,
  });
  if (deadline > now + maximum) {
    throw new Error("A member directory operation deadline exceeds its maximum initial window");
  }
  if (leaseExpiresAtMs > deadline) {
    throw new Error("A member directory lease cannot outlive its operation deadline");
  }

  const leaseExpiresAt = new Date(leaseExpiresAtMs).toISOString();
  if (isLeaseExpired({ leaseExpiresAt, now: input.now })) {
    throw new Error("A freshly issued member directory lease cannot already be expired");
  }

  const next: Record<string, unknown> = {
    ...current,
    readerVersion: rule.to.readerVersion,
    directoryWriteMode: rule.to.directoryWriteMode,
    freezeStatus: rule.to.freezeStatus,
    operationPhase: rule.to.operationPhase,
    stateRevision: current.stateRevision + 1,
    lastCommittedChunkNo: 0,
    activeOperationId: input.operationId,
    leaseId: input.leaseId,
    leaseOwner: input.leaseOwner,
    leaseExpiresAt,
    operationDeadline: input.operationDeadline,
    updatedAt: input.now,
    updatedBy: input.actorId,
  };
  delete next["preparedOperationId"];

  return memberDirectoryStateSchema.parse(next);
}

/**
 * Transaction budgets from the spec. The 50-row bound assumes the worst row writes a student, an
 * admin profile, five uniqueness reservations plus chunk receipt, audit and state - 353 writes,
 * under Firestore's 500 limit with size headroom. None of these may be raised without fresh
 * Emulator and load evidence.
 */
export const memberDirectoryMaxRowsPerChunk = 50;
export const memberDirectoryMaxChunksPerOperation = 8;
export const memberDirectoryMaxRowsPerOperation = 400;

export type MemberDirectoryChunkCommitDecision =
  | Readonly<{ kind: "commit"; nextState: MemberDirectoryState }>
  | Readonly<{ kind: "noop"; reason: string }>;

/**
 * Decides whether one chunk may commit, replay as a no-op, or must fail closed.
 *
 * The replay rule is the delicate part. A chunk that is already committed is a no-op *only* when
 * the receipt presented matches the stored one exactly; the same chunk number arriving with
 * different content is a retry under a receipt that no longer describes it, and the spec forbids
 * skipping or re-running it. Failing there is the difference between an idempotent replay and a
 * silent second write.
 */
export function planMemberDirectoryChunkCommit(
  input: Readonly<{
    currentState: MemberDirectoryState;
    operationId: string;
    phase: MemberDirectoryState["operationPhase"];
    chunkNo: number;
    rowCount: number;
    /** Rows already committed by earlier chunks of this operation. */
    priorRowCount: number;
    outputSetMac: string;
    /** The stored receipt for this chunk, when one already exists. */
    committedOutputSetMac?: string;
    now: string;
    actorId: string;
  }>,
): MemberDirectoryChunkCommitDecision {
  const current = memberDirectoryStateSchema.parse(input.currentState);

  if (current.activeOperationId === undefined || current.leaseExpiresAt === undefined) {
    throw new Error("A member directory chunk requires an active operation and lease");
  }
  if (current.activeOperationId !== input.operationId) {
    throw new Error("A member directory chunk requires its own operation");
  }
  if (current.operationPhase !== input.phase) {
    throw new Error(
      `A member directory chunk for ${input.phase} cannot commit while the state is in ${current.operationPhase}`,
    );
  }
  if (isLeaseExpired({ leaseExpiresAt: current.leaseExpiresAt, now: input.now })) {
    throw new Error("A member directory chunk requires a live lease");
  }
  if (
    current.operationDeadline !== undefined &&
    parseInstant(input.now, "now") >= parseInstant(current.operationDeadline, "operationDeadline")
  ) {
    throw new Error("A member directory chunk cannot commit past its operation deadline");
  }

  if (input.rowCount < 0 || input.rowCount > memberDirectoryMaxRowsPerChunk) {
    throw new Error(
      `A member directory chunk may carry at most ${String(memberDirectoryMaxRowsPerChunk)} rows`,
    );
  }
  if (input.chunkNo < 1 || input.chunkNo > memberDirectoryMaxChunksPerOperation) {
    throw new Error(
      `A member directory operation accepts at most ${String(memberDirectoryMaxChunksPerOperation)} chunks`,
    );
  }
  if (input.priorRowCount + input.rowCount > memberDirectoryMaxRowsPerOperation) {
    throw new Error(
      `A member directory operation accepts at most ${String(memberDirectoryMaxRowsPerOperation)} rows`,
    );
  }

  if (input.chunkNo <= current.lastCommittedChunkNo) {
    if (input.committedOutputSetMac === undefined) {
      throw new Error("A committed member directory chunk has no stored receipt to replay against");
    }
    if (input.committedOutputSetMac !== input.outputSetMac) {
      throw new Error(
        "A member directory chunk cannot be retried with different content under the same receipt",
      );
    }
    return Object.freeze({
      kind: "noop" as const,
      reason: `Chunk ${String(input.chunkNo)} of ${input.operationId} is already committed with the same receipt`,
    });
  }

  if (input.chunkNo !== current.lastCommittedChunkNo + 1) {
    throw new Error(
      `Member directory chunks advance without gaps; expected ${String(current.lastCommittedChunkNo + 1)} but got ${String(input.chunkNo)}`,
    );
  }

  return Object.freeze({
    kind: "commit" as const,
    nextState: memberDirectoryStateSchema.parse({
      ...current,
      stateRevision: current.stateRevision + 1,
      lastCommittedChunkNo: input.chunkNo,
      updatedAt: input.now,
      updatedBy: input.actorId,
    }),
  });
}

/**
 * Entering another phase under the same operation and lease - the forward-to-compensation move.
 * The phase-local chunk counter resets to 0, which is exactly why it must be an audited state
 * transition and not something an executor does implicitly between chunks.
 */
export function planMemberDirectoryPhaseChange(
  input: Readonly<{
    currentState: MemberDirectoryState;
    toPhase: MemberDirectoryState["operationPhase"];
    operationId: string;
    now: string;
    actorId: string;
  }>,
): MemberDirectoryState {
  const current = memberDirectoryStateSchema.parse(input.currentState);
  if (current.activeOperationId === undefined || current.leaseId === undefined) {
    throw new Error("A member directory phase change requires an active operation and lease");
  }
  if (current.activeOperationId !== input.operationId) {
    throw new Error("A member directory phase change requires its own operation");
  }
  if (current.leaseExpiresAt === undefined) {
    throw new Error("A member directory phase change requires a lease expiry");
  }
  if (isLeaseExpired({ leaseExpiresAt: current.leaseExpiresAt, now: input.now })) {
    throw new Error("A member directory phase change requires a live lease");
  }
  if (current.operationPhase !== "forward" || input.toPhase !== "compensation") {
    throw new Error(
      `Member directory phase change ${current.operationPhase} -> ${input.toPhase} is not permitted`,
    );
  }

  return memberDirectoryStateSchema.parse({
    ...current,
    operationPhase: input.toPhase,
    stateRevision: current.stateRevision + 1,
    lastCommittedChunkNo: 0,
    updatedAt: input.now,
    updatedBy: input.actorId,
  });
}

/**
 * The completion transaction of an identity-key bootstrap (T108).
 *
 * Verification moves only the parent: the state stays frozen with coverage incomplete, precisely so
 * that a crash between verifying and completing cannot expose a stable tuple whose parent never
 * finished. This is the other half - the one transaction that both records the proof and hands the
 * directory back.
 *
 * It returns to the pre-cutover tuple rather than opening the canonical one. Bootstrap covers the
 * identities that predated the writer; it does not migrate anything, so the reader it hands back is
 * the one it took. Cutover is `directory-forward`'s job and needs its own approval.
 */
export function planMemberDirectoryBootstrapCompletion(
  input: Readonly<{
    currentState: MemberDirectoryState;
    operationId: string;
    identityKeyBaselineMac: string;
    identityKeyBaselineArtifactId: string;
    now: string;
    actorId: string;
  }>,
): MemberDirectoryState {
  const current = memberDirectoryStateSchema.parse(input.currentState);

  if (
    current.readerVersion !== "legacy-v1" ||
    current.directoryWriteMode !== "blocked" ||
    current.freezeStatus !== "frozen" ||
    current.operationPhase !== "bootstrap"
  ) {
    throw new Error("Only a frozen bootstrap tuple can complete an identity-key bootstrap");
  }
  if (current.activeOperationId === undefined || current.activeOperationId !== input.operationId) {
    throw new Error("An identity-key bootstrap completion requires its own operation");
  }
  if (current.leaseExpiresAt === undefined) {
    throw new Error("An identity-key bootstrap completion requires a lease");
  }
  /**
   * An expired lease does not complete an operation any more than it commits a chunk. Completion
   * writes the baseline that every later writer trusts, so it is the last place to let the clock
   * stand in for authorization.
   */
  if (isLeaseExpired({ leaseExpiresAt: current.leaseExpiresAt, now: input.now })) {
    throw new Error("An identity-key bootstrap completion requires a live lease");
  }
  /**
   * Coverage alone is enough here, and deliberately so: the state schema already ties the baseline
   * MAC and artifact ID to coverage, so `incomplete` means no baseline is recorded. Re-checking the
   * baseline fields would be a second guard for a rule that already holds one level down, and the
   * kind that quietly rots when the schema changes underneath it.
   */
  if (current.identityKeyCoverage !== "incomplete") {
    throw new Error("An identity-key bootstrap completes coverage that is still incomplete");
  }

  const next: Record<string, unknown> = {
    ...current,
    readerVersion: "legacy-v1",
    directoryWriteMode: "legacy-v1",
    freezeStatus: "open",
    operationPhase: "idle",
    identityKeyCoverage: "complete",
    identityKeyBaselineMac: input.identityKeyBaselineMac,
    identityKeyBaselineArtifactId: input.identityKeyBaselineArtifactId,
    stateRevision: current.stateRevision + 1,
    lastCommittedChunkNo: 0,
    updatedAt: input.now,
    updatedBy: input.actorId,
  };
  // A stable tuple carries no operation or lease. Deleting rather than blanking is what the schema
  // demands, and it is also the difference between "no lease" and "a lease that is empty".
  for (const field of [
    "activeOperationId",
    "leaseId",
    "leaseOwner",
    "leaseExpiresAt",
    "operationDeadline",
    "preparedOperationId",
  ]) {
    delete next[field];
  }

  return memberDirectoryStateSchema.parse(next);
}
