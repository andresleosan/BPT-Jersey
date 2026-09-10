import { describe, expect, it, vi } from "vitest";

import type { StaffProfile } from "@bpt-jersey/domain/staff";

import {
  createStaffProfileHandler,
  listStaffProfilesHandler,
  replaceStaffAssignmentsHandler,
  replaceStaffAvailabilityHandler,
  setStaffActiveHandler,
  updateStaffProfileHandler,
  type StaffCallableServices,
} from "./staff-callables.js";

const profile: StaffProfile = {
  staffId: "staff-1" as StaffProfile["staffId"],
  academyId: "academy-1" as StaffProfile["academyId"],
  userId: "user-1" as StaffProfile["userId"],
  role: "coach",
  active: true,
  status: "active",
  schemaVersion: "1",
  createdAt: "2026-08-21T09:00:00Z",
  createdBy: "owner-1",
  updatedAt: "2026-08-21T09:00:00Z",
  updatedBy: "owner-1",
};

function request(data: unknown, role = "owner") {
  return {
    auth: { uid: "owner-1", token: { academyId: "academy-1", role } },
    data,
  } as never;
}

function services(): StaffCallableServices {
  let customClaims = { academyId: "academy-1", role: "adultStudent" };
  return {
    store: {
      getStaffProfile: vi.fn(async () => profile),
      listStaffProfiles: vi.fn(async () => [
        {
          staffKey: profile.staffId,
          role: profile.role,
          active: profile.active,
          status: profile.status,
          schemaVersion: profile.schemaVersion,
        },
      ]),
      createStaffProfile: vi.fn(async () => profile),
      updateStaffProfile: vi.fn(async () => profile),
      setStaffActive: vi.fn(async () => profile),
      replaceStaffAvailability: vi.fn(async () => []),
      replaceStaffAssignments: vi.fn(async () => []),
    },
    withClaimsLock: async (_academyId, _actorId, _userId, operation) =>
      operation({ retain: () => undefined }),
    auth: {
      getUser: vi.fn(async () => ({ customClaims })),
      setCustomUserClaims: vi.fn(async (_userId, claims) => {
        customClaims = { ...claims };
      }),
    },
    now: () => "2026-08-21T10:00:00Z",
  };
}

