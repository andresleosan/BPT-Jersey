import { describe, expect, it } from "vitest";

import {
  createProfileStore,
  type ProfileDocumentData,
  type ProfileFirestore,
  type SaveClientProfileInput,
} from "./profile-service.js";

type Ref = Readonly<{ id: string; path: string }>;

function createFakeFirestore(initial: Record<string, ProfileDocumentData> = {}) {
  const records = new Map(Object.entries(initial));
  let generatedId = 0;
  const ref = (path: string): Ref => ({ id: path.split("/").at(-1) ?? "", path });
  const fake: ProfileFirestore = {
    doc: ref,
    collection: (path) => ({
      doc: (id?: string) => ref(`${path}/${id ?? `student-${generatedId++}`}`),
      where: (field, _operator, value) => ({
        path,
        field,
        value,
        limit: () => ({ path, field, value }),
      }),
    }),
    runTransaction: async (callback) => {
      const transaction = {
        get: async (target: Ref | { path: string; field: string; value: unknown }) => {
          if ("field" in target) {
            const docs = [...records.entries()]
              .filter(
                ([path, data]) =>
                  path.startsWith(`${target.path}/`) && data[target.field] === target.value,
              )
              .map(([path, data]) => ({ ...ref(path), exists: true, data: () => data }));
            return { docs };
          }
          const data = records.get(target.path);
          return { ...ref(target.path), exists: data !== undefined, data: () => data };
        },
        create: (target: Ref, data: ProfileDocumentData) => {
          if (records.has(target.path)) throw new Error("already exists");
          records.set(target.path, data);
          return transaction;
        },
        set: (target: Ref, data: ProfileDocumentData) => {
          records.set(target.path, data);
          return transaction;
        },
      };
      return callback(transaction);
    },
  };
  return { firestore: fake, records };
}

const input = (): SaveClientProfileInput => ({
  academyId: "academy-1",
  userId: "user-1",
  email: "adult@example.test",
  displayName: "Synthetic Adult",
  fullName: "Synthetic Adult",
  dateOfBirth: "1990-08-19",
  phoneNumber: "+15550000001",
  trainingCenter: "Town",
  trainingTimePreferences: ["evening"],
  now: "2026-08-19T12:00:00.000Z",
});

describe("profile Firestore store", () => {
  it("returns an empty lookup and atomically creates both canonical documents", async () => {
    const { firestore, records } = createFakeFirestore();
    const store = createProfileStore({ firestore, generateStudentId: () => "student-1" });

    await expect(store.getClientProfile("user-1", "academy-1")).resolves.toBeUndefined();
    const projection = await store.saveClientProfile(input());

    expect(projection.user.userId).toBe("user-1");
    expect(projection.student.studentId).toBe("student-1");
    expect(records.has("academies/academy-1/users/user-1")).toBe(true);
    expect(records.has("academies/academy-1/students/student-1")).toBe(true);
  });

  it("updates the existing participant while preserving creation provenance", async () => {
    const { firestore } = createFakeFirestore();
    let sequence = 0;
    const store = createProfileStore({
      firestore,
      generateStudentId: () => `student-${++sequence}`,
    });

    const created = await store.saveClientProfile(input());
    const updated = await store.saveClientProfile({
      ...input(),
      fullName: "Synthetic Adult Updated",
      trainingCenter: "West",
      now: "2026-08-20T12:00:00.000Z",
    });

    expect(updated.student.studentId).toBe(created.student.studentId);
    expect(updated.student.createdAt).toBe(created.student.createdAt);
    expect(updated.student.createdBy).toBe(created.student.createdBy);
    expect(updated.student.updatedAt).toBe("2026-08-20T12:00:00.000Z");
    expect(updated.student.trainingCenter).toBe("West");
  });

  it("fails closed for tenant mismatches, duplicate identities, and forbidden fields", async () => {
    const duplicate = {
      "academies/academy-1/students/student-a": {
        userId: "user-1",
      },
      "academies/academy-1/students/student-b": {
        userId: "user-1",
      },
    };
    const { firestore } = createFakeFirestore(duplicate);
    const store = createProfileStore({ firestore, generateStudentId: () => "student-new" });
    await expect(store.saveClientProfile(input())).rejects.toThrow(/duplicate/i);

    const mismatch = createFakeFirestore({
      "academies/academy-1/users/user-1": {
        userId: "user-1",
        academyId: "academy-2",
        accountType: "client",
        displayName: "Synthetic Adult",
        email: "adult@example.test",
        phoneNumber: "+15550000001",
        active: true,
        status: "active",
        schemaVersion: "1",
        createdAt: "2026-08-19T12:00:00.000Z",
        createdBy: "user-1",
        updatedAt: "2026-08-19T12:00:00.000Z",
        updatedBy: "user-1",
      },
    });
    await expect(
      createProfileStore({ firestore: mismatch.firestore }).saveClientProfile(input()),
    ).rejects.toThrow(/tenant/i);

    const forbidden = createFakeFirestore({
      "academies/academy-1/users/user-1": { medicalConditions: "forbidden" },
    });
    await expect(
      createProfileStore({ firestore: forbidden.firestore }).saveClientProfile(input()),
    ).rejects.toThrow(/invalid/i);
  });
});
