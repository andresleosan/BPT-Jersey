import type { MemberDirectoryState } from "@bpt-jersey/domain/members/directory";
import {
  assertChunkSequence,
  memberDirectoryChunkReceiptSchema,
  memberDirectoryRollbackCapacityLimit,
} from "@bpt-jersey/domain/members/directory-migration";
import {
  memberDirectoryOperationDocumentSchema,
  planMemberDirectoryOperationStatusChange,
  type MemberDirectoryOperationDocument,
} from "@bpt-jersey/domain/members/directory-operations";
import {
  assertMemberDirectoryBootstrapClosable,
  planMemberDirectoryBootstrapCompletion,
} from "@bpt-jersey/domain/members/directory-transitions";

import {
  verifyMemberDirectoryBootstrapBaseline,
  type MemberDirectoryBootstrapChunkEvidence,
  type MemberDirectoryBootstrapVerification,
} from "./member-directory-bootstrap-verification.js";
import {
  buildStudentIdentityKeyTuple,
  constantTimeMacEquals,
  parseStudentIdentityKeyTuple,
  studentIdentityKeyKinds,
  studentIdentityKeySchema,
} from "./member-directory-crypto.js";
import {
  advanceMemberDirectoryControlPlane,
  assertMemberDirectoryControlPlane,
  type MemberDirectoryGuardEvent,
  type MemberDirectoryRestoreGuard,
} from "./member-directory-state.js";

/**
 * The closure of an identity-key bootstrap (T108, slice 9): the two transactions that end the
 * operation, wired to the pure pieces slice 8 left behind.
 *
 * The spec asks for a verification transaction that moves only the parent `applying -> verified`,
 * and a completion transaction that re-establishes the same proof and moves both the parent
 * `verified -> completed` and the control plane back to its pre-cutover tuple. This module owns the
 * wiring; the proof itself is `verifyMemberDirectoryBootstrapBaseline` and the state change is
 * `planMemberDirectoryBootstrapCompletion`, both unchanged.
 *
 * **Where the proof's inputs come from, and why it is not circular.** The frozen artifact says
 * which reservation tuples this operation planned to own. Firestore says which reservations exist.
 * The runner reads the documents the artifact names, rebuilds each tuple *from what was stored*,
 * folds those into a baseline MAC and compares it with the artifact's. So the artifact supplies the
 * question and Firestore supplies the answer - if the two were both taken from the artifact the
 * comparison would prove only that the artifact equals itself.
 *
 * **Failing closed is left to one place.** A stored key with the wrong owner, kind, digest version
 * or secret version produces a tuple that differs, and dies on the MAC comparison. The runner
 * refuses early only for the things it cannot express as a tuple at all - a document that is
 * missing, unparseable, or filed under another academy, which the tuple does not carry. Adding a
 * per-field check next to a MAC that already covers it is the second guard that rots when the first
 * one changes.
 */

/** Nobody's baseline can exceed the rollback capacity times the identifier kinds a student may hold. */
export const memberDirectoryMaxBaselineIdentityKeys =
  memberDirectoryRollbackCapacityLimit * studentIdentityKeyKinds.length;

/**
 * The encrypted exact baseline artifact this operation froze, as the closure needs to read it.
 *
 * It is a port rather than a concrete store because the artifact lives outside Firestore by design
 * - the spec keeps the exact ordered tuple set and the private plan out of the database - and the
 * approved artifact store arrives with the frozen-plan slice. The shape here is exactly what the
 * bootstrap executor already emits per chunk, so freezing it is a copy rather than a translation.
 */
export type MemberDirectoryBootstrapBaselineArtifact = Readonly<{
  /** The opaque ID the completed state records, so the baseline can be reopened later. */
  artifactId: string;
  academyId: string;
  operationId: string;
  secretVersion: string;
  /** The baseline MAC recorded when the plan was frozen. */
  identityKeyBaselineMac: string;
  /** The expected tuples, partitioned by the chunk that was to own them, ascending. */
  chunks: readonly Readonly<{ chunkNo: number; expectedKeyTuples: readonly string[] }>[];
}>;

export type MemberDirectoryBootstrapArtifactStore = Readonly<{
  open(
    input: Readonly<{ academyId: string; operationId: string }>,
  ): Promise<MemberDirectoryBootstrapBaselineArtifact>;
}>;

export type MemberDirectoryBootstrapClosureControlPlane = Readonly<{
  state: unknown;
  guard: unknown;
  event: unknown;
  /** The parent operation document. */
  operation: unknown;
  /** Every committed chunk receipt of this operation, ascending by chunk number. */
  receipts: readonly unknown[];
  /** The stored `studentIdentityKeys` document for each key ID asked for, keyed by key ID. */
  identityKeys: ReadonlyMap<string, unknown>;
}>;

