import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { afterAll, describe, expect, it } from "vitest";

import type { MemberDirectoryState } from "@bpt-jersey/domain/members/directory";
import { memberDirectoryOperationDocumentSchema } from "@bpt-jersey/domain/members/directory-operations";
import { planMemberDirectoryAcquisition } from "@bpt-jersey/domain/members/directory-transitions";

import {
  createMemberDirectoryArtifactStore,
  createMemberDirectoryFrozenPlanStore,
} from "../../apps/functions/src/members/member-directory-artifact-store.js";
import { createMemberDirectoryChunkFirestoreStore } from "../../apps/functions/src/members/member-directory-chunk-runner-firestore.js";
import {
  runMemberDirectoryForwardCutover,
  runMemberDirectoryForwardVerification,
} from "../../apps/functions/src/members/member-directory-forward-closure-runner.js";
import {
  planMemberDirectoryForwardDryRun,
  type MemberDirectoryForwardDryRun,
} from "../../apps/functions/src/members/member-directory-forward-dry-run.js";
import {
  createMemberDirectoryForwardClosureFirestoreStore,
  createMemberDirectoryForwardControlPlaneFirestoreStore,
  createMemberDirectoryForwardSourceFirestoreStore,
} from "../../apps/functions/src/members/member-directory-forward-runner-firestore.js";
import { runMemberDirectoryForwardChunk } from "../../apps/functions/src/members/member-directory-forward-runner.js";
import {
  advanceMemberDirectoryControlPlane,
  buildInitialMemberDirectoryControlPlane,
} from "../../apps/functions/src/members/member-directory-state.js";

/**
 * The end-to-end Emulator rehearsal of a directory-forward operation (T108, slice 16).
 *
 * Every earlier rehearsal proved one piece against a real Firestore. This proves the **whole
 * forward path**, in the order it really runs and through the real adapters: the dry-run classifies
 * the legacy rows and emits the frozen artifacts, the artifact store seals them to disk, the runner
 * opens them and commits a chunk, verification proves every committed chunk against the plan, and
 * the cutover switches the reader.
 *
 * Nothing here hands one component a value another component was supposed to produce. The manifest
 * is the dry-run's own output, read back out of the sealed store; the receipt on the parent is the
 * dry-run's own receipt; the chunk's documents are read back out of Firestore. That is the property
 * a rehearsal has that a unit test cannot: every seam is a real one.
 */

const projectId = "demo-bpt-jersey";
const runId = "member-directory-forward-operation-" + process.pid + "-" + randomUUID().slice(0, 8);
const academyId = runId + "-academy";
const operationId = "op-forward-" + randomUUID().slice(0, 8);
const actorId = runId + "-runner";
const plannerActorId = runId + "-operator";

const identitySecretMaterial = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8";
const integritySecretMaterial = "ICEiIyQlJicoKSorLC0uLzAxMjM0NTY3ODk6Ozw9Pj8";
const cursorSecretMaterial = "QEFCQ0RFRkdISUpLTE1OT1BRUlNUVVZXWFlaW1xdXl8";
const artifactSecretMaterial = "YGFiY2RlZmdoaWprbG1ub3BxcnN0dXZ3eHl6e3x9fn8";
const identitySecretVersion = "identity-v1";
const integritySecretVersion = "integrity-v1";

const initializedAt = "2026-09-08T11:00:00.000Z";
const acquiredAt = "2026-09-08T12:00:00.000Z";
const operationWriteTime = "2026-09-08T12:00:30.000Z";
const committedAt = "2026-09-08T12:01:00.000Z";
const verifiedAt = "2026-09-08T12:01:20.000Z";
const operationDeadline = "2026-09-08T12:25:00.000Z";
const baselineMac = "f".repeat(64);

const legacyIds = ["LEGACY-8101", "LEGACY-8102", "LEGACY-8103"] as const;
const mintedStudentIds = ["student-minted-8101", "student-minted-8102"] as const;
/**
 * The third row is a reviewed match against an existing minor. It creates no student, and it is
 * the only scenario that makes the runner read a family and a relationship - which is the one
 * collection path an adapter can get wrong without any unit test noticing.
 */
const matchLegacyId = "LEGACY-8103";
const matchedStudentId = "student-existing-8103";
const familyId = "family-8103";
const relationshipId = "relationship-8103";

const firestoreEmulatorHost = process.env.FIRESTORE_EMULATOR_HOST?.trim();

