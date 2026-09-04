import { randomUUID } from "node:crypto";

import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore, type Firestore, type QuerySnapshot } from "firebase-admin/firestore";
import { afterAll, describe, expect, it } from "vitest";

import type { MemberDirectoryState } from "@bpt-jersey/domain/members/directory";

import { deriveStudentIdentityKeyId } from "../../apps/functions/src/members/member-directory-crypto.js";
import { buildInitialMemberDirectoryControlPlane } from "../../apps/functions/src/members/member-directory-state.js";
import {
  createProfileStore,
  type ProfileFirestore,
  type ProfileStore,
  type SaveClientProfileInput,
} from "../../apps/functions/src/profiles/profile-service.js";

const projectId = "demo-bpt-jersey";
const runId = `profile-integration-${process.pid}-${randomUUID().slice(0, 8)}`;
const normalAcademyId = `${runId}-normal`;
const capacityAcademyId = `${runId}-capacity`;
const frozenAcademyId = `${runId}-frozen`;
const identitySecret = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8";
const integritySecret = "ICEiIyQlJicoKSorLC0uLzAxMjM0NTY3ODk6Ozw9Pj8";
const initialNow = "2026-09-03T20:00:00.000Z";
const createNow = "2026-09-03T20:01:00.000Z";
const updateNow = "2026-09-03T20:02:00.000Z";
const replayNow = "2026-09-03T20:03:00.000Z";
const firestoreEmulatorHost = process.env.FIRESTORE_EMULATOR_HOST?.trim();

