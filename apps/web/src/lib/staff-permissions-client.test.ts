import { beforeEach, describe, expect, it, vi } from "vitest";

const callable = vi.hoisted(() => vi.fn());
vi.mock("firebase/functions", () => ({ httpsCallable: () => callable }));
vi.mock("./firebase-client", () => ({ getFirebaseFunctions: () => ({}) }));

import {
  grantStaffPermission,
  listStaffPermissionGrants,
  permissionGrantLabel,
  permissionGrantStatusLabel,
  revokeStaffPermission,
  type PermissionGrantView,
} from "./staff-permissions-client";

const grant: PermissionGrantView = {
  grantId: "grant-1",
  academyId: "academy-1",
  subjectUserId: "coach-1",
  permission: "reviewPenalties",
  reason: "Covers the office desk while Ana is away",
  grantedBy: "owner-1",
  grantedAt: "2026-09-05T12:00:00.000Z",
  expiresAt: "2026-10-05T12:00:00.000Z",
  revokedAt: null,
  revokedBy: null,
  revocationReason: null,
  schemaVersion: "1",
  status: "active",
};

describe("staff permissions client (T116)", () => {
  beforeEach(() => {
    // Block body on purpose: `() => callable.mockReset()` returns the mock, and Vitest treats
    // a function returned from a hook as its teardown, so it would call the mock after the
    // test - outside any try/catch - and report the raw error as a failure.
    callable.mockReset();
  });

  it("returns a well-formed list and sends no filter when none was asked for", async () => {
    callable.mockResolvedValue({ data: { grants: [grant] } });
    await expect(listStaffPermissionGrants()).resolves.toEqual([grant]);
    expect(callable).toHaveBeenCalledWith(null);

    await listStaffPermissionGrants({ subjectUserId: "coach-1" });
    expect(callable).toHaveBeenLastCalledWith({ subjectUserId: "coach-1" });
  });

  it("refuses a payload carrying a permission outside the closed list", async () => {
    callable.mockResolvedValue({
      data: { grants: [{ ...grant, permission: "manageStaff" }] },
    });
    await expect(listStaffPermissionGrants()).rejects.toThrow(
      "Unable to load permission grants. Please try again.",
    );
  });

  it("refuses a malformed shape and an unknown status", async () => {
    for (const data of [
      {},
      { grants: null },
      { grants: [{ grantId: "grant-1" }] },
      { grants: [{ ...grant, status: "pending" }] },
    ]) {
      callable.mockResolvedValue({ data });
      await expect(listStaffPermissionGrants()).rejects.toThrow("Unable to load permission grants");
    }
  });

  it("never leaks the underlying failure of a grant or a revoke", async () => {
    // Thrown synchronously: a floating rejected promise would be reported as an unhandled
    // rejection even though the client catches it, which reads as a failure that is not one.
    callable.mockImplementation(() => {
      throw new Error("FIRESTORE precondition academies/academy-1/staff");
    });
    await expect(
      grantStaffPermission({
        subjectUserId: "coach-1",
        permission: "reviewPenalties",
        reason: "Covers the office desk",
        expiresAt: "2026-10-05T12:00:00.000Z",
      }),
    ).rejects.toThrow("Unable to grant that permission. Please try again.");
    await expect(
      revokeStaffPermission({ grantId: "grant-1", reason: "Ana is back" }),
    ).rejects.toThrow("Unable to revoke that grant. Please try again.");
  });

  it("returns the grant a successful call produced", async () => {
    callable.mockResolvedValue({ data: { grant } });
    await expect(
      grantStaffPermission({
        subjectUserId: "coach-1",
        permission: "reviewPenalties",
        reason: "Covers the office desk",
        expiresAt: "2026-10-05T12:00:00.000Z",
      }),
    ).resolves.toEqual(grant);
    await expect(
      revokeStaffPermission({ grantId: "grant-1", reason: "Ana is back" }),
    ).resolves.toEqual(grant);
  });

  it("labels a grant without printing a raw contract value", () => {
    expect(permissionGrantLabel("reviewPenalties")).toBe("Review no-show penalties");
    expect(permissionGrantLabel("manageClasses")).toBe("Manage classes");
    expect(permissionGrantStatusLabel(grant)).toBe("Active until 2026-10-05");
    expect(permissionGrantStatusLabel({ ...grant, status: "revoked" })).toBe("Revoked");
    expect(permissionGrantStatusLabel({ ...grant, status: "expired" })).toBe("Expired");
  });
});
