import type { MemberDirectoryState } from "@bpt-jersey/domain/members/directory";
import {
  assertChunkSequence,
  memberDirectoryChunkReceiptSchema,
} from "@bpt-jersey/domain/members/directory-migration";
import {
  memberDirectoryOperationDocumentSchema,
  planMemberDirectoryOperationStatusChange,
  type MemberDirectoryOperationDocument,
} from "@bpt-jersey/domain/members/directory-operations";
import {
  assertMemberDirectoryForwardClosable,
  planMemberDirectoryForwardCutover,
} from "@bpt-jersey/domain/members/directory-transitions";

import { constantTimeMacEquals } from "./member-directory-crypto.js";
import { assertMemberDirectoryForwardBaseline } from "./member-directory-forward-runner.js";
import {
  openMemberDirectoryFrozenPlan,
  type MemberDirectoryFrozenPlan,
  type MemberDirectoryFrozenPlanStore,
} from "./member-directory-frozen-plan.js";
import {
  advanceMemberDirectoryControlPlane,
  assertMemberDirectoryControlPlane,
  type MemberDirectoryGuardEvent,
  type MemberDirectoryRestoreGuard,
} from "./member-directory-state.js";

/**
 * The closure of a directory-forward operation (T108, slice 15): steps 10 and 11 of the confirmation
 * algorithm, which are the two transactions that end the migration.
 *
 * Verification proves that every chunk the frozen plan named committed exactly the output it froze,
 * and moves only the parent `applying -> verified`. The state stays legacy, blocked and frozen
 * throughout: a crash here must not be able to leave a tenant serving from a canonical directory
 * whose parent never finished. Cutover re-establishes the same proof from scratch and then, in one
 * transaction, switches the reader, releases the freeze and the lease, and completes the parent.
 *
 * **The proof is a function called twice, not a flag read once.** Exactly as in the bootstrap
 * closure: the completion transaction re-derives everything rather than trusting a `verified` parent
 * it happened to find, because a crash between the two must resume in the completion transaction and
 * that transaction has to re-establish the proof rather than inherit it.
 *
 * **Where the answers come from.** The frozen plan poses the question - these chunks, these output
 * roots, this many rows - and Firestore answers it with the receipts that were actually committed
 * and the students that actually exist. Taking both sides from the artifact would prove only that
 * the artifact equals itself, which is the mistake slice 9 wrote down and this follows.
 *
 * **What cutover deliberately does not do.** It does not retire the legacy reader.
 * `globalLegacyReadEliminated` stays false and the rollback protocol stays `legacy-projection-v1`,
 * because switching the reader and proving nothing depends on `members` any more are two different
 * claims, and only T097 may make the second.
 */

export type MemberDirectoryForwardClosureControlPlane = Readonly<{
  state: unknown;
  guard: unknown;
  event: unknown;
  operation: unknown;
  /** Every committed chunk receipt of this operation's forward phase. */
  receipts: readonly unknown[];
  /**
   * The canonical students the tenant holds right now, counted under the freeze. It is a count and
   * not a list on purpose: the closure needs the number the capacity equation was built on, and
   * enumerating students here would be a second bounded scan with nothing to compare it against.
   */
  admittedStudentCount: number;
}>;

export type MemberDirectoryForwardVerificationWrite = Readonly<{
  academyId: string;
  /**
   * The control-plane position the proof was made against. The commit refuses unless state and
   * guard still stand here, which is what lets verification write the parent alone: it is filed
   * against a position proven current at the moment of the write, not one merely read earlier.
   */
  expectedStateRevision: number;
  expectedEventMac: string;
  operation: MemberDirectoryOperationDocument;
}>;

export type MemberDirectoryForwardCutoverWrite = Readonly<{
  academyId: string;
  nextState: MemberDirectoryState;
  guard: MemberDirectoryRestoreGuard;
  event: MemberDirectoryGuardEvent;
  operation: MemberDirectoryOperationDocument;
}>;

