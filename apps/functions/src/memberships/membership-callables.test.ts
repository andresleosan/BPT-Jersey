import { describe, expect, it, vi } from "vitest";
import type { CallableRequest } from "firebase-functions/v2/https";

import type { FamilyStore } from "../families/family-service.js";
import {
  MembershipStoreError,
  createMembershipStore,
  type MembershipDocumentData,
  type MembershipFirestore,
  type MembershipTransaction,
} from "./membership-service.js";
import type { StaffFamilyProjection } from "@bpt-jersey/domain/families";
import type { MembershipRecord, MembershipStatus } from "@bpt-jersey/domain/memberships/lifecycle";
import type { StudentProfile } from "@bpt-jersey/domain/profiles";

import {
  cancelMembershipHandler,
  createMembershipHandler,
  listMembershipsHandler,
  transitionMembershipHandler,
  type MembershipCallableServices,
  type MembershipStudentScope,
} from "./membership-callables.js";

vi.mock("firebase-admin/auth", () => ({
  getAuth: () => ({
    getUser: async (uid: string) => ({
      disabled: false,
      emailVerified: true,
      customClaims: {
        academyId: "academy-1",
        role:
          uid === "guardian-1"
            ? "guardian"
            : uid === "adult-user-1"
              ? "adultStudent"
              : "teenStudent",
      },
    }),
  }),
}));

const now = "2026-08-19T10:00:00.000Z";
const academyId = "academy-1";
const familyId = "family-1";
const minorStudentId = "student-1";
const adultStudentId = "student-adult-1";

function membership(overrides: Partial<MembershipRecord> = {}): MembershipRecord {
  return {
    membershipId: "membership-1",
    academyId,
    familyId,
    studentId: minorStudentId,
    planId: "bpt-jersey-adult",
    status: "active",
    startsAt: now,
    endsAt: null,
    nextBillingAt: null,
    schemaVersion: "1",
    createdAt: now,
    createdBy: "admin-1",
    updatedAt: now,
    updatedBy: "admin-1",
    ...overrides,
  };
}

function createTransitionFirestore() {
  const membershipRecord = membership();
  const membershipPath = `academies/${academyId}/memberships/${membershipRecord.membershipId}`;
  const records = new Map<string, MembershipDocumentData>([[membershipPath, membershipRecord]]);
  const writes: string[] = [];
  const audits: MembershipDocumentData[] = [];
  type FakeReference = Readonly<{ id: string; path: string }>;
  type FakeQuery = Readonly<{ path: string; field: string; value: unknown; limit?: number }>;
  const reference = (path: string): FakeReference => ({
    id: path.split("/").at(-1) ?? "",
    path,
  });
  const firestore: MembershipFirestore = {
    doc: (path) => reference(path),
    collection: (path) => ({
      doc: (id?: string) => reference(`${path}/${id ?? "audit-generated"}`),
      where: (field, _operator, value) => ({
        path,
        field,
        value,
        limit: (count: number) => ({ path, field, value, limit: count }),
      }),
    }),
    runTransaction: async <T>(callback: (transaction: MembershipTransaction) => Promise<T>) => {
      const before = new Map(records);
      const transaction: MembershipTransaction = {
        get: async (target) => {
          if ("field" in target) {
            const query = target as FakeQuery;
            return {
              docs: [...records.entries()]
                .filter(
                  ([path, data]) =>
                    path.startsWith(`${query.path}/`) && data[query.field] === query.value,
                )
                .slice(0, query.limit)
                .map(([path, data]) => ({
                  ...reference(path),
                  exists: true,
                  data: () => data,
                })),
            };
          }
          const data = records.get(target.path);
          return {
            ...reference(target.path),
            exists: data !== undefined,
            data: () => data,
          };
        },
        create: (target, data) => {
          writes.push(`create:${target.path}`);
          records.set(target.path, data);
          if (target.path.includes("/auditEvents/")) audits.push(data);
          return transaction;
        },
        set: (target, data) => {
          writes.push(`set:${target.path}`);
          records.set(target.path, data);
          return transaction;
        },
      };
      try {
        return await callback(transaction);
      } catch (error) {
        records.clear();
        for (const [path, data] of before) records.set(path, data);
        writes.length = 0;
        audits.length = 0;
        throw error;
      }
    },
  };
  return { firestore, records, writes, audits, membershipPath };
}

