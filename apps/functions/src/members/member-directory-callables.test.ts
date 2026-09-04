import { describe, expect, it, vi } from "vitest";
import { Timestamp } from "firebase-admin/firestore";

import {
  createMemberDirectoryActorActivityCheck,
  createMemberDirectoryHandler,
  getMemberDetailHandler,
  listMembersHandler,
  lookupMemberIdentityHandler,
  updateMemberDirectoryHandler,
  type MemberDirectoryCallableServices,
} from "./member-directory-callables.js";
import { CanonicalMemberDirectoryError } from "./canonical-member-directory-service.js";
import { CanonicalMemberDirectoryReadError } from "./canonical-member-directory-read-service.js";

const now = "2026-09-03T21:00:00.000Z";
const createValue = {
  requestId: "request-1",
  fullName: "Synthetic Adult",
  dateOfBirth: "1990-01-02",
  trainingCenter: "Town",
  trainingTimePreferences: ["evening"],
};

function request(
  data: unknown,
  input: Readonly<{
    role?: string;
    uid?: string;
    academyId?: string;
    appCheck?: boolean;
  }> = {},
) {
  const role = input.role ?? "owner";
  const uid = input.uid ?? "owner-1";
  const academyId = input.academyId ?? "academy-1";
  return {
    data,
    auth: role === "anonymous" ? undefined : { uid, token: { academyId, role } },
    ...(input.appCheck === false ? {} : { app: { appId: "web-app-1" } }),
  } as never;
}

function services(): MemberDirectoryCallableServices {
  return {
    writer: {
      createAdminAdult: vi.fn(async () => ({
        memberId: "student-1",
        studentId: "student-1",
      })),
      updateAdminMember: vi.fn(async () => ({
        memberId: "student-1",
        studentId: "student-1",
      })),
    },
    reader: {
      list: vi.fn(async () => ({ rows: [] })),
      detail: vi.fn(async () => ({
        studentId: "student-1",
        fullName: "Synthetic Adult",
        dateOfBirth: "1990-01-02",
        trainingCenter: "Town" as const,
        trainingTimePreferences: ["evening"] as const,
        participantType: "adult" as const,
        active: true,
        status: "active" as const,
        gender: "unknown" as const,
      })),
      lookup: vi.fn(async () => ({ matched: false as const })),
    },
    isActorActive: vi.fn(async () => true),
    now: () => now,
  };
}

const actorStatusInput = {
  uid: "owner-1",
  academyId: "academy-1",
  role: "owner" as const,
};

function provisionedAdminDocument(
  overrides: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    userId: "owner-1",
    academyId: "academy-1",
    accountType: "staff",
    displayName: "Synthetic Owner",
    email: "owner@example.test",
    authProvider: "google",
    active: true,
    adminRole: "owner",
    lastRoleChangeAuditId: "audit-role-1",
    createdAt: Timestamp.fromMillis(1_700_000_000_000),
    createdBy: "bootstrap-owner",
    updatedAt: Timestamp.fromMillis(1_700_000_001_000),
    updatedBy: "bootstrap-owner",
    status: "active",
    schemaVersion: 1,
    ...overrides,
  };
}

type ActivityAuthUser = Readonly<{
  uid: string;
  disabled: boolean;
  customClaims?: Readonly<Record<string, unknown>>;
}>;

type ActivityDocument = Readonly<{
  exists: boolean;
  data: () => unknown;
}>;

function activityHarness(
  input: Readonly<{
    authUser?: ActivityAuthUser;
    adminDocument?: unknown;
    adminDocumentExists?: boolean;
    lockExists?: boolean;
  }> = {},
) {
  const authUser = input.authUser ?? {
    uid: "owner-1",
    disabled: false,
    customClaims: {
      academyId: "academy-1",
      role: "owner",
      mfaEnrolled: true,
    },
  };
  const getAuthUser = vi.fn(async () => authUser);
  const getDocument = vi.fn(async (path: string): Promise<ActivityDocument> => {
    if (path.endsWith("/adminRoleLocks/owner-1")) {
      return {
        exists: input.lockExists ?? false,
        data: () => (input.lockExists ? { phase: "active" } : undefined),
      };
    }
    return {
      exists: input.adminDocumentExists ?? true,
      data: () => input.adminDocument ?? provisionedAdminDocument(),
    };
  });
  return {
    check: createMemberDirectoryActorActivityCheck({ getAuthUser, getDocument }),
    getAuthUser,
    getDocument,
  };
}

