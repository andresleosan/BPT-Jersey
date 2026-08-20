import { describe, expect, it } from "vitest";

import type { FamilyStudentDraft, UserProfile } from "@bpt-jersey/domain";

import {
  FamilyStoreError,
  createFamilyStore,
  type FamilyAuthService,
  type FamilyDocumentData,
  type FamilyFirestore,
} from "./family-service.js";

type Ref = Readonly<{ id: string; path: string }>;
type Query = Readonly<{ path: string; field: string; value: unknown; limit: number }>;

function createFakeFirestore(initial: Record<string, FamilyDocumentData> = {}) {
  const records = new Map(Object.entries(initial));
  const writes: string[] = [];
  const ref = (path: string): Ref => ({ id: path.split("/").at(-1) ?? "", path });
  const fake: FamilyFirestore = {
    doc: (path) => ref(path),
    collection: (path) => ({
      doc: (id?: string) => ref(`${path}/${id ?? "generated"}`),
      where: (field, _operator, value) => ({
        path,
        field,
        value,
        limit: (count) => ({ path, field, value, limit: count }),
      }),
    }),
    runTransaction: async (callback) => {
      const snapshot = new Map(records);
      const transaction = {
        get: async (target: Ref | Query) => {
          if ("field" in target) {
            const docs = [...records.entries()]
              .filter(
                ([path, data]) =>
                  path.startsWith(`${target.path}/`) && data[target.field] === target.value,
              )
              .slice(0, target.limit)
              .map(([path, data]) => ({ ...ref(path), exists: true, data: () => data }));
            return { docs };
          }
          const data = records.get(target.path);
          return { ...ref(target.path), exists: data !== undefined, data: () => data };
        },
        create: (target: Ref, data: FamilyDocumentData) => {
          if (records.has(target.path)) throw new Error("already exists");
          writes.push(`create:${target.path}`);
          records.set(target.path, data);
          return transaction;
        },
        set: (target: Ref, data: FamilyDocumentData) => {
          writes.push(`set:${target.path}`);
          records.set(target.path, data);
          return transaction;
        },
      };
      try {
        return await callback(transaction);
      } catch (error) {
        records.clear();
        for (const [path, data] of snapshot) records.set(path, data);
        writes.length = 0;
        throw error;
      }
    },
  };
  return { firestore: fake, records, writes };
}

function tutorUser(overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    userId: "user-1",
    academyId: "academy-1",
    accountType: "client",
    displayName: "Synthetic Guardian",
    email: "guardian@example.test",
    phoneNumber: "+441234567890",
    active: true,
    status: "active",
    schemaVersion: "1",
    createdAt: "2026-08-19T10:00:00.000Z",
    createdBy: "admin-1",
    updatedAt: "2026-08-19T10:00:00.000Z",
    updatedBy: "admin-1",
    ...overrides,
  };
}

function draft(name: string): FamilyStudentDraft {
  return {
    fullName: name,
    dateOfBirth: "2015-08-19",
    trainingCenter: "Town",
    trainingTimePreferences: ["afternoon"],
  };
}

function createServices(
  initial: Record<string, FamilyDocumentData> = {},
  authUsers: UserProfile | readonly UserProfile[] | undefined = tutorUser(),
) {
  const fake = createFakeFirestore(initial);
  const availableAuthUsers =
    authUsers === undefined ? [] : Array.isArray(authUsers) ? authUsers : [authUsers];
  const auth: FamilyAuthService = {
    getUser: async (userId) => {
      const authUser = availableAuthUsers.find((user) => user.userId === userId);
      if (authUser === undefined) throw new Error("auth user missing");
      return { uid: authUser.userId };
    },
  };
  let familyNumber = 0;
  let studentNumber = 0;
  const store = createFamilyStore({
    firestore: fake.firestore,
    auth,
    generateFamilyId: () => `family-${++familyNumber}`,
    generateStudentId: () => `student-${++studentNumber}`,
  });
  return { ...fake, store };
}