function student(overrides: Partial<StudentProfile> = {}): StudentProfile {
  return {
    studentId: minorStudentId,
    academyId,
    familyId,
    fullName: "Synthetic Minor",
    dateOfBirth: "2015-08-19",
    trainingCenter: "Town",
    trainingTimePreferences: ["afternoon"],
    participantType: "minor",
    active: true,
    status: "active",
    schemaVersion: "1",
    createdAt: now,
    createdBy: "admin-1",
    updatedAt: now,
    updatedBy: "admin-1",
    ...overrides,
  };
}

function staffFamilyProjection(
  currentFamilyId = familyId,
  familyOverrides: Partial<StaffFamilyProjection["family"]> = {},
): StaffFamilyProjection {
  return {
    family: {
      familyId: currentFamilyId,
      academyId,
      primaryContactUserId: "guardian-1",
      billingContactUserId: "guardian-1",
      active: true,
      status: "active",
      schemaVersion: "1",
      createdAt: now,
      createdBy: "admin-1",
      updatedAt: now,
      updatedBy: "admin-1",
      ...familyOverrides,
    },
    students: [student({ familyId: currentFamilyId })],
    relationships: [],
  };
}

function request(
  data: unknown,
  role: string | undefined,
  uid = "admin-1",
  requestAcademyId = academyId,
): CallableRequest<unknown> {
  return {
    data,
    app: role === undefined ? undefined : { appId: "verified-test-app" },
    auth:
      role === undefined
        ? undefined
        : { uid, token: { academyId: requestAcademyId, role, auth_time: 1_754_633_600 } },
  } as unknown as CallableRequest<unknown>;
}

function guardianFamilyStore(): Pick<FamilyStore, "getGuardianFamily" | "getStaffFamily"> {
  return {
    getGuardianFamily: vi.fn(async () => ({
      family: { familyId, active: true, status: "active" as const },
      tutor: {
        userId: "guardian-1",
        displayName: "Synthetic Guardian",
        email: "guardian@example.test",
        phoneNumber: "+441234567890",
      },
      students: [
        {
          studentId: minorStudentId,
          fullName: "Synthetic Minor",
          dateOfBirth: "2015-08-19",
          trainingCenter: "Town" as const,
          trainingTimePreferences: ["afternoon" as const],
          active: true,
          status: "active" as const,
        },
      ],
    })),
    getStaffFamily: vi.fn(async () => staffFamilyProjection()),
  };
}

function adultStudentScope(
  overrides: Partial<MembershipStudentScope> = {},
): MembershipStudentScope {
  return {
    studentId: adultStudentId,
    familyId: "adult-family-1",
    participantType: "adult",
    active: true,
    status: "active",
    ...overrides,
  };
}

function teenStudentScope(overrides: Partial<MembershipStudentScope> = {}): MembershipStudentScope {
  return {
    studentId: minorStudentId,
    familyId,
    participantType: "minor",
    active: true,
    status: "active",
    ...overrides,
  };
}

function services(overrides: Partial<MembershipCallableServices> = {}): MembershipCallableServices {
  return {
    store: {
      listMemberships: vi.fn(async () => [membership()]),
      getMembership: vi.fn(async () => membership()),
      createMembership: vi.fn(async (input) => {
        const canonicalFamily = input.studentId === adultStudentId ? "adult-family-1" : familyId;
        if (input.familyId !== undefined && input.familyId !== canonicalFamily)
          throw new MembershipStoreError("tenant", "Synthetic student family mismatch");
        return membership({
          membershipId: "membership-created",
          familyId: input.familyId ?? input.scope.familyIds?.[0] ?? canonicalFamily,
          studentId: input.studentId,
          status: input.status,
          createdBy: input.actorId,
          updatedBy: input.actorId,
        });
      }),
      transitionMembership: vi.fn(async (input) =>
        membership({
          membershipId: input.membershipId,
          status: input.targetStatus,
          endsAt: input.targetStatus === "cancelled" ? now : null,
          updatedBy: input.actorId,
        }),
      ),
    },
    memberStudentIds: vi.fn(async (_academyId, actorId) =>
      actorId === "adult-user-1" ? [adultStudentId] : [minorStudentId],
    ),
    familyStore: guardianFamilyStore(),
    findStudentByUserId: vi.fn(async () => adultStudentScope()),
    isActorActive: vi.fn(async () => true),
    now: () => now,
    ...overrides,
  };
}

