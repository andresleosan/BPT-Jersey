import type { MemberDirectoryState } from "@bpt-jersey/domain/members/directory";
import type { MemberDirectoryOperationReceipt } from "@bpt-jersey/domain/members/directory-migration";
import {
  memberDirectoryOperationDocumentSchema,
  type MemberDirectoryOperationDocument,
} from "@bpt-jersey/domain/members/directory-operations";
import type { MemberDirectoryPrivateOutputPlan } from "@bpt-jersey/domain/members/directory-private-plan";

import {
  runMemberDirectoryChunkCommit,
  type MemberDirectoryChunkCommitResult,
  type MemberDirectoryChunkRunnerDependencies,
} from "./member-directory-chunk-runner.js";
import { constantTimeMacEquals } from "./member-directory-crypto.js";
import {
  planMemberDirectoryForwardChunk,
  type MemberDirectoryForwardObservedRow,
  type MemberDirectoryForwardPlannedRow,
} from "./member-directory-forward-executor.js";
import {
  openMemberDirectoryFrozenPlan,
  requireMemberDirectoryManifestRow,
  type MemberDirectoryFrozenPlan,
  type MemberDirectoryFrozenPlanStore,
} from "./member-directory-frozen-plan.js";
import { assertMemberDirectoryControlPlane } from "./member-directory-state.js";

/**
 * The forward runner (T108, slice 14): the piece that turns a frozen plan into one committed chunk.
 *
 * Slice 10 wrote the executor, slice 12 the store, slice 13 the dry-run that fills it. Each of them
 * knew one part of the operation and nothing about the others. This is what joins them: open the
 * frozen artifacts, prove them against the parent's receipt, check the identity-key baseline step 4
 * asks for, read exactly the documents the plan names, ask the executor what to write, and hand the
 * result to the transactional envelope that decides whether it may commit at all.
 *
 * **What it deliberately does not decide.** It computes no eligibility, derives no document and
 * owns no transaction. `planMemberDirectoryForwardChunk` decides what a chunk writes,
 * `runMemberDirectoryChunkCommit` decides whether it commits, and `openMemberDirectoryFrozenPlan`
 * decides whether the artifacts are the ones this operation was frozen against. Adding a second
 * opinion on any of the three here is how a runner starts disagreeing with the rules it drives.
 *
 * **Two actors, on purpose.** The documents a chunk creates carry the actor the plan was frozen
 * with - `receipt.createdBy` - because the plan's canonical content MACs were computed over
 * documents bearing that actor, and a different one would produce different bytes and a root the
 * receipt does not approve. The audit entry, the chunk receipt and the guard event carry whoever is
 * running the chunk now. They are different questions - who authored this record, and who ran this
 * transaction - and collapsing them would make a resumed chunk unable to match its own plan.
 *
 * **Why the reads need no second round.** The expected reservation IDs are not derived from the
 * legacy rows here; they are read straight out of the frozen plan's target paths. That is what the
 * plan is for, and it means every document a chunk needs is known before the first read rather than
 * after a first read that would then have to be trusted.
 */

const identityKeyPathSegment = "/studentIdentityKeys/";

export type MemberDirectoryForwardChunkDocuments = Readonly<{
  /** `members/{legacyMemberId}`, keyed by legacy ID; absent when the row is gone. */
  sourceRows: ReadonlyMap<string, unknown>;
  /** `students/{targetStudentId}` for every row of the chunk, present only where one exists. */
  students: ReadonlyMap<string, unknown>;
  /** `studentAdminProfiles/{targetStudentId}`; a present one is what step 6 refuses. */
  adminProfiles: ReadonlyMap<string, unknown>;
  families: ReadonlyMap<string, unknown>;
  relationships: ReadonlyMap<string, unknown>;
  /** `studentIdentityKeys/{keyId}` for the keys the plan expects this chunk to create. */
  identityKeys: ReadonlyMap<string, unknown>;
}>;

export type MemberDirectoryForwardReadRequest = Readonly<{
  academyId: string;
  sourceLegacyIds: readonly string[];
  targetStudentIds: readonly string[];
  familyIds: readonly string[];
  relationshipIds: readonly string[];
  expectedKeyIds: readonly string[];
}>;

