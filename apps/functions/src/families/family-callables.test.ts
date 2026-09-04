import { describe, expect, it, vi } from "vitest";
import { Timestamp } from "firebase-admin/firestore";

import type {
  FamilyRecord,
  FamilyRelationship,
  GuardianFamilyProjection,
  StaffFamilyProjection,
  StudentProfile,
} from "@bpt-jersey/domain";

import {
  createFamilyActorActivityCheck,
  createFamilyHandler,
  familyReadCallableOptions,
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
  requestId: "request-create-1",
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
  appCheckVerified = true,
) {
  return {
    data,
    auth: role === undefined ? undefined : { uid, token: { academyId, role } },
    ...(appCheckVerified ? { app: { appId: "test-app" } } : {}),
  } as never;
}

function services(): FamilyCallableServices & {
  store: NonNullable<FamilyCallableServices["store"]>;
} {
  return {
    store: {
      createFamily: vi.fn(async () => staffProjection),
      getStaffFamily: vi.fn(async () => staffProjection),
      getStaffFamilyForActor: vi.fn(async () => staffProjection),
      getGuardianFamily: vi.fn(async () => guardianProjection),
      updateFamily: vi.fn(async () => staffProjection),
    },
    isActorActive: vi.fn(async () => true),
    now: () => "2026-08-19T10:00:00.000Z",
  };
}