describe("family Firestore store", () => {
  it("atomically creates one family, two minors, and deterministic guardian relationships", async () => {
    const { store, records } = createServices({
      "academies/academy-1/users/user-1": tutorUser(),
    });

    const projection = await store.createFamily({
      academyId: "academy-1",
      actorId: "admin-1",
      tutorUserId: "user-1",
      students: [draft("Synthetic Minor One"), draft("Synthetic Minor Two")],
      now: "2026-08-19T10:00:00.000Z",
    });

    expect(projection.family.familyId).toBe("family-1");
    expect(projection.students).toHaveLength(2);
    expect(projection.students.every((student) => student.familyId === "family-1")).toBe(true);
    expect(projection.students.every((student) => student.participantType === "minor")).toBe(true);
    expect(projection.relationships.map((item) => item.relationshipId)).toEqual([
      "family-1--student-1",
      "family-1--student-2",
    ]);
    expect(projection.family.createdBy).toBe("admin-1");
    expect(records.has("academies/academy-1/families/family-1")).toBe(true);
    expect(records.has("academies/academy-1/relationships/family-1--student-2")).toBe(true);
  });

  it("returns an empty guardian lookup and a same-tenant staff projection", async () => {
    const { store } = createServices({
      "academies/academy-1/users/user-1": tutorUser(),
    });

    await expect(store.getGuardianFamily("academy-1", "user-1")).resolves.toBeUndefined();
    await store.createFamily({
      academyId: "academy-1",
      actorId: "admin-1",
      tutorUserId: "user-1",
      students: [draft("Synthetic Minor")],
      now: "2026-08-19T10:00:00.000Z",
    });

    await expect(store.getStaffFamily("academy-1", "family-1")).resolves.toMatchObject({
      family: { familyId: "family-1", academyId: "academy-1" },
      students: [{ fullName: "Synthetic Minor" }],
    });
    await expect(store.getStaffFamily("academy-2", "family-1")).resolves.toBeUndefined();
  });

  it("rejects duplicate tutor membership, invalid Auth, tenant mismatch, and linked student collisions", async () => {
    const first = createServices({
      "academies/academy-1/users/user-1": tutorUser(),
    });
    const input = {
      academyId: "academy-1",
      actorId: "admin-1",
      tutorUserId: "user-1",
      students: [draft("Synthetic Minor")],
      now: "2026-08-19T10:00:00.000Z",
    } as const;
    await first.store.createFamily(input);
    await expect(first.store.createFamily(input)).rejects.toMatchObject({ code: "duplicate" });

    await expect(createServices({}, undefined).store.createFamily(input)).rejects.toMatchObject({
      code: "precondition",
    });
    await expect(
      createServices(
        { "academies/academy-1/users/user-1": tutorUser({ academyId: "academy-2" }) },
        tutorUser({ academyId: "academy-2" }),
      ).store.createFamily(input),
    ).rejects.toMatchObject({ code: "tenant" });

    const collision = createServices({
      "academies/academy-1/users/user-1": tutorUser(),
      "academies/academy-1/students/student-1": {
        studentId: "student-1",
        academyId: "academy-1",
        familyId: "family-existing",
      },
    });
    await expect(collision.store.createFamily(input)).rejects.toMatchObject({ code: "duplicate" });

    const familyCollision = createServices({
      "academies/academy-1/users/user-1": tutorUser(),
      "academies/academy-1/families/family-1": {},
    });
    await expect(familyCollision.store.createFamily(input)).rejects.toMatchObject({
      code: "duplicate",
    });
  });

  it("propagates a replacement tutor to the family contacts and active relationships", async () => {
    const secondTutor = tutorUser({ userId: "user-2", email: "second@example.test" });
    const { store, records } = createServices(
      {
        "academies/academy-1/users/user-1": tutorUser(),
        "academies/academy-1/users/user-2": secondTutor,
      },
      [tutorUser(), secondTutor],
    );
    await store.createFamily({
      academyId: "academy-1",
      actorId: "admin-1",
      tutorUserId: "user-1",
      students: [draft("Synthetic Minor")],
      now: "2026-08-19T10:00:00.000Z",
    });

    const projection = await store.updateFamily({
      academyId: "academy-1",
      actorId: "admin-2",
      familyId: "family-1",
      operation: { kind: "replaceTutor", tutorUserId: "user-2" },
      now: "2026-08-20T10:00:00.000Z",
    });

    expect(projection.family.primaryContactUserId).toBe("user-2");
    expect(projection.family.billingContactUserId).toBe("user-2");
    expect(projection.relationships[0]?.adultUserId).toBe("user-2");
    expect(records.get("academies/academy-1/families/family-1")).toMatchObject({
      createdAt: "2026-08-19T10:00:00.000Z",
      updatedBy: "admin-2",
    });
  });

  it("deactivates one relationship and then the family without deleting documents", async () => {
    const { store, records } = createServices({
      "academies/academy-1/users/user-1": tutorUser(),
    });
    await store.createFamily({
      academyId: "academy-1",
      actorId: "admin-1",
      tutorUserId: "user-1",
      students: [draft("Synthetic Minor One"), draft("Synthetic Minor Two")],
      now: "2026-08-19T10:00:00.000Z",
    });

    await store.updateFamily({
      academyId: "academy-1",
      actorId: "admin-1",
      familyId: "family-1",
      operation: { kind: "deactivateRelationship", studentId: "student-1" },
      now: "2026-08-20T10:00:00.000Z",
    });
    const guardian = await store.getGuardianFamily("academy-1", "user-1");
    expect(guardian?.students.map((student) => student.studentId)).toEqual(["student-2"]);

    await store.updateFamily({
      academyId: "academy-1",
      actorId: "admin-1",
      familyId: "family-1",
      operation: { kind: "deactivateFamily" },
      now: "2026-08-21T10:00:00.000Z",
    });
    expect(records.has("academies/academy-1/families/family-1")).toBe(true);
    expect(records.has("academies/academy-1/relationships/family-1--student-2")).toBe(true);
    await expect(store.getGuardianFamily("academy-1", "user-1")).resolves.toBeUndefined();
  });

  it("returns a redacted guardian projection without relationships or internal fields", async () => {
    const { store } = createServices({
      "academies/academy-1/users/user-1": tutorUser(),
    });
    await store.createFamily({
      academyId: "academy-1",
      actorId: "admin-1",
      tutorUserId: "user-1",
      students: [draft("Synthetic Minor")],
      now: "2026-08-19T10:00:00.000Z",
    });

    const projection = await store.getGuardianFamily("academy-1", "user-1");
    expect(projection).toBeDefined();
    expect(projection).not.toHaveProperty("relationships");
    expect(projection).not.toHaveProperty("academyId");
    expect(projection?.tutor).toEqual({
      userId: "user-1",
      displayName: "Synthetic Guardian",
      email: "guardian@example.test",
      phoneNumber: "+441234567890",
    });
    expect(projection?.students[0]).not.toHaveProperty("createdBy");
    expect(projection?.students[0]).not.toHaveProperty("familyId");
  });

  it("fails closed when guardian relationships resolve to more than one family", async () => {
    const { store } = createServices({
      "academies/academy-1/users/user-1": tutorUser(),
      "academies/academy-1/relationships/family-a--student-a": {
        relationshipId: "family-a--student-a",
        academyId: "academy-1",
        adultUserId: "user-1",
        familyId: "family-a",
        studentId: "student-a",
        relationshipType: "guardian",
        permissions: ["readProfile"],
        validFrom: "2026-08-19T10:00:00.000Z",
        active: true,
        status: "active",
        schemaVersion: "1",
        createdAt: "2026-08-19T10:00:00.000Z",
        createdBy: "admin-1",
        updatedAt: "2026-08-19T10:00:00.000Z",
        updatedBy: "admin-1",
      },
      "academies/academy-1/relationships/family-b--student-b": {
        relationshipId: "family-b--student-b",
        academyId: "academy-1",
        adultUserId: "user-1",
        familyId: "family-b",
        studentId: "student-b",
        relationshipType: "guardian",
        permissions: ["readProfile"],
        validFrom: "2026-08-19T10:00:00.000Z",
        active: true,
        status: "active",
        schemaVersion: "1",
        createdAt: "2026-08-19T10:00:00.000Z",
        createdBy: "admin-1",
        updatedAt: "2026-08-19T10:00:00.000Z",
        updatedBy: "admin-1",
      },
    });

    await expect(store.getGuardianFamily("academy-1", "user-1")).rejects.toMatchObject({
      code: "duplicate",
    });
  });

  it("does not write forbidden fields or paths", async () => {
    const { store, records, writes } = createServices({
      "academies/academy-1/users/user-1": tutorUser(),
    });
    await store.createFamily({
      academyId: "academy-1",
      actorId: "admin-1",
      tutorUserId: "user-1",
      students: [draft("Synthetic Minor")],
      now: "2026-08-19T10:00:00.000Z",
    });

    expect(
      writes.every((write) =>
        /academies\/academy-1\/(families|students|relationships)\//u.test(write),
      ),
    ).toBe(true);
    for (const [path, data] of records) {
      if (
        !path.includes("/families/") &&
        !path.includes("/students/") &&
        !path.includes("/relationships/")
      )
        continue;
      expect(data).not.toHaveProperty("medicalConditions");
      expect(data).not.toHaveProperty("waiver");
      expect(data).not.toHaveProperty("membershipId");
      expect(data).not.toHaveProperty("belt");
      expect(data).not.toHaveProperty("stripe");
    }
  });
});

void FamilyStoreError;
