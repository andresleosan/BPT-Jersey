import { describe, expect, it, vi } from "vitest";

import {
  coachMemberProfileHeaderSchema,
  memberNameSearchLimit,
} from "@bpt-jersey/domain/members/profile";
import type { StudentProfile } from "@bpt-jersey/domain/profiles";

import { CanonicalMemberDirectoryReadError } from "./canonical-member-directory-read-service.js";
import type { MemberDirectoryCallableServices } from "./member-directory-callables.js";
import {
  getMemberProfileHandler,
  searchMemberNamesHandler,
  type MemberProfileCallableServices,
} from "./member-profile-callables.js";
import { createMemberProfileService, type MemberProfileStore } from "./member-profile-service.js";

const now = "2026-09-17T09:00:00.000Z";

const student = {
  studentId: "student-a",
  academyId: "academy-1",
  fullName: "Test Member A",
  dateOfBirth: "2000-09-20",
  trainingCenter: "Town",
  trainingTimePreferences: ["evening"],
  participantType: "adult",
  active: true,
  status: "active",
  schemaVersion: "1",
  createdAt: "2026-01-15T10:00:00.000Z",
  createdBy: "owner-1",
  updatedAt: "2026-01-15T10:00:00.000Z",
  updatedBy: "owner-1",
} as StudentProfile;

function request(data: unknown, input: Readonly<{ role?: string; appCheck?: boolean }> = {}) {
  const role = input.role ?? "owner";
  return {
    data,
    auth:
      role === "anonymous"
        ? undefined
        : { uid: "actor-1", token: { academyId: "academy-1", role } },
    ...(input.appCheck === false ? {} : { app: { appId: "web-app-1" } }),
  } as never;
}

const store: MemberProfileStore = {
  getFamily: async () => undefined,
  listStudentRelationships: async () => [],
  getUserDisplayName: async () => undefined,
  listStudentMemberships: async () => [],
  getPlanDisplayName: async () => undefined,
  listMembershipNumbers: async () => ["7"],
  listStudentNames: async () => [{ studentId: "student-a", fullName: "Test Member A" }],
};

function services(overrides: Readonly<{ store?: MemberProfileStore }> = {}) {
  const memberProfileRecord = vi.fn(async () => ({ student }));
  const requireActor = vi.fn(async (req: { auth?: { token: { role: string } } }) => ({
    kind: "user" as const,
    userId: "actor-1",
    academyId: "academy-1",
    role: req.auth?.token.role,
    staffId: null,
  }));
  const resolveStudent = vi.fn(async () => student);
  const isActorActive = vi.fn(async () => true);
  const value: MemberProfileCallableServices = {
    directory: {
      reader: { memberProfileRecord },
      isActorActive,
      now: () => now,
    } as unknown as MemberDirectoryCallableServices,
    levelAuthorization: { requireActor, resolveStudent } as never,
    profiles: createMemberProfileService({ store: overrides.store ?? store }),
  };
  return { value, memberProfileRecord, requireActor, resolveStudent, isActorActive };
}

