import { describe, expect, it, vi } from "vitest";

const syntheticAuthUsers = vi.hoisted(() => new Map<string, Record<string, unknown>>());
const syntheticDocuments = vi.hoisted(() => new Map<string, Record<string, unknown>>());
vi.mock("firebase-admin/auth", () => ({
  getAuth: () => ({
    getUser: async (uid: string) => syntheticAuthUsers.get(uid),
    getUsers: async (ids: readonly { uid: string }[]) => ({
      users: ids.flatMap(({ uid }) =>
        syntheticAuthUsers.has(uid) ? [{ uid, ...syntheticAuthUsers.get(uid) }] : [],
      ),
    }),
  }),
}));
vi.mock("firebase-admin/firestore", () => ({
  getFirestore: () => ({
    collection: () => ({ limit: () => ({}) }),
    runTransaction: async (operation: (transaction: unknown) => unknown) =>
      operation({ get: async () => ({ docs: [] }) }),
    doc: (path: string) => ({ path, id: path.split("/").at(-1) }),
    getAll: async (...refs: readonly { path: string; id: string }[]) =>
      refs.map((ref) => ({
        id: ref.id,
        get: (field: string) => syntheticDocuments.get(ref.path)?.[field],
        data: () => syntheticDocuments.get(ref.path),
      })),
  }),
}));

import type { StaffProfile } from "@bpt-jersey/domain/staff";