export type MemberDirectoryForwardClosureStore = Readonly<{
  read(
    input: Readonly<{ academyId: string; operationId: string }>,
  ): Promise<MemberDirectoryForwardClosureControlPlane>;
  /** Writes the parent and nothing else. */
  commitVerification(write: MemberDirectoryForwardVerificationWrite): Promise<void>;
  /** Writes state, guard, event and the parent atomically. */
  commitCutover(write: MemberDirectoryForwardCutoverWrite): Promise<void>;
}>;

export type MemberDirectoryForwardClosureDependencies = Readonly<{
  projectId: string;
  store: MemberDirectoryForwardClosureStore;
  artifacts: MemberDirectoryFrozenPlanStore;
  integritySecretMaterial: string;
  integritySecretVersion: string;
  now: () => string;
}>;

export type MemberDirectoryForwardClosureRequest = Readonly<{
  academyId: string;
  operationId: string;
  actorId: string;
}>;

export type MemberDirectoryForwardProof = Readonly<{
  /** The chunks the plan named, every one of them committed with the root it froze. */
  chunkCount: number;
  /** The manifest rows the committed receipts account for. */
  writtenRowCount: number;
  postCutoverAdmittedStudentCount: number;
  planMac: string;
}>;

export type MemberDirectoryForwardClosureResult = Readonly<{
  /** False when the parent already stood where this half would have moved it. */
  moved: boolean;
  reason?: string;
  /** Absent for exactly one outcome - a completed operation, which no longer has a frozen plan. */
  proof?: MemberDirectoryForwardProof;
}>;

function closureFailure(reason: string): never {
  throw new Error(`Member directory forward closure refused: ${reason}`);
}

type ForwardClosureContext = Readonly<{
  controlPlane: MemberDirectoryForwardClosureControlPlane;
  state: MemberDirectoryState;
  guard: unknown;
  event: MemberDirectoryGuardEvent;
  operation: MemberDirectoryOperationDocument;
  frozen: MemberDirectoryFrozenPlan;
}>;

/**
 * The control plane, the parent and the frozen artifacts.
 *
 * It stops short of the closure precondition on purpose. A *completed* operation fails that
 * precondition for the most ordinary reason there is - cutover opened the freeze and cleared the
 * lease - and a caller retrying after a commit it never saw acknowledged deserves "already
 * completed" rather than a control-plane error that sends somebody hunting for a fault.
 */
async function readForwardClosureContext(
  dependencies: MemberDirectoryForwardClosureDependencies,
  request: MemberDirectoryForwardClosureRequest,
  now: string,
): Promise<ForwardClosureContext> {
  const controlPlane = await dependencies.store.read({
    academyId: request.academyId,
    operationId: request.operationId,
  });

  const current = assertMemberDirectoryControlPlane({
    projectId: dependencies.projectId,
    state: controlPlane.state,
    guard: controlPlane.guard,
    event: controlPlane.event,
    integritySecretMaterial: dependencies.integritySecretMaterial,
    integritySecretVersion: dependencies.integritySecretVersion,
  });
  if (current.state.academyId !== request.academyId) {
    closureFailure("the control plane belongs to another academy");
  }

  const operation = memberDirectoryOperationDocumentSchema.parse(controlPlane.operation);
  if (
    operation.operationId !== request.operationId ||
    operation.academyId !== request.academyId ||
    operation.operationType !== "directory-forward"
  ) {
    closureFailure("the parent operation is not this academy's directory-forward");
  }

  const stored = await dependencies.artifacts.open({
    academyId: request.academyId,
    operationId: request.operationId,
  });
  const frozen = openMemberDirectoryFrozenPlan({
    receipt: operation.receipt,
    manifest: stored.manifest,
    plan: stored.plan,
    now,
    integritySecretMaterial: dependencies.integritySecretMaterial,
  });

  return Object.freeze({
    controlPlane,
    state: current.state,
    guard: current.guard,
    event: current.event,
    operation,
    frozen,
  });
}

