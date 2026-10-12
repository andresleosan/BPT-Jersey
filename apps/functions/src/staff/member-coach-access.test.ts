import { beforeEach, describe, expect, it, vi } from "vitest";

const syntheticAuthUsers = vi.hoisted(() => new Map<string, Record<string, unknown>>());
const setCustomUserClaims = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("firebase-admin/auth", () => ({
  getAuth: () => ({
    getUser: async (uid: string) => syntheticAuthUsers.get(uid),
    setCustomUserClaims,
  }),
}));
vi.mock("firebase-admin/firestore", () => ({
  getFirestore: () => ({
    doc: (path: string) => ({
      get: async () => ({
        data: () =>
          path === "academies/academy-1/coachMemberAccess/member-1"
            ? {
                userId: "member-1",
                academyId: "academy-1",
                memberRole: "adultStudent",
                grantedAt: "2026-10-01T09:00:00.000Z",
                grantedBy: "owner-1",
                schemaVersion: "1",
              }
            : undefined,
      }),
      update: async () => undefined,
    }),
    collection: () => ({
      where: () => ({ get: async () => ({ docs: [{ data: () => ({ active: true }) }] }) }),
    }),
  }),
}));

import { switchAccessMode } from "./member-coach-access.js";

function liveUser(overrides: Record<string, unknown> = {}) {
  syntheticAuthUsers.set("member-1", {
    uid: "member-1",
    disabled: false,
    customClaims: { academyId: "academy-1", role: "adultStudent" },
    tokensValidAfterTime: "2020-01-01T00:00:00.000Z",
    ...overrides,
  });
}

const request = {
  auth: {
    uid: "member-1",
    token: { academyId: "academy-1", role: "adultStudent", auth_time: 1_700_000_000 },
  },
  data: { mode: "coach" },
} as never;

describe("switchAccessMode", () => {
  beforeEach(() => {
    syntheticAuthUsers.clear();
    setCustomUserClaims.mockClear();
  });

  it("switches an active member with coach access to the coach claim", async () => {
    liveUser();
    await expect(switchAccessMode.run(request)).resolves.toEqual({ switched: true });
    expect(setCustomUserClaims).toHaveBeenCalledWith("member-1", {
      academyId: "academy-1",
      role: "coach",
    });
  });

  it("refuses a disabled account before rewriting its role claim (N-03)", async () => {
    liveUser({ disabled: true });
    await expect(switchAccessMode.run(request)).rejects.toMatchObject({ code: "unauthenticated" });
    expect(setCustomUserClaims).not.toHaveBeenCalled();
  });

  it("refuses a token issued before a session revocation (N-03)", async () => {
    liveUser({ tokensValidAfterTime: "2030-01-01T00:00:00.000Z" });
    await expect(switchAccessMode.run(request)).rejects.toMatchObject({ code: "unauthenticated" });
    expect(setCustomUserClaims).not.toHaveBeenCalled();
  });

  it("refuses a token whose academy no longer matches the live claim (N-03)", async () => {
    liveUser({ customClaims: { academyId: "academy-2", role: "adultStudent" } });
    await expect(switchAccessMode.run(request)).rejects.toMatchObject({
      code: "permission-denied",
    });
    expect(setCustomUserClaims).not.toHaveBeenCalled();
  });
});
