import { describe, expect, it, vi } from "vitest";

import type { ClientProfileProjection } from "@bpt-jersey/domain";

import {
  getClientProfileHandler,
  profileCallableOptions,
  saveClientProfileHandler,
  type ProfileCallableServices,
} from "./profile-callables.js";

const projection = {
  user: {
    userId: "user-1",
    academyId: "academy-1",
    accountType: "client",
    displayName: "Synthetic Adult",
    email: "adult@example.test",
    phoneNumber: "+15550000001",
    active: true,
    status: "active",
    schemaVersion: "1",
    createdAt: "2026-08-19T12:00:00.000Z",
    createdBy: "user-1",
    updatedAt: "2026-08-19T12:00:00.000Z",
    updatedBy: "user-1",
  },
  student: {
    studentId: "student-1",
    academyId: "academy-1",
    userId: "user-1",
    fullName: "Synthetic Adult",
    dateOfBirth: "1990-08-19",
    phoneNumber: "+15550000001",
    email: "adult@example.test",
    trainingCenter: "Town",
    trainingTimePreferences: ["evening"],
    participantType: "adult",
    active: true,
    status: "active",
    schemaVersion: "1",
    createdAt: "2026-08-19T12:00:00.000Z",
    createdBy: "user-1",
    updatedAt: "2026-08-19T12:00:00.000Z",
    updatedBy: "user-1",
  },
} as ClientProfileProjection;

const payload = {
  requestId: "profile-request-1",
  fullName: "Synthetic Adult",
  dateOfBirth: "1990-08-19",
  phoneNumber: "+15550000001",
  trainingCenter: "Town",
  trainingTimePreferences: ["evening"],
};

function request(
  data: unknown = payload,
  auth: unknown = {
    uid: "user-1",
    token: { academyId: "academy-1", role: "adultStudent" },
  },
  app: unknown = { appId: "verified-app" },
) {
  return { auth, data, ...(app === null ? {} : { app }) } as never;
}

function services(): ProfileCallableServices & {
  store: NonNullable<ProfileCallableServices["store"]>;
  auth: NonNullable<ProfileCallableServices["auth"]>;
} {
  return {
    auth: {
      getUser: vi.fn(async () => ({
        uid: "user-1",
        disabled: false,
        email: "adult@example.test",
        displayName: "Synthetic Adult",
        customClaims: { academyId: "academy-1", role: "adultStudent" },
      })),
    },
    store: {
      getClientProfile: vi.fn(async () => projection),
      saveClientProfile: vi.fn(async () => projection),
    },
    now: () => "2026-08-19T12:00:00.000Z",
  };
}