export type MemberDirectoryForwardSourceStore = Readonly<{
  read(request: MemberDirectoryForwardReadRequest): Promise<MemberDirectoryForwardChunkDocuments>;
}>;

export type MemberDirectoryForwardControlPlane = Readonly<{
  state: unknown;
  guard: unknown;
  event: unknown;
  operation: unknown;
}>;

export type MemberDirectoryForwardControlPlaneStore = Readonly<{
  read(
    input: Readonly<{ academyId: string; operationId: string }>,
  ): Promise<MemberDirectoryForwardControlPlane>;
}>;

export type MemberDirectoryForwardRunnerDependencies = Readonly<{
  /** The control plane and parent, read before the artifacts are opened. */
  controlPlane: MemberDirectoryForwardControlPlaneStore;
  /** The two frozen artifacts, always fetched together. */
  artifacts: MemberDirectoryFrozenPlanStore;
  documents: MemberDirectoryForwardSourceStore;
  /** The transactional envelope. Its own store owns the commit. */
  chunkRunner: MemberDirectoryChunkRunnerDependencies;
  identitySecretMaterial: string;
  identitySecretVersion: string;
}>;

export type MemberDirectoryForwardChunkRequest = Readonly<{
  academyId: string;
  operationId: string;
  chunkNo: number;
  /** Whoever is running this chunk. Not the actor the plan's documents carry. */
  actorId: string;
}>;

export type MemberDirectoryForwardChunkOutcome = MemberDirectoryChunkCommitResult &
  Readonly<{
    rowCount: number;
    createdStudentCount: number;
    createdProfileCount: number;
    createdKeyCount: number;
  }>;

function forwardRunnerFailure(reason: string): never {
  throw new Error(`Member directory forward runner refused: ${reason}`);
}

/**
 * Step 4 of the confirmation algorithm, at the level a forward operation can answer it.
 *
 * The bootstrap that produced the baseline already proved it the hard way: its closure rebuilt every
 * reservation tuple out of Firestore and compared the fold with the artifact. What forward has to
 * establish is that **that** baseline is the one its plan was frozen against, and that the tenant
 * still stands on it. Recomputing the tuples here would be a second implementation of a proof that
 * already exists, run under a lease that belongs to a different operation.
 *
 * The keys the forward plan itself touches are checked where they are used: the executor refuses any
 * reservation that already exists, whoever owns it and whatever version it carries, which covers the
 * duplicate owner and the unknown key version the step names.
 */
export function assertMemberDirectoryForwardBaseline(
  input: Readonly<{ state: MemberDirectoryState; receipt: MemberDirectoryOperationReceipt }>,
): void {
  const { state, receipt } = input;
  if (state.identityKeyCoverage !== "complete") {
    // Invariant: directory-forward never silently performs bootstrap work. An incomplete coverage
    // means the identities that predate the writer were never enumerated, so nothing this operation
    // creates can be proven not to collide with one of them.
    forwardRunnerFailure("the identity-key bootstrap has not completed for this academy");
  }
  if (
    state.identityKeyBaselineMac === undefined ||
    state.identityKeyBaselineArtifactId === undefined
  ) {
    forwardRunnerFailure("the completed coverage records no baseline to verify against");
  }
  if (!constantTimeMacEquals(state.identityKeyBaselineMac, receipt.identityKeyBaselineMac)) {
    // The plan was frozen against a baseline the tenant no longer stands on: a reconciliation or a
    // restore replaced it, and every collision the plan proved absent was proved against the old one.
    forwardRunnerFailure("the plan was frozen against a different identity-key baseline");
  }
  if (state.secretVersion !== receipt.secretVersion) {
    forwardRunnerFailure("the plan was frozen under another identity secret version");
  }
}

type ForwardContext = Readonly<{
  state: MemberDirectoryState;
  operation: MemberDirectoryOperationDocument;
  frozen: MemberDirectoryFrozenPlan;
}>;