const createPayload = {
  familyId,
  studentId: minorStudentId,
  planId: "bpt-jersey-adult",
  status: "trial",
};

const transitionPayload = { membershipId: "membership-1", targetStatus: "paused" };

describe("membership callables", () => {
  it("rejects anonymous requests and denies coaches before touching the store", async () => {
    for (const role of [undefined, "headCoach", "coach"]) {
      const current = services();
      await expect(listMembershipsHandler(request(null, role), current)).rejects.toMatchObject({
        code: role === undefined ? "unauthenticated" : "permission-denied",
      });
      expect(current.store.listMemberships).not.toHaveBeenCalled();
    }
  });

  it("gives owner and administrator tenant-wide read and create scope", async () => {
    for (const role of ["owner", "administrator"]) {
      const current = services();
      await expect(listMembershipsHandler(request(null, role), current)).resolves.toHaveLength(1);
      expect(current.store.listMemberships).toHaveBeenCalledWith({ academyId });
      await expect(createMembershipHandler(request(createPayload, role), current)).resolves.toEqual(
        expect.objectContaining({ membershipId: "membership-created", status: "trial" }),
      );
      expect(current.store.createMembership).toHaveBeenCalledWith({
        academyId,
        actorId: "admin-1",
        memberActor: false,
        now,
        familyId,
        studentId: minorStudentId,
        planId: "bpt-jersey-adult",
        status: "trial",
        scope: {
          academyId,
          familyIds: [familyId],
          studentIds: [minorStudentId],
        },
      });
      await expect(
        createMembershipHandler(request({ ...createPayload, status: "active" }, role), current),
      ).resolves.toEqual(
        expect.objectContaining({ membershipId: "membership-created", status: "active" }),
      );
      expect(current.store.createMembership).toHaveBeenLastCalledWith(
        expect.objectContaining({ status: "active" }),
      );
    }
  });

  it("accepts a create payload without familyId and lets the store derive the family", async () => {
    const current = services();
    const withoutFamily: Record<string, unknown> = { ...createPayload };
    delete withoutFamily.familyId;
    await expect(
      createMembershipHandler(request(withoutFamily, "owner"), current),
    ).resolves.toEqual(
      expect.objectContaining({ membershipId: "membership-created", status: "trial" }),
    );
    expect(current.store.createMembership).toHaveBeenCalledWith({
      academyId,
      actorId: "admin-1",
      memberActor: false,
      now,
      studentId: minorStudentId,
      planId: "bpt-jersey-adult",
      status: "trial",
      scope: { academyId, studentIds: [minorStudentId] },
    });

    // Self-service adults resolve to their own linked family without naming it.
    vi.mocked(current.familyStore!.getStaffFamily).mockResolvedValue(
      staffFamilyProjection("adult-family-1"),
    );
    await expect(
      createMembershipHandler(
        request({ ...withoutFamily, studentId: adultStudentId }, "adultStudent", "adult-user-1"),
        current,
      ),
    ).resolves.toEqual(expect.objectContaining({ status: "trial" }));
    const lastInput = vi.mocked(current.store.createMembership).mock.lastCall?.[0];
    expect(lastInput).toMatchObject({
      studentId: adultStudentId,
      scope: { academyId, memberActorId: "adult-user-1", studentIds: [adultStudentId] },
    });
    expect(lastInput).not.toHaveProperty("familyId");

    // The payload stays closed: unknown keys and a missing student are still rejected.
    await expect(
      createMembershipHandler(request({ ...withoutFamily, extra: true }, "owner"), current),
    ).rejects.toMatchObject({ code: "invalid-argument" });
    const withoutStudent: Record<string, unknown> = { ...withoutFamily };
    delete withoutStudent.studentId;
    await expect(
      createMembershipHandler(request(withoutStudent, "owner"), current),
    ).rejects.toMatchObject({ code: "invalid-argument" });
  });

  it("resolves a guardian to one active family and its related minors", async () => {
    const current = services();
    await expect(
      listMembershipsHandler(request(null, "guardian", "guardian-1"), current),
    ).resolves.toEqual([expect.objectContaining({ membershipId: "membership-1" })]);
    expect(current.store.listMemberships).toHaveBeenCalledWith({
      academyId,
      memberActorId: "guardian-1",
      studentIds: [minorStudentId],
    });

    await expect(
      createMembershipHandler(request(createPayload, "guardian", "guardian-1"), current),
    ).resolves.toEqual(expect.objectContaining({ status: "trial" }));
    expect(current.store.createMembership).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "trial",
        scope: {
          academyId,
          memberActorId: "guardian-1",
          familyIds: [familyId],
          studentIds: [minorStudentId],
        },
      }),
    );
  });

  it("denies an unrelated guardian family, inactive relation, adult target, and active creation", async () => {
    const current = services();
    vi.mocked(current.memberStudentIds).mockResolvedValueOnce([]);
    await expect(
      createMembershipHandler(request(createPayload, "guardian", "guardian-1"), current),
    ).rejects.toMatchObject({ code: "permission-denied" });

    vi.mocked(current.memberStudentIds).mockResolvedValueOnce([]);
    await expect(
      createMembershipHandler(request(createPayload, "guardian", "guardian-1"), current),
    ).rejects.toMatchObject({ code: "permission-denied" });

    await expect(
      createMembershipHandler(
        request({ ...createPayload, studentId: adultStudentId }, "guardian", "guardian-1"),
        current,
      ),
    ).rejects.toMatchObject({ code: "permission-denied" });
    await expect(
      createMembershipHandler(
        request({ ...createPayload, status: "active" }, "guardian", "guardian-1"),
        current,
      ),
    ).rejects.toMatchObject({ code: "permission-denied" });
  });

  it("keeps Transit Free administrative-only", async () => {
    const current = services();
    await expect(
      createMembershipHandler(
        request({ ...createPayload, planId: "transit-free" }, "guardian", "guardian-1"),
        current,
      ),
    ).rejects.toMatchObject({ code: "permission-denied" });
    expect(current.store.createMembership).not.toHaveBeenCalled();
  });

  it("resolves an adult student to only the linked adult student", async () => {
    const current = services();
    const payload = { ...createPayload, familyId: "adult-family-1", studentId: adultStudentId };
    vi.mocked(current.familyStore!.getStaffFamily).mockResolvedValue(
      staffFamilyProjection("adult-family-1"),
    );
    vi.mocked(current.store.listMemberships).mockResolvedValueOnce([
      membership({
        familyId: "adult-family-1",
        studentId: adultStudentId,
      }),
    ]);
    await expect(
      listMembershipsHandler(request(null, "adultStudent", "adult-user-1"), current),
    ).resolves.toHaveLength(1);
    expect(current.store.listMemberships).toHaveBeenCalledWith({
      academyId,
      memberActorId: "adult-user-1",
      studentIds: [adultStudentId],
    });
    await expect(
      createMembershipHandler(request(payload, "adultStudent", "adult-user-1"), current),
    ).resolves.toEqual(expect.objectContaining({ status: "trial" }));
    expect(current.store.createMembership).toHaveBeenCalledWith(
      expect.objectContaining({
        familyId: "adult-family-1",
        studentId: adultStudentId,
        status: "trial",
        scope: {
          academyId,
          memberActorId: "adult-user-1",
          familyIds: ["adult-family-1"],
          studentIds: [adultStudentId],
        },
      }),
    );

    await expect(
      createMembershipHandler(
        request({ ...payload, status: "active" }, "adultStudent", "adult-user-1"),
        current,
      ),
    ).rejects.toMatchObject({ code: "permission-denied" });

    await expect(
      createMembershipHandler(
        request({ ...payload, familyId: "other-family" }, "adultStudent", "adult-user-1"),
        current,
      ),
    ).rejects.toMatchObject({ code: "permission-denied" });
    await expect(
      createMembershipHandler(
        request({ ...payload, studentId: "other-student" }, "adultStudent", "adult-user-1"),
        current,
      ),
    ).rejects.toMatchObject({ code: "permission-denied" });

    vi.mocked(current.memberStudentIds).mockResolvedValueOnce([]);
    await expect(
      listMembershipsHandler(request(null, "adultStudent", "adult-user-1"), current),
    ).rejects.toMatchObject({ code: "permission-denied" });
  });

  it("returns only an active teen's linked minor memberships", async () => {
    const current = services({
      findStudentByUserId: vi.fn(async () => teenStudentScope()),
    });
    await expect(
      listMembershipsHandler(request(null, "teenStudent", "teen-user-1"), current),
    ).resolves.toEqual([expect.objectContaining({ studentId: minorStudentId, familyId })]);
    expect(current.store.listMemberships).toHaveBeenCalledWith({
      academyId,
      memberActorId: "teen-user-1",
      studentIds: [minorStudentId],
    });
  });

  it("denies a teen trial creation for their own active minor before the store operation", async () => {
    const current = services({
      findStudentByUserId: vi.fn(async () => teenStudentScope()),
    });

    await expect(
      createMembershipHandler(
        request(
          { ...createPayload, familyId, studentId: minorStudentId },
          "teenStudent",
          "teen-user-1",
        ),
        current,
      ),
    ).rejects.toMatchObject({ code: "permission-denied" });
    expect(current.store.createMembership).not.toHaveBeenCalled();
  });

  it("denies teen membership reads without an active linked minor and family scope", async () => {
    for (const scope of [
      undefined,
      teenStudentScope({ participantType: "adult" }),
      teenStudentScope({ active: false, status: "inactive" }),
    ]) {
      const current = services({
        memberStudentIds: vi.fn(async () =>
          scope && scope.participantType === "minor" && scope.active ? [minorStudentId] : [],
        ),
      });
      await expect(
        listMembershipsHandler(request(null, "teenStudent", "teen-user-1"), current),
      ).rejects.toMatchObject({ code: "permission-denied" });
      expect(current.store.listMemberships).not.toHaveBeenCalled();
    }

    const inactiveFamily = services({ memberStudentIds: vi.fn(async () => []) });
    await expect(
      listMembershipsHandler(request(null, "teenStudent", "teen-user-1"), inactiveFamily),
    ).rejects.toMatchObject({ code: "permission-denied" });
    expect(inactiveFamily.store.listMemberships).not.toHaveBeenCalled();

    const outOfScope = services({ findStudentByUserId: vi.fn(async () => teenStudentScope()) });
    vi.mocked(outOfScope.store.listMemberships).mockResolvedValue([
      membership({ studentId: "sibling-student", familyId }),
    ]);
    await expect(
      listMembershipsHandler(request(null, "teenStudent", "teen-user-1"), outOfScope),
    ).rejects.toMatchObject({ code: "permission-denied" });
  });

  it("requires exact payloads and rejects authority fields, hostile descriptors, dates, IDs, and statuses", async () => {
    const current = services();
    for (const payload of [
      { ...createPayload, academyId },
      { ...createPayload, actorId: "attacker" },
      { ...createPayload, priceMinor: 1 },
      { ...createPayload, status: "paused" },
      { ...createPayload, startsAt: now },
      { ...createPayload, endsAt: null },
      { ...createPayload, nextBillingAt: null },
      { ...createPayload, familyId: "../other" },
      { ...createPayload, [Symbol("extra")]: true },
      Object.assign(Object.create({ inherited: true }), createPayload),
    ]) {
      await expect(
        createMembershipHandler(request(payload, "owner"), current),
      ).rejects.toMatchObject({
        code: "invalid-argument",
      });
    }

    const hostile = { ...createPayload };
    Object.defineProperty(hostile, "planId", {
      enumerable: true,
      get: () => {
        throw new Error("hostile plan getter");
      },
    });
    await expect(createMembershipHandler(request(hostile, "owner"), current)).rejects.toMatchObject(
      {
        code: "invalid-argument",
      },
    );
    await expect(
      listMembershipsHandler(request({ academyId }, "owner"), current),
    ).rejects.toMatchObject({
      code: "invalid-argument",
    });
    await expect(
      transitionMembershipHandler(request({ ...transitionPayload, academyId }, "owner"), current),
    ).rejects.toMatchObject({ code: "invalid-argument" });
    await expect(
      cancelMembershipHandler(
        request({ membershipId: "membership-1", targetStatus: "active" }, "owner"),
        current,
      ),
    ).rejects.toMatchObject({ code: "invalid-argument" });
    expect(current.store.createMembership).not.toHaveBeenCalled();
  });

  it("allows administrators to transition and cancel through the same scoped path", async () => {
    const current = services();
    await expect(
      transitionMembershipHandler(request(transitionPayload, "administrator"), current),
    ).resolves.toEqual(expect.objectContaining({ status: "paused" }));
    expect(current.store.getMembership).toHaveBeenCalledWith(
      { academyId, membershipIds: ["membership-1"] },
      "membership-1",
    );
    expect(current.store.transitionMembership).toHaveBeenCalledWith({
      academyId,
      actorId: "admin-1",
      now,
      membershipId: "membership-1",
      targetStatus: "paused",
      scope: {
        academyId,
        familyIds: [familyId],
        studentIds: [minorStudentId],
        membershipIds: ["membership-1"],
      },
    });

    await expect(
      cancelMembershipHandler(request({ membershipId: "membership-1" }, "administrator"), current),
    ).resolves.toEqual(expect.objectContaining({ status: "cancelled" }));
    expect(current.store.transitionMembership).toHaveBeenLastCalledWith(
      expect.objectContaining({ targetStatus: "cancelled" }),
    );
  });

  it("maps an invalid transition from active to trial to a safe precondition error", async () => {
    const fake = createTransitionFirestore();
    const current = services({
      store: createMembershipStore({ firestore: fake.firestore }),
    });
    await expect(
      transitionMembershipHandler(
        request({ membershipId: "membership-1", targetStatus: "trial" }, "administrator"),
        current,
      ),
    ).rejects.toMatchObject({
      code: "failed-precondition",
      message: "Membership operation is not available",
    });
    expect(fake.writes).toEqual([]);
    expect(fake.audits).toEqual([]);
    expect(fake.records.get(fake.membershipPath)).toEqual(membership());
  });

  it("denies self-service transitions and redacts every response", async () => {
    const current = services();
    await expect(
      transitionMembershipHandler(request(transitionPayload, "guardian", "guardian-1"), current),
    ).rejects.toMatchObject({ code: "permission-denied" });
    await expect(
      cancelMembershipHandler(
        request({ membershipId: "membership-1" }, "adultStudent", "adult-user-1"),
        current,
      ),
    ).rejects.toMatchObject({ code: "permission-denied" });

    const [response] = await listMembershipsHandler(request(null, "owner"), current);
    expect(response).toEqual({
      membershipId: "membership-1",
      familyId,
      studentId: minorStudentId,
      planId: "bpt-jersey-adult",
      status: "active",
      startsAt: now,
      endsAt: null,
      nextBillingAt: null,
    });
    for (const field of [
      "academyId",
      "schemaVersion",
      "createdAt",
      "createdBy",
      "updatedAt",
      "updatedBy",
      "priceMinor",
      "audit",
      "path",
    ]) {
      expect(response).not.toHaveProperty(field);
    }
  });

  it("maps cross-tenant, missing relationship, inactive actor, store, and invalid transitions safely", async () => {
    const current = services();
    vi.mocked(current.store.listMemberships).mockResolvedValueOnce([
      membership({ academyId: "academy-2" }),
    ]);
    await expect(listMembershipsHandler(request(null, "owner"), current)).rejects.toMatchObject({
      code: "permission-denied",
      message: "Membership access is not permitted",
    });

    vi.mocked(current.isActorActive!).mockResolvedValueOnce(false);
    await expect(listMembershipsHandler(request(null, "owner"), current)).rejects.toMatchObject({
      code: "permission-denied",
    });

    vi.mocked(current.memberStudentIds).mockResolvedValueOnce([]);
    await expect(
      listMembershipsHandler(request(null, "guardian", "guardian-1"), current),
    ).rejects.toMatchObject({
      code: "permission-denied",
    });

    const { MembershipStoreError } = await import("./membership-service.js");
    vi.mocked(current.store.transitionMembership).mockRejectedValueOnce(
      new MembershipStoreError("precondition", "raw Firestore path and secret"),
    );
    await expect(
      transitionMembershipHandler(request(transitionPayload, "owner"), current),
    ).rejects.toMatchObject({
      code: "failed-precondition",
      message: "Membership operation is not available",
    });
    vi.mocked(current.store.getMembership).mockResolvedValueOnce(undefined);
    await expect(
      transitionMembershipHandler(request(transitionPayload, "owner"), current),
    ).rejects.toMatchObject({ code: "failed-precondition" });
    expect(current.store.transitionMembership).not.toHaveBeenCalledWith(
      expect.objectContaining({ targetStatus: "trial" as MembershipStatus }),
    );
  });
});
