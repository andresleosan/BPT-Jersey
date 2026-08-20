import { describe, expect, it, vi } from "vitest";

import type {
  FamilyRecord,
  FamilyRelationship,
  GuardianFamilyProjection,
  StaffFamilyProjection,
  StudentProfile,
} from "@bpt-jersey/domain";

import {
  createFamilyHandler,
  getFamilyHandler,
  updateFamilyHandler,
  type FamilyCallableServices,
} from "./family-callables.js";

const family: FamilyRecord = {
  familyId: "family-1",
  academyId: "academy-1",
  primaryContactUserId: "user-1",
  billingContactUserId: "user-1",
  active: true,
  status: "active",
  schemaVersion: "1",
  createdAt: "2026-08-19T10:00:00.000Z",
  createdBy: "admin-1",
  updatedAt: "2026-08-19T10:00:00.000Z",
  updatedBy: "admin-1",
};

const student: StudentProfile = {
  studentId: "student-1",
  academyId: "academy-1",
  familyId: "family-1",
  fullName: "Synthetic Minor",
  dateOfBirth: "2015-08-19",
  trainingCenter: "Town",
  trainingTimePreferences: ["afternoon"],
  participantType: "minor",
  active: true,
  status: "active",
  schemaVersion: "1",
  createdAt: "2026-08-19T10:00:00.000Z",
  createdBy: "admin-1",
  updatedAt: "2026-08-19T10:00:00.000Z",
  updatedBy: "admin-1",
};

const relationship: FamilyRelationship = {
  relationshipId: "family-1--student-1",
  academyId: "academy-1",
  familyId: "family-1",
  studentId: "student-1",
  adultUserId: "user-1",
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
};

const staffProjection: StaffFamilyProjection = {
  family,
  students: [student],
  relationships: [relationship],
};

const guardianProjection: GuardianFamilyProjection = {
  family: { familyId: "family-1", active: true, status: "active" },
  tutor: {
    userId: "user-1",
    displayName: "Synthetic Guardian",
    email: "guardian@example.test",
    phoneNumber: "+441234567890",
  },
  students: [
    {
      studentId: "student-1",
      fullName: "Synthetic Minor",
      dateOfBirth: "2015-08-19",
      trainingCenter: "Town",
      trainingTimePreferences: ["afternoon"],
      active: true,
      status: "active",
    },
  ],
};

const createPayload = {
  tutorUserId: "user-1",
  students: [
    {
      fullName: "Synthetic Minor",
      dateOfBirth: "2015-08-19",
      trainingCenter: "Town",
      trainingTimePreferences: ["afternoon"],
    },
  ],
};

function request(
  data: unknown,
  role: string | undefined = undefined,
  uid = "admin-1",
  academyId = "academy-1",
) {
  return {
    data,
    auth: role === undefined ? undefined : { uid, token: { academyId, role } },
  } as never;
}

function services(): FamilyCallableServices & {
  store: NonNullable<FamilyCallableServices["store"]>;
} {
  return {
    store: {
      createFamily: vi.fn(async () => staffProjection),
      getStaffFamily: vi.fn(async () => staffProjection),
      getGuardianFamily: vi.fn(async () => guardianProjection),
      updateFamily: vi.fn(async () => staffProjection),
    },
    now: () => "2026-08-19T10:00:00.000Z",
  };
}

