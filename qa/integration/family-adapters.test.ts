import { randomUUID } from "node:crypto";

import { deleteApp, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createFamilyActorActivityCheck,
  getFamilyHandler,
  updateFamilyHandler,
} from "../../apps/functions/src/families/family-callables.js";
import {
  createFamilyStore,
  type FamilyAuthService,
  type FamilyFirestore,
} from "../../apps/functions/src/families/family-service.js";
import { buildInitialMemberDirectoryControlPlane } from "../../apps/functions/src/members/member-directory-state.js";
import type { MemberDirectoryState } from "@bpt-jersey/domain/members/directory";

const runId = `family-${process.pid}-${randomUUID()}`;
const academyId = `${runId}-academy`;
const staffId = `${runId}-staff`;
const guardianId = `${runId}-guardian`;
const replacementTutorId = `${runId}-replacement`;
const unrelatedGuardianId = `${runId}-unrelated`;
const app = initializeApp({ projectId: "demo-bpt-jersey" }, runId);
const auth = getAuth(app);
const firestore = getFirestore(app);
const now = "2026-08-19T10:00:00.000Z";
const controlNow = "2026-08-19T09:00:00.000Z";
const identitySecret = Buffer.alloc(32, 17).toString("base64url");
const integritySecret = Buffer.alloc(32, 29).toString("base64url");
const identitySecretVersion = "identity-v1";
const integritySecretVersion = "integrity-v1";

async function seedUser(userId: string, displayName: string, email: string): Promise<void> {
  await auth.createUser({ uid: userId, displayName, email });
  await auth.setCustomUserClaims(userId, { academyId, role: "guardian" });
  await firestore.doc(`academies/${academyId}/users/${userId}`).set({
    userId,
    academyId,
    accountType: "client",
    displayName,
    email,
    phoneNumber: "+441234567890",
    active: true,
    status: "active",
    schemaVersion: "1",
    createdAt: now,
    createdBy: staffId,
    updatedAt: now,
    updatedBy: staffId,
  });
}

async function seedStaff(): Promise<void> {
  await auth.createUser({
    uid: staffId,
    displayName: "Synthetic Admin",
    email: `${staffId}@example.test`,
  });
  await auth.setCustomUserClaims(staffId, { academyId, role: "administrator" });
  const timestamp = Timestamp.fromMillis(Date.parse(controlNow));
  await firestore.doc(`academies/${academyId}/users/${staffId}`).set({
    userId: staffId,
    academyId,
    accountType: "staff",
    displayName: "Synthetic Admin",
    email: `${staffId}@example.test`,
    authProvider: "google",
    active: true,
    adminRole: "administrator",
    lastRoleChangeAuditId: `${runId}-role-audit`,
    createdAt: timestamp,
    createdBy: staffId,
    updatedAt: timestamp,
    updatedBy: staffId,
    status: "active",
    schemaVersion: 1,
  });
}

async function seedControlPlane(): Promise<void> {
  const state: MemberDirectoryState = {
    stateId: "current",
    academyId,
    readerVersion: "canonical-v1",
    directoryWriteMode: "canonical-v1",
    freezeStatus: "open",
    stateRevision: 0,
    globalLegacyReadEliminated: false,
    identityKeyCoverage: "complete",
    digestVersion: "hmac-sha256-v1",
    secretVersion: identitySecretVersion,
    identityKeyBaselineMac: "a".repeat(64),
    identityKeyBaselineArtifactId: `${runId}-baseline`,
    rollbackProtocolVersion: "legacy-projection-v1",
    rollbackCapacityLimit: 400,
    rollbackEligibleStudentCount: 0,
    operationPhase: "idle",
    lastCommittedChunkNo: 0,
    schemaVersion: "1",
    createdAt: controlNow,
    createdBy: staffId,
    updatedAt: controlNow,
    updatedBy: staffId,
  };
  const { guard, event } = buildInitialMemberDirectoryControlPlane({
    projectId: "demo-bpt-jersey",
    state,
    now: controlNow,
    actorId: staffId,
    integritySecretMaterial: integritySecret,
    integritySecretVersion,
  });
  await Promise.all([
    firestore.doc(`academies/${academyId}/memberDirectoryStates/current`).set(state),
    firestore.doc(`memberDirectoryRestoreGuards/${academyId}`).set(guard),
    firestore.doc(`memberDirectoryRestoreGuards/${academyId}/events/${event.eventId}`).set(event),
  ]);
}