import {
  createStaffProfileHandler,
  listStaffProfiles,
  listStaffProfilesHandler,
  replaceStaffAssignmentsHandler,
  replaceStaffAvailabilityHandler,
  setStaffActiveHandler,
  staffCallableServices,
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

function request(data: unknown, role = "owner", uid = "owner-1") {
  return {
    auth: { uid, token: { academyId: "academy-1", role } },
    data,
  } as never;
}

function services(): StaffCallableServices {
  let customClaims = { academyId: "academy-1", role: "adultStudent" };
  return {
    store: {
      getStaffProfile: vi.fn(async () => profile),
      listStaffProfiles: vi.fn(async (_academyId: string, viewerUserId: string) => [
        {
          staffKey: profile.staffId,
          role: profile.role,
          active: profile.active,
          status: profile.status,
          self: profile.userId === viewerUserId,
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
  it.each(["owner", "administrator"])(
    "%s manages coach creation, profiles, assignments, availability and activation",
    async (role) => {
      const current = services();
      await createStaffProfileHandler(
        request({ userId: "user-1", role: "coach", requestId: "request-1" }, role),
        current,
      );
      await updateStaffProfileHandler(
        request({ staffKey: "staff-1", role: "coach" }, role),
        current,
      );
      await replaceStaffAssignmentsHandler(
        request(
          {
            staffKey: "staff-1",
            assignments: [{ targetType: "location", targetId: "location-town" }],
          },
          role,
        ),
        current,
      );
      await replaceStaffAvailabilityHandler(
        request(
          {
            staffKey: "staff-1",
            windows: [
              { weekday: 1, startLocal: "17:00", endLocal: "19:00", timezone: "Europe/London" },
            ],
          },
          role,
        ),
        current,
      );
      vi.mocked(current.store.setStaffActive).mockResolvedValue({
        ...profile,
        active: false,
        status: "inactive",
      });
      await expect(
        setStaffActiveHandler(request({ staffKey: "staff-1", active: false }, role), current),
      ).resolves.toMatchObject({ active: false });
      for (const method of [
        current.store.createStaffProfile,
        current.store.updateStaffProfile,
        current.store.replaceStaffAssignments,
        current.store.replaceStaffAvailability,
        current.store.setStaffActive,
      ]) {
        expect(method).toHaveBeenCalledOnce();
        expect(method).toHaveBeenCalledWith(
          expect.objectContaining({ academyId: "academy-1", actorId: "owner-1" }),
        );
      }
      expect(current.auth.setCustomUserClaims).toHaveBeenLastCalledWith("user-1", {
        academyId: "academy-1",
      });
    },
  );

  it("does not create the retired head-coach role", async () => {
    const current = services();
    await expect(
      createStaffProfileHandler(
        request({ userId: "user-1", role: "headCoach", requestId: "r" }),
        current,
      ),
    ).rejects.toMatchObject({ code: "invalid-argument" });
    expect(current.store.createStaffProfile).not.toHaveBeenCalled();
    expect(current.auth.setCustomUserClaims).not.toHaveBeenCalled();
  });

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
      self: false,
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

  it("ends the old sessions when the staff role changes, promotions included (N-03)", async () => {
    const current = services();
    const revokeRefreshTokens = vi.fn(async () => undefined);
    const withRevoke = { ...current, auth: { ...current.auth, revokeRefreshTokens } };

    // adultStudent -> coach: the old token would be refused by every live check for up to 1 h.
    await createStaffProfileHandler(
      request({ userId: "user-1", role: "coach", requestId: "request-1" }),
      withRevoke,
    );
    expect(revokeRefreshTokens).toHaveBeenCalledWith("user-1");

    revokeRefreshTokens.mockClear();
    await updateStaffProfileHandler(request({ staffKey: "staff-1", role: "coach" }), withRevoke);
    expect(revokeRefreshTokens).not.toHaveBeenCalled();
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
        self: false,
        schemaVersion: "1",
        name: null,
      },
    ]);
    expect(current.store.listStaffProfiles).toHaveBeenCalledWith("academy-1", "owner-1");
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

  it("names each coach for the owner and the headCoach, and keeps the list if names fail", async () => {
    const named = {
      ...services(),
      staffNames: vi.fn(async () => new Map([["staff-1", "Ana Coach"]])),
    };
    for (const role of ["owner", "headCoach"]) {
      await expect(listStaffProfilesHandler(request({}, role), named)).resolves.toEqual([
        expect.objectContaining({ staffKey: "staff-1", name: "Ana Coach" }),
      ]);
    }
    expect(named.staffNames).toHaveBeenCalledWith("academy-1", ["staff-1"]);

    const unnamed = { ...services(), staffNames: vi.fn(async () => new Map<string, string>()) };
    await expect(listStaffProfilesHandler(request({}), unnamed)).resolves.toEqual([
      expect.objectContaining({ staffKey: "staff-1", name: null }),
    ]);
    const failing = {
      ...services(),
      staffNames: vi.fn(async () => Promise.reject(new Error("auth down"))),
    };
    await expect(listStaffProfilesHandler(request({}), failing)).resolves.toEqual([
      expect.objectContaining({ staffKey: "staff-1", name: null }),
    ]);
  });

  it("reads each staff name from Auth, else from the academy profile, and leaves out the rest", async () => {
    syntheticDocuments.set("academies/a-names/staff/coach-1", { userId: "names-uid-1" });
    syntheticDocuments.set("academies/a-names/staff/member-coach", { userId: "names-uid-2" });
    syntheticDocuments.set("academies/a-names/staff/nameless", { userId: "names-uid-3" });
    syntheticDocuments.set("academies/a-names/users/names-uid-2", { displayName: " Ana Member " });
    syntheticAuthUsers.set("names-uid-1", { displayName: "Bo Staff" });
    syntheticAuthUsers.set("names-uid-2", { displayName: "" });
    syntheticAuthUsers.set("names-uid-3", {});
    syntheticDocuments.set("academies/a-names/staff/long", { userId: "names-uid-4" });
    syntheticAuthUsers.set("names-uid-4", { displayName: "x".repeat(300) });

    const names = await staffCallableServices().staffNames!("a-names", [
      "coach-1",
      "member-coach",
      "nameless",
      "missing",
      "long",
    ]);

    expect([...names]).toEqual([
      ["coach-1", "Bo Staff"],
      ["member-coach", "Ana Member"],
      ["long", "x".repeat(200)],
    ]);
  });

  it("denies anonymous and non-admin listing requests", async () => {
    const current = services();

    await expect(listStaffProfilesHandler({ data: {} } as never, current)).rejects.toMatchObject({
      code: "unauthenticated",
    });
    await expect(listStaffProfilesHandler(request({}, "coach"), current)).rejects.toMatchObject({
      code: "permission-denied",
    });
    await expect(listStaffProfilesHandler(request({}, "guardian"), current)).rejects.toMatchObject({
      code: "permission-denied",
    });
  });

  it("lets a head coach read the staff list within their academy (ADR-010, 2026-09-16)", async () => {
    const current = services();

    await expect(listStaffProfilesHandler(request({}, "headCoach"), current)).resolves.toEqual([
      {
        staffKey: "staff-1",
        role: "coach",
        active: true,
        status: "active",
        self: false,
        schemaVersion: "1",
        name: null,
      },
    ]);
    expect(current.store.listStaffProfiles).toHaveBeenCalledWith("academy-1", "owner-1");
    await expect(
      listStaffProfilesHandler(request({ extra: true }, "headCoach"), current),
    ).rejects.toMatchObject({ code: "invalid-argument" });
  });

  it("flags the caller's own profile without ever sending the userId", async () => {
    const current = services();

    // "user-1" owns `staff-1`: the row comes back flagged, and the uid stays on the server.
    const rows = await listStaffProfilesHandler(request({}, "headCoach", "user-1"), current);

    expect(rows).toEqual([
      {
        staffKey: "staff-1",
        role: "coach",
        active: true,
        status: "active",
        self: true,
        schemaVersion: "1",
        name: null,
      },
    ]);
    expect(JSON.stringify(rows)).not.toContain("user-1");
  });

  it("uses staffKey for every browser mutation parser and returns safe profile projections", async () => {
    const current = services();

    await expect(
      updateStaffProfileHandler(request({ staffKey: "staff-1", role: "coach" }), current),
    ).resolves.toEqual({
      staffKey: "staff-1",
      role: "coach",
      active: true,
      status: "active",
      self: false,
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
  it("refuses a staff-list token issued before a demotion or a session revocation (N-03)", async () => {
    const liveRequest = (
      uid: string,
      role: string,
      liveRole: string,
      tokensValidAfterTime: string,
    ) => {
      syntheticAuthUsers.set(uid, {
        uid,
        disabled: false,
        customClaims: { academyId: "academy-1", role: liveRole },
        tokensValidAfterTime,
      });
      return {
        auth: { uid, token: { academyId: "academy-1", role, auth_time: 1_700_000_000 } },
        data: {},
      } as never;
    };
    await expect(
      listStaffProfiles.run(liveRequest("owner-1", "owner", "owner", "2020-01-01T00:00:00.000Z")),
    ).resolves.toEqual([]);
    await expect(
      listStaffProfiles.run(
        liveRequest("head-1", "headCoach", "coach", "2020-01-01T00:00:00.000Z"),
      ),
    ).rejects.toMatchObject({ code: "permission-denied" });
    await expect(
      listStaffProfiles.run(
        liveRequest("admin-9", "administrator", "administrator", "2030-01-01T00:00:00.000Z"),
      ),
    ).rejects.toMatchObject({ code: "unauthenticated" });
  });
});