describe("member directory administrative activity gate", () => {
  it("accepts only the exact active provisioning document and current Auth claims", async () => {
    const harness = activityHarness();

    await expect(harness.check(actorStatusInput)).resolves.toBe(true);
    expect(harness.getAuthUser).toHaveBeenCalledWith("owner-1");
    expect(harness.getDocument).toHaveBeenCalledTimes(2);
    expect(harness.getDocument).toHaveBeenNthCalledWith(1, "academies/academy-1/users/owner-1");
    expect(harness.getDocument).toHaveBeenNthCalledWith(
      2,
      "academies/academy-1/adminRoleLocks/owner-1",
    );
  });

  it("rejects a different provisioned role or tenant", async () => {
    await expect(
      activityHarness({
        adminDocument: provisionedAdminDocument({ adminRole: "administrator" }),
      }).check(actorStatusInput),
    ).resolves.toBe(false);
    await expect(
      activityHarness({
        adminDocument: provisionedAdminDocument({ academyId: "academy-2" }),
      }).check(actorStatusInput),
    ).resolves.toBe(false);
  });

  it("rejects while the provisioning role lock exists", async () => {
    await expect(activityHarness({ lockExists: true }).check(actorStatusInput)).resolves.toBe(
      false,
    );
  });

  it("rejects revoked, cross-tenant or changed Auth claims", async () => {
    const claimsCases = [
      { mfaEnrolled: true },
      { academyId: "academy-2", role: "owner" },
      { academyId: "academy-1", role: "administrator" },
    ] as const;
    for (const customClaims of claimsCases) {
      await expect(
        activityHarness({
          authUser: { uid: "owner-1", disabled: false, customClaims },
        }).check(actorStatusInput),
      ).resolves.toBe(false);
    }
  });

  it("fails closed for inactive, stale-version or non-exact admin documents", async () => {
    const invalidDocuments = [
      provisionedAdminDocument({ active: false }),
      provisionedAdminDocument({ status: "inactive" }),
      provisionedAdminDocument({ accountType: "client" }),
      provisionedAdminDocument({ schemaVersion: "1" }),
      provisionedAdminDocument({ unexpectedField: "not provisioned" }),
    ];
    for (const adminDocument of invalidDocuments) {
      await expect(activityHarness({ adminDocument }).check(actorStatusInput)).resolves.toBe(false);
    }
  });
});