function createStore() {
  const familyAuth: FamilyAuthService = { getUser: (userId) => auth.getUser(userId) };
  return createFamilyStore({
    firestore: firestore as unknown as FamilyFirestore,
    auth: familyAuth,
    canonicalControl: {
      projectId: "demo-bpt-jersey",
      identitySecretMaterial: identitySecret,
      identitySecretVersion,
      integritySecretMaterial: integritySecret,
      integritySecretVersion,
    },
  });
}

const isActorActive = createFamilyActorActivityCheck({
  getAuthUser: (uid) => auth.getUser(uid),
  getDocument: (path) => firestore.doc(path).get(),
});

function request(data: unknown, role: string, uid: string) {
  return {
    data,
    auth: { uid, token: { academyId, role } },
    app: { appId: "family-integration-test" },
  } as never;
}

async function deleteIfPresent(path: string): Promise<void> {
  await firestore.doc(path).delete();
}

async function deleteCollection(path: string): Promise<void> {
  const snapshot = await firestore.collection(path).get();
  await Promise.all(snapshot.docs.map((document) => document.ref.delete()));
}

describe("family adapter against the Firestore/Auth emulators", () => {
  let familyId = "";
  let studentIds: string[] = [];

  beforeAll(async () => {
    await Promise.all([
      seedStaff(),
      seedControlPlane(),
      seedUser(guardianId, "Synthetic Guardian", `${guardianId}@example.test`),
      seedUser(replacementTutorId, "Replacement Guardian", `${replacementTutorId}@example.test`),
      seedUser(unrelatedGuardianId, "Unrelated Guardian", `${unrelatedGuardianId}@example.test`),
    ]);
  });

  afterAll(async () => {
    await Promise.all([
      ...studentIds.map((studentId) =>
        deleteIfPresent(`academies/${academyId}/students/${studentId}`),
      ),
      familyId === ""
        ? Promise.resolve()
        : deleteIfPresent(`academies/${academyId}/families/${familyId}`),
      ...studentIds.map((studentId) =>
        deleteIfPresent(`academies/${academyId}/relationships/${familyId}--${studentId}`),
      ),
      ...[guardianId, replacementTutorId, unrelatedGuardianId].map((userId) =>
        deleteIfPresent(`academies/${academyId}/users/${userId}`),
      ),
      deleteIfPresent(`academies/${academyId}/users/${staffId}`),
      deleteIfPresent(`academies/${academyId}/memberDirectoryStates/current`),
      deleteCollection(`academies/${academyId}/familyWriteReceipts`),
      deleteCollection(`academies/${academyId}/memberDirectoryWriteReceipts`),
      deleteCollection(`academies/${academyId}/auditEvents`),
      deleteCollection(`memberDirectoryRestoreGuards/${academyId}/events`),
    ]);
    await deleteIfPresent(`memberDirectoryRestoreGuards/${academyId}`);
    await Promise.all(
      [staffId, guardianId, replacementTutorId, unrelatedGuardianId].map((userId) =>
        auth.deleteUser(userId),
      ),
    );
    await deleteApp(app);
  });

  it("creates two linked minors through the callable/store and preserves the envelope", async () => {
    const store = createStore();
    const created = await store.createFamily({
      academyId,
      actorId: staffId,
      actorRole: "administrator",
      requestId: `${runId}-create`,
      tutorUserId: guardianId,
      students: [
        {
          fullName: "Synthetic Minor One",
          dateOfBirth: "2015-08-19",
          trainingCenter: "Town",
          trainingTimePreferences: ["afternoon"],
        },
        {
          fullName: "Synthetic Minor Two",
          dateOfBirth: "2017-04-12",
          trainingCenter: "West",
          trainingTimePreferences: ["evening"],
        },
      ],
      now,
    });
    familyId = created.family.familyId;
    studentIds = created.students.map((student) => student.studentId);

    expect(created.students).toHaveLength(2);
    expect(created.relationships).toHaveLength(2);
    expect(
      (await firestore.doc(`academies/${academyId}/families/${familyId}`).get()).data(),
    ).toEqual(
      expect.objectContaining({
        familyId,
        primaryContactUserId: guardianId,
        billingContactUserId: guardianId,
        createdBy: staffId,
      }),
    );
    const firstStudent = (
      await firestore.doc(`academies/${academyId}/students/${studentIds[0]}`).get()
    ).data();
    expect(firstStudent).toEqual(expect.objectContaining({ familyId, participantType: "minor" }));
    expect(firstStudent).not.toHaveProperty("userId");
    const familyReceipts = await firestore
      .collection(`academies/${academyId}/familyWriteReceipts`)
      .get();
    const canonicalMemberReceipts = await firestore
      .collection(`academies/${academyId}/memberDirectoryWriteReceipts`)
      .get();
    expect(familyReceipts.docs).toHaveLength(1);
    expect(familyReceipts.docs[0]?.id).toMatch(/^family-write-[a-f0-9]{64}$/u);
    expect(canonicalMemberReceipts.empty).toBe(true);
  });

  it("returns exactly the linked minors to guardian and denies an unrelated guardian", async () => {
    const store = createStore();
    const guardian = await getFamilyHandler(request(null, "guardian", guardianId), {
      store,
      isActorActive,
    });
    expect(guardian.students).toHaveLength(2);
    expect(guardian).not.toHaveProperty("relationships");
    expect(guardian.students[0]).not.toHaveProperty("familyId");
    expect(guardian.students[0]).not.toHaveProperty("createdBy");
    await expect(
      getFamilyHandler(request(null, "guardian", unrelatedGuardianId), {
        store,
        isActorActive,
      }),
    ).rejects.toMatchObject({ code: "permission-denied" });
  });

  it("propagates tutor replacement and excludes a deactivated relationship", async () => {
    const store = createStore();
    await updateFamilyHandler(
      request(
        { familyId, operation: { kind: "replaceTutor", tutorUserId: replacementTutorId } },
        "administrator",
        staffId,
      ),
      { store, isActorActive },
    );
    await expect(
      getFamilyHandler(request(null, "guardian", guardianId), { store, isActorActive }),
    ).rejects.toMatchObject({ code: "permission-denied" });
    const replacement = await getFamilyHandler(request(null, "guardian", replacementTutorId), {
      store,
      isActorActive,
    });
    expect(replacement.students).toHaveLength(2);

    await updateFamilyHandler(
      request(
        { familyId, operation: { kind: "deactivateRelationship", studentId: studentIds[0] } },
        "administrator",
        staffId,
      ),
      { store, isActorActive },
    );
    const remaining = await getFamilyHandler(request(null, "guardian", replacementTutorId), {
      store,
      isActorActive,
    });
    expect(remaining.students.map((student) => student.studentId)).toEqual([studentIds[1]]);
    await expect(
      store.createFamily({
        academyId,
        actorId: staffId,
        actorRole: "administrator",
        requestId: `${runId}-duplicate`,
        tutorUserId: replacementTutorId,
        students: [
          {
            fullName: "Synthetic Duplicate Tutor Child",
            dateOfBirth: "2016-01-01",
            trainingCenter: "Town",
            trainingTimePreferences: ["morning"],
          },
        ],
        now,
      }),
    ).rejects.toMatchObject({ code: "duplicate" });
  });
});