describe("profile callables", () => {
  it("configures mandatory App Check and the versioned directory secrets on the wrappers", () => {
    expect(profileCallableOptions).toMatchObject({
      enforceAppCheck: true,
    });
    expect(profileCallableOptions.secrets).toHaveLength(2);
  });

  it("requires an authenticated adult client and derives the tenant from claims", async () => {
    const current = services();

    await expect(saveClientProfileHandler(request(), current)).resolves.toEqual(projection);
    expect(current.auth.getUser).toHaveBeenCalledWith("user-1");
    expect(current.store.saveClientProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        academyId: "academy-1",
        userId: "user-1",
        email: "adult@example.test",
        requestId: "profile-request-1",
      }),
    );
  });

  it("rejects anonymous, malformed-claim, and non-client requests", async () => {
    const current = services();
    await expect(saveClientProfileHandler(request(payload, null), current)).rejects.toMatchObject({
      code: "unauthenticated",
    });
    await expect(
      saveClientProfileHandler(
        request(payload, { uid: "user-1", token: { academyId: "academy-1" } }),
        current,
      ),
    ).rejects.toMatchObject({ code: "permission-denied" });
    await expect(
      saveClientProfileHandler(
        request(payload, { uid: "user-1", token: { academyId: "academy-1", role: "coach" } }),
        current,
      ),
    ).rejects.toMatchObject({ code: "permission-denied" });
  });

  it("requires verified App Check before any Auth or Firestore work", async () => {
    const current = services();
    await expect(
      saveClientProfileHandler(
        request(
          payload,
          { uid: "user-1", token: { academyId: "academy-1", role: "adultStudent" } },
          null,
        ),
        current,
      ),
    ).rejects.toMatchObject({ code: "unauthenticated" });
    await expect(
      getClientProfileHandler(
        request(
          null,
          { uid: "user-1", token: { academyId: "academy-1", role: "adultStudent" } },
          null,
        ),
        current,
      ),
    ).rejects.toMatchObject({ code: "unauthenticated" });
    expect(current.auth.getUser).not.toHaveBeenCalled();
    expect(current.store.saveClientProfile).not.toHaveBeenCalled();
    expect(current.store.getClientProfile).not.toHaveBeenCalled();
  });

  it("rejects client-controlled authority fields and invalid editable fields", async () => {
    const current = services();
    await expect(
      saveClientProfileHandler(request({ ...payload, requestId: "" }), current),
    ).rejects.toMatchObject({ code: "invalid-argument" });
    for (const [field, value] of [
      ["academyId", "academy-2"],
      ["userId", "other-user"],
      ["email", "attacker@example.test"],
      ["active", false],
      ["status", "suspended"],
      ["createdBy", "attacker"],
      ["source", "admin"],
    ] as const) {
      await expect(
        saveClientProfileHandler(request({ ...payload, [field]: value }), current),
      ).rejects.toMatchObject({ code: "invalid-argument" });
    }
    await expect(
      saveClientProfileHandler(
        request({ ...payload, trainingTimePreferences: ["evening", "evening"] }),
        current,
      ),
    ).rejects.toMatchObject({ code: "invalid-argument" });
    expect(current.store.saveClientProfile).not.toHaveBeenCalled();
  });

  it("fails closed when current Auth identity, status, tenant, or role no longer matches", async () => {
    for (const authUser of [
      {
        uid: "other-user",
        disabled: false,
        email: "adult@example.test",
        customClaims: { academyId: "academy-1", role: "adultStudent" },
      },
      {
        uid: "user-1",
        disabled: true,
        email: "adult@example.test",
        customClaims: { academyId: "academy-1", role: "adultStudent" },
      },
      {
        uid: "user-1",
        disabled: false,
        email: "adult@example.test",
        customClaims: { academyId: "academy-2", role: "adultStudent" },
      },
      {
        uid: "user-1",
        disabled: false,
        email: "adult@example.test",
        customClaims: { academyId: "academy-1", role: "guardian" },
      },
    ]) {
      const current = services();
      vi.mocked(current.auth.getUser).mockResolvedValue(authUser);
      await expect(saveClientProfileHandler(request(), current)).rejects.toMatchObject({
        code: "permission-denied",
      });
      expect(current.store.saveClientProfile).not.toHaveBeenCalled();

      const reader = services();
      vi.mocked(reader.auth.getUser).mockResolvedValue(authUser);
      await expect(getClientProfileHandler(request(null), reader)).rejects.toMatchObject({
        code: "permission-denied",
      });
      expect(reader.store.getClientProfile).not.toHaveBeenCalled();
    }
  });

  it("returns a minimal own-profile projection and generic store errors", async () => {
    const current = services();
    await expect(getClientProfileHandler(request(null), current)).resolves.toEqual(projection);
    expect(current.store.getClientProfile).toHaveBeenCalledWith("user-1", "academy-1");

    vi.mocked(current.store.getClientProfile).mockImplementation(async () => {
      throw new Error("contains infrastructure details");
    });
    await expect(getClientProfileHandler(request(null), current)).rejects.toMatchObject({
      code: "internal",
      message: "Unable to load profile",
    });
  });
});
