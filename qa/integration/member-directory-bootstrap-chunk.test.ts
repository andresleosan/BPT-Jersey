import { randomUUID } from "node:crypto";

import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { afterAll, describe, expect, it } from "vitest";

import type { MemberDirectoryState } from "@bpt-jersey/domain/members/directory";
import { memberDirectoryDryRunClassifications } from "@bpt-jersey/domain/members/directory-migration";
import { memberDirectoryOperationDocumentSchema } from "@bpt-jersey/domain/members/directory-operations";
import { planMemberDirectoryAcquisition } from "@bpt-jersey/domain/members/directory-transitions";

import { planMemberDirectoryBootstrapChunk } from "../../apps/functions/src/members/member-directory-bootstrap-executor.js";
import { createMemberDirectoryChunkFirestoreStore } from "../../apps/functions/src/members/member-directory-chunk-runner-firestore.js";
import {
  runMemberDirectoryChunkCommit,
  type MemberDirectoryChunkCommitWrite,
  type MemberDirectoryChunkStore,
} from "../../apps/functions/src/members/member-directory-chunk-runner.js";
import { buildStudentIdentityKey } from "../../apps/functions/src/members/member-directory-crypto.js";
import {
  advanceMemberDirectoryControlPlane,
  assertMemberDirectoryControlPlane,
  buildInitialMemberDirectoryControlPlane,
} from "../../apps/functions/src/members/member-directory-state.js";

/**
 * The Emulator rehearsal of the first T108 executor: the identity-key bootstrap chunk, committed
 * through the real transactional envelope against a real Firestore.
 *
 * The unit tests prove the rules; this proves the parts a double cannot - that state, guard, event,
 * receipt and the executor's identity keys land in one transaction or not at all, that the
 * compare-and-set in the adapter refuses a plan made against a state that has since moved, and that
 * a refusal leaves the freeze exactly as it was.
 */

const projectId = "demo-bpt-jersey";
const runId = "member-directory-bootstrap-" + process.pid + "-" + randomUUID().slice(0, 8);
const academyId = runId + "-academy";
const operationId = "op-bootstrap-" + randomUUID().slice(0, 8);
const actorId = runId + "-runner";
const identitySecretMaterial = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8";
const integritySecretMaterial = "ICEiIyQlJicoKSorLC0uLzAxMjM0NTY3ODk6Ozw9Pj8";
const integritySecretVersion = "integrity-v1";
const identitySecretVersion = "identity-v1";
const initializedAt = "2026-09-07T11:00:00.000Z";
const acquiredAt = "2026-09-07T12:00:00.000Z";
const committedAt = "2026-09-07T12:01:00.000Z";
const operationDeadline = "2026-09-07T12:25:00.000Z";
const firstStudentId = "student-3001";
const secondStudentId = "student-3002";

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
    "SKIP member-directory bootstrap chunk integration: FIRESTORE_EMULATOR_HOST must be loopback",
  );
}

const app = useLocalEmulator
  ? initializeApp({ projectId }, "member-directory-bootstrap-" + runId)
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
    fullName: "Synthetic Bootstrap Student " + studentId,
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
  [firstStudentId]: "BPT 3001",
  [secondStudentId]: "BPT 3002",
};

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
      codeVersion: "9a9d839",
      schemaVersion: "1",
      effectiveDate: initializedAt,
      expiresAt: "2026-09-07T13:00:00.000Z",
      sourceMac: "a".repeat(64),
      privateManifestMac: "b".repeat(64),
      planMac: "c".repeat(64),
      digestVersion: "hmac-sha256-v1",
      secretVersion: identitySecretVersion,
      identityKeyBaselineMac: "d".repeat(64),
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

async function readStoredControlPlane(database: Firestore): Promise<MemberDirectoryState> {
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
  // Re-parsed from what Firestore stored, not from what was sent.
  return memberDirectoryOperationDocumentSchema.parse(stored.data());
}

async function countIdentityKeys(database: Firestore): Promise<number> {
  const keys = await database.collection(`academies/${academyId}/studentIdentityKeys`).get();
  return keys.size;
}

function planFor(
  observed: readonly Readonly<{ studentId: string; student: unknown; profile: unknown }>[],
  studentIds: readonly string[],
  chunkNo: number,
  existingKeys: readonly unknown[] = [],
) {
  return planMemberDirectoryBootstrapChunk(
    {
      academyId,
      operationId,
      chunkNo,
      plannedStudentIds: studentIds,
      observed,
      existingKeys,
      now: committedAt,
      actorId,
    },
    { identitySecretMaterial, identitySecretVersion, integritySecretMaterial },
  );
}

function recordingStore(store: MemberDirectoryChunkStore): {
  store: MemberDirectoryChunkStore;
  writes: MemberDirectoryChunkCommitWrite[];
} {
  const writes: MemberDirectoryChunkCommitWrite[] = [];
  return {
    writes,
    store: {
      read: (input) => store.read(input),
      commit: async (write) => {
        writes.push(write);
        return store.commit(write);
      },
    },
  };
}