/**
 * The control plane, the parent and the frozen artifacts, each proven to be this operation's.
 *
 * The artifacts are opened *after* the parent, because the receipt they are proven against lives on
 * the parent: opening them first would mean holding a manifest with nothing yet to check it.
 */
async function readForwardContext(
  dependencies: MemberDirectoryForwardRunnerDependencies,
  request: MemberDirectoryForwardChunkRequest,
  now: string,
): Promise<ForwardContext> {
  const controlPlane = await dependencies.controlPlane.read({
    academyId: request.academyId,
    operationId: request.operationId,
  });

  const current = assertMemberDirectoryControlPlane({
    projectId: dependencies.chunkRunner.projectId,
    state: controlPlane.state,
    guard: controlPlane.guard,
    event: controlPlane.event,
    integritySecretMaterial: dependencies.chunkRunner.integritySecretMaterial,
    integritySecretVersion: dependencies.chunkRunner.integritySecretVersion,
  });
  if (current.state.academyId !== request.academyId) {
    forwardRunnerFailure("the control plane belongs to another academy");
  }

  const operation = memberDirectoryOperationDocumentSchema.parse(controlPlane.operation);
  if (
    operation.operationId !== request.operationId ||
    operation.academyId !== request.academyId ||
    operation.operationType !== "directory-forward"
  ) {
    forwardRunnerFailure("the parent operation is not this academy's directory-forward");
  }

  assertMemberDirectoryForwardBaseline({ state: current.state, receipt: operation.receipt });

  const stored = await dependencies.artifacts.open({
    academyId: request.academyId,
    operationId: request.operationId,
  });
  const frozen = openMemberDirectoryFrozenPlan({
    receipt: operation.receipt,
    manifest: stored.manifest,
    plan: stored.plan,
    now,
    integritySecretMaterial: dependencies.chunkRunner.integritySecretMaterial,
  });

  return Object.freeze({ state: current.state, operation, frozen });
}

/** The chunk the plan names, refusing a number the plan does not cover. */
function requirePlanChunk(
  plan: MemberDirectoryPrivateOutputPlan,
  chunkNo: number,
): MemberDirectoryPrivateOutputPlan["chunks"][number] {
  const chunk = plan.chunks.find((candidate) => candidate.chunkNo === chunkNo);
  if (chunk === undefined) {
    // A chunk number outside the frozen plan is not a chunk to improvise: the plan is the whole
    // statement of what this operation writes.
    forwardRunnerFailure(`the frozen plan does not cover chunk ${String(chunkNo)}`);
  }
  return chunk;
}

/** Everything one chunk reads, taken from the manifest rows and the plan's own target paths. */
function planChunkReads(
  frozen: MemberDirectoryFrozenPlan,
  chunk: MemberDirectoryPrivateOutputPlan["chunks"][number],
  academyId: string,
): MemberDirectoryForwardReadRequest {
  const rows = chunk.sourceLegacyIds.map((sourceLegacyId) =>
    requireMemberDirectoryManifestRow(frozen, sourceLegacyId),
  );
  const expectedKeyIds = chunk.targets.flatMap((target) => {
    const index = target.path.indexOf(identityKeyPathSegment);
    return index === -1 ? [] : [target.path.slice(index + identityKeyPathSegment.length)];
  });
  return Object.freeze({
    academyId,
    sourceLegacyIds: Object.freeze([...chunk.sourceLegacyIds]),
    targetStudentIds: Object.freeze(rows.map((row) => row.targetStudentId)),
    familyIds: Object.freeze(
      rows.flatMap((row) => (row.family === undefined ? [] : [row.family.familyId])),
    ),
    relationshipIds: Object.freeze(
      rows.flatMap((row) => (row.family === undefined ? [] : [row.family.relationshipId])),
    ),
    expectedKeyIds: Object.freeze(expectedKeyIds),
  });
}

/**
 * Runs one forward chunk: reads what the plan names, asks the executor what it produces, checks that
 * against the root the receipt approved, and commits through the shared envelope.
 */