function isLoopbackEmulator(host: string | undefined): boolean {
  if (host === undefined || host === "") return false;
  try {
    const url = new URL(`http://${host}`);
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

const useLocalEmulator = isLoopbackEmulator(firestoreEmulatorHost);
if (!useLocalEmulator) {
  console.warn("SKIP profile adapter integration: FIRESTORE_EMULATOR_HOST must be loopback");
}

const app = useLocalEmulator
  ? initializeApp({ projectId }, `profile-adapters-${runId}`)
  : undefined;
const firestore = app === undefined ? undefined : getFirestore(app);
const describeLocal = useLocalEmulator ? describe : describe.skip;

const academyCollections = Object.freeze([
  "users",
  "families",
  "students",
  "studentIdentityKeys",
  "profileWriteReceipts",
  "auditEvents",
  "memberDirectoryStates",
  "members",
] as const);

const receiptFields = Object.freeze([
  "receiptId",
  "academyId",
  "actorId",
  "requestMac",
  "studentId",
  "familyId",
  "identityKeyId",
  "identitySecretVersion",
  "integritySecretVersion",
  "auditEventId",
  "stateRevisionBefore",
  "stateRevisionAfter",
  "createdStudent",
  "createdFamily",
  "status",
  "createdAt",
  "schemaVersion",
] as const);

const auditFields = Object.freeze([
  "academyId",
  "actorId",
  "action",
  "targetRef",
  "purpose",
  "correlationId",
  "auditEventId",
  "occurredAt",
  "result",
  "schemaVersion",
] as const);

function requireFirestore(): Firestore {
  if (firestore === undefined) {
    throw new Error("Local Firestore Emulator is unavailable");
  }
  return firestore;
}

function userId(academyId: string): string {
  return `${academyId}-adult`;
}

function canonicalState(
  academyId: string,
  rollbackEligibleStudentCount: number,
  overrides: Partial<MemberDirectoryState> = {},
): MemberDirectoryState {
  return {
    stateId: "current",
    academyId,
    readerVersion: "canonical-v1",
    directoryWriteMode: "canonical-v1",
    freezeStatus: "open",
    stateRevision: 0,
    globalLegacyReadEliminated: false,
    identityKeyCoverage: "complete",
    digestVersion: "hmac-sha256-v1",
    secretVersion: "identity-v1",
    identityKeyBaselineMac: "a".repeat(64),
    identityKeyBaselineArtifactId: "baseline-1",
    rollbackProtocolVersion: "legacy-projection-v1",
    rollbackCapacityLimit: 400,
    rollbackEligibleStudentCount,
    operationPhase: "idle",
    lastCommittedChunkNo: 0,
    schemaVersion: "1",
    createdAt: initialNow,
    createdBy: "system-1",
    updatedAt: initialNow,
    updatedBy: "system-1",
    ...overrides,
  };
}

function clientAuthBinding(academyId: string): Readonly<Record<string, unknown>> {
  const uid = userId(academyId);
  return {
    userId: uid,
    academyId,
    accountType: "client",
    displayName: "Synthetic Adult",
    email: "synthetic-adult@example.test",
    phoneNumber: "+12015550199",
    active: true,
    status: "active",
    schemaVersion: "1",
    createdAt: initialNow,
    createdBy: uid,
    updatedAt: initialNow,
    updatedBy: uid,
  };
}

async function seedAcademy(
  academyId: string,
  rollbackEligibleStudentCount: number,
  overrides: Partial<MemberDirectoryState> = {},
): Promise<MemberDirectoryState> {
  if (!academyId.startsWith(`${runId}-`)) {
    throw new Error("Refusing to seed a non-ephemeral academy");
  }
  const currentFirestore = requireFirestore();
  const state = canonicalState(academyId, rollbackEligibleStudentCount, overrides);
  const control = buildInitialMemberDirectoryControlPlane({
    projectId,
    state,
    integritySecretMaterial: integritySecret,
    integritySecretVersion: "integrity-v1",
    now: state.updatedAt,
    actorId: "system-1",
  });
  const batch = currentFirestore.batch();
  batch.create(
    currentFirestore.doc(`academies/${academyId}/users/${userId(academyId)}`),
    clientAuthBinding(academyId),
  );
  batch.create(currentFirestore.doc(`academies/${academyId}/memberDirectoryStates/current`), state);
  batch.create(currentFirestore.doc(`memberDirectoryRestoreGuards/${academyId}`), control.guard);
  batch.create(
    currentFirestore.doc(
      `memberDirectoryRestoreGuards/${academyId}/events/${control.event.eventId}`,
    ),
    control.event,
  );
  await batch.commit();
  return state;
}

function createStore(academyId: string): ProfileStore {
  let studentSequence = 0;
  let auditSequence = 0;
  return createProfileStore({
    firestore: requireFirestore() as unknown as ProfileFirestore,
    projectId,
    identitySecretMaterial: identitySecret,
    identitySecretVersion: "identity-v1",
    integritySecretMaterial: integritySecret,
    integritySecretVersion: "integrity-v1",
    generateStudentId: () => `${academyId}-student-${++studentSequence}`,
    generateAuditId: () => `${academyId}-audit-${++auditSequence}`,
  });
}

function profileInput(
  academyId: string,
  requestId: string,
  now: string,
  overrides: Partial<SaveClientProfileInput> = {},
): SaveClientProfileInput {
  return {
    academyId,
    userId: userId(academyId),
    email: "synthetic-adult@example.test",
    displayName: "Synthetic Adult",
    requestId,
    fullName: "Synthetic Adult",
    dateOfBirth: "1990-03-14",
    phoneNumber: "+12015550199",
    trainingCenter: "Town",
    trainingTimePreferences: ["evening"],
    now,
    ...overrides,
  };
}

async function deleteCollection(path: string): Promise<void> {
  const currentFirestore = requireFirestore();
  const snapshot = await currentFirestore.collection(path).get();
  if (snapshot.empty) return;
  const batch = currentFirestore.batch();
  snapshot.docs.forEach((document) => batch.delete(document.ref));
  await batch.commit();
}

async function cleanupAcademy(academyId: string): Promise<void> {
  if (!academyId.startsWith(`${runId}-`)) {
    throw new Error("Refusing to clean a non-ephemeral academy");
  }
  const currentFirestore = requireFirestore();
  await Promise.all(
    academyCollections.map((collection) =>
      deleteCollection(`academies/${academyId}/${collection}`),
    ),
  );
  await deleteCollection(`memberDirectoryRestoreGuards/${academyId}/events`);
  await currentFirestore.doc(`memberDirectoryRestoreGuards/${academyId}`).delete();
  await currentFirestore.doc(`academies/${academyId}`).delete();
}

type AcademyFootprint = Readonly<{
  state: FirebaseFirestore.DocumentSnapshot;
  guard: FirebaseFirestore.DocumentSnapshot;
  users: QuerySnapshot;
  families: QuerySnapshot;
  students: QuerySnapshot;
  keys: QuerySnapshot;
  receipts: QuerySnapshot;
  audits: QuerySnapshot;
  events: QuerySnapshot;
  members: QuerySnapshot;
}>;

async function footprint(academyId: string): Promise<AcademyFootprint> {
  const currentFirestore = requireFirestore();
  const [state, guard, users, families, students, keys, receipts, audits, events, members] =
    await Promise.all([
      currentFirestore.doc(`academies/${academyId}/memberDirectoryStates/current`).get(),
      currentFirestore.doc(`memberDirectoryRestoreGuards/${academyId}`).get(),
      currentFirestore.collection(`academies/${academyId}/users`).get(),
      currentFirestore.collection(`academies/${academyId}/families`).get(),
      currentFirestore.collection(`academies/${academyId}/students`).get(),
      currentFirestore.collection(`academies/${academyId}/studentIdentityKeys`).get(),
      currentFirestore.collection(`academies/${academyId}/profileWriteReceipts`).get(),
      currentFirestore.collection(`academies/${academyId}/auditEvents`).get(),
      currentFirestore.collection(`memberDirectoryRestoreGuards/${academyId}/events`).get(),
      currentFirestore.collection(`academies/${academyId}/members`).get(),
    ]);
  return { state, guard, users, families, students, keys, receipts, audits, events, members };
}

function sortedIds(snapshot: QuerySnapshot): string[] {
  return snapshot.docs.map((document) => document.id).sort();
}

function expectMetadataOnly(
  receipts: QuerySnapshot,
  audits: QuerySnapshot,
  sensitiveValues: readonly string[],
): void {
  for (const receipt of receipts.docs) {
    const data = receipt.data();
    const expectedFields =
      data.createdFamily === true ? [...receiptFields, "familyAuditEventId"] : receiptFields;
    expect(Object.keys(data).sort()).toEqual([...expectedFields].sort());
  }
  for (const audit of audits.docs) {
    expect(Object.keys(audit.data()).sort()).toEqual([...auditFields].sort());
  }
  const serialized = JSON.stringify([
    ...receipts.docs.map((document) => document.data()),
    ...audits.docs.map((document) => document.data()),
  ]);
  for (const value of sensitiveValues) {
    expect(serialized).not.toContain(value);
  }
}

async function expectRejectedSeedOnly(
  academyId: string,
  expectedState: Partial<MemberDirectoryState>,
): Promise<void> {
  const current = await footprint(academyId);
  expect(current.state.data()).toMatchObject(expectedState);
  expect(current.guard.data()).toMatchObject({
    highestStateRevision: 0,
    lastEventId: "0",
  });
  expect(current.users.docs).toHaveLength(1);
  expect(current.families.empty).toBe(true);
  expect(current.students.empty).toBe(true);
  expect(current.keys.empty).toBe(true);
  expect(current.receipts.empty).toBe(true);
  expect(current.audits.empty).toBe(true);
  expect(sortedIds(current.events)).toEqual(["0"]);
  expect(current.members.empty).toBe(true);
}

afterAll(async () => {
  if (firestore === undefined || app === undefined) return;
  try {
    await Promise.all([normalAcademyId, capacityAcademyId, frozenAcademyId].map(cleanupAcademy));
  } finally {
    await deleteApp(app);
  }
});

describeLocal("profile canonical adapter against Firestore Emulator", () => {
  it("creates, updates and replays an adult profile with one HMAC reservation and no legacy members access", async () => {
    await seedAcademy(normalAcademyId, 0);
    const store = createStore(normalAcademyId);
    const createRequestId = `${runId}-create`;
    const updateRequestId = `${runId}-update`;
    const create = profileInput(normalAcademyId, createRequestId, createNow);
    const created = await store.saveClientProfile(create);
    const createdReplay = await store.saveClientProfile({
      ...create,
      now: updateNow,
    });
    expect(createdReplay).toEqual(created);

    const update = profileInput(normalAcademyId, updateRequestId, updateNow, {
      fullName: "Synthetic Adult Updated",
      trainingCenter: "West",
      trainingTimePreferences: ["morning", "evening"],
    });
    const updated = await store.saveClientProfile(update);
    const updatedReplay = await store.saveClientProfile({
      ...update,
      now: replayNow,
    });
    expect(updatedReplay).toEqual(updated);
    expect(updated.student).toMatchObject({
      studentId: created.student.studentId,
      userId: userId(normalAcademyId),
      fullName: "Synthetic Adult Updated",
      trainingCenter: "West",
      createdAt: createNow,
      updatedAt: updateNow,
    });

    const current = await footprint(normalAcademyId);
    expect(current.state.data()).toMatchObject({
      stateRevision: 2,
      rollbackEligibleStudentCount: 1,
      updatedBy: userId(normalAcademyId),
    });
    expect(current.guard.data()).toMatchObject({
      highestStateRevision: 2,
      highestRollbackEligibleStudentCount: 1,
      lastEventId: "2",
    });
    expect(sortedIds(current.events)).toEqual(["0", "1", "2"]);
    expect(current.events.docs.map((document) => document.data().transitionKind)).toEqual(
      expect.arrayContaining(["initialize", "adult-auth-link", "adult-auth-link"]),
    );
    expect(current.users.docs).toHaveLength(1);
    expect(current.families.docs).toHaveLength(1);
    expect(current.students.docs).toHaveLength(1);
    expect(current.keys.docs).toHaveLength(1);
    expect(current.receipts.docs).toHaveLength(2);
    expect(current.audits.docs).toHaveLength(3);
    expect(current.members.empty).toBe(true);

    const identityKeyId = deriveStudentIdentityKeyId({
      academyId: normalAcademyId,
      kind: "auth-user-id",
      value: userId(normalAcademyId),
      secretMaterial: identitySecret,
    });
    expect(current.keys.docs[0]?.id).toBe(identityKeyId);
    expect(current.keys.docs[0]?.data()).toMatchObject({
      kind: "auth-user-id",
      ownerStudentId: created.student.studentId,
      secretVersion: "identity-v1",
    });
    expect(current.receipts.docs.map((document) => document.data().createdStudent).sort()).toEqual([
      false,
      true,
    ]);
    expect(current.receipts.docs.map((document) => document.data().createdFamily).sort()).toEqual([
      false,
      true,
    ]);
    expect(current.audits.docs.map((document) => document.data().action).sort()).toEqual([
      "family.created",
      "member.created",
      "member.updated",
    ]);
    expectMetadataOnly(current.receipts, current.audits, [
      createRequestId,
      updateRequestId,
      "synthetic-adult@example.test",
      "Synthetic Adult",
      "Synthetic Adult Updated",
      "+12015550199",
      "1990-03-14",
    ]);

    const beforeDivergence = {
      state: current.state.data(),
      student: current.students.docs[0]?.data(),
      family: current.families.docs[0]?.data(),
      keys: sortedIds(current.keys),
      receipts: sortedIds(current.receipts),
      audits: sortedIds(current.audits),
      events: sortedIds(current.events),
    };
    await expect(
      store.saveClientProfile({
        ...update,
        fullName: "Divergent Replay",
        now: replayNow,
      }),
    ).rejects.toMatchObject({ code: "replay" });

    const afterDivergence = await footprint(normalAcademyId);
    expect(afterDivergence.state.data()).toEqual(beforeDivergence.state);
    expect(afterDivergence.students.docs[0]?.data()).toEqual(beforeDivergence.student);
    expect(afterDivergence.families.docs[0]?.data()).toEqual(beforeDivergence.family);
    expect(sortedIds(afterDivergence.keys)).toEqual(beforeDivergence.keys);
    expect(sortedIds(afterDivergence.receipts)).toEqual(beforeDivergence.receipts);
    expect(sortedIds(afterDivergence.audits)).toEqual(beforeDivergence.audits);
    expect(sortedIds(afterDivergence.events)).toEqual(beforeDivergence.events);
    expect(afterDivergence.members.empty).toBe(true);
  }, 60_000);

  it("rejects a new student at rollback capacity without any partial document", async () => {
    await seedAcademy(capacityAcademyId, 400);
    const store = createStore(capacityAcademyId);

    await expect(
      store.saveClientProfile(
        profileInput(capacityAcademyId, `${runId}-capacity-request`, createNow),
      ),
    ).rejects.toMatchObject({ code: "capacity" });

    await expectRejectedSeedOnly(capacityAcademyId, {
      stateRevision: 0,
      rollbackEligibleStudentCount: 400,
      freezeStatus: "open",
    });
  }, 60_000);

  it("rejects a frozen canonical writer without any partial document", async () => {
    await seedAcademy(frozenAcademyId, 0, {
      directoryWriteMode: "blocked",
      freezeStatus: "frozen",
      operationPhase: "identity-reconcile",
      activeOperationId: "profile-freeze-operation",
      leaseId: "profile-freeze-lease",
      leaseOwner: "profile-freeze-worker",
      leaseExpiresAt: "2026-09-03T20:10:00.000Z",
      operationDeadline: "2026-09-03T20:30:00.000Z",
      updatedAt: createNow,
      updatedBy: "profile-freeze-worker",
    });
    const store = createStore(frozenAcademyId);

    await expect(
      store.saveClientProfile(profileInput(frozenAcademyId, `${runId}-frozen-request`, updateNow)),
    ).rejects.toMatchObject({ code: "unavailable" });

    await expectRejectedSeedOnly(frozenAcademyId, {
      stateRevision: 0,
      rollbackEligibleStudentCount: 0,
      directoryWriteMode: "blocked",
      freezeStatus: "frozen",
      operationPhase: "identity-reconcile",
    });
  }, 60_000);
});
