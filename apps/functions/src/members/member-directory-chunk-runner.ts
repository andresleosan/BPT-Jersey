import {
  buildMemberDirectoryChunkId,
  memberDirectoryChunkReceiptSchema,
  type MemberDirectoryChunkReceipt,
  type MemberDirectoryMigrationPhase,
} from "@bpt-jersey/domain/members/directory-migration";
import { planMemberDirectoryChunkCommit } from "@bpt-jersey/domain/members/directory-transitions";

import {
  constantTimeMacEquals,
  createMemberDirectoryChunkOutputSetMac,
} from "./member-directory-crypto.js";
import {
  advanceMemberDirectoryControlPlane,
  assertMemberDirectoryControlPlane,
  type MemberDirectoryGuardEvent,
  type MemberDirectoryRestoreGuard,
  type MemberDirectoryTransitionKind,
} from "./member-directory-state.js";

/**
 * The transactional envelope every member directory chunk goes through (T108).
 *
 * This deliberately knows nothing about what a chunk writes. Its job is the part that is identical
 * for bootstrap, forward, compensation, projection and recovery: prove the control plane is exactly
 * where it should be, decide commit / replay / refuse, and advance state, guard, receipt and audit
 * together or not at all. Each executor supplies its own domain writes to the same transaction.
 *
 * Splitting it this way is what stops the seven executors from each re-deriving the freeze rules,
 * which is where a migration usually grows its first silent inconsistency.
 */

/**
 * `restore-recovery` is a chunk-owning phase but is not handled here: it belongs to backup v3's
 * restore module, which owns its own approvals and proof rules. Mapping it to a migration
 * transition kind would file its audit trail under the wrong operation.
 */
const transitionKindByPhase: Readonly<
  Partial<Record<MemberDirectoryMigrationPhase, MemberDirectoryTransitionKind>>
> = {
  bootstrap: "identity-key-bootstrap",
  "identity-reconcile": "identity-key-reconcile",
  forward: "directory-forward",
  compensation: "failed-forward-compensation",
  "rollback-projection": "rollback-projection",
  "canonical-recovery": "canonical-recovery",
};

export type MemberDirectoryChunkControlPlane = Readonly<{
  state: unknown;
  guard: unknown;
  event: unknown;
  /** The stored receipt's output MAC, when this chunk was already committed. */
  committedOutputSetMac?: string;
  /** Rows committed by earlier chunks of the same operation. */
  priorRowCount: number;
}>;

/**
 * One domain document an executor wants created inside the chunk's transaction.
 *
 * Create-only, deliberately. Every phase that only adds documents - bootstrap, forward, projection -
 * is expressible here, and the phases that remove them (compensation, recovery) undo a *verified*
 * prior state rather than issuing free-form deletes, so they need their own reviewed shape rather
 * than a `delete` member added here in advance.
 */
export type MemberDirectoryChunkDomainWrite = Readonly<{
  operation: "create";
  path: string;
  data: Readonly<Record<string, unknown>>;
}>;

export type MemberDirectoryChunkCommitWrite = Readonly<{
  academyId: string;
  chunkId: string;
  nextState: unknown;
  guard: MemberDirectoryRestoreGuard;
  event: MemberDirectoryGuardEvent;
  receipt: MemberDirectoryChunkReceipt;
  /** The executor's own documents, created in the same transaction as everything above. */
  domainWrites: readonly MemberDirectoryChunkDomainWrite[];
}>;

export type MemberDirectoryChunkStore = Readonly<{
  read(
    input: Readonly<{ academyId: string; operationId: string; chunkId: string }>,
  ): Promise<MemberDirectoryChunkControlPlane>;
  /** Writes state, guard, event and receipt atomically, together with the caller's domain writes. */
  commit(write: MemberDirectoryChunkCommitWrite): Promise<void>;
}>;

export type MemberDirectoryChunkRunnerDependencies = Readonly<{
  projectId: string;
  store: MemberDirectoryChunkStore;
  integritySecretMaterial: string;
  integritySecretVersion: string;
  now: () => string;
}>;

export type MemberDirectoryChunkCommitRequest = Readonly<{
  academyId: string;
  operationId: string;
  phase: MemberDirectoryMigrationPhase;
  chunkNo: number;
  rowCount: number;
  quarantinedCount: number;
  outputSetMac: string;
  actorId: string;
  /** Required for, and only for, a compensation chunk. */
  sourceForwardChunkNo?: number;
  /**
   * The executor's domain writes. When present - an empty array included - the runner recomputes
   * the output-set MAC over them and refuses the chunk unless it equals `outputSetMac`, so the
   * receipt is a proof of what was written rather than a number the caller asserted. Omitting the
   * field leaves the MAC unchecked, which is only sound because a chunk with no domain writes
   * writes nothing to be wrong about.
   */
  domainWrites?: readonly MemberDirectoryChunkDomainWrite[];
}>;

