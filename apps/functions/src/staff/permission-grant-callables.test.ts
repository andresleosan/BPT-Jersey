import { describe, expect, it, vi } from "vitest";

import {
  allowedByRoleOrGrant,
  createGrantStaffPermissionHandler,
  createListStaffPermissionGrantsHandler,
  createRevokeStaffPermissionHandler,
  permissionGrantCallableOptions,
} from "./permission-grant-callables";
import { PermissionGrantError, type PermissionGrantService } from "./permission-grant-service";

function fakeRequest(data: unknown, role = "owner", uid = "office-1") {
  return { auth: { uid, token: { academyId: "academy-1", role } }, data } as never;
}

function service(overrides: Partial<PermissionGrantService> = {}): PermissionGrantService {
  return {
    grantPermission: vi.fn().mockResolvedValue({ grantId: "grant-1", status: "active" }),
    revokePermission: vi.fn().mockResolvedValue({ grantId: "grant-1", status: "revoked" }),
    listPermissionGrants: vi.fn().mockResolvedValue([]),
    evaluatePermission: vi.fn().mockResolvedValue({ allowed: false, grantId: null, reason: "no" }),
    ...overrides,
  } as unknown as PermissionGrantService;
}

const grantPayload = {
  subjectUserId: "coach-1",
  permission: "reviewPenalties",
  reason: "Covers the office desk while Ana is away",
  expiresAt: "2026-10-05T12:00:00.000Z",
};

describe("permission grant callables (T116)", () => {
  it("requires and consumes App Check on every grant callable", () => {
    expect(permissionGrantCallableOptions).toEqual({
      cors: ["https://bptjersey.pages.dev"],
      invoker: "public",
      enforceAppCheck: true,
      consumeAppCheckToken: true,
    });
  });

  describe("grantStaffPermission", () => {
    it("passes office's parsed command through with the actor attached", async () => {
      const grants = service();
      await createGrantStaffPermissionHandler({ service: grants })(fakeRequest(grantPayload));
      expect(grants.grantPermission).toHaveBeenCalledWith({
        academyId: "academy-1",
        actorId: "office-1",
        actorRole: "owner",
        command: grantPayload,
      });
    });

    it("refuses every role but office, a head coach included", async () => {
      const handler = createGrantStaffPermissionHandler({ service: service() });
      for (const role of ["headCoach", "coach", "guardian", "adultStudent"]) {
        await expect(handler(fakeRequest(grantPayload, role, "other-1"))).rejects.toMatchObject({
          code: "permission-denied",
        });
      }
      await expect(
        handler(fakeRequest(grantPayload, "administrator", "admin-1")),
      ).resolves.toBeDefined();
    });

    it("refuses a permission outside the closed list and a malformed payload", async () => {
      const handler = createGrantStaffPermissionHandler({ service: service() });
      for (const payload of [
        { ...grantPayload, permission: "manageStaff" },
        { ...grantPayload, permission: "grantPermissions" },
        { ...grantPayload, extra: 1 },
        { ...grantPayload, reason: "no" },
        null,
        {},
      ]) {
        await expect(handler(fakeRequest(payload))).rejects.toMatchObject({
          code: "invalid-argument",
        });
      }
    });

    it("maps a store refusal to a safe code without leaking its detail", async () => {
      const cases = [
        { code: "denied" as const, expected: "permission-denied" },
        { code: "tenant" as const, expected: "permission-denied" },
        { code: "conflict" as const, expected: "failed-precondition" },
        { code: "not-found" as const, expected: "not-found" },
        { code: "invalid" as const, expected: "invalid-argument" },
      ];
      for (const { code, expected } of cases) {
        const handler = createGrantStaffPermissionHandler({
          service: service({
            grantPermission: vi
              .fn()
              .mockRejectedValue(new PermissionGrantError(code, "internal grant detail")),
          }),
        });
        const rejection = (await handler(fakeRequest(grantPayload)).catch(
          (error: unknown) => error,
        )) as { code: string; message: string };
        expect(rejection.code).toBe(expected);
        expect(rejection.message).not.toContain("internal grant detail");
      }
    });
  });

  describe("revokeStaffPermission", () => {
    it("takes a grant and a reason from office only", async () => {
      const grants = service();
      const payload = { grantId: "grant-1", reason: "Ana is back at the desk" };
      await createRevokeStaffPermissionHandler({ service: grants })(fakeRequest(payload));
      expect(grants.revokePermission).toHaveBeenCalledWith(
        expect.objectContaining({ actorId: "office-1", command: payload }),
      );

      const handler = createRevokeStaffPermissionHandler({ service: service() });
      await expect(handler(fakeRequest(payload, "coach", "coach-1"))).rejects.toMatchObject({
        code: "permission-denied",
      });
      for (const bad of [{ grantId: "grant-1" }, { grantId: "grant-1", reason: "no" }, null]) {
        await expect(handler(fakeRequest(bad))).rejects.toMatchObject({
          code: "invalid-argument",
        });
      }
    });
  });

  describe("listStaffPermissionGrants", () => {
    it("is office-only and accepts an optional subject filter", async () => {
      const grants = service();
      const handler = createListStaffPermissionGrantsHandler({ service: grants });

      await handler(fakeRequest(null));
      expect(grants.listPermissionGrants).toHaveBeenCalledWith({ academyId: "academy-1" });

      await handler(fakeRequest({ subjectUserId: "coach-1" }));
      expect(grants.listPermissionGrants).toHaveBeenLastCalledWith({
        academyId: "academy-1",
        subjectUserId: "coach-1",
      });

      // A coach never sees the delegation list, not even the entry naming themselves.
      for (const role of ["headCoach", "coach", "guardian", "adultStudent"]) {
        await expect(handler(fakeRequest(null, role, "coach-1"))).rejects.toMatchObject({
          code: "permission-denied",
        });
      }
      for (const payload of [{ subjectUserId: "" }, { subjectUserId: "coach-1", extra: 1 }]) {
        await expect(handler(fakeRequest(payload))).rejects.toMatchObject({
          code: "invalid-argument",
        });
      }
    });
  });

  describe("allowedByRoleOrGrant", () => {
    it("answers by role first and never reads the store for an allowed role", async () => {
      const grants = service();
      await expect(
        allowedByRoleOrGrant({
          service: grants,
          academyId: "academy-1",
          userId: "office-1",
          role: "owner",
          permittedRoles: ["owner", "administrator"],
          permission: "reviewPenalties",
        }),
      ).resolves.toBe(true);
      expect(grants.evaluatePermission).not.toHaveBeenCalled();
    });

    it("gives a refused role a second chance through a live grant", async () => {
      const granted = service({
        evaluatePermission: vi
          .fn()
          .mockResolvedValue({ allowed: true, grantId: "grant-1", reason: "granted" }),
      });
      await expect(
        allowedByRoleOrGrant({
          service: granted,
          academyId: "academy-1",
          userId: "coach-1",
          role: "coach",
          permittedRoles: ["owner", "administrator"],
          permission: "reviewPenalties",
        }),
      ).resolves.toBe(true);
      expect(granted.evaluatePermission).toHaveBeenCalledWith({
        academyId: "academy-1",
        subjectUserId: "coach-1",
        permission: "reviewPenalties",
      });
    });

    it("stays closed when there is no grant", async () => {
      await expect(
        allowedByRoleOrGrant({
          service: service(),
          academyId: "academy-1",
          userId: "coach-1",
          role: "coach",
          permittedRoles: ["owner", "administrator"],
          permission: "reviewPenalties",
        }),
      ).resolves.toBe(false);
    });
  });
});