/**
 * The whole proof, computed from scratch. Both halves of the closure call this.
 */
function establishForwardProof(
  context: ForwardClosureContext,
  request: MemberDirectoryForwardClosureRequest,
  now: string,
): MemberDirectoryForwardProof {
  const { controlPlane, frozen, operation } = context;

  // The same precondition the cutover planner enforces, applied here so verification stands on it
  // too rather than on a weaker copy of it.
  assertMemberDirectoryForwardClosable({
    currentState: context.state,
    operationId: request.operationId,
    now,
  });
  assertMemberDirectoryForwardBaseline({ state: context.state, receipt: operation.receipt });

  const receiptsByChunkNo = new Map<number, ReturnType<typeof parseForwardReceipt>>();
  for (const stored of controlPlane.receipts) {
    const receipt = parseForwardReceipt(stored, request);
    if (receiptsByChunkNo.has(receipt.chunkNo)) {
      closureFailure("two committed receipts claim the same chunk number");
    }
    receiptsByChunkNo.set(receipt.chunkNo, receipt);
  }
  if (receiptsByChunkNo.size !== frozen.plan.chunks.length) {
    // Fewer receipts than planned means the operation is not finished; more means it committed a
    // chunk the frozen plan never authorised. Neither is a migration to cut over.
    closureFailure("the committed chunks do not match the chunks the plan froze");
  }
  assertChunkSequence([...receiptsByChunkNo.keys()].sort((left, right) => left - right));

  let writtenRowCount = 0;
  for (const chunk of frozen.plan.chunks) {
    const receipt = receiptsByChunkNo.get(chunk.chunkNo);
    if (receipt === undefined) {
      closureFailure(`chunk ${String(chunk.chunkNo)} of the frozen plan has no committed receipt`);
    }
    if (!constantTimeMacEquals(receipt.outputSetMac, chunk.expectedOutputSetMac)) {
      // The chunk committed, but not the output the plan froze. That is the one thing the receipts
      // exist to make checkable after the fact, and it is checked before the reader switches.
      closureFailure(`chunk ${String(chunk.chunkNo)} committed an output its plan did not freeze`);
    }
    if (receipt.writtenCount !== chunk.sourceLegacyIds.length) {
      closureFailure(
        `chunk ${String(chunk.chunkNo)} wrote a different number of rows than planned`,
      );
    }
    if (receipt.quarantinedCount !== 0) {
      // Forward never quarantines: the confirmation rejects the whole plan when a row stops being
      // eligible. A non-zero count means something set a row aside, which no rule here authorises.
      closureFailure(`chunk ${String(chunk.chunkNo)} quarantined rows, which forward never does`);
    }
    writtenRowCount += receipt.writtenCount;
  }

  if (writtenRowCount !== frozen.manifest.rows.length) {
    closureFailure("the committed rows do not account for every row the manifest mapped");
  }

  /**
   * The exact student count the capacity equation was built on. Reading it now and comparing it to
   * the receipt is what makes `rollbackEligibleStudentCount` a measured number rather than an
   * asserted one: the rollback plan's whole bound rests on it.
   */
  if (controlPlane.admittedStudentCount !== operation.receipt.postCutoverAdmittedStudentCount) {
    closureFailure("the directory holds a different number of students than the plan predicted");
  }

  return Object.freeze({
    chunkCount: frozen.plan.chunks.length,
    writtenRowCount,
    postCutoverAdmittedStudentCount: operation.receipt.postCutoverAdmittedStudentCount,
    planMac: operation.receipt.planMac,
  });
}

/** One committed receipt, required to be this operation's forward chunk. */
function parseForwardReceipt(
  stored: unknown,
  request: MemberDirectoryForwardClosureRequest,
): ReturnType<typeof memberDirectoryChunkReceiptSchema.parse> {
  const receipt = memberDirectoryChunkReceiptSchema.parse(stored);
  if (
    receipt.operationId !== request.operationId ||
    receipt.academyId !== request.academyId ||
    receipt.phase !== "forward"
  ) {
    // A compensation receipt of the same operation is a real document and belongs to another
    // phase's proof entirely; folding one in here would count an undo as work done.
    closureFailure("a committed receipt does not belong to this operation's forward phase");
  }
  return receipt;
}