export type MemberDirectoryBootstrapVerificationWrite = Readonly<{
  academyId: string;
  /**
   * The control-plane position the proof was made against. The commit refuses unless state and
   * guard still stand exactly here, which is what lets the verification write the parent alone: it
   * is filed against a control plane proven not to have moved, rather than one merely read earlier.
   */
  expectedStateRevision: number;
  expectedEventMac: string;
  operation: MemberDirectoryOperationDocument;
}>;

export type MemberDirectoryBootstrapCompletionWrite = Readonly<{
  academyId: string;
  nextState: MemberDirectoryState;
  guard: MemberDirectoryRestoreGuard;
  event: MemberDirectoryGuardEvent;
  operation: MemberDirectoryOperationDocument;
}>;

export type MemberDirectoryBootstrapClosureStore = Readonly<{
  read(
    input: Readonly<{
      academyId: string;
      operationId: string;
      /** The key IDs the artifact expects. Nothing else is read from the reservation collection. */
      expectedKeyIds: readonly string[];
    }>,
  ): Promise<MemberDirectoryBootstrapClosureControlPlane>;
  /** Writes the parent and nothing else. */
  commitVerification(write: MemberDirectoryBootstrapVerificationWrite): Promise<void>;
  /** Writes state, guard, event and the parent atomically. */
  commitCompletion(write: MemberDirectoryBootstrapCompletionWrite): Promise<void>;
}>;

export type MemberDirectoryBootstrapClosureDependencies = Readonly<{
  projectId: string;
  store: MemberDirectoryBootstrapClosureStore;
  artifacts: MemberDirectoryBootstrapArtifactStore;
  integritySecretMaterial: string;
  integritySecretVersion: string;
  now: () => string;
}>;

export type MemberDirectoryBootstrapClosureRequest = Readonly<{
  academyId: string;
  operationId: string;
  actorId: string;
}>;

export type MemberDirectoryBootstrapClosureResult = Readonly<{
  /** False when the parent already stood where this half would have moved it. */
  moved: boolean;
  reason?: string;
  /**
   * The proof, whenever one could be established. It is absent for exactly one outcome - a
   * completed operation - because completion hands the directory back and clears the lease, so
   * there is no longer a frozen bootstrap for a proof to be about.
   */
  verification?: MemberDirectoryBootstrapVerification;
}>;

function closureFailure(reason: string): never {
  throw new Error(`Member directory bootstrap closure refused: ${reason}`);
}

type ClosureContext = Readonly<{
  artifact: MemberDirectoryBootstrapBaselineArtifact;
  controlPlane: MemberDirectoryBootstrapClosureControlPlane;
  state: MemberDirectoryState;
  guard: unknown;
  event: MemberDirectoryGuardEvent;
  operation: MemberDirectoryOperationDocument;
}>;

/**
 * Reads the artifact's expected tuples and refuses a set it cannot use: chunk numbers that are not
 * a gapless ascending sequence, or one key ID claimed by two chunks. Returns the key IDs in the
 * order the reservations must be read.
 */
function planArtifactReads(
  artifact: MemberDirectoryBootstrapBaselineArtifact,
  request: MemberDirectoryBootstrapClosureRequest,
): readonly string[] {
  if (
    artifact.academyId !== request.academyId ||
    artifact.operationId !== request.operationId ||
    artifact.artifactId.length === 0
  ) {
    closureFailure("the baseline artifact belongs to another operation or academy");
  }
  if (artifact.chunks.length === 0) {
    closureFailure("a baseline artifact with no chunk plans nothing to prove");
  }

  assertChunkSequence(artifact.chunks.map((chunk) => chunk.chunkNo));

  const keyIds: string[] = [];
  const seen = new Set<string>();
  for (const chunk of artifact.chunks) {
    for (const tuple of chunk.expectedKeyTuples) {
      const parsed = parseStudentIdentityKeyTuple(tuple);
      if (seen.has(parsed.keyId)) {
        // One reservation owned by two chunks would be folded into the baseline twice, which the
        // baseline MAC refuses anyway - but refusing here names the artifact rather than the proof.
        closureFailure("the baseline artifact claims one reservation under two chunks");
      }
      seen.add(parsed.keyId);
      keyIds.push(parsed.keyId);
    }
  }
  if (keyIds.length === 0) {
    closureFailure("a baseline artifact with no expected reservation proves nothing");
  }
  if (keyIds.length > memberDirectoryMaxBaselineIdentityKeys) {
    // Bounded before any read: the closure must not be the one place in the migration where an
    // unbounded fan-out of document gets is possible.
    closureFailure(
      `a baseline covers at most ${String(memberDirectoryMaxBaselineIdentityKeys)} reservations`,
    );
  }
  return Object.freeze(keyIds);
}