afterAll(async () => {
  if (app !== undefined) {
    await deleteApp(app);
  }
});

describeLocal("member directory bootstrap chunk against the Emulator", () => {
  it("commits identity keys, receipt and control plane in one transaction, and refuses to move twice", async () => {
    const database = requireFirestore();
    await seedFrozenBootstrapControlPlane(database);

    const store = createMemberDirectoryChunkFirestoreStore(database);
    const recorder = recordingStore(store);
    const observed = await readObservedRows(database, [firstStudentId]);
    const plan = planFor(observed, [firstStudentId], 1);
    expect(plan.createdKeyCount).toBe(1);

    const result = await runMemberDirectoryChunkCommit(
      {
        projectId,
        store: recorder.store,
        integritySecretMaterial,
        integritySecretVersion,
        now: () => committedAt,
      },
      {
        academyId,
        operationId,
        phase: "bootstrap",
        chunkNo: 1,
        rowCount: plan.rowCount,
        quarantinedCount: plan.quarantinedCount,
        outputSetMac: plan.outputSetMac,
        actorId,
        domainWrites: plan.domainWrites,
      },
    );

    expect(result.committed).toBe(true);
    expect(result.chunkId).toBe(operationId + ":bootstrap:1");

    // The domain document the executor planned is really there, under the path it planned.
    const keyPath = plan.domainWrites[0]?.path ?? "";
    const storedKey = await database.doc(keyPath).get();
    expect(storedKey.exists).toBe(true);
    expect(storedKey.data()?.["ownerStudentId"]).toBe(firstStudentId);

    const receipt = await database
      .doc(`academies/${academyId}/memberDirectoryMigrationChunks/${result.chunkId}`)
      .get();
    expect(receipt.exists).toBe(true);
    expect(receipt.data()?.["outputSetMac"]).toBe(plan.outputSetMac);
    expect(receipt.data()?.["writtenCount"]).toBe(1);

    const committedState = await readStoredControlPlane(database);
    expect(committedState.stateRevision).toBe(2);
    expect(committedState.lastCommittedChunkNo).toBe(1);
    expect(committedState.freezeStatus).toBe("frozen");

    // The parent moved in the same transaction, bound to the same guard event as the state.
    const parent = await readStoredOperation(database);
    expect(parent.status).toBe("applying");
    expect(parent.statusAuditEventId).toBe(String(committedState.stateRevision));
    expect(parent.receipt.planMac).toBe("c".repeat(64));

    /**
     * Re-issuing the exact commit the runner produced must fail. The receipt, the guard event and
     * the identity keys are created, never overwritten, so a second attempt at a committed chunk
     * cannot quietly rewrite what the first one wrote. (The compare-and-set that guards a *stale*
     * plan is a different rule, proved on its own below.)
     */
    const committedWrite = recorder.writes[0];
    expect(committedWrite).toBeDefined();
    if (committedWrite !== undefined) {
      await expect(store.commit(committedWrite)).rejects.toThrow();
    }
    const afterReplay = await readStoredControlPlane(database);
    expect(afterReplay.stateRevision).toBe(2);
    expect(await countIdentityKeys(database)).toBe(1);
  });

  it("no-ops an exact chunk replay and writes nothing new", async () => {
    const database = requireFirestore();
    const store = createMemberDirectoryChunkFirestoreStore(database);
    const observed = await readObservedRows(database, [firstStudentId]);
    const plan = planFor(observed, [firstStudentId], 1);

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
        chunkNo: 1,
        rowCount: plan.rowCount,
        quarantinedCount: plan.quarantinedCount,
        outputSetMac: plan.outputSetMac,
        actorId,
        domainWrites: plan.domainWrites,
      },
    );

    expect(result.committed).toBe(false);
    expect(result.reason).toMatch(/already committed/u);
    const state = await readStoredControlPlane(database);
    expect(state.stateRevision).toBe(2);
    expect(await countIdentityKeys(database)).toBe(1);
  });

  /**
   * A reservation already owned by someone else is the case that must never be resolved by a
   * heuristic. The chunk fails, the freeze stands, and nothing at all is written.
   */
  it("refuses a chunk whose identifier is reserved for another student and preserves the freeze", async () => {
    const database = requireFirestore();
    const intruderKey = buildStudentIdentityKey({
      academyId,
      kind: "membership-number",
      value: membershipNumberByStudent[secondStudentId] ?? "",
      ownerStudentId: "student-9999",
      secretMaterial: identitySecretMaterial,
      secretVersion: identitySecretVersion,
      now: initializedAt,
      actorId,
    });
    await database
      .doc(`academies/${academyId}/studentIdentityKeys/${intruderKey.keyId}`)
      .create(intruderKey);

    const observed = await readObservedRows(database, [secondStudentId]);
    expect(() => planFor(observed, [secondStudentId], 2, [intruderKey])).toThrow(
      /owned by another student/u,
    );

    const state = await readStoredControlPlane(database);
    expect(state.stateRevision).toBe(2);
    expect(state.lastCommittedChunkNo).toBe(1);
    expect(state.freezeStatus).toBe("frozen");
    const receipt = await database
      .doc(`academies/${academyId}/memberDirectoryMigrationChunks/${operationId}:bootstrap:2`)
      .get();
    expect(receipt.exists).toBe(false);
  });

  it("commits the next chunk in sequence and counts its rows against the operation", async () => {
    const database = requireFirestore();
    // The intruder is removed so the second student may hold its own reservation; the point of the
    // previous test was that the executor refused while it was there.
    const blockedKey = buildStudentIdentityKey({
      academyId,
      kind: "membership-number",
      value: membershipNumberByStudent[secondStudentId] ?? "",
      ownerStudentId: "student-9999",
      secretMaterial: identitySecretMaterial,
      secretVersion: identitySecretVersion,
      now: initializedAt,
      actorId,
    });
    await database.doc(`academies/${academyId}/studentIdentityKeys/${blockedKey.keyId}`).delete();

    const store = createMemberDirectoryChunkFirestoreStore(database);
    const observed = await readObservedRows(database, [secondStudentId]);
    const plan = planFor(observed, [secondStudentId], 2);

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
        chunkNo: 2,
        rowCount: plan.rowCount,
        quarantinedCount: plan.quarantinedCount,
        outputSetMac: plan.outputSetMac,
        actorId,
        domainWrites: plan.domainWrites,
      },
    );

    expect(result.committed).toBe(true);
    const state = await readStoredControlPlane(database);
    expect(state.stateRevision).toBe(3);
    expect(state.lastCommittedChunkNo).toBe(2);
    expect(await countIdentityKeys(database)).toBe(2);

    // A later chunk does not move the parent again: it stays on the audit event of the first.
    const parent = await readStoredOperation(database);
    expect(parent.status).toBe("applying");
    expect(parent.statusAuditEventId).toBe("2");

    // The adapter sums the operation's earlier receipts, which is how the 400-row operation budget
    // is enforced across chunks rather than per chunk.
    const controlPlane = await store.read({
      academyId,
      operationId,
      chunkId: operationId + ":bootstrap:3",
    });
    expect(controlPlane.priorRowCount).toBe(2);
  });

  /**
   * The compare-and-set, isolated.
   *
   * The port is read-then-commit, so the runner plans against a state it read a moment earlier. A
   * concurrent writer landing in that window is simulated here exactly: the wrapper advances the
   * stored state between the runner's read and the adapter's commit. The commit must refuse on the
   * revision it was planned against, and leave no receipt and no key behind - not on the receipt
   * already existing, which is a different rule and would not catch this at all.
   *
   * This test is last on purpose: it deliberately leaves the control plane bumped out of band.
   */
  it("refuses a commit planned against a state that moved underneath it", async () => {
    const database = requireFirestore();
    const store = createMemberDirectoryChunkFirestoreStore(database);
    const stateReference = database.doc(`academies/${academyId}/memberDirectoryStates/current`);
    const observed = await readObservedRows(database, [firstStudentId]);
    const storedKeys = await database
      .collection(`academies/${academyId}/studentIdentityKeys`)
      .get();
    // A third chunk over the first student, whose key already exists and is compatible: it plans
    // zero domain writes, so no create can collide and the stale revision is the only thing left
    // that can stop it.
    const plan = planFor(
      observed,
      [firstStudentId],
      3,
      storedKeys.docs.map((document) => document.data()),
    );
    expect(plan.domainWrites).toHaveLength(0);

    const interferingStore: MemberDirectoryChunkStore = {
      read: (input) => store.read(input),
      commit: async (write) => {
        const current = await stateReference.get();
        const state = current.data() ?? {};
        await stateReference.set({
          ...state,
          stateRevision: (state["stateRevision"] as number) + 1,
        });
        return store.commit(write);
      },
    };

    await expect(
      runMemberDirectoryChunkCommit(
        {
          projectId,
          store: interferingStore,
          integritySecretMaterial,
          integritySecretVersion,
          now: () => committedAt,
        },
        {
          academyId,
          operationId,
          phase: "bootstrap",
          chunkNo: 3,
          rowCount: plan.rowCount,
          quarantinedCount: plan.quarantinedCount,
          outputSetMac: plan.outputSetMac,
          actorId,
          domainWrites: plan.domainWrites,
        },
      ),
    ).rejects.toThrow(/moved while the chunk was being planned/u);

    const receipt = await database
      .doc(`academies/${academyId}/memberDirectoryMigrationChunks/${operationId}:bootstrap:3`)
      .get();
    expect(receipt.exists).toBe(false);
    expect(await countIdentityKeys(database)).toBe(2);
  });
});
