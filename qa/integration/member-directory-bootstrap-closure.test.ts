import { randomUUID } from "node:crypto";

import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { afterAll, describe, expect, it } from "vitest";

import type { MemberDirectoryState } from "@bpt-jersey/domain/members/directory";
import { memberDirectoryDryRunClassifications } from "@bpt-jersey/domain/members/directory-migration";
import { memberDirectoryOperationDocumentSchema } from "@bpt-jersey/domain/members/directory-operations";
import { planMemberDirectoryAcquisition } from "@bpt-jersey/domain/members/directory-transitions";

import { createMemberDirectoryBootstrapClosureFirestoreStore } from "../../apps/functions/src/members/member-directory-bootstrap-closure-runner-firestore.js";
import {
  runMemberDirectoryBootstrapCompletion,
  runMemberDirectoryBootstrapVerification,
  type MemberDirectoryBootstrapBaselineArtifact,
  type MemberDirectoryBootstrapClosureDependencies,
} from "../../apps/functions/src/members/member-directory-bootstrap-closure-runner.js";
import { planMemberDirectoryBootstrapChunk } from "../../apps/functions/src/members/member-directory-bootstrap-executor.js";
import { createMemberDirectoryChunkFirestoreStore } from "../../apps/functions/src/members/member-directory-chunk-runner-firestore.js";
import { runMemberDirectoryChunkCommit } from "../../apps/functions/src/members/member-directory-chunk-runner.js";
import {
  createMemberDirectoryIdentityBaselineMac,
  parseStudentIdentityKeyTuple,
} from "../../apps/functions/src/members/member-directory-crypto.js";
import {
  advanceMemberDirectoryControlPlane,
  assertMemberDirectoryControlPlane,
  buildInitialMemberDirectoryControlPlane,
} from "../../apps/functions/src/members/member-directory-state.js";

/**
 * The Emulator rehearsal of the T108 bootstrap closure (slice 9): two real chunks committed through
 * the real envelope, then the verification and completion transactions run against a real Firestore.
 *
 * The unit tests prove the rules. This proves the parts a double cannot:
 *
 * - that the baseline really is recomputed from the reservation documents Firestore stored, by
 *   reading them back through the adapter rather than from the plan that wrote them - removing one
 *   of those documents ends the closure, and does not move the parent;
 * - that the verification transaction writes the parent and leaves state, guard and revision
 *   untouched, which is the property that makes a crash between the two halves safe;
 * - that completion moves state, guard, event and parent together, and lands on the pre-cutover
 *   tuple with the lease fields gone;
 * - and that a closure planned against a control plane that has since moved is refused rather than
 *   applied over it.
 */

const projectId = "demo-bpt-jersey";
const runId = "member-directory-closure-" + process.pid + "-" + randomUUID().slice(0, 8);
const academyId = runId + "-academy";
const operationId = "op-closure-" + randomUUID().slice(0, 8);
const artifactId = "artifact-" + operationId;
const actorId = runId + "-runner";
const identitySecretMaterial = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8";
const integritySecretMaterial = "ICEiIyQlJicoKSorLC0uLzAxMjM0NTY3ODk6Ozw9Pj8";
const integritySecretVersion = "integrity-v1";
const identitySecretVersion = "identity-v1";
const initializedAt = "2026-09-07T11:00:00.000Z";
const acquiredAt = "2026-09-07T12:00:00.000Z";
const committedAt = "2026-09-07T12:00:30.000Z";
const closedAt = "2026-09-07T12:01:00.000Z";
const operationDeadline = "2026-09-07T12:25:00.000Z";
const firstStudentId = "student-4001";
const secondStudentId = "student-4002";

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

const useLocalEmulator = isLocalEmulatorHost(firestoreEmulatorHost);
if (!useLocalEmulator) {
  console.warn(
    "SKIP member-directory bootstrap closure integration: FIRESTORE_EMULATOR_HOST must be loopback",
  );
}

const app = useLocalEmulator
  ? initializeApp({ projectId }, "member-directory-closure-" + runId)
  : undefined;
