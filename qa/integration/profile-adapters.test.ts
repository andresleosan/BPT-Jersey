import { randomUUID } from "node:crypto";

import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createProfileStore,
  type ProfileFirestore,
} from "../../apps/functions/src/profiles/profile-service.js";

const runId = `profile-integration-${process.pid}-${randomUUID()}`;
const academyId = `${runId}-academy`;
const app = initializeApp({ projectId: "demo-bpt-jersey" }, runId);
const firestore = getFirestore(app);
const store = createProfileStore({
  firestore: firestore as unknown as ProfileFirestore,
  generateStudentId: () => `${runId}-student-1`,
});

const input = (now = "2026-08-19T12:00:00.000Z") => ({
  academyId,
  userId: `${runId}-user-1`,
  email: "synthetic@example.test",
  displayName: "Synthetic Adult",
  fullName: "Synthetic Adult",
  dateOfBirth: "1990-08-19",
  phoneNumber: "+15550000001",
  trainingCenter: "Town" as const,
  trainingTimePreferences: ["evening"] as const,
  now,
});

beforeAll(async () => {
  await firestore.doc(`academies/${academyId}/integrationMarker/marker`).set({ runId });
});

afterAll(async () => {
  const [users, students] = await Promise.all([
    firestore.collection(`academies/${academyId}/users`).get(),
    firestore.collection(`academies/${academyId}/students`).get(),
  ]);
  await Promise.all([...users.docs, ...students.docs].map((document) => document.ref.delete()));
  await firestore.doc(`academies/${academyId}/integrationMarker/marker`).delete();
  await deleteApp(app);
});

describe("profile Firestore adapter against the local emulator", () => {
  it("creates and updates users/students atomically with server-owned provenance", async () => {
    const created = await store.saveClientProfile(input());
    const updated = await store.saveClientProfile({
      ...input("2026-08-20T12:00:00.000Z"),
      fullName: "Synthetic Adult Updated",
      trainingCenter: "West",
    });

    expect(updated.student.studentId).toBe(created.student.studentId);
    expect(updated.student.createdAt).toBe(created.student.createdAt);
    expect(updated.student.createdBy).toBe(created.student.createdBy);
    expect(updated.student.updatedAt).toBe("2026-08-20T12:00:00.000Z");
    await expect(store.getClientProfile(input().userId, academyId)).resolves.toEqual(updated);
  });

  it("does not allow a profile path to be reused across academies", async () => {
    await expect(
      store.saveClientProfile({ ...input(), academyId: `${academyId}/other` }),
    ).rejects.toMatchObject({ code: "tenant" });
  });
});