/**
 * Rebuilds one chunk's evidence: the receipt as stored, and the tuples of the reservations the
 * artifact expects that chunk to own, read back out of Firestore rather than taken from the plan.
 */
function chunkEvidence(
  expectedKeyTuples: readonly string[],
  receipt: unknown,
  identityKeys: ReadonlyMap<string, unknown>,
  academyId: string,
): MemberDirectoryBootstrapChunkEvidence {
  const tuples = expectedKeyTuples.map((expected) => {
    const { keyId } = parseStudentIdentityKeyTuple(expected);
    const stored = identityKeys.get(keyId);
    if (stored === undefined) {
      // The reservation the baseline is built from is not there. There is nothing to verify and
      // nothing to repair: a baseline is only as true as the documents that back it.
      closureFailure("a reservation the baseline artifact expects does not exist");
    }
    const parsed = studentIdentityKeySchema.safeParse(stored);
    if (!parsed.success) {
      closureFailure("a stored reservation is not a valid identity key record");
    }
    if (parsed.data.academyId !== academyId || parsed.data.keyId !== keyId) {
      // The tuple carries neither the academy nor the path it was read from, so a document from
      // another tenant would fold in silently. This is the one divergence the MAC cannot see.
      closureFailure("a stored reservation belongs to another academy or key");
    }
    return buildStudentIdentityKeyTuple(parsed.data);
  });
  return Object.freeze({ receipt, tuples: Object.freeze(tuples) });
}

/**
 * Everything a closure needs before it can decide anything: the artifact, the control plane read
 * against it, and the parent - each checked to be this academy's identity-key bootstrap.
 *
 * It deliberately stops short of the closure precondition. A *completed* operation fails that
 * precondition for the most ordinary reason there is - completion opened the freeze and cleared the
 * lease - and a caller retrying after a commit it never saw acknowledged deserves "already
 * completed" rather than a control-plane error that sends someone hunting for a fault that is not
 * there. Reading the parent before asserting the precondition is what makes that answer available.
 */