const firestore = app === undefined ? undefined : getFirestore(app);
const describeLocal = useLocalEmulator ? describe : describe.skip;

function requireFirestore(): Firestore {
  if (firestore === undefined) {
    throw new Error("Local Firestore emulator is unavailable");
  }
  return firestore;
}

function legacyBaselineState(): MemberDirectoryState {
  return {
    stateId: "current",
    academyId,
    readerVersion: "legacy-v1",
    directoryWriteMode: "legacy-v1",
    freezeStatus: "open",
    stateRevision: 0,
    globalLegacyReadEliminated: false,
    identityKeyCoverage: "incomplete",
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
  };
}

function studentDocument(studentId: string): Readonly<Record<string, unknown>> {
  return {
    studentId,
    academyId,
    fullName: "Synthetic Closure Student " + studentId,
    dateOfBirth: "2000-01-02",
    phoneNumber: "+441534000001",
    email: studentId + "@example.test",
    trainingCenter: "Town",
    trainingTimePreferences: ["evening"],
    participantType: "adult",
    active: true,
    status: "active",
    schemaVersion: "1",
    createdAt: initializedAt,
    createdBy: actorId,
    updatedAt: initializedAt,
    updatedBy: actorId,
  };
}

function profileDocument(
  studentId: string,
  membershipNumber: string,
): Readonly<Record<string, unknown>> {
  return {
    studentId,
    academyId,
    membershipNumber,
    gender: "unknown",
    source: "admin",
    schemaVersion: "1",
    createdAt: initializedAt,
    createdBy: actorId,
    updatedAt: initializedAt,
    updatedBy: actorId,
  };
}

const membershipNumberByStudent: Readonly<Record<string, string>> = {
  [firstStudentId]: "BPT 4001",
  [secondStudentId]: "BPT 4002",
};

/**
 * The baseline MAC the frozen artifact would carry. It is computed here from the tuples the plan
 * expects, exactly as the dry-run would have, and never from what the closure reads back - the
 * whole point of the rehearsal is that those two are established independently.
 */
function artifactBaselineMac(tuples: readonly string[]): string {
  return createMemberDirectoryIdentityBaselineMac({
    academyId,
    operationId,
    secretVersion: identitySecretVersion,
    tuples,
    secretMaterial: integritySecretMaterial,
  });
}

/**
 * The tuples the frozen plan expects, derived once here from the same inputs the dry-run would have
 * used. Computing them before anything is written is what lets the artifact be a genuinely
 * independent statement of the baseline rather than a transcript of what the chunks happened to do.
 */
const plannedTuples: readonly string[] = (() => {
  const tuples: string[] = [];
  for (const [studentId, membershipNumber] of Object.entries(membershipNumberByStudent)) {
    const plan = planMemberDirectoryBootstrapChunk(
      {
        academyId,
        operationId,
        chunkNo: 1,
        plannedStudentIds: [studentId],
        observed: [
          {
            studentId,
            student: studentDocument(studentId),
            profile: profileDocument(studentId, membershipNumber),
          },
        ],
        existingKeys: [],
        now: committedAt,
        actorId,
      },
      { identitySecretMaterial, identitySecretVersion, integritySecretMaterial },
    );
    tuples.push(...plan.expectedKeyTuples);
  }
  return Object.freeze(tuples);
})();

const plannedBaselineMac = artifactBaselineMac(plannedTuples);