describe("canonical member directory callables", () => {
  it("passes an App-Checked active admin update to the canonical writer", async () => {
    const current = services();
    const value = {
      studentId: "student-1",
      requestId: "41cbb1aa-7020-4bb5-88a4-dbc73c5f0123",
      fullName: "Updated Adult",
      dateOfBirth: "1990-01-02",
      trainingCenter: "West",
      trainingTimePreferences: ["morning"],
      gender: "unknown",
    };

    await expect(updateMemberDirectoryHandler(request(value), current)).resolves.toEqual({
      memberId: "student-1",
      studentId: "student-1",
    });
    expect(current.writer.updateAdminMember).toHaveBeenCalledWith({
      actor: {
        actorId: "owner-1",
        academyId: "academy-1",
        role: "owner",
        active: true,
        appCheckVerified: true,
      },
      value,
      now,
    });
  });

  it("derives the active App-Checked owner and server time for canonical creation", async () => {
    const current = services();

    await expect(createMemberDirectoryHandler(request(createValue), current)).resolves.toEqual({
      memberId: "student-1",
      studentId: "student-1",
    });
    expect(current.isActorActive).toHaveBeenCalledWith({
      uid: "owner-1",
      academyId: "academy-1",
      role: "owner",
    });
    expect(current.writer.createAdminAdult).toHaveBeenCalledWith({
      actor: {
        actorId: "owner-1",
        academyId: "academy-1",
        role: "owner",
        active: true,
        appCheckVerified: true,
      },
      value: createValue,
      now,
    });
  });

  it("rejects missing App Check, non-owner roles and inactive actors before domain I/O", async () => {
    const missingAppCheck = services();
    await expect(
      listMembersHandler(request({ pageSize: 20 }, { appCheck: false }), missingAppCheck),
    ).rejects.toMatchObject({ code: "unauthenticated" });
    expect(missingAppCheck.reader.list).not.toHaveBeenCalled();

    const wrongRole = services();
    await expect(
      listMembersHandler(request({ pageSize: 20 }, { role: "headCoach" }), wrongRole),
    ).rejects.toMatchObject({ code: "permission-denied" });
    expect(wrongRole.isActorActive).not.toHaveBeenCalled();

    const inactive = services();
    vi.mocked(inactive.isActorActive).mockResolvedValue(false);
    await expect(
      createMemberDirectoryHandler(request(createValue), inactive),
    ).rejects.toMatchObject({ code: "permission-denied" });
    expect(inactive.writer.createAdminAdult).not.toHaveBeenCalled();
  });

  it("passes only server-derived authority to list, detail and exact lookup", async () => {
    const current = services();
    const listValue = { pageSize: 10, cursor: "opaque" };
    const detailValue = {
      studentId: "student-1",
      purpose: "member-record-maintenance",
    };
    const lookupValue = {
      lookupKind: "membership-number",
      value: "BPT 00000001",
      purpose: "member-identity-lookup",
    };

    await listMembersHandler(
      request(listValue, { role: "administrator", uid: "admin-1" }),
      current,
    );
    await getMemberDetailHandler(
      request(detailValue, { role: "administrator", uid: "admin-1" }),
      current,
    );
    await lookupMemberIdentityHandler(
      request(lookupValue, { role: "administrator", uid: "admin-1" }),
      current,
    );

    const actor = {
      actorId: "admin-1",
      academyId: "academy-1",
      role: "administrator",
      active: true,
      appCheckVerified: true,
    } as const;
    expect(current.reader.list).toHaveBeenCalledWith({ actor, value: listValue, now });
    expect(current.reader.detail).toHaveBeenCalledWith({ actor, value: detailValue, now });
    expect(current.reader.lookup).toHaveBeenCalledWith({ actor, value: lookupValue, now });
  });

  it("maps closed domain errors without returning internal or searched data", async () => {
    const invalid = services();
    vi.mocked(invalid.writer.createAdminAdult).mockRejectedValue(
      new CanonicalMemberDirectoryError("invalid", "raw BPT 00000001"),
    );
    await expect(createMemberDirectoryHandler(request(createValue), invalid)).rejects.toMatchObject(
      { code: "invalid-argument", message: "Invalid member request" },
    );

    const limited = services();
    vi.mocked(limited.reader.lookup).mockRejectedValue(
      new CanonicalMemberDirectoryReadError("rate-limited", "raw BPT 00000001"),
    );
    await expect(
      lookupMemberIdentityHandler(
        request({
          lookupKind: "membership-number",
          value: "BPT 00000001",
          purpose: "member-identity-lookup",
        }),
        limited,
      ),
    ).rejects.toMatchObject({
      code: "resource-exhausted",
      message: "Restricted member read rate limit exceeded",
    });

    const detailLimited = services();
    vi.mocked(detailLimited.reader.detail).mockRejectedValue(
      new CanonicalMemberDirectoryReadError("rate-limited", "raw student-1"),
    );
    await expect(
      getMemberDetailHandler(
        request({ studentId: "student-1", purpose: "member-record-maintenance" }),
        detailLimited,
      ),
    ).rejects.toMatchObject({
      code: "resource-exhausted",
      message: "Restricted member read rate limit exceeded",
    });
  });
});