async function readClosureContext(
  dependencies: MemberDirectoryBootstrapClosureDependencies,
  request: MemberDirectoryBootstrapClosureRequest,
): Promise<ClosureContext> {
  const artifact = await dependencies.artifacts.open({
    academyId: request.academyId,
    operationId: request.operationId,
  });
  const expectedKeyIds = planArtifactReads(artifact, request);

  const controlPlane = await dependencies.store.read({
    academyId: request.academyId,
    operationId: request.operationId,
    expectedKeyIds,
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
    operation.operationType !== "identity-key-bootstrap"
  ) {
    closureFailure("the parent operation is not this academy's identity-key bootstrap");
  }

  return Object.freeze({
    artifact,
    controlPlane,
    state: current.state,
    guard: current.guard,
    event: current.event,
    operation,
  });
}

/**
 * The whole proof, computed from scratch. Both halves of the closure call this - the second one
 * re-establishes what the first proved rather than trusting a `verified` parent it found already
 * written, which is the property the spec asks for and the only reason the proof is a function
 * instead of a flag.
 */
function establishBootstrapProof(
  context: ClosureContext,
  dependencies: MemberDirectoryBootstrapClosureDependencies,
  request: MemberDirectoryBootstrapClosureRequest,
  now: string,
): MemberDirectoryBootstrapVerification {
  const { artifact, controlPlane, operation } = context;

  // The same four-part precondition the completion planner enforces, applied here so verification
  // stands on it too rather than on a weaker copy of it.
  assertMemberDirectoryBootstrapClosable({
    currentState: context.state,
    operationId: request.operationId,
    now,
  });

  /**
   * The artifact must be the one this operation's frozen receipt named. Two independent stores
   * agreeing on the baseline MAC is what "rejects divergent artifacts" means; without it the
   * closure would verify against whichever artifact it happened to be handed.
   */
  if (
    !constantTimeMacEquals(
      artifact.identityKeyBaselineMac,
      operation.receipt.identityKeyBaselineMac,
    )
  ) {
    closureFailure("the baseline artifact is not the one this operation froze");
  }
  if (
    artifact.secretVersion !== operation.receipt.secretVersion ||
    artifact.secretVersion !== context.state.secretVersion
  ) {
    // The baseline MAC binds the secret version. Proving it under a different one would certify a
    // set of reservations that the state does not claim to hold.
    closureFailure("the baseline artifact was frozen under another identity secret version");
  }

  const receiptsByChunkNo = new Map<number, unknown>();
  for (const stored of controlPlane.receipts) {
    const receipt = memberDirectoryChunkReceiptSchema.parse(stored);
    if (receiptsByChunkNo.has(receipt.chunkNo)) {
      closureFailure("two committed receipts claim the same chunk number");
    }
    receiptsByChunkNo.set(receipt.chunkNo, stored);
  }
  if (receiptsByChunkNo.size !== artifact.chunks.length) {
    // Fewer receipts than planned means the operation is not finished; more means it committed a
    // chunk the frozen plan never authorised. Neither is a baseline.
    closureFailure("the committed chunks do not match the chunks the artifact planned");
  }

  const evidence = artifact.chunks.map((chunk) => {
    const receipt = receiptsByChunkNo.get(chunk.chunkNo);
    if (receipt === undefined) {
      closureFailure("a chunk the artifact planned has no committed receipt");
    }
    return chunkEvidence(
      chunk.expectedKeyTuples,
      receipt,
      controlPlane.identityKeys,
      request.academyId,
    );
  });

  return verifyMemberDirectoryBootstrapBaseline(
    {
      academyId: request.academyId,
      operationId: request.operationId,
      secretVersion: context.state.secretVersion,
      chunks: evidence,
      artifactBaselineMac: artifact.identityKeyBaselineMac,
    },
    { integritySecretMaterial: dependencies.integritySecretMaterial },
  );
}

/**
 * The verification transaction: proves the baseline and moves only the parent `applying ->
 * verified`. The state stays blocked, frozen and incomplete on purpose - a crash here must not be
 * able to leave a stable tuple whose parent never finished.
 *
 * `statusAuditEventId` names the guard event the control plane stands at, not a new one. The guard
 * chain has exactly one event per state revision, so minting an event would mean moving the state,
 * which is the one thing this transaction may not do. What makes the reference honest is the
 * compare-and-set: the parent is filed against a control-plane position proven still current at the
 * moment of the write.
 */
export async function runMemberDirectoryBootstrapVerification(
  dependencies: MemberDirectoryBootstrapClosureDependencies,
  request: MemberDirectoryBootstrapClosureRequest,
): Promise<MemberDirectoryBootstrapClosureResult> {
  const now = dependencies.now();
  const context = await readClosureContext(dependencies, request);
  if (context.operation.status === "completed") {
    // Terminal, and it does not carry a proof: completion opened the freeze and cleared the lease,
    // so there is no frozen bootstrap left for a proof to be about.
    return Object.freeze({ moved: false, reason: "the operation is already completed" });
  }
  const verification = establishBootstrapProof(context, dependencies, request, now);

  if (context.operation.status === "verified") {
    // Already verified, and the proof just re-established says so correctly. Resume belongs to the
    // completion transaction; repeating this one would be a second audit entry for one event.
    return Object.freeze({
      moved: false,
      reason: "the operation is already verified",
      verification,
    });
  }

  const operation = planMemberDirectoryOperationStatusChange({
    current: context.operation,
    toStatus: "verified",
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

  return Object.freeze({ moved: true, verification });
}

/**
 * The completion transaction: the same proof again, from scratch, and then the one transaction that
 * records it and hands the directory back.
 *
 * It returns to the pre-cutover tuple rather than the canonical one, and clears the lease fields -
 * both decided in `planMemberDirectoryBootstrapCompletion`, which this only supplies with the
 * recomputed MAC and the artifact's opaque ID.
 */
export async function runMemberDirectoryBootstrapCompletion(
  dependencies: MemberDirectoryBootstrapClosureDependencies,
  request: MemberDirectoryBootstrapClosureRequest,
): Promise<MemberDirectoryBootstrapClosureResult> {
  const now = dependencies.now();
  const context = await readClosureContext(dependencies, request);
  if (context.operation.status === "completed") {
    // Terminal, and it does not carry a proof: completion opened the freeze and cleared the lease,
    // so there is no frozen bootstrap left for a proof to be about.
    return Object.freeze({ moved: false, reason: "the operation is already completed" });
  }
  const verification = establishBootstrapProof(context, dependencies, request, now);

  const nextState = planMemberDirectoryBootstrapCompletion({
    currentState: context.state,
    operationId: request.operationId,
    identityKeyBaselineMac: verification.identityKeyBaselineMac,
    identityKeyBaselineArtifactId: context.artifact.artifactId,
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
    transitionKind: "identity-key-bootstrap",
    now,
    actorId: request.actorId,
    integritySecretMaterial: dependencies.integritySecretMaterial,
    integritySecretVersion: dependencies.integritySecretVersion,
  });

  // Planned last, from the event this transaction is about to write, so the parent's completion and
  // the control-plane transition share one audit entry instead of two to be correlated later.
  const operation = planMemberDirectoryOperationStatusChange({
    current: context.operation,
    toStatus: "completed",
    auditEventId: advanced.event.eventId,
    now,
    actorId: request.actorId,
  });

  await dependencies.store.commitCompletion({
    academyId: request.academyId,
    nextState,
    guard: advanced.guard,
    event: advanced.event,
    operation,
  });

  return Object.freeze({ moved: true, verification });
}