/**
 * Step 10: proves the migration and moves only the parent `applying -> verified`.
 */
export async function runMemberDirectoryForwardVerification(
  dependencies: MemberDirectoryForwardClosureDependencies,
  request: MemberDirectoryForwardClosureRequest,
): Promise<MemberDirectoryForwardClosureResult> {
  const now = dependencies.now();
  const context = await readForwardClosureContext(dependencies, request, now);
  if (context.operation.status === "completed") {
    return Object.freeze({ moved: false, reason: "the operation is already completed" });
  }
  const proof = establishForwardProof(context, request, now);

  if (context.operation.status === "verified") {
    // Already verified, and the proof just re-established says so correctly. Resume belongs to the
    // cutover transaction; repeating this one would be a second audit entry for one event.
    return Object.freeze({ moved: false, reason: "the operation is already verified", proof });
  }

  const operation = planMemberDirectoryOperationStatusChange({
    current: context.operation,
    toStatus: "verified",
    // The guard chain holds one event per state revision, and this transaction may not move the
    // state, so it names the event the control plane already stands at.
    auditEventId: context.event.eventId,
    now,
    actorId: request.actorId,
  });

  await dependencies.store.commitVerification({
    academyId: request.academyId,
    expectedStateRevision: context.state.stateRevision,
    expectedEventMac: context.event.eventMac,
    operation,
  });

  return Object.freeze({ moved: true, proof });
}

/**
 * Step 11: the same proof again, from scratch, and then the one transaction that switches the
 * reader, releases the freeze and the lease, and completes the parent.
 */
export async function runMemberDirectoryForwardCutover(
  dependencies: MemberDirectoryForwardClosureDependencies,
  request: MemberDirectoryForwardClosureRequest,
): Promise<MemberDirectoryForwardClosureResult> {
  const now = dependencies.now();
  const context = await readForwardClosureContext(dependencies, request, now);
  if (context.operation.status === "completed") {
    return Object.freeze({ moved: false, reason: "the operation is already completed" });
  }
  const proof = establishForwardProof(context, request, now);

  if (context.operation.status !== "verified") {
    // The spec makes cutover require a verified parent, and the reason is worth keeping: the
    // verification transaction is the audited record that the proof was established once already.
    // Cutting over straight from `applying` would switch the reader with no such record.
    closureFailure("the cutover requires a verified operation");
  }

  const nextState = planMemberDirectoryForwardCutover({
    currentState: context.state,
    operationId: request.operationId,
    postCutoverAdmittedStudentCount: proof.postCutoverAdmittedStudentCount,
    now,
    actorId: request.actorId,
  });

  const advanced = advanceMemberDirectoryControlPlane({
    projectId: dependencies.projectId,
    state: context.state,
    guard: context.guard,
    event: context.event,
    nextState,
    operationId: request.operationId,
    transitionKind: "directory-forward",
    now,
    actorId: request.actorId,
    integritySecretMaterial: dependencies.integritySecretMaterial,
    integritySecretVersion: dependencies.integritySecretVersion,
  });

  // Planned last, from the event this transaction is about to write, so the parent's completion and
  // the reader switch share one audit entry instead of two to be correlated afterwards.
  const operation = planMemberDirectoryOperationStatusChange({
    current: context.operation,
    toStatus: "completed",
    auditEventId: advanced.event.eventId,
    now,
    actorId: request.actorId,
  });

  await dependencies.store.commitCutover({
    academyId: request.academyId,
    nextState,
    guard: advanced.guard,
    event: advanced.event,
    operation,
  });

  return Object.freeze({ moved: true, proof });
}
