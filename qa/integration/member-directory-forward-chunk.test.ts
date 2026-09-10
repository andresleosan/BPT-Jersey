import { randomUUID } from "node:crypto";

import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { afterAll, describe, expect, it } from "vitest";

import type { MemberDirectoryState } from "@bpt-jersey/domain/members/directory";
import { memberDirectoryDryRunClassifications } from "@bpt-jersey/domain/members/directory-migration";
import { memberDirectoryOperationDocumentSchema } from "@bpt-jersey/domain/members/directory-operations";
import { planMemberDirectoryAcquisition } from "@bpt-jersey/domain/members/directory-transitions";

import { createMemberDirectoryChunkFirestoreStore } from "../../apps/functions/src/members/member-directory-chunk-runner-firestore.js";
import { runMemberDirectoryChunkCommit } from "../../apps/functions/src/members/member-directory-chunk-runner.js";
import {
  buildStudentIdentityKey,
  createMemberDirectorySourceRowMac,
} from "../../apps/functions/src/members/member-directory-crypto.js";
import {
  planMemberDirectoryForwardChunk,
  type MemberDirectoryForwardObservedRow,
  type MemberDirectoryForwardPlannedRow,
} from "../../apps/functions/src/members/member-directory-forward-executor.js";
import {
  advanceMemberDirectoryControlPlane,
  assertMemberDirectoryControlPlane,
  buildInitialMemberDirectoryControlPlane,
} from "../../apps/functions/src/members/member-directory-state.js";

/**
 * The Emulator rehearsal of the forward chunk executor (T108, slice 10) - the first executor that
 * writes real domain documents, committed through the same transactional envelope as bootstrap
 * against a real Firestore.
 *
 * The unit tests prove the rules. This proves the parts a double cannot: that a student, its admin
 * profile and its reservations land together with the receipt, the control plane and the parent in
 * one transaction; that a matched student is attached to without its own document being touched;
 * that the row budget accumulates through the stored receipts of earlier chunks; and that a refused
 * chunk leaves the freeze standing with nothing written at all.
 */

const projectId = "demo-bpt-jersey";
const runId = "member-directory-forward-" + process.pid + "-" + randomUUID().slice(0, 8);
const academyId = runId + "-academy";
const operationId = "op-forward-" + randomUUID().slice(0, 8);
const actorId = runId + "-runner";
const identitySecretMaterial = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8";
const integritySecretMaterial = "ICEiIyQlJicoKSorLC0uLzAxMjM0NTY3ODk6Ozw9Pj8";
const integritySecretVersion = "integrity-v1";
const identitySecretVersion = "identity-v1";
const initializedAt = "2026-09-08T11:00:00.000Z";
const acquiredAt = "2026-09-08T12:00:00.000Z";
const operationWriteTime = "2026-09-08T12:00:30.000Z";
const committedAt = "2026-09-08T12:01:00.000Z";
const operationDeadline = "2026-09-08T12:25:00.000Z";
const effectiveDate = "2026-09-08";

const createRowLegacyId = "LEGACY-7001";
const createRowStudentId = "student-new-7001";
const matchRowLegacyId = "LEGACY-7002";
const matchedStudentId = "student-existing-7002";
const conflictRowLegacyId = "LEGACY-7003";
const conflictStudentId = "student-new-7003";

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
    "SKIP member-directory forward chunk integration: FIRESTORE_EMULATOR_HOST must be loopback",
  );
}

const app = useLocalEmulator
  ? initializeApp({ projectId }, "member-directory-forward-" + runId)
  : undefined;
const firestore = app === undefined ? undefined : getFirestore(app);
const describeLocal = useLocalEmulator ? describe : describe.skip;

function requireFirestore(): Firestore {
  if (firestore === undefined) {
    throw new Error("Local Firestore emulator is unavailable");
  }
  return firestore;
}

