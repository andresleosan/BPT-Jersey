import { randomUUID } from "node:crypto";

import { deleteApp, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  getFamilyHandler,
  updateFamilyHandler,
} from "../../apps/functions/src/families/family-callables.js";
import {
  createFamilyStore,
  type FamilyAuthService,
  type FamilyFirestore,
} from "../../apps/functions/src/families/family-service.js";

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

async function seedUser(userId: string, displayName: string, email: string): Promise<void> {
  await auth.createUser({ uid: userId, displayName, email });
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

function request(data: unknown, role: string, uid: string) {
  return {
    data,
    auth: { uid, token: { academyId, role } },
  } as never;
}

async function deleteIfPresent(path: string): Promise<void> {
  await firestore.doc(path).delete();
}

describe("family adapter against the Firestore/Auth emulators", () => {
  let familyId = "";
  let studentIds: string[] = [];

  beforeAll(async () => {
    await Promise.all([
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
    ]);
    await Promise.all(
      [guardianId, replacementTutorId, unrelatedGuardianId].map((userId) =>
        auth.deleteUser(userId),
      ),
    );
    await deleteApp(app);
  });

  it("creates two linked minors through the callable/store and preserves the envelope", async () => {
    const familyAuth: FamilyAuthService = { getUser: (userId) => auth.getUser(userId) };
    const store = createFamilyStore({
      firestore: firestore as unknown as FamilyFirestore,
      auth: familyAuth,
    });
    const created = await store.createFamily({
      academyId,
      actorId: staffId,
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
  });

  it("returns exactly the linked minors to guardian and denies an unrelated guardian", async () => {
    const familyAuth: FamilyAuthService = { getUser: (userId) => auth.getUser(userId) };
    const store = createFamilyStore({
      firestore: firestore as unknown as FamilyFirestore,
      auth: familyAuth,
    });
    const guardian = await getFamilyHandler(request(null, "guardian", guardianId), { store });
    expect(guardian.students).toHaveLength(2);
    expect(guardian).not.toHaveProperty("relationships");
    expect(guardian.students[0]).not.toHaveProperty("familyId");
    expect(guardian.students[0]).not.toHaveProperty("createdBy");
    await expect(
      getFamilyHandler(request(null, "guardian", unrelatedGuardianId), { store }),
    ).rejects.toMatchObject({ code: "permission-denied" });
  });

  it("propagates tutor replacement and excludes a deactivated relationship", async () => {
    const familyAuth: FamilyAuthService = { getUser: (userId) => auth.getUser(userId) };
    const store = createFamilyStore({
      firestore: firestore as unknown as FamilyFirestore,
      auth: familyAuth,
    });
    await updateFamilyHandler(
      request(
        { familyId, operation: { kind: "replaceTutor", tutorUserId: replacementTutorId } },
        "owner",
        staffId,
      ),
      { store },
    );
    await expect(
      getFamilyHandler(request(null, "guardian", guardianId), { store }),
    ).rejects.toMatchObject({ code: "permission-denied" });
    const replacement = await getFamilyHandler(request(null, "guardian", replacementTutorId), {
      store,
    });
    expect(replacement.students).toHaveLength(2);

    await updateFamilyHandler(
      request(
        { familyId, operation: { kind: "deactivateRelationship", studentId: studentIds[0] } },
        "administrator",
        staffId,
      ),
      { store },
    );
    const remaining = await getFamilyHandler(request(null, "guardian", replacementTutorId), {
      store,
    });
    expect(remaining.students.map((student) => student.studentId)).toEqual([studentIds[1]]);
    await expect(
      store.createFamily({
        academyId,
        actorId: staffId,
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