describe("getMemberProfile (T051V2, grill G6)", () => {
  it("gives owner and administrator the full view through the audited restricted read", async () => {
    for (const role of ["owner", "administrator"] as const) {
      const harness = services();
      const profile = await getMemberProfileHandler(
        request({ studentId: "student-a" }, { role }),
        harness.value,
      );
      expect(profile.view).toBe("full");
      expect(Object.keys(profile).sort()).toEqual([
        "cards",
        "details",
        "header",
        "nextFreeMemberNumber",
        "view",
      ]);
      expect(harness.memberProfileRecord).toHaveBeenCalledWith({
        actor: expect.objectContaining({ role, academyId: "academy-1", appCheckVerified: true }),
        value: { studentId: "student-a" },
        now,
      });
      expect(harness.resolveStudent).not.toHaveBeenCalled();
    }
  });

  it("gives headCoach and coach the header only, never touching the restricted reader", async () => {
    for (const role of ["headCoach", "coach"] as const) {
      const harness = services();
      const profile = await getMemberProfileHandler(
        request({ studentId: "student-a" }, { role }),
        harness.value,
      );
      expect(Object.keys(profile).sort()).toEqual(["header", "view"]);
      expect(profile.view).toBe("coach");
      expect(Object.keys(profile.header).sort()).toEqual([
        "age",
        "birthdayBadge",
        "fullName",
        "participantType",
        "status",
        "studentId",
      ]);
      expect(JSON.stringify(profile)).not.toMatch(/dateOfBirth|membership|details|cards/u);
      expect(harness.resolveStudent).toHaveBeenCalledWith(
        expect.objectContaining({ role }),
        "student-a",
      );
      expect(harness.memberProfileRecord).not.toHaveBeenCalled();
      expect(harness.isActorActive).not.toHaveBeenCalled();
    }
  });

  /**
   * The coach view is only as narrow as the shape behind it: a field added to the shared header
   * shape would reach the mat without this test failing first.
   */
  it("keeps the coach header shape to the six agreed fields", () => {
    expect(Object.keys(coachMemberProfileHeaderSchema.shape).sort()).toEqual([
      "age",
      "birthdayBadge",
      "fullName",
      "participantType",
      "status",
      "studentId",
    ]);
  });

  it("refuses client roles and anonymous callers before any read", async () => {
    for (const role of ["guardian", "adultStudent"]) {
      const harness = services();
      await expect(
        getMemberProfileHandler(request({ studentId: "student-a" }, { role }), harness.value),
      ).rejects.toMatchObject({ code: "permission-denied" });
      expect(harness.memberProfileRecord).not.toHaveBeenCalled();
      expect(harness.resolveStudent).not.toHaveBeenCalled();
    }
    const harness = services();
    await expect(
      getMemberProfileHandler(
        request({ studentId: "student-a" }, { role: "anonymous" }),
        harness.value,
      ),
    ).rejects.toMatchObject({ code: "unauthenticated" });
  });

  it("requires App Check in the handler for office", async () => {
    const harness = services();
    await expect(
      getMemberProfileHandler(
        request({ studentId: "student-a" }, { role: "owner", appCheck: false }),
        harness.value,
      ),
    ).rejects.toMatchObject({ code: "unauthenticated" });
    expect(harness.memberProfileRecord).not.toHaveBeenCalled();
  });

  it("validates the coach payload before resolving the student", async () => {
    const harness = services();
    await expect(
      getMemberProfileHandler(
        request({ studentId: "student-a", view: "full" }, { role: "coach" }),
        harness.value,
      ),
    ).rejects.toMatchObject({ code: "invalid-argument" });
    expect(harness.resolveStudent).not.toHaveBeenCalled();
  });

  it("maps the restricted read failures to safe callable codes", async () => {
    for (const [code, expected] of [
      ["not-found", "not-found"],
      ["rate-limited", "resource-exhausted"],
      ["invalid", "invalid-argument"],
    ] as const) {
      const harness = services();
      harness.memberProfileRecord.mockRejectedValueOnce(
        new CanonicalMemberDirectoryReadError(code, "synthetic"),
      );
      await expect(
        getMemberProfileHandler(request({ studentId: "student-a" }), harness.value),
      ).rejects.toMatchObject({ code: expected });
    }
  });
});

describe("searchMemberNames (T051V2)", () => {
  it("lets every staff role search by name", async () => {
    for (const role of ["owner", "administrator", "headCoach", "coach"]) {
      const harness = services();
      await expect(
        searchMemberNamesHandler(request({ query: "test" }, { role }), harness.value),
      ).resolves.toEqual({ members: [{ studentId: "student-a", fullName: "Test Member A" }] });
    }
  });

  /** The contract has no `limit`: a 21st row would fail the output parse, so the cap is the guard. */
  it("clamps the answer to the contract limit when many names match", async () => {
    const many = Array.from({ length: memberNameSearchLimit + 5 }, (_, index) => ({
      studentId: `student-${index}`,
      fullName: `Test Member ${String(index).padStart(2, "0")}`,
    }));
    const harness = services({ store: { ...store, listStudentNames: async () => many } });
    const result = await searchMemberNamesHandler(
      request({ query: "test" }, { role: "owner" }),
      harness.value,
    );
    expect(result.members).toHaveLength(memberNameSearchLimit);
    expect(result.members[0]?.fullName).toBe("Test Member 00");
  });

  it("refuses client roles and invalid queries", async () => {
    for (const role of ["guardian", "adultStudent"]) {
      await expect(
        searchMemberNamesHandler(request({ query: "test" }, { role }), services().value),
      ).rejects.toMatchObject({ code: "permission-denied" });
    }
    await expect(
      searchMemberNamesHandler(request({ query: "t" }, { role: "coach" }), services().value),
    ).rejects.toMatchObject({ code: "invalid-argument" });
  });
});