async function seedFrozenBootstrapControlPlane(database: Firestore): Promise<void> {
  const baseline = legacyBaselineState();
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
    phase: "bootstrap",
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
    transitionKind: "identity-key-bootstrap",
    now: acquiredAt,
    actorId,
    integritySecretMaterial,
    integritySecretVersion,
  });

  const operation = memberDirectoryOperationDocumentSchema.parse({
    operationId,
    academyId,
    operationType: "identity-key-bootstrap",
    status: "frozen",
    receipt: {
      operationId,
      academyId,
      phase: "bootstrap",
      targetProjectClassification: "emulator",
      codeVersion: "8680f7c",
      schemaVersion: "1",
      effectiveDate: initializedAt,
      expiresAt: "2026-09-07T13:00:00.000Z",
      sourceMac: "a".repeat(64),
      privateManifestMac: "b".repeat(64),
      planMac: "c".repeat(64),
      digestVersion: "hmac-sha256-v1",
      secretVersion: identitySecretVersion,
      // Filled in below, once the plan that determines it exists.
      identityKeyBaselineMac: plannedBaselineMac,
      expectedOutputSetMacRoots: ["e".repeat(64)],
      classificationCounts: Object.fromEntries(
        memberDirectoryDryRunClassifications.map((classification) => [classification, 0]),
      ),
      preExistingAdmittedStudentCount: 2,
      plannedNewStudentCount: 0,
      postCutoverAdmittedStudentCount: 2,
      maximumApprovedRows: 400,
      integrityMacVersion: "hmac-sha256-v1",
      integritySecretVersion,
      operationWriteTime: initializedAt,
      createdAt: initializedAt,
      createdBy: actorId,
    },
    statusAuditEventId: "1",
    statusChangedAt: acquiredAt,
    statusChangedBy: actorId,
    schemaVersion: "1",
    createdAt: initializedAt,
    createdBy: actorId,
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
  for (const [studentId, membershipNumber] of Object.entries(membershipNumberByStudent)) {
    batch.create(
      database.doc(`academies/${academyId}/students/${studentId}`),
      studentDocument(studentId),
    );
    batch.create(
      database.doc(`academies/${academyId}/studentAdminProfiles/${studentId}`),
      profileDocument(studentId, membershipNumber),
    );
  }
  await batch.commit();
}

async function readObservedRows(
  database: Firestore,
  studentIds: readonly string[],
): Promise<readonly Readonly<{ studentId: string; student: unknown; profile: unknown }>[]> {
  return Promise.all(
    studentIds.map(async (studentId) => {
      const [student, profile] = await Promise.all([
        database.doc(`academies/${academyId}/students/${studentId}`).get(),
        database.doc(`academies/${academyId}/studentAdminProfiles/${studentId}`).get(),
      ]);
      return { studentId, student: student.data(), profile: profile.data() };
    }),
  );
}

function planFor(
  observed: readonly Readonly<{ studentId: string; student: unknown; profile: unknown }>[],
  studentIds: readonly string[],
  chunkNo: number,
) {
  return planMemberDirectoryBootstrapChunk(
    {
      academyId,
      operationId,
      chunkNo,
      plannedStudentIds: studentIds,
      observed,
      existingKeys: [],
      now: committedAt,
      actorId,
    },
    { identitySecretMaterial, identitySecretVersion, integritySecretMaterial },
  );
}

/** The key ID the first planned tuple names, which is the document the first chunk reserved. */
function firstKeyId(): string {
  return parseStudentIdentityKeyTuple(plannedTuples[0] ?? "").keyId;
}

function frozenArtifact(): MemberDirectoryBootstrapBaselineArtifact {
  const [firstTuple, secondTuple] = plannedTuples as [string, string];
  return Object.freeze({
    artifactId,
    academyId,
    operationId,
    secretVersion: identitySecretVersion,
    identityKeyBaselineMac: plannedBaselineMac,
    chunks: Object.freeze([
      Object.freeze({ chunkNo: 1, expectedKeyTuples: Object.freeze([firstTuple]) }),
      Object.freeze({ chunkNo: 2, expectedKeyTuples: Object.freeze([secondTuple]) }),
    ]),
  });
}

function closureDependencies(database: Firestore): MemberDirectoryBootstrapClosureDependencies {
  return {
    projectId,
    store: createMemberDirectoryBootstrapClosureFirestoreStore(database),
    artifacts: { open: async () => frozenArtifact() },
    integritySecretMaterial,
    integritySecretVersion,
    now: () => closedAt,
  };
}

async function readStoredState(database: Firestore): Promise<MemberDirectoryState> {
  const state = await database.doc(`academies/${academyId}/memberDirectoryStates/current`).get();
  const guard = await database.doc(`memberDirectoryRestoreGuards/${academyId}`).get();
  const lastEventId = guard.data()?.["lastEventId"] as string;
  const event = await database
    .doc(`memberDirectoryRestoreGuards/${academyId}/events/${lastEventId}`)
    .get();
  // Re-validates the whole chain from what Firestore actually stored, not from what was sent.
  const verified = assertMemberDirectoryControlPlane({
    projectId,
    state: state.data(),
    guard: guard.data(),
    event: event.data(),
    integritySecretMaterial,
    integritySecretVersion,
  });
  return verified.state;
}

async function readStoredOperation(database: Firestore) {
  const stored = await database
    .doc(`academies/${academyId}/memberDirectoryMigrations/${operationId}`)
    .get();
  return memberDirectoryOperationDocumentSchema.parse(stored.data());
}

async function commitBothChunks(database: Firestore): Promise<void> {
  const store = createMemberDirectoryChunkFirestoreStore(database);
  const studentIdsByChunk: readonly (readonly string[])[] = [[firstStudentId], [secondStudentId]];
  for (const [index, studentIds] of studentIdsByChunk.entries()) {
    const chunkNo = index + 1;
    const observed = await readObservedRows(database, studentIds);
    const plan = planFor(observed, studentIds, chunkNo);
    const result = await runMemberDirectoryChunkCommit(
      {
        projectId,
        store,
        integritySecretMaterial,
        integritySecretVersion,
        now: () => committedAt,
      },
      {
        academyId,
        operationId,
        phase: "bootstrap",
        chunkNo,
        rowCount: plan.rowCount,
        quarantinedCount: plan.quarantinedCount,
        outputSetMac: plan.outputSetMac,
        actorId,
        domainWrites: plan.domainWrites,
      },
    );
    expect(result.committed).toBe(true);
  }
}

afterAll(async () => {
  if (app !== undefined) {
    await deleteApp(app);
  }
});

describeLocal("member directory bootstrap closure against the Emulator", () => {
  it("verifies the stored baseline, then completes and hands the directory back", async () => {
    const database = requireFirestore();
    await seedFrozenBootstrapControlPlane(database);
    await commitBothChunks(database);

    const beforeClosure = await readStoredState(database);
    expect(beforeClosure.stateRevision).toBe(3);
    expect(beforeClosure.lastCommittedChunkNo).toBe(2);
    expect((await readStoredOperation(database)).status).toBe("applying");

    /**
     * Before anything is verified: remove one of the two reservations the baseline is built from.
     * A baseline is only as true as the documents behind it, so the closure must refuse rather than
     * prove whatever survived - and it must refuse without moving the parent.
     */
    const missingKeyPath = `academies/${academyId}/studentIdentityKeys/${firstKeyId()}`;
    const removed = await database.doc(missingKeyPath).get();
    expect(removed.exists).toBe(true);
    await database.doc(missingKeyPath).delete();
    await expect(
      runMemberDirectoryBootstrapVerification(closureDependencies(database), {
        academyId,
        operationId,
        actorId,
      }),
    ).rejects.toThrow(/a reservation the baseline artifact expects does not exist/u);
    expect((await readStoredOperation(database)).status).toBe("applying");
    await database.doc(missingKeyPath).create(removed.data() ?? {});

    const dependencies = closureDependencies(database);
    const request = { academyId, operationId, actorId };

    /**
     * Verification. The baseline is recomputed from the two reservation documents the chunks wrote,
     * read back through the adapter, and it matches a MAC that was computed before any of them
     * existed.
     */
    const verified = await runMemberDirectoryBootstrapVerification(dependencies, request);
    expect(verified.moved).toBe(true);
    expect(verified.verification?.identityCount).toBe(2);
    expect(verified.verification?.chunkCount).toBe(2);
    expect(verified.verification?.identityKeyBaselineMac).toBe(plannedBaselineMac);

    const afterVerification = await readStoredState(database);
    // Only the parent moved. Same revision, same frozen tuple, coverage still incomplete - the
    // property that makes a crash between the two halves safe to resume.
    expect(afterVerification.stateRevision).toBe(3);
    expect(afterVerification.freezeStatus).toBe("frozen");
    expect(afterVerification.identityKeyCoverage).toBe("incomplete");
    expect(afterVerification.activeOperationId).toBe(operationId);
    const verifiedParent = await readStoredOperation(database);
    expect(verifiedParent.status).toBe("verified");

    // A second verification is a no-op that still re-establishes the proof.
    const again = await runMemberDirectoryBootstrapVerification(dependencies, request);
    expect(again.moved).toBe(false);
    expect(again.verification?.identityKeyBaselineMac).toBe(plannedBaselineMac);
    expect((await readStoredState(database)).stateRevision).toBe(3);

    /** Completion: the same proof from scratch, then state, guard, event and parent together. */
    const completed = await runMemberDirectoryBootstrapCompletion(dependencies, request);
    expect(completed.moved).toBe(true);

    const finalState = await readStoredState(database);
    expect(finalState.stateRevision).toBe(4);
    expect(finalState.identityKeyCoverage).toBe("complete");
    expect(finalState.identityKeyBaselineMac).toBe(plannedBaselineMac);
    expect(finalState.identityKeyBaselineArtifactId).toBe(artifactId);
    // The pre-cutover tuple, not the canonical one: bootstrap covered identities, it migrated none.
    expect(finalState.readerVersion).toBe("legacy-v1");
    expect(finalState.directoryWriteMode).toBe("legacy-v1");
    expect(finalState.freezeStatus).toBe("open");
    expect(finalState.operationPhase).toBe("idle");
    expect(finalState.lastCommittedChunkNo).toBe(0);
    // A stable tuple carries no lease, and does not carry an empty one.
    expect(finalState.activeOperationId).toBeUndefined();
    expect(finalState.leaseId).toBeUndefined();
    expect(finalState.leaseExpiresAt).toBeUndefined();

    const finalParent = await readStoredOperation(database);
    expect(finalParent.status).toBe("completed");
    expect(finalParent.statusAuditEventId).toBe("4");
    // The frozen dry-run receipt is carried through the closure untouched.
    expect(finalParent.receipt.planMac).toBe("c".repeat(64));
    expect(finalParent.receipt.identityKeyBaselineMac).toBe(plannedBaselineMac);

    const closingEvent = await database
      .doc(`memberDirectoryRestoreGuards/${academyId}/events/4`)
      .get();
    expect(closingEvent.exists).toBe(true);
    expect(closingEvent.data()?.["transitionKind"]).toBe("identity-key-bootstrap");
    expect(closingEvent.data()?.["operationId"]).toBe(operationId);

    /**
     * Completion again. The parent is terminal and the closure says so instead of writing a second
     * completion over a state that is no longer frozen.
     */
    const replay = await runMemberDirectoryBootstrapCompletion(dependencies, request);
    expect(replay.moved).toBe(false);
    expect(replay.reason).toMatch(/already completed/u);
    // And no proof, because the freeze it would have been about is open again.
    expect(replay.verification).toBeUndefined();
    expect((await readStoredState(database)).stateRevision).toBe(4);
  });

  it("refuses a verification planned against a control plane that has since moved", async () => {
    const database = requireFirestore();
    const store = createMemberDirectoryBootstrapClosureFirestoreStore(database);
    const parent = await readStoredOperation(database);

    /**
     * The stale write: a parent change filed against revision 3, which is where the earlier
     * verification stood, after completion has moved the control plane to revision 4. The
     * compare-and-set is the only thing standing between this and a parent moved over a state
     * nobody rechecked.
     */
    await expect(
      store.commitVerification({
        academyId,
        expectedStateRevision: 3,
        expectedEventMac: "0".repeat(64),
        operation: parent,
      }),
    ).rejects.toThrow(/moved while the baseline was being verified/u);

    expect((await readStoredOperation(database)).status).toBe("completed");
  });
});