function isLocalEmulatorHost(host: string | undefined): boolean {
  if (host === undefined || host === "") return false;
  try {
    const url = new URL("http://" + host);
    return (
      (url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "[::1]") &&
      url.pathname === "/" &&
      url.username === "" &&
      url.password === "" &&
      url.search === "" &&
      url.hash === ""
    );
  } catch {
    return false;
  }
}

/**
 * The artifact store's own gate demands a loopback host written as `127.0.0.1:<port>` exactly. The
 * emulator variable may legitimately say `localhost`, so the environment handed to the store is
 * normalized rather than the gate being loosened for the rehearsal.
 */
function loopbackHost(host: string): string {
  const url = new URL("http://" + host);
  return "127.0.0.1:" + url.port;
}

const useLocalEmulator = isLocalEmulatorHost(firestoreEmulatorHost);
if (!useLocalEmulator) {
  console.warn(
    "SKIP member-directory forward operation integration: FIRESTORE_EMULATOR_HOST must be loopback",
  );
}

const app = useLocalEmulator
  ? initializeApp({ projectId }, "member-directory-forward-operation-" + runId)
  : undefined;
const firestore = app === undefined ? undefined : getFirestore(app);
const describeLocal = useLocalEmulator ? describe : describe.skip;

let artifactRoot: string | undefined;

function requireFirestore(): Firestore {
  if (firestore === undefined) throw new Error("Local Firestore emulator is unavailable");
  return firestore;
}

function legacyMemberDocument(memberId: string): Readonly<Record<string, unknown>> {
  return {
    memberId,
    academyId,
    membershipNumber: "BPT " + memberId.slice(-4),
    fullName: "Synthetic Forward Member " + memberId,
    email: memberId.toLowerCase() + "@example.test",
    birthDate: "1990-04-05",
    mobileNumber: "+441534000801",
    frequency: "Twice a week",
    paymentStatus: "regularized",
    gender: "unknown",
    trainingCenter: "Town",
    membershipStatus: "active",
    createdAt: initializedAt,
    createdBy: actorId,
    updatedAt: initializedAt,
    updatedBy: actorId,
    source: "member-pdf-import",
    schemaVersion: "1",
  };
}

function existingMinorStudent(): Readonly<Record<string, unknown>> {
  return {
    studentId: matchedStudentId,
    academyId,
    fullName: "Existing Canonical Minor",
    dateOfBirth: "2015-01-01",
    familyId,
    trainingCenter: "West",
    trainingTimePreferences: ["morning"],
    participantType: "minor",
    active: true,
    status: "active",
    schemaVersion: "1",
    createdAt: initializedAt,
    createdBy: actorId,
    updatedAt: initializedAt,
    updatedBy: actorId,
  };
}

function existingFamily(): Readonly<Record<string, unknown>> {
  return {
    familyId,
    academyId,
    primaryContactUserId: "guardian-8103",
    billingContactUserId: "guardian-8103",
    active: true,
    status: "active",
    schemaVersion: "1",
    createdAt: initializedAt,
    createdBy: actorId,
    updatedAt: initializedAt,
    updatedBy: actorId,
  };
}

function existingRelationship(): Readonly<Record<string, unknown>> {
  return {
    relationshipId,
    academyId,
    familyId,
    studentId: matchedStudentId,
    adultUserId: "guardian-8103",
    relationshipType: "guardian",
    permissions: ["readProfile"],
    validFrom: initializedAt,
    active: true,
    status: "active",
    schemaVersion: "1",
    createdAt: initializedAt,
    createdBy: actorId,
    updatedAt: initializedAt,
    updatedBy: actorId,
  };
}

/** The state a completed identity-key bootstrap leaves behind: the only tuple forward acquires from. */
function postBootstrapState(): MemberDirectoryState {
  return {
    stateId: "current",
    academyId,
    readerVersion: "legacy-v1",
    directoryWriteMode: "legacy-v1",
    freezeStatus: "open",
    stateRevision: 0,
    globalLegacyReadEliminated: false,
    identityKeyCoverage: "complete",
    identityKeyBaselineMac: baselineMac,
    identityKeyBaselineArtifactId: "artifact-bootstrap-1",
    digestVersion: "hmac-sha256-v1",
    secretVersion: identitySecretVersion,
    rollbackProtocolVersion: "legacy-projection-v1",
    rollbackCapacityLimit: 400,
    rollbackEligibleStudentCount: 0,
    operationPhase: "idle",
    lastCommittedChunkNo: 0,
    schemaVersion: "1",
    createdAt: initializedAt,
    createdBy: actorId,
    updatedAt: initializedAt,
    updatedBy: actorId,
  } as MemberDirectoryState;
}