describe("family callables", () => {
  it("allows owner and administrator creation while deriving tenant and actor", async () => {
    for (const role of ["owner", "administrator"]) {
      const current = services();
      await expect(createFamilyHandler(request(createPayload, role), current)).resolves.toEqual(
        staffProjection,
      );
      expect(current.store.createFamily).toHaveBeenCalledWith({
        academyId: "academy-1",
        actorId: "admin-1",
        tutorUserId: "user-1",
        students: createPayload.students,
        now: "2026-08-19T10:00:00.000Z",
      });
    }
  });

  it("rejects anonymous, malformed claims, and non-administrative write roles", async () => {
    const current = services();
    await expect(
      createFamilyHandler(request(createPayload, undefined), current),
    ).rejects.toMatchObject({
      code: "unauthenticated",
    });
    await expect(
      createFamilyHandler(request(createPayload, "guardian", "guardian-1"), current),
    ).rejects.toMatchObject({ code: "permission-denied" });
    await expect(
      createFamilyHandler(request(createPayload, "headCoach", "coach-1"), current),
    ).rejects.toMatchObject({ code: "permission-denied" });
    await expect(
      createFamilyHandler(request(createPayload, undefined, "admin-1", "academy-1"), current),
    ).rejects.toMatchObject({ code: "unauthenticated" });
  });

  it("rejects extra authority fields and invalid minor drafts before the store", async () => {
    const current = services();
    await expect(
      createFamilyHandler(request({ ...createPayload, familyId: "family-2" }, "owner"), current),
    ).rejects.toMatchObject({ code: "invalid-argument" });
    await expect(
      createFamilyHandler(
        request(
          {
            ...createPayload,
            students: [{ ...createPayload.students[0], userId: "user-1" }],
          },
          "owner",
        ),
        current,
      ),
    ).rejects.toMatchObject({ code: "invalid-argument" });
    expect(current.store.createFamily).not.toHaveBeenCalled();
  });

  it("allows a guardian to read only with null payload and rejects family IDs or writes", async () => {
    const current = services();
    await expect(getFamilyHandler(request(null, "guardian", "user-1"), current)).resolves.toEqual(
      guardianProjection,
    );
    expect(current.store.getGuardianFamily).toHaveBeenCalledWith("academy-1", "user-1");
    await expect(
      getFamilyHandler(request({ familyId: "family-1" }, "guardian", "user-1"), current),
    ).rejects.toMatchObject({ code: "invalid-argument" });
    await expect(
      updateFamilyHandler(
        request(
          { familyId: "family-1", operation: { kind: "deactivateFamily" } },
          "guardian",
          "user-1",
        ),
        current,
      ),
    ).rejects.toMatchObject({ code: "permission-denied" });
  });

  it("allows staff lookup only with an exact familyId payload", async () => {
    const current = services();
    await expect(
      getFamilyHandler(request({ familyId: "family-1" }, "administrator"), current),
    ).resolves.toEqual(staffProjection);
    expect(current.store.getStaffFamily).toHaveBeenCalledWith("academy-1", "family-1");
    await expect(
      getFamilyHandler(request({ familyId: "family-1", academyId: "academy-2" }, "owner"), current),
    ).rejects.toMatchObject({ code: "invalid-argument" });
    await expect(getFamilyHandler(request(null, "owner"), current)).rejects.toMatchObject({
      code: "invalid-argument",
    });
  });

  it("allows one exact staff update operation and rejects ambiguous operations", async () => {
    const current = services();
    const payload = {
      familyId: "family-1",
      operation: { kind: "replaceTutor", tutorUserId: "user-2" },
    };
    await expect(updateFamilyHandler(request(payload, "owner"), current)).resolves.toEqual(
      staffProjection,
    );
    expect(current.store.updateFamily).toHaveBeenCalledWith({
      academyId: "academy-1",
      actorId: "admin-1",
      familyId: "family-1",
      operation: payload.operation,
      now: "2026-08-19T10:00:00.000Z",
    });
    await expect(
      updateFamilyHandler(
        request(
          {
            familyId: "family-1",
            operation: { kind: "deactivateFamily", studentId: "student-1" },
          },
          "owner",
        ),
        current,
      ),
    ).rejects.toMatchObject({ code: "invalid-argument" });
  });

  it("maps tenant, conflict, and unexpected store failures to safe public errors", async () => {
    const current = services();
    vi.mocked(current.store.getStaffFamily).mockRejectedValueOnce(
      new Error("Firestore credentials and raw payload details"),
    );
    await expect(
      getFamilyHandler(request({ familyId: "family-1" }, "owner"), current),
    ).rejects.toMatchObject({ code: "internal", message: "Unable to load family" });
    await expect(
      getFamilyHandler(request({ familyId: "family-1" }, "owner"), current),
    ).resolves.toEqual(staffProjection);
  });
});