/**
 * The state a completed identity-key bootstrap leaves behind: the baseline recorded and complete,
 * the reader still legacy. That is the only tuple forward may be acquired from.
 */
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
    identityKeyBaselineMac: "f".repeat(64),
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
  };
}

function legacyMemberDocument(
  memberId: string,
  membershipNumber: string,
  overrides: Readonly<Record<string, unknown>> = {},
): Readonly<Record<string, unknown>> {
  return {
    memberId,
    academyId,
    membershipNumber,
    fullName: "Synthetic Forward Member " + memberId,
    email: memberId.toLowerCase() + "@example.test",
    birthDate: "1990-04-05",
    mobileNumber: "+441534000701",
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
    ...overrides,
  };
}

function existingStudentDocument(studentId: string): Readonly<Record<string, unknown>> {
  return {
    studentId,
    academyId,
    fullName: "Existing Canonical Student " + studentId,
    dateOfBirth: "1985-07-08",
    trainingCenter: "West",
    trainingTimePreferences: ["morning"],
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

const membershipNumberByLegacyId: Readonly<Record<string, string>> = {
  [createRowLegacyId]: "BPT 7001",
  [matchRowLegacyId]: "BPT 7002",
  [conflictRowLegacyId]: "BPT 7003",
};

async function seedFrozenForwardControlPlane(database: Firestore): Promise<void> {
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

  const operation = memberDirectoryOperationDocumentSchema.parse({
    operationId,
    academyId,
    operationType: "directory-forward",
    status: "frozen",
    receipt: {
      operationId,
      academyId,
      phase: "forward",
      targetProjectClassification: "emulator",
      codeVersion: "885c701",
      schemaVersion: "1",
      effectiveDate: initializedAt,
      expiresAt: "2026-09-08T13:00:00.000Z",
      sourceMac: "a".repeat(64),
      privateManifestMac: "b".repeat(64),
      planMac: "c".repeat(64),
      digestVersion: "hmac-sha256-v1",
      secretVersion: identitySecretVersion,
      identityKeyBaselineMac: "f".repeat(64),
      expectedOutputSetMacRoots: ["e".repeat(64)],
      classificationCounts: Object.fromEntries(
        memberDirectoryDryRunClassifications.map((classification) => [classification, 0]),
      ),
      preExistingAdmittedStudentCount: 1,
      plannedNewStudentCount: 1,
      postCutoverAdmittedStudentCount: 2,
      maximumApprovedRows: 400,
      integrityMacVersion: "hmac-sha256-v1",
      integritySecretVersion,
      operationWriteTime,
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
  for (const [legacyMemberId, membershipNumber] of Object.entries(membershipNumberByLegacyId)) {
    batch.create(
      database.doc(`academies/${academyId}/members/${legacyMemberId}`),
      legacyMemberDocument(legacyMemberId, membershipNumber),
    );
  }
  // The student an explicit match attaches to; it predates the migration and is never rewritten.
  batch.create(
    database.doc(`academies/${academyId}/students/${matchedStudentId}`),
    existingStudentDocument(matchedStudentId),
  );
  await batch.commit();
}

/**
 * Reads exactly what the confirmation algorithm requires per row: the legacy row re-read inside the
 * chunk, the target student and admin profile, and the reservations the row's identifiers would
 * occupy. The source MAC is taken from the stored document, which is what the dry-run would have
 * recorded, so the plan and the observation are two reads of the same thing rather than one.
 */
async function readForwardRow(
  database: Firestore,
  legacyMemberId: string,
  targetStudentId: string,
): Promise<Readonly<{ observed: MemberDirectoryForwardObservedRow; sourceRowMac: string }>> {
  const [member, student, profile] = await Promise.all([
    database.doc(`academies/${academyId}/members/${legacyMemberId}`).get(),
    database.doc(`academies/${academyId}/students/${targetStudentId}`).get(),
    database.doc(`academies/${academyId}/studentAdminProfiles/${targetStudentId}`).get(),
  ]);
  const document = member.data();
  return {
    observed: {
      legacyMemberId,
      member: document,
      student: student.data(),
      profile: profile.data(),
    },
    sourceRowMac: createMemberDirectorySourceRowMac({
      academyId,
      sourceCollection: "members",
      sourceId: legacyMemberId,
      document,
      secretMaterial: integritySecretMaterial,
    }),
  };
}

async function readExistingKeys(
  database: Firestore,
  keyIds: readonly string[],
): Promise<readonly unknown[]> {
  const documents = await Promise.all(
    keyIds.map((keyId) =>
      database.doc(`academies/${academyId}/studentIdentityKeys/${keyId}`).get(),
    ),
  );
  return documents.flatMap((document) => (document.exists ? [document.data()] : []));
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
  return memberDirectoryOperationDocumentSchema.parse(stored.data());
}

async function countIdentityKeys(database: Firestore): Promise<number> {
  const keys = await database.collection(`academies/${academyId}/studentIdentityKeys`).get();
  return keys.size;
}

async function countAdminProfiles(database: Firestore): Promise<number> {
  const profiles = await database.collection(`academies/${academyId}/studentAdminProfiles`).get();
  return profiles.size;
}

function plannedRowFor(
  legacyMemberId: string,
  targetStudentId: string,
  sourceRowMac: string,
  overrides: Partial<MemberDirectoryForwardPlannedRow> = {},
): MemberDirectoryForwardPlannedRow {
  return {
    legacyMemberId,
    classification: "createable-adult",
    explicitlyReviewed: false,
    targetStudentId,
    sourceRowMac,
    trainingTimePreferences: ["evening"],
    ...overrides,
  };
}

function planFor(
  chunkNo: number,
  plannedRows: readonly MemberDirectoryForwardPlannedRow[],
  observed: readonly MemberDirectoryForwardObservedRow[],
  existingKeys: readonly unknown[] = [],
) {
  return planMemberDirectoryForwardChunk(
    {
      academyId,
      operationId,
      chunkNo,
      plannedRows,
      observed,
      existingKeys,
      operationWriteTime,
      effectiveDate,
      actorId,
    },
    { identitySecretMaterial, identitySecretVersion, integritySecretMaterial },
  );
}

async function commitChunk(
  database: Firestore,
  chunkNo: number,
  plan: ReturnType<typeof planMemberDirectoryForwardChunk>,
) {
  return runMemberDirectoryChunkCommit(
    {
      projectId,
      store: createMemberDirectoryChunkFirestoreStore(database),
      integritySecretMaterial,
      integritySecretVersion,
      now: () => committedAt,
    },
    {
      academyId,
      operationId,
      phase: "forward",
      chunkNo,
      rowCount: plan.rowCount,
      quarantinedCount: plan.quarantinedCount,
      outputSetMac: plan.outputSetMac,
      actorId,
      domainWrites: plan.domainWrites,
    },
  );
}

afterAll(async () => {
  if (app !== undefined) {
    await deleteApp(app);
  }
});

describeLocal("member directory forward chunk against the Emulator", () => {
  it("creates the student, its admin profile and its reservations in one transaction with the parent", async () => {
    const database = requireFirestore();
    await seedFrozenForwardControlPlane(database);

    const row = await readForwardRow(database, createRowLegacyId, createRowStudentId);
    const plan = planFor(
      1,
      [plannedRowFor(createRowLegacyId, createRowStudentId, row.sourceRowMac)],
      [row.observed],
    );
    // One student, one admin profile, one membership-number key and one legacy-member-id key.
    expect(plan.createdStudentCount).toBe(1);
    expect(plan.createdKeyCount).toBe(2);
    expect(plan.domainWrites).toHaveLength(4);

    const result = await commitChunk(database, 1, plan);
    expect(result.committed).toBe(true);
    expect(result.chunkId).toBe(operationId + ":forward:1");

    const student = await database
      .doc(`academies/${academyId}/students/${createRowStudentId}`)
      .get();
    expect(student.exists).toBe(true);
    // Invariant 23: the legacy active/regularized labels never activate the migrated participant.
    expect(student.data()?.["active"]).toBe(false);
    expect(student.data()?.["status"]).toBe("inactive");
    expect(student.data()?.["dateOfBirth"]).toBe("1990-04-05");

    const profile = await database
      .doc(`academies/${academyId}/studentAdminProfiles/${createRowStudentId}`)
      .get();
    expect(profile.exists).toBe(true);
    expect(profile.data()?.["source"]).toBe("legacy-member-migration");
    expect(profile.data()?.["migrationId"]).toBe(operationId);
    expect(profile.data()?.["legacyMemberId"]).toBe(createRowLegacyId);

    const receipt = await database
      .doc(`academies/${academyId}/memberDirectoryMigrationChunks/${result.chunkId}`)
      .get();
    expect(receipt.data()?.["outputSetMac"]).toBe(plan.outputSetMac);
    expect(receipt.data()?.["writtenCount"]).toBe(1);
    expect(receipt.data()?.["quarantinedCount"]).toBe(0);

    const state = await readStoredControlPlane(database);
    expect(state.stateRevision).toBe(2);
    expect(state.lastCommittedChunkNo).toBe(1);
    // The reader stays legacy and the freeze stands until the separate completion transaction.
    expect(state.readerVersion).toBe("legacy-v1");
    expect(state.freezeStatus).toBe("frozen");

    const parent = await readStoredOperation(database);
    expect(parent.status).toBe("applying");
    expect(parent.statusAuditEventId).toBe(String(state.stateRevision));
    expect(await countIdentityKeys(database)).toBe(2);
  });

  /**
   * An explicit match adds the profile and the reservations to a student that already exists, and
   * the row budget it commits against comes from the stored receipt of chunk 1, not from anything
   * this chunk was told.
   */
  it("attaches to an existing student without rewriting it and accumulates the row budget", async () => {
    const database = requireFirestore();
    const before = await database.doc(`academies/${academyId}/students/${matchedStudentId}`).get();

    const row = await readForwardRow(database, matchRowLegacyId, matchedStudentId);
    const plan = planFor(
      2,
      [
        plannedRowFor(matchRowLegacyId, matchedStudentId, row.sourceRowMac, {
          classification: "explicit-existing-student-match",
        }),
      ],
      [row.observed],
    );
    expect(plan.createdStudentCount).toBe(0);
    expect(plan.createdProfileCount).toBe(1);

    const result = await commitChunk(database, 2, plan);
    expect(result.committed).toBe(true);

    const after = await database.doc(`academies/${academyId}/students/${matchedStudentId}`).get();
    // The matched student is untouched: same content, same update time.
    expect(after.data()).toEqual(before.data());
    expect(after.updateTime?.isEqual(before.updateTime!)).toBe(true);

    const profile = await database
      .doc(`academies/${academyId}/studentAdminProfiles/${matchedStudentId}`)
      .get();
    expect(profile.data()?.["legacyMemberId"]).toBe(matchRowLegacyId);

    const state = await readStoredControlPlane(database);
    expect(state.stateRevision).toBe(3);
    expect(state.lastCommittedChunkNo).toBe(2);
    expect(await countIdentityKeys(database)).toBe(4);
    expect(await countAdminProfiles(database)).toBe(2);
  });

  it("no-ops an exact chunk replay and writes nothing new", async () => {
    const database = requireFirestore();
    const row = await readForwardRow(database, createRowLegacyId, createRowStudentId);
    // Chunk 1's targets now exist, so the executor cannot replan it. The replay the runner has to
    // recognise is the receipt it already stored, which is exactly what is re-sent here.
    const receipt = await database
      .doc(`academies/${academyId}/memberDirectoryMigrationChunks/${operationId}:forward:1`)
      .get();
    const result = await runMemberDirectoryChunkCommit(
      {
        projectId,
        store: createMemberDirectoryChunkFirestoreStore(database),
        integritySecretMaterial,
        integritySecretVersion,
        now: () => committedAt,
      },
      {
        academyId,
        operationId,
        phase: "forward",
        chunkNo: 1,
        rowCount: 1,
        quarantinedCount: 0,
        outputSetMac: receipt.data()?.["outputSetMac"] as string,
        actorId,
      },
    );

    expect(result.committed).toBe(false);
    expect(result.reason).toMatch(/already committed/u);
    expect(row.observed.student).toBeDefined();
    const state = await readStoredControlPlane(database);
    expect(state.stateRevision).toBe(3);
    expect(await countIdentityKeys(database)).toBe(4);
  });

  /**
   * An identifier already reserved for somebody else is a live identity conflict, and
   * `identity-conflict` is never write eligible. The chunk fails, the freeze stands, and neither the
   * student nor the profile nor the receipt appears.
   */
  it("refuses a row whose identifier is already reserved and writes nothing", async () => {
    const database = requireFirestore();
    const intruder = buildStudentIdentityKey({
      academyId,
      kind: "membership-number",
      value: membershipNumberByLegacyId[conflictRowLegacyId] ?? "",
      ownerStudentId: "student-9999",
      secretMaterial: identitySecretMaterial,
      secretVersion: identitySecretVersion,
      now: initializedAt,
      actorId,
    });
    await database
      .doc(`academies/${academyId}/studentIdentityKeys/${intruder.keyId}`)
      .create(intruder);

    const row = await readForwardRow(database, conflictRowLegacyId, conflictStudentId);
    const existingKeys = await readExistingKeys(database, [intruder.keyId]);
    expect(() =>
      planFor(
        3,
        [plannedRowFor(conflictRowLegacyId, conflictStudentId, row.sourceRowMac)],
        [row.observed],
        existingKeys,
      ),
    ).toThrow(/already reserved/u);

    const student = await database
      .doc(`academies/${academyId}/students/${conflictStudentId}`)
      .get();
    expect(student.exists).toBe(false);
    const receipt = await database
      .doc(`academies/${academyId}/memberDirectoryMigrationChunks/${operationId}:forward:3`)
      .get();
    expect(receipt.exists).toBe(false);
    const state = await readStoredControlPlane(database);
    expect(state.stateRevision).toBe(3);
    expect(state.freezeStatus).toBe("frozen");
    expect(await countAdminProfiles(database)).toBe(2);
  });

  /**
   * The receipt is a proof of what was written, not a number the caller asserts: the runner
   * recomputes the output MAC over the domain writes before the first read.
   */
  it("refuses a chunk whose domain writes do not match the receipt MAC", async () => {
    const database = requireFirestore();
    const row = await readForwardRow(database, conflictRowLegacyId, conflictStudentId);
    const plan = planFor(
      3,
      [plannedRowFor(conflictRowLegacyId, conflictStudentId, row.sourceRowMac)],
      [row.observed],
    );
    const tampered = plan.domainWrites.filter(
      (write) => !write.path.endsWith(`/students/${conflictStudentId}`),
    );

    await expect(
      runMemberDirectoryChunkCommit(
        {
          projectId,
          store: createMemberDirectoryChunkFirestoreStore(database),
          integritySecretMaterial,
          integritySecretVersion,
          now: () => committedAt,
        },
        {
          academyId,
          operationId,
          phase: "forward",
          chunkNo: 3,
          rowCount: plan.rowCount,
          quarantinedCount: plan.quarantinedCount,
          outputSetMac: plan.outputSetMac,
          actorId,
          domainWrites: tampered,
        },
      ),
    ).rejects.toThrow(/does not match its receipt MAC/u);

    const state = await readStoredControlPlane(database);
    expect(state.stateRevision).toBe(3);
  });
});