function artifactEnvironment(): Readonly<Record<string, string | undefined>> {
  return {
    GCLOUD_PROJECT: projectId,
    FIRESTORE_EMULATOR_HOST: loopbackHost(firestoreEmulatorHost ?? "127.0.0.1:8080"),
    MEMBER_DIRECTORY_ARTIFACT_ROOT: artifactRoot,
    MEMBER_DIRECTORY_BASELINE_ENCRYPTION_SECRET: artifactSecretMaterial,
    MEMBER_DIRECTORY_IDENTITY_KEY_SECRET: identitySecretMaterial,
    MEMBER_DIRECTORY_MIGRATION_INTEGRITY_SECRET: integritySecretMaterial,
    MEMBER_DIRECTORY_CURSOR_SECRET: cursorSecretMaterial,
  };
}

/**
 * Runs the real dry-run over the legacy rows as they are stored, exactly as a reviewer's run would:
 * the source documents are read back from Firestore rather than passed in from the seeding code.
 */
async function runDryRun(database: Firestore): Promise<MemberDirectoryForwardDryRun> {
  const snapshots = await Promise.all(
    legacyIds.map(async (legacyMemberId) => ({
      legacyMemberId,
      document: (
        await database.doc(`academies/${academyId}/members/${legacyMemberId}`).get()
      ).data(),
    })),
  );
  // Read back from Firestore too, so the dry-run classifies the match against the stored records
  // rather than against the values the seeding code happened to hold.
  const [student, family, relationship] = await Promise.all([
    database.doc(`academies/${academyId}/students/${matchedStudentId}`).get(),
    database.doc(`academies/${academyId}/families/${familyId}`).get(),
    database.doc(`academies/${academyId}/relationships/${relationshipId}`).get(),
  ]);
  const minted = [...mintedStudentIds];
  return planMemberDirectoryForwardDryRun(
    {
      academyId,
      operationId,
      manifestId: "manifest-" + operationId,
      planId: "plan-" + operationId,
      targetProjectClassification: "emulator",
      codeVersion: "rehearsal",
      sourceRows: snapshots,
      existingStudents: [student.data()],
      existingAdminProfiles: [],
      existingIdentityKeys: [],
      existingFamilies: [family.data()],
      existingRelationships: [relationship.data()],
      stateAdmittedStudentCount: 1,
      identityKeyBaselineMac: baselineMac,
      maximumApprovedRows: 400,
      effectiveDate: operationWriteTime,
      expiresAt: "2026-09-08T13:00:00.000Z",
      operationWriteTime,
      createdAt: acquiredAt,
      manifestPreparedAt: initializedAt,
      manifestExpiresAt: "2026-09-08T13:00:00.000Z",
      actorId: plannerActorId,
      decisions: [
        ...legacyIds
          .filter((legacyMemberId) => legacyMemberId !== matchLegacyId)
          .map((legacyMemberId) => ({
            legacyMemberId,
            decision: "create" as const,
            trainingTimePreferences: ["evening"] as const,
          })),
        {
          legacyMemberId: matchLegacyId,
          decision: "match" as const,
          targetStudentId: matchedStudentId,
          reviewedReason: "Same person, verified against the signed enrolment form",
          familyId,
          relationshipId,
        },
      ],
    },
    {
      identitySecretMaterial,
      identitySecretVersion,
      integritySecretMaterial,
      integritySecretVersion,
      mintTargetStudentId: () => {
        const next = minted.shift();
        if (next === undefined) throw new Error("the rehearsal ran out of minted student IDs");
        return next;
      },
    },
  );
}