export type MemberDirectoryChunkCommitResult = Readonly<{
  chunkId: string;
  committed: boolean;
  reason?: string;
}>;

export async function runMemberDirectoryChunkCommit(
  dependencies: MemberDirectoryChunkRunnerDependencies,
  request: MemberDirectoryChunkCommitRequest,
): Promise<MemberDirectoryChunkCommitResult> {
  const transitionKind = transitionKindByPhase[request.phase];
  if (transitionKind === undefined) {
    throw new Error(
      `Member directory phase ${request.phase} is not committed by the migration chunk runner`,
    );
  }

  const chunkId = buildMemberDirectoryChunkId({
    operationId: request.operationId,
    phase: request.phase,
    chunkNo: request.chunkNo,
  });

  const domainWrites = request.domainWrites ?? [];
  // Checked before the first read: a chunk whose receipt does not describe its own writes must
  // never reach Firestore, however healthy the control plane turns out to be.
  if (request.domainWrites !== undefined) {
    const recomputed = createMemberDirectoryChunkOutputSetMac({
      chunkId,
      phase: request.phase,
      writes: domainWrites,
      secretMaterial: dependencies.integritySecretMaterial,
    });
    if (!constantTimeMacEquals(recomputed, request.outputSetMac)) {
      throw new Error("Member directory chunk output set does not match its receipt MAC");
    }
  }

  const controlPlane = await dependencies.store.read({
    academyId: request.academyId,
    operationId: request.operationId,
    chunkId,
  });

  /**
   * Validates the guard event chain before anything else. A state that no longer matches its guard
   * means the control plane was restored or tampered with, and no chunk may commit over that.
   */
  const current = assertMemberDirectoryControlPlane({
    projectId: dependencies.projectId,
    state: controlPlane.state,
    guard: controlPlane.guard,
    event: controlPlane.event,
    integritySecretMaterial: dependencies.integritySecretMaterial,
    integritySecretVersion: dependencies.integritySecretVersion,
  });

  if (current.state.academyId !== request.academyId) {
    throw new Error("Member directory chunk academy does not match its control plane");
  }

  const now = dependencies.now();
  const decision = planMemberDirectoryChunkCommit({
    currentState: current.state,
    operationId: request.operationId,
    phase: request.phase,
    chunkNo: request.chunkNo,
    rowCount: request.rowCount,
    priorRowCount: controlPlane.priorRowCount,
    outputSetMac: request.outputSetMac,
    // Spread conditionally: under exactOptionalPropertyTypes an explicit `undefined` is not the
    // same as an absent optional property, and "no stored receipt" has to mean absent.
    ...(controlPlane.committedOutputSetMac === undefined
      ? {}
      : { committedOutputSetMac: controlPlane.committedOutputSetMac }),
    now,
    actorId: request.actorId,
  });

  if (decision.kind === "noop") {
    return Object.freeze({ chunkId, committed: false, reason: decision.reason });
  }

  const receipt = memberDirectoryChunkReceiptSchema.parse({
    chunkId,
    operationId: request.operationId,
    academyId: request.academyId,
    phase: request.phase,
    chunkNo: request.chunkNo,
    status: "committed",
    outputSetMac: request.outputSetMac,
    writtenCount: request.rowCount,
    quarantinedCount: request.quarantinedCount,
    ...(request.sourceForwardChunkNo === undefined
      ? {}
      : { sourceForwardChunkNo: request.sourceForwardChunkNo }),
    integrityMacVersion: "hmac-sha256-v1",
    integritySecretVersion: dependencies.integritySecretVersion,
    schemaVersion: "1",
    createdAt: now,
    createdBy: request.actorId,
  });

  const advanced = advanceMemberDirectoryControlPlane({
    projectId: dependencies.projectId,
    state: current.state,
    guard: controlPlane.guard,
    event: controlPlane.event,
    nextState: decision.nextState,
    operationId: request.operationId,
    transitionKind,
    now,
    actorId: request.actorId,
    integritySecretMaterial: dependencies.integritySecretMaterial,
    integritySecretVersion: dependencies.integritySecretVersion,
  });

  await dependencies.store.commit({
    academyId: request.academyId,
    chunkId,
    nextState: decision.nextState,
    guard: advanced.guard,
    event: advanced.event,
    receipt,
    domainWrites,
  });

  return Object.freeze({ chunkId, committed: true });
}