describe("staff callables", () => {
  it("authorizes admin callers, derives tenant/actor, and syncs claims after create", async () => {
    const current = services();

    await expect(
      createStaffProfileHandler(
        request({ userId: "user-1", role: "coach", requestId: "request-1" }),
        current,
      ),
    ).resolves.toEqual({
      staffKey: "staff-1",
      role: "coach",
      active: true,
      status: "active",
      schemaVersion: "1",
    });
    expect(current.store.createStaffProfile).toHaveBeenCalledWith({
      academyId: "academy-1",
      actorId: "owner-1",
      userId: "user-1",
      role: "coach",
      requestId: "request-1",
      now: "2026-08-21T10:00:00Z",
    });
    expect(current.auth.setCustomUserClaims).toHaveBeenCalledWith("user-1", {
      academyId: "academy-1",
      role: "coach",
    });
  });

  it("rejects anonymous, non-admin, cross-tenant, and extra-field requests", async () => {
    const current = services();
    await expect(
      createStaffProfileHandler(
        { data: { userId: "user-1", role: "coach", requestId: "r" } } as never,
        current,
      ),
    ).rejects.toMatchObject({ code: "unauthenticated" });
    await expect(
      createStaffProfileHandler(
        request({ userId: "user-1", role: "coach", requestId: "r" }, "coach"),
        current,
      ),
    ).rejects.toMatchObject({ code: "permission-denied" });
    await expect(
      createStaffProfileHandler(
        request({ userId: "user-1", role: "coach", requestId: "r", academyId: "academy-2" }),
        current,
      ),
    ).rejects.toMatchObject({ code: "invalid-argument" });
  });

  it("does not update claims when the canonical store rejects", async () => {
    const current = services();
    vi.mocked(current.store.setStaffActive).mockRejectedValue(new Error("store failure"));

    await expect(
      setStaffActiveHandler(request({ staffKey: "staff-1", active: false }), current),
    ).rejects.toMatchObject({ code: "internal" });
    expect(current.auth.setCustomUserClaims).not.toHaveBeenCalled();
  });

  it("rejects an administrative claim from another academy before the store mutates", async () => {
    const current = services();
    vi.mocked(current.auth.getUser).mockResolvedValue({
      customClaims: { academyId: "academy-2", role: "administrator" },
    });

    await expect(
      createStaffProfileHandler(
        request({ userId: "user-1", role: "coach", requestId: "request-1" }),
        current,
      ),
    ).rejects.toMatchObject({ code: "permission-denied" });
    expect(current.store.createStaffProfile).not.toHaveBeenCalled();
  });

  it("rejects any existing staff claim from another academy before the store mutates", async () => {
    const current = services();
    vi.mocked(current.auth.getUser).mockResolvedValue({
      customClaims: { academyId: "academy-2", role: "coach" },
    });

    await expect(
      createStaffProfileHandler(
        request({ userId: "user-1", role: "coach", requestId: "request-1" }),
        current,
      ),
    ).rejects.toMatchObject({ code: "permission-denied" });
    expect(current.store.createStaffProfile).not.toHaveBeenCalled();
  });

  it("rejects malformed administrative claims before the store mutates", async () => {
    const current = services();
    vi.mocked(current.auth.getUser).mockResolvedValue({
      customClaims: { academyId: 42, role: "administrator" },
    });

    await expect(
      createStaffProfileHandler(
        request({ userId: "user-1", role: "coach", requestId: "request-1" }),
        current,
      ),
    ).rejects.toMatchObject({ code: "permission-denied" });
    expect(current.store.createStaffProfile).not.toHaveBeenCalled();
  });

  it("retains the shared lock when safe claims cannot be applied", async () => {
    const current = services();
    let retained = false;
    vi.mocked(current.auth.setCustomUserClaims).mockRejectedValue(new Error("auth unavailable"));
    const lockedServices: StaffCallableServices = {
      ...current,
      withClaimsLock: async (_academyId, _actorId, _userId, operation) =>
        operation({
          retain: () => {
            retained = true;
          },
        }),
    };

    await expect(
      createStaffProfileHandler(
        request({ userId: "user-1", role: "coach", requestId: "request-1" }),
        lockedServices,
      ),
    ).rejects.toMatchObject({ code: "internal" });
    expect(retained).toBe(true);
  });

  it("removes the stale staff role and quarantines the profile after a claims failure", async () => {
    const current = services();
    vi.mocked(current.auth.setCustomUserClaims).mockImplementationOnce(async () => {
      throw new Error("auth unavailable");
    });

    await expect(
      createStaffProfileHandler(
        request({ userId: "user-1", role: "coach", requestId: "request-1" }),
        current,
      ),
    ).rejects.toMatchObject({ code: "failed-precondition" });
    expect(current.auth.setCustomUserClaims).toHaveBeenNthCalledWith(2, "user-1", {
      academyId: "academy-1",
    });
    expect(current.store.setStaffActive).toHaveBeenCalledWith({
      academyId: "academy-1",
      actorId: "owner-1",
      staffId: "staff-1",
      active: false,
      now: "2026-08-21T10:00:00Z",
    });
  });

  it("retains the lock when the Firestore quarantine cannot be written", async () => {
    const current = services();
    let retained = false;
    vi.mocked(current.auth.setCustomUserClaims).mockImplementationOnce(async () => {
      throw new Error("auth unavailable");
    });
    vi.mocked(current.store.setStaffActive).mockRejectedValue(new Error("store unavailable"));
    const lockedServices: StaffCallableServices = {
      ...current,
      withClaimsLock: async (_academyId, _actorId, _userId, operation) =>
        operation({
          retain: () => {
            retained = true;
          },
        }),
    };

    await expect(
      createStaffProfileHandler(
        request({ userId: "user-1", role: "coach", requestId: "request-1" }),
        lockedServices,
      ),
    ).rejects.toMatchObject({ code: "internal" });
    expect(retained).toBe(true);
  });

  it("does not overwrite an unrelated Auth change during compensation", async () => {
    const current = services();
    let reads = 0;
    let retained = false;
    vi.mocked(current.auth.getUser).mockImplementation(async () => {
      reads += 1;
      return {
        customClaims:
          reads <= 2
            ? { academyId: "academy-1", role: "adultStudent" }
            : { academyId: "academy-1", role: "headCoach" },
      };
    });
    vi.mocked(current.auth.setCustomUserClaims).mockImplementation(async () => undefined);
    const lockedServices: StaffCallableServices = {
      ...current,
      withClaimsLock: async (_academyId, _actorId, _userId, operation) =>
        operation({
          retain: () => {
            retained = true;
          },
        }),
    };

    await expect(
      createStaffProfileHandler(
        request({ userId: "user-1", role: "coach", requestId: "request-1" }),
        lockedServices,
      ),
    ).rejects.toMatchObject({ code: "internal" });
    expect(current.auth.setCustomUserClaims).toHaveBeenCalledTimes(1);
    expect(current.store.setStaffActive).toHaveBeenCalled();
    expect(retained).toBe(true);
  });

  it("removes the non-administrative claim after deactivation and validates assignments", async () => {
    const current = services();
    vi.mocked(current.store.setStaffActive).mockResolvedValue({
      ...profile,
      active: false,
      status: "inactive",
    });

    await expect(
      setStaffActiveHandler(request({ staffKey: "staff-1", active: false }), current),
    ).resolves.toMatchObject({ active: false });
    expect(current.auth.setCustomUserClaims).toHaveBeenCalledWith("user-1", {
      academyId: "academy-1",
    });

    await expect(
      replaceStaffAssignmentsHandler(
        request({
          staffKey: "staff-1",
          assignments: [{ targetType: "location", targetId: "location-town" }],
        }),
        current,
      ),
    ).resolves.toEqual([]);
  });

  it("lists safe staff projections with an exact empty payload without touching Auth claims", async () => {
    const current = services();

    await expect(listStaffProfilesHandler(request({}), current)).resolves.toEqual([
      {
        staffKey: "staff-1",
        role: "coach",
        active: true,
        status: "active",
        schemaVersion: "1",
      },
    ]);
    expect(current.auth.setCustomUserClaims).not.toHaveBeenCalled();

    await expect(listStaffProfilesHandler(request(null), current)).rejects.toMatchObject({
      code: "invalid-argument",
    });
    await expect(listStaffProfilesHandler(request({ extra: true }), current)).rejects.toMatchObject(
      {
        code: "invalid-argument",
      },
    );
  });

  it("denies anonymous and non-admin listing requests", async () => {
    const current = services();

    await expect(listStaffProfilesHandler({ data: {} } as never, current)).rejects.toMatchObject({
      code: "unauthenticated",
    });
    await expect(listStaffProfilesHandler(request({}, "coach"), current)).rejects.toMatchObject({
      code: "permission-denied",
    });
  });

  it("uses staffKey for every browser mutation parser and returns safe profile projections", async () => {
    const current = services();

    await expect(
      updateStaffProfileHandler(request({ staffKey: "staff-1", role: "headCoach" }), current),
    ).resolves.toEqual({
      staffKey: "staff-1",
      role: "coach",
      active: true,
      status: "active",
      schemaVersion: "1",
    });
    expect(current.store.updateStaffProfile).toHaveBeenCalledWith(
      expect.objectContaining({ staffId: "staff-1" }),
    );

    await expect(
      replaceStaffAvailabilityHandler(
        request({
          staffKey: "staff-1",
          windows: [
            { weekday: 1, startLocal: "17:00", endLocal: "19:00", timezone: "Europe/London" },
          ],
        }),
        current,
      ),
    ).resolves.toEqual([]);
    expect(current.store.replaceStaffAvailability).toHaveBeenCalledWith(
      expect.objectContaining({ staffId: "staff-1" }),
    );

    await expect(
      replaceStaffAssignmentsHandler(request({ staffKey: "staff-1", assignments: [] }), current),
    ).resolves.toEqual([]);
    expect(current.store.replaceStaffAssignments).toHaveBeenCalledWith(
      expect.objectContaining({ staffId: "staff-1" }),
    );
  });

  it("rejects a malformed store projection before returning it to the browser", async () => {
    const current = services();
    vi.mocked(current.store.listStaffProfiles).mockResolvedValue([
      {
        staffKey: "staff-1",
        role: "coach",
        active: true,
        status: "active",
        schemaVersion: "1",
        userId: "private-user",
      } as never,
    ]);

    await expect(listStaffProfilesHandler(request({}), current)).rejects.toMatchObject({
      code: "invalid-argument",
    });
  });

  it("rejects availability and assignment replacement arrays over the shared limit", async () => {
    const current = services();
    const windows = Array.from({ length: 101 }, () => ({
      weekday: 1,
      startLocal: "17:00",
      endLocal: "19:00",
      timezone: "Europe/London",
    }));
    const assignments = Array.from({ length: 101 }, (_, index) => ({
      targetType: "location" as const,
      targetId: `location-${index}`,
    }));

    await expect(
      replaceStaffAvailabilityHandler(request({ staffKey: "staff-1", windows }), current),
    ).rejects.toMatchObject({ code: "invalid-argument" });
    await expect(
      replaceStaffAssignmentsHandler(request({ staffKey: "staff-1", assignments }), current),
    ).rejects.toMatchObject({ code: "invalid-argument" });
    expect(current.store.replaceStaffAvailability).not.toHaveBeenCalled();
    expect(current.store.replaceStaffAssignments).not.toHaveBeenCalled();
  });
});