async function seedFrozenControlPlane(
  database: Firestore,
  dryRun: MemberDirectoryForwardDryRun,
): Promise<void> {
  const baseline = postBootstrapState();
  const initial = buildInitialMemberDirectoryControlPlane({
    projectId,
    state: baseline,
    now: initializedAt,
    actorId,
    integritySecretMaterial,
    integritySecretVersion,
  });
  const acquired = planMemberDirectoryAcquisition({
    currentState: baseline,
    phase: "forward",
    operationId,
    leaseId: "lease-" + operationId,
    leaseOwner: actorId,
    operationDeadline,
    now: acquiredAt,
    actorId,
  });
  const advanced = advanceMemberDirectoryControlPlane({
    projectId,
    state: baseline,
    guard: initial.guard,
    event: initial.event,
    nextState: acquired,
    operationId,
    transitionKind: "directory-forward",
    now: acquiredAt,
    actorId,
    integritySecretMaterial,
    integritySecretVersion,
  });

  // The parent carries the dry-run's own receipt, not a hand-written one.
  const operation = memberDirectoryOperationDocumentSchema.parse({
    operationId,
    academyId,
    operationType: "directory-forward",
    status: "frozen",
    receipt: dryRun.receipt,
    statusAuditEventId: "1",
    statusChangedAt: acquiredAt,
    statusChangedBy: actorId,
    schemaVersion: "1",
    createdAt: initializedAt,
    createdBy: plannerActorId,
  });

  const batch = database.batch();
  batch.create(
    database.doc(`academies/${academyId}/memberDirectoryMigrations/${operationId}`),
    operation,
  );
  batch.create(database.doc(`academies/${academyId}/memberDirectoryStates/current`), acquired);
  batch.create(database.doc(`memberDirectoryRestoreGuards/${academyId}`), advanced.guard);
  batch.create(database.doc(`memberDirectoryRestoreGuards/${academyId}/events/0`), initial.event);
  batch.create(database.doc(`memberDirectoryRestoreGuards/${academyId}/events/1`), advanced.event);
  await batch.commit();
}

function chunkRunnerDependencies(database: Firestore, now: string) {
  return {
    projectId,
    store: createMemberDirectoryChunkFirestoreStore(database),
    integritySecretMaterial,
    integritySecretVersion,
    now: () => now,
  };
}

function forwardDependencies(database: Firestore, now: string) {
  return {
    controlPlane: createMemberDirectoryForwardControlPlaneFirestoreStore(database),
    artifacts: createMemberDirectoryFrozenPlanStore(
      createMemberDirectoryArtifactStore(artifactEnvironment()),
    ),
    documents: createMemberDirectoryForwardSourceFirestoreStore(database),
    chunkRunner: chunkRunnerDependencies(database, now),
    identitySecretMaterial,
    identitySecretVersion,
  };
}

function closureDependencies(database: Firestore, now: string) {
  return {
    projectId,
    store: createMemberDirectoryForwardClosureFirestoreStore(database),
    artifacts: createMemberDirectoryFrozenPlanStore(
      createMemberDirectoryArtifactStore(artifactEnvironment()),
    ),
    integritySecretMaterial,
    integritySecretVersion,
    now: () => now,
  };
}

/**
 * The same dependencies, with the control plane advanced out of band **between the read and the
 * commit**.
 *
 * That is the only way to isolate the compare-and-set: the runner reads, plans and commits in three
 * steps that no Firestore transaction spans, so the adapter re-reads state and guard inside the
 * transaction and refuses unless they still stand where the proof was made. Without the interleave
 * the check would pass for the trivial reason that nothing ever moved.
 */
function racedClosureDependencies(
  database: Firestore,
  now: string,
): ReturnType<typeof closureDependencies> {
  const dependencies = closureDependencies(database, now);
  return {
    ...dependencies,
    store: {
      ...dependencies.store,
      read: async (input) => {
        const plane = await dependencies.store.read(input);
        const stateReference = database.doc(`academies/${academyId}/memberDirectoryStates/current`);
        const stored = (await stateReference.get()).data();
        await stateReference.set({
          ...stored,
          stateRevision: ((stored?.["stateRevision"] as number | undefined) ?? 0) + 1,
        });
        return plane;
      },
    },
  };
}

afterAll(async () => {
  if (artifactRoot !== undefined) {
    // The spec requires local rehearsal fixtures to be removed when the rehearsal ends.
    await rm(artifactRoot, { recursive: true, force: true });
  }
  if (app !== undefined) await deleteApp(app);
});

