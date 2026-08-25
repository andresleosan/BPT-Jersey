import { describe, expect, it, vi } from "vitest";

import {
  createHealthStore,
  type HealthDocumentData,
  type HealthFirestore,
} from "./health-service.js";

type Ref = Readonly<{ id: string; path: string }>;
function createFakeFirestore(initial: Record<string, HealthDocumentData> = {}) {
  const records = new Map(Object.entries(initial));
  let generated = 0;
  const ref = (path: string): Ref => ({ id: path.split("/").at(-1) ?? "", path });
  const firestore: HealthFirestore = {
    doc: ref,
    collection: (path) => ({
      doc: (id?: string) => ref(path + "/" + (id ?? "generated-" + generated++)),
      where: (field, _operator, value) => ({
        path,
        field,
        value,
        limit: (limit: number) => ({ path, field, value, limit }),
      }),
    }),
    runTransaction: async (callback) => {
      const transaction = {
        get: async (
          target: Ref | { path: string; field?: string; value?: unknown; limit: number },
        ) => {
          if ("limit" in target) {
            return {
              docs: [...records.entries()]
                .filter(
                  ([key, value]) =>
                    key.startsWith(target.path + "/") &&
                    (target.field === undefined || value[target.field] === target.value),
                )
                .slice(0, target.limit)
                .map(([key, value]) => ({ ...ref(key), exists: true, data: () => value })),
            };
          }
          const data = records.get(target.path);
          return { ...ref(target.path), exists: data !== undefined, data: () => data };
        },
        create: (target: Ref, data: HealthDocumentData) => {
          if (records.has(target.path)) throw new Error("already exists");
          records.set(target.path, data);
          return transaction;
        },
        set: (target: Ref, data: HealthDocumentData) => {
          records.set(target.path, data);
          return transaction;
        },
      };
      return callback(transaction);
    },
  };
  return { firestore, records };
}

const student: HealthDocumentData = {
  studentId: "student-1",
  academyId: "academy-1",
  userId: "user-1",
  fullName: "Synthetic Minor",
  dateOfBirth: "2015-01-01",
  phoneNumber: "+15550000001",
  email: "minor@example.test",
  trainingCenter: "Town",
  trainingTimePreferences: ["evening"],
  participantType: "minor",
  active: true,
  status: "active",
  schemaVersion: "1",
  createdAt: "2026-08-24T10:00:00Z",
  createdBy: "owner-1",
  updatedAt: "2026-08-24T10:00:00Z",
  updatedBy: "owner-1",
};
const relationship: HealthDocumentData = {
  relationshipId: "family-1--student-1",
  academyId: "academy-1",
  familyId: "family-1",
  studentId: "student-1",
  adultUserId: "guardian-1",
  relationshipType: "guardian",
  permissions: ["readProfile"],
  validFrom: "2026-08-01T00:00:00Z",
  active: true,
  status: "active",
  schemaVersion: "1",
  createdAt: "2026-08-01T00:00:00Z",
  createdBy: "owner-1",
  updatedAt: "2026-08-01T00:00:00Z",
  updatedBy: "owner-1",
};
const saveInput = {
  academyId: "academy-1",
  actorId: "owner-1",
  now: "2026-08-24T12:00:00Z",
  studentId: "student-1",
  minimumOperationalSupport: ["mobility"] as const,
  conditionSummary: "Needs a clear visual instruction.",
  staffReferenceLabel: "Visual cue",
  expiresAt: null,
};

describe("health support store", () => {
  it("creates a restricted profile, redacts guardian output, and rejects an unrelated guardian", async () => {
    const seeded = createFakeFirestore({
      "academies/academy-1/students/student-1": student,
      "academies/academy-1/relationships/family-1--student-1": relationship,
    });
    const store = createHealthStore({ firestore: seeded.firestore });
    const admin = await store.saveHealthProfile(saveInput);
    expect(admin).toMatchObject({ studentId: "student-1", staffReferenceLabel: "Visual cue" });
    const guardian = await store.getHealthProfile({
      academyId: "academy-1",
      actorId: "guardian-1",
      role: "guardian",
      studentId: "student-1",
    });
    expect(guardian).toMatchObject({
      studentId: "student-1",
      conditionSummary: "Needs a clear visual instruction.",
    });
    expect(guardian).not.toHaveProperty("staffReferenceLabel");
    await expect(
      store.getHealthProfile({
        academyId: "academy-1",
        actorId: "guardian-2",
        role: "guardian",
        studentId: "student-1",
      }),
    ).rejects.toThrow(/permitted/i);
  });

  it("allows a guardian request and atomically approves it while preserving staff-only data", async () => {
    const seeded = createFakeFirestore({
      "academies/academy-1/students/student-1": student,
      "academies/academy-1/relationships/family-1--student-1": relationship,
    });
    const store = createHealthStore({
      firestore: seeded.firestore,
      generateRequestId: () => "request-1",
    });
    await store.saveHealthProfile(saveInput);
    const request = await store.createChangeRequest({
      academyId: "academy-1",
      actorId: "guardian-1",
      studentId: "student-1",
      proposedMinimumOperationalSupport: ["communication"],
      proposedConditionSummary: "Needs one-step instructions.",
      proposedExpiresAt: null,
    });
    expect(request.status).toBe("pending");
    await expect(
      store.createChangeRequest({
        academyId: "academy-1",
        actorId: "guardian-1",
        studentId: "student-1",
        proposedMinimumOperationalSupport: ["mobility"],
        proposedConditionSummary: null,
        proposedExpiresAt: null,
      }),
    ).rejects.toThrow(/pending/i);
    const reviewed = await store.reviewChangeRequest({
      academyId: "academy-1",
      actorId: "owner-1",
      requestId: "request-1",
      decision: "approve",
    });
    expect(reviewed.status).toBe("approved");
    const admin = await store.getHealthProfile({
      academyId: "academy-1",
      actorId: "owner-1",
      role: "owner",
      studentId: "student-1",
    });
    expect(admin).toMatchObject({
      minimumOperationalSupport: ["communication"],
      staffReferenceLabel: "Visual cue",
    });
  });

  it("fails closed for coaches without an assignment and permits an injected current assignment", async () => {
    const seeded = createFakeFirestore({
      "academies/academy-1/students/student-1": student,
      "academies/academy-1/relationships/family-1--student-1": relationship,
    });
    const store = createHealthStore({ firestore: seeded.firestore });
    await store.saveHealthProfile(saveInput);
    await expect(
      store.getHealthProfile({
        academyId: "academy-1",
        actorId: "coach-1",
        role: "coach",
        studentId: "student-1",
      }),
    ).rejects.toThrow(/assignment/i);
    const assigned = createHealthStore({
      firestore: seeded.firestore,
      hasCurrentStudentAssignment: vi.fn(async () => true),
    });
    await expect(
      assigned.getHealthProfile({
        academyId: "academy-1",
        actorId: "coach-1",
        role: "coach",
        studentId: "student-1",
      }),
    ).resolves.toMatchObject({ studentId: "student-1", staffReferenceLabel: "Visual cue" });
  });

  it("deactivates without deleting the restricted record", async () => {
    const seeded = createFakeFirestore({ "academies/academy-1/students/student-1": student });
    const store = createHealthStore({ firestore: seeded.firestore });
    await store.saveHealthProfile(saveInput);
    await store.deactivateHealthProfile({
      academyId: "academy-1",
      actorId: "owner-1",
      studentId: "student-1",
    });
    expect(seeded.records.get("academies/academy-1/healthProfiles/student-1")).toMatchObject({
      status: "inactive",
    });
  });
});