describe("family callables", () => {
  it("requires App Check on the guardian and staff family reader wrapper", () => {
    expect(familyReadCallableOptions).toEqual({ enforceAppCheck: true });
  });

  it("resolves current administrative authority from Auth, profile, and role lock state", async () => {
    const documents = new Map<string, unknown>([
      [
        "academies/academy-1/users/admin-1",
        {
          userId: "admin-1",
          academyId: "academy-1",
          accountType: "staff",
          displayName: "Synthetic Admin",
          email: "admin-1@example.test",
          authProvider: "google",
          adminRole: "administrator",
          lastRoleChangeAuditId: "role-audit-1",
          active: true,
          status: "active",
          createdAt: Timestamp.fromMillis(Date.parse("2026-08-19T09:00:00.000Z")),
          createdBy: "owner-1",
          updatedAt: Timestamp.fromMillis(Date.parse("2026-08-19T09:00:00.000Z")),
          updatedBy: "owner-1",
          schemaVersion: 1,
        },
      ],
    ]);
    let disabled = false;
    const check = createFamilyActorActivityCheck({
      getAuthUser: async (uid) => ({
        uid,
        disabled,
        customClaims: { academyId: "academy-1", role: "administrator" },
      }),
      getDocument: async (path) => ({
        exists: documents.has(path),
        data: () => documents.get(path),
      }),
    });
    const actor = {
      uid: "admin-1",
      academyId: "academy-1",
      role: "administrator",
    } as const;

    await expect(check(actor)).resolves.toBe(true);
    disabled = true;
    await expect(check(actor)).resolves.toBe(false);
    disabled = false;
    documents.set("academies/academy-1/adminRoleLocks/admin-1", { active: true });
    await expect(check(actor)).resolves.toBe(false);
    documents.delete("academies/academy-1/adminRoleLocks/admin-1");
    documents.set("academies/academy-1/users/admin-1", {
      ...(documents.get("academies/academy-1/users/admin-1") as object),
      adminRole: "owner",
    });
    await expect(check(actor)).resolves.toBe(false);
  });

  it("allows owner and administrator creation while deriving tenant and actor", async () => {
    for (const role of ["owner", "administrator"]) {
      const current = services();
      await expect(createFamilyHandler(request(createPayload, role), current)).resolves.toEqual(
        staffProjection,
      );
      expect(current.store.createFamily).toHaveBeenCalledWith({
        academyId: "academy-1",
        actorId: "admin-1",
        actorRole: role,
        requestId: "request-create-1",
        tutorUserId: "user-1",
        students: createPayload.students,
        now: "2026-08-19T10:00:00.000Z",
      });
      expect(current.isActorActive).toHaveBeenCalledWith({
        uid: "admin-1",
        academyId: "academy-1",
        role,
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

  it("requires verified App Check and a currently active matching administrative role", async () => {
    const missingAppCheck = services();
    await expect(
      createFamilyHandler(
        request(createPayload, "owner", "admin-1", "academy-1", false),
        missingAppCheck,
      ),
    ).rejects.toMatchObject({ code: "unauthenticated" });
    expect(missingAppCheck.store.createFamily).not.toHaveBeenCalled();

    const staleRole = services();
    vi.mocked(staleRole.isActorActive).mockResolvedValueOnce(false);
    await expect(
      updateFamilyHandler(
        request({ familyId: "family-1", operation: { kind: "deactivateFamily" } }, "administrator"),
        staleRole,
      ),
    ).rejects.toMatchObject({ code: "permission-denied" });
    expect(staleRole.store.updateFamily).not.toHaveBeenCalled();
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

  it("fails closed on family reads without App Check or with stale current authority", async () => {
    const missingAppCheck = services();
    await expect(
      getFamilyHandler(request(null, "guardian", "user-1", "academy-1", false), missingAppCheck),
    ).rejects.toMatchObject({ code: "unauthenticated" });
    expect(missingAppCheck.isActorActive).not.toHaveBeenCalled();
    expect(missingAppCheck.store.getGuardianFamily).not.toHaveBeenCalled();

    for (const [role, data] of [
      ["guardian", null],
      ["administrator", { familyId: "family-1" }],
    ] as const) {
      const stale = services();
      vi.mocked(stale.isActorActive).mockResolvedValue(false);
      await expect(getFamilyHandler(request(data, role), stale)).rejects.toMatchObject({
        code: "permission-denied",
      });
      expect(stale.store.getGuardianFamily).not.toHaveBeenCalled();
      expect(stale.store.getStaffFamily).not.toHaveBeenCalled();
      expect(stale.store.getStaffFamilyForActor).not.toHaveBeenCalled();
    }
  });

  it("allows staff lookup only with an exact familyId payload", async () => {
    const current = services();
    await expect(
      getFamilyHandler(request({ familyId: "family-1" }, "administrator"), current),
    ).resolves.toEqual(staffProjection);
    expect(current.store.getStaffFamilyForActor).toHaveBeenCalledWith({
      academyId: "academy-1",
      actorId: "admin-1",
      actorRole: "administrator",
      familyId: "family-1",
    });
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
      actorRole: "owner",
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

  it("requires and forwards a strict requestId for each identity-creating command", async () => {
    const current = services();
    await expect(
      createFamilyHandler(
        request(
          { tutorUserId: createPayload.tutorUserId, students: createPayload.students },
          "owner",
        ),
        current,
      ),
    ).rejects.toMatchObject({ code: "invalid-argument" });
    await expect(
      updateFamilyHandler(
        request(
          {
            familyId: "family-1",
            operation: { kind: "addStudent", student: createPayload.students[0] },
          },
          "owner",
        ),
        current,
      ),
    ).rejects.toMatchObject({ code: "invalid-argument" });

    const payload = {
      familyId: "family-1",
      operation: {
        kind: "addStudent",
        requestId: "request-add-1",
        student: createPayload.students[0],
      },
    } as const;
    await expect(updateFamilyHandler(request(payload, "administrator"), current)).resolves.toEqual(
      staffProjection,
    );
    expect(current.store.updateFamily).toHaveBeenCalledWith({
      academyId: "academy-1",
      actorId: "admin-1",
      actorRole: "administrator",
      familyId: "family-1",
      operation: payload.operation,
      now: "2026-08-19T10:00:00.000Z",
    });
  });

  it("maps tenant, conflict, and unexpected store failures to safe public errors", async () => {
    const current = services();
    vi.mocked(current.store.getStaffFamilyForActor).mockRejectedValueOnce(
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