describeLocal("member directory forward operation end to end", () => {
  it("runs dry-run, chunk, verification and cutover against a real Firestore", async () => {
    const database = requireFirestore();
    artifactRoot = await mkdtemp(join(tmpdir(), "bpt-member-directory-"));

    const batch = database.batch();
    for (const legacyMemberId of legacyIds) {
      batch.create(
        database.doc(`academies/${academyId}/members/${legacyMemberId}`),
        legacyMemberDocument(legacyMemberId),
      );
    }
    batch.create(
      database.doc(`academies/${academyId}/students/${matchedStudentId}`),
      existingMinorStudent(),
    );
    batch.create(database.doc(`academies/${academyId}/families/${familyId}`), existingFamily());
    batch.create(
      database.doc(`academies/${academyId}/relationships/${relationshipId}`),
      existingRelationship(),
    );
    await batch.commit();

    // 1. The dry-run reads the stored rows and emits the three frozen artifacts. Zero writes: the
    //    directory is still empty of students afterwards.
    const dryRun = await runDryRun(database);
    expect(dryRun.manifest.rows).toHaveLength(3);
    // A match creates no student, so it must not move the capacity equation.
    expect(dryRun.receipt.plannedNewStudentCount).toBe(2);
    expect(dryRun.receipt.postCutoverAdmittedStudentCount).toBe(3);
    expect(dryRun.manifest.rows.find((row) => row.sourceLegacyId === matchLegacyId)).toMatchObject({
      classification: "explicit-existing-student-match",
      targetStudentId: matchedStudentId,
      family: { familyId, relationshipId },
    });
    // Zero writes: the only student is the one that was already there.
    const beforeAnyChunk = await database.collection(`academies/${academyId}/students`).get();
    expect(beforeAnyChunk.size).toBe(1);

    // 2. The artifacts are sealed into the approved store, and everything after this reads them
    //    back through the cipher and the file system rather than from the value in hand.
    const artifacts = createMemberDirectoryArtifactStore(artifactEnvironment());
    await artifacts.put({
      kind: "reviewed-manifest",
      academyId,
      operationId,
      artifact: dryRun.manifest,
    });
    await artifacts.put({
      kind: "output-plan",
      academyId,
      operationId,
      artifact: dryRun.plan,
    });

    await seedFrozenControlPlane(database, dryRun);

    // 3. The chunk, through the real adapters.
    const outcome = await runMemberDirectoryForwardChunk(
      forwardDependencies(database, committedAt),
      { academyId, operationId, chunkNo: 1, actorId },
    );
    expect(outcome.committed).toBe(true);
    // Three rows, two of which create a student: the match attaches to the one already there.
    expect(outcome.createdStudentCount).toBe(2);
    expect(outcome.createdProfileCount).toBe(3);
    // membership-number and legacy-member-id per row.
    expect(outcome.createdKeyCount).toBe(6);

    const [firstStudent, firstProfile, receipt, stateAfterChunk, parentAfterChunk] =
      await Promise.all([
        database.doc(`academies/${academyId}/students/${mintedStudentIds[0]}`).get(),
        database.doc(`academies/${academyId}/studentAdminProfiles/${mintedStudentIds[0]}`).get(),
        database
          .doc(`academies/${academyId}/memberDirectoryMigrationChunks/${operationId}:forward:1`)
          .get(),
        database.doc(`academies/${academyId}/memberDirectoryStates/current`).get(),
        database.doc(`academies/${academyId}/memberDirectoryMigrations/${operationId}`).get(),
      ]);

    // Invariant 23: a migrated student is created inactive, and the legacy labels activate nobody.
    expect(firstStudent.data()).toMatchObject({
      studentId: mintedStudentIds[0],
      active: false,
      status: "inactive",
      participantType: "adult",
      // The documents carry the actor the plan was frozen with, not the one that ran the chunk.
      createdBy: plannerActorId,
      createdAt: operationWriteTime,
    });
    expect(firstStudent.data()).not.toHaveProperty("familyId");
    expect(firstProfile.data()).toMatchObject({
      source: "legacy-member-migration",
      migrationId: operationId,
      legacyMemberId: legacyIds[0],
    });
    expect(receipt.data()).toMatchObject({
      status: "committed",
      writtenCount: 3,
      quarantinedCount: 0,
      outputSetMac: dryRun.plan.chunks[0]?.expectedOutputSetMac,
      // The audit trail records whoever ran the chunk.
      createdBy: actorId,
    });
    // The reader has not moved: chunks write under the freeze and switch nothing.
    expect(stateAfterChunk.data()).toMatchObject({
      readerVersion: "legacy-v1",
      directoryWriteMode: "blocked",
      freezeStatus: "frozen",
      lastCommittedChunkNo: 1,
    });
    // The first committed chunk moved the parent frozen -> applying in the same transaction.
    expect(parentAfterChunk.data()).toMatchObject({ status: "applying" });

    const [matchedStudent, matchedProfile] = await Promise.all([
      database.doc(`academies/${academyId}/students/${matchedStudentId}`).get(),
      database.doc(`academies/${academyId}/studentAdminProfiles/${matchedStudentId}`).get(),
    ]);
    // Step 6: no existing student is overwritten. It gains an admin profile and nothing else.
    expect(matchedStudent.data()).toMatchObject({
      fullName: "Existing Canonical Minor",
      updatedAt: initializedAt,
      active: true,
    });
    expect(matchedProfile.data()).toMatchObject({
      studentId: matchedStudentId,
      migrationId: operationId,
      legacyMemberId: matchLegacyId,
    });

    // 4a. The compare-and-set, isolated: something advances the control plane between the proof
    //     and the write, and the verification refuses with the parent left exactly where it was.
    await expect(
      runMemberDirectoryForwardVerification(racedClosureDependencies(database, verifiedAt), {
        academyId,
        operationId,
        actorId,
      }),
    ).rejects.toThrow(/control plane moved while the migration was being verified/u);
    const parentAfterRace = await database
      .doc(`academies/${academyId}/memberDirectoryMigrations/${operationId}`)
      .get();
    expect(parentAfterRace.data()).toMatchObject({ status: "applying" });
    // Put the revision back, so the rest of the rehearsal runs against the real position.
    const stateReference = database.doc(`academies/${academyId}/memberDirectoryStates/current`);
    const raced = (await stateReference.get()).data();
    await stateReference.set({
      ...raced,
      stateRevision: ((raced?.["stateRevision"] as number | undefined) ?? 1) - 1,
    });

    // 4b. Verification proves the committed chunk against the plan and moves the parent alone.
    const verification = await runMemberDirectoryForwardVerification(
      closureDependencies(database, verifiedAt),
      { academyId, operationId, actorId },
    );
    expect(verification.moved).toBe(true);
    expect(verification.proof).toMatchObject({
      chunkCount: 1,
      writtenRowCount: 3,
      postCutoverAdmittedStudentCount: 3,
    });
    const [parentAfterVerification, stateAfterVerification] = await Promise.all([
      database.doc(`academies/${academyId}/memberDirectoryMigrations/${operationId}`).get(),
      database.doc(`academies/${academyId}/memberDirectoryStates/current`).get(),
    ]);
    expect(parentAfterVerification.data()).toMatchObject({ status: "verified" });
    // Still legacy, blocked and frozen: a crash here must not leave a switched reader.
    expect(stateAfterVerification.data()).toMatchObject({
      readerVersion: "legacy-v1",
      directoryWriteMode: "blocked",
      freezeStatus: "frozen",
    });

    // 5. The cutover, which is the only transaction that switches the reader.
    const cutover = await runMemberDirectoryForwardCutover(
      closureDependencies(database, "2026-09-08T12:01:40.000Z"),
      { academyId, operationId, actorId },
    );
    expect(cutover.moved).toBe(true);

    const [finalState, finalParent] = await Promise.all([
      database.doc(`academies/${academyId}/memberDirectoryStates/current`).get(),
      database.doc(`academies/${academyId}/memberDirectoryMigrations/${operationId}`).get(),
    ]);
    expect(finalState.data()).toMatchObject({
      readerVersion: "canonical-v1",
      directoryWriteMode: "canonical-v1",
      freezeStatus: "open",
      operationPhase: "idle",
      // The legacy reader is switched away from, not retired: only T097 may set the marker.
      globalLegacyReadEliminated: false,
      rollbackProtocolVersion: "legacy-projection-v1",
      rollbackEligibleStudentCount: 3,
      lastCommittedChunkNo: 0,
    });
    expect(finalState.data()).not.toHaveProperty("leaseId");
    expect(finalState.data()).not.toHaveProperty("activeOperationId");
    expect(finalParent.data()).toMatchObject({ status: "completed" });

    // 6. A second cutover of the same operation is answered, not applied. `completed` is terminal.
    const replay = await runMemberDirectoryForwardCutover(
      closureDependencies(database, "2026-09-08T12:02:00.000Z"),
      { academyId, operationId, actorId },
    );
    expect(replay.moved).toBe(false);
    expect(replay.reason).toMatch(/already completed/u);

    await artifacts.remove({ kind: "reviewed-manifest", academyId, operationId });
    await artifacts.remove({ kind: "output-plan", academyId, operationId });
  }, 60_000);
});
