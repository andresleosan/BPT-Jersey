import { describe, expect, it, vi } from "vitest";

const syntheticAuthUsers = vi.hoisted(() => new Map<string, Record<string, unknown>>());
vi.mock("firebase-admin/auth", () => ({
  getAuth: () => ({
    getUser: async (uid: string) => syntheticAuthUsers.get(uid),
  }),
}));
vi.mock("firebase-admin/firestore", () => ({
  getFirestore: () => ({
    doc: (path: string) => ({ path }),
    runTransaction: async (run: (tx: unknown) => Promise<unknown>) =>
      run({
        get: async () => ({ data: () => ({ sessionId: "session-1", capacity: 10 }) }),
      }),
  }),
}));

import { getSessionAgeAvailability } from "./age-capacity";

function fakeRequest(role: string, uid: string, live: { role?: string; validAfter?: string } = {}) {
  syntheticAuthUsers.set(uid, {
    uid,
    disabled: false,
    customClaims: { academyId: "academy-1", role: live.role ?? role },
    tokensValidAfterTime: live.validAfter ?? "2020-01-01T00:00:00.000Z",
  });
  return {
    app: { appId: "synthetic-app" },
    auth: { uid, token: { academyId: "academy-1", role, auth_time: 1_700_000_000 } },
    data: { sessionId: "session-1" },
  } as never;
}

describe("getSessionAgeAvailability", () => {
  it("lets a current staff member read the age occupancy", async () => {
    await expect(getSessionAgeAvailability.run(fakeRequest("coach", "coach-1"))).resolves.toEqual({
      rows: [],
    });
  });

  it("refuses a staff token issued before a demotion or a session revocation (N-03)", async () => {
    await expect(
      getSessionAgeAvailability.run(fakeRequest("coach", "coach-9", { role: "adultStudent" })),
    ).rejects.toMatchObject({ code: "permission-denied" });
    await expect(
      getSessionAgeAvailability.run(
        fakeRequest("headCoach", "coach-10", { validAfter: "2030-01-01T00:00:00.000Z" }),
      ),
    ).rejects.toMatchObject({ code: "unauthenticated" });
  });
});