export async function runMemberDirectoryForwardChunk(
  dependencies: MemberDirectoryForwardRunnerDependencies,
  request: MemberDirectoryForwardChunkRequest,
): Promise<MemberDirectoryForwardChunkOutcome> {
  const now = dependencies.chunkRunner.now();
  const context = await readForwardContext(dependencies, request, now);
  const { receipt } = context.operation;
  const chunk = requirePlanChunk(context.frozen.plan, request.chunkNo);

  const reads = planChunkReads(context.frozen, chunk, request.academyId);
  const documents = await dependencies.documents.read(reads);

  const plannedRows: MemberDirectoryForwardPlannedRow[] = chunk.sourceLegacyIds.map(
    (sourceLegacyId) => {
      const row = requireMemberDirectoryManifestRow(context.frozen, sourceLegacyId);
      return Object.freeze({
        legacyMemberId: row.sourceLegacyId,
        classification: row.classification,
        explicitlyReviewed: row.classification !== "createable-adult",
        targetStudentId: row.targetStudentId,
        sourceRowMac: row.sourceRowMac,
        trainingTimePreferences: row.trainingTimePreferences ?? [],
        ...(row.family === undefined
          ? {}
          : { familyId: row.family.familyId, relationshipId: row.family.relationshipId }),
      });
    },
  );

  const observed: MemberDirectoryForwardObservedRow[] = plannedRows.map((row) =>
    Object.freeze({
      legacyMemberId: row.legacyMemberId,
      member: documents.sourceRows.get(row.legacyMemberId),
      student: documents.students.get(row.targetStudentId),
      profile: documents.adminProfiles.get(row.targetStudentId),
      ...(row.familyId === undefined || row.relationshipId === undefined
        ? {}
        : {
            family: documents.families.get(row.familyId),
            relationship: documents.relationships.get(row.relationshipId),
          }),
    }),
  );

  const chunkPlan = planMemberDirectoryForwardChunk(
    {
      academyId: request.academyId,
      operationId: request.operationId,
      chunkNo: request.chunkNo,
      plannedRows,
      observed,
      existingKeys: reads.expectedKeyIds.flatMap((keyId) => {
        const stored = documents.identityKeys.get(keyId);
        return stored === undefined ? [] : [stored];
      }),
      // Taken from the receipt, never from the caller: the plan's content MACs were computed over
      // documents bearing exactly these values, so a clock read here would produce a different set.
      operationWriteTime: receipt.operationWriteTime,
      effectiveDate: receipt.effectiveDate.slice(0, 10),
      actorId: receipt.createdBy,
    },
    {
      identitySecretMaterial: dependencies.identitySecretMaterial,
      identitySecretVersion: dependencies.identitySecretVersion,
      integritySecretMaterial: dependencies.chunkRunner.integritySecretMaterial,
    },
  );

  /**
   * The root the executor just produced has to be the one the plan froze and the receipt approved.
   *
   * The executor's own `sourceRowMac` check already catches a changed legacy row. This catches
   * everything else that could make the written documents differ from the reviewed ones - a
   * different write time, a different actor, a plan sliced into different chunks - and it catches it
   * on this chunk rather than on the last one, with the earlier chunks already committed.
   */
  if (!constantTimeMacEquals(chunkPlan.outputSetMac, chunk.expectedOutputSetMac)) {
    forwardRunnerFailure(
      `chunk ${String(request.chunkNo)} does not produce the output set its plan froze`,
    );
  }

  const result = await runMemberDirectoryChunkCommit(dependencies.chunkRunner, {
    academyId: request.academyId,
    operationId: request.operationId,
    phase: "forward",
    chunkNo: request.chunkNo,
    rowCount: chunkPlan.rowCount,
    quarantinedCount: chunkPlan.quarantinedCount,
    outputSetMac: chunkPlan.outputSetMac,
    domainWrites: chunkPlan.domainWrites,
    actorId: request.actorId,
  });

  return Object.freeze({
    ...result,
    rowCount: chunkPlan.rowCount,
    createdStudentCount: chunkPlan.createdStudentCount,
    createdProfileCount: chunkPlan.createdProfileCount,
    createdKeyCount: chunkPlan.createdKeyCount,
  });
}
