import { describe, expect, it, vi } from "vitest";

const syntheticAuthUsers = vi.hoisted(() => new Map<string, Record<string, unknown>>());
vi.mock("firebase-admin/auth", () => ({
  getAuth: () => ({ getUser: async (uid: string) => syntheticAuthUsers.get(uid) }),
}));

import { getRegistrationChoiceHandler } from "./registration-choice-callables.js";

function request(data: unknown, role: string, uid = "user-1") {
  syntheticAuthUsers.set(uid, {
    uid,
    disabled: false,
    customClaims: { academyId: "a1", role },
    tokensValidAfterTime: "2020-01-01T00:00:00.000Z",
  });
  return {
    app: { appId: "synthetic-app" },
    auth: { uid, token: { academyId: "a1", role, auth_time: 1_700_000_000 } },
    data,
  } as never;
}

const query = { sessionId: "s1", studentId: "st1" };
const answer = { studentId: "st1", choice: { kind: "intro" }, reason: null } as const;

describe("getRegistrationChoice callable", () => {
  it.each(["owner", "administrator"])("answers %s for one student and one class", async (role) => {
    const read = vi.fn().mockResolvedValue(answer);

    await expect(getRegistrationChoiceHandler(request(query, role), read)).resolves.toEqual(answer);
    expect(read).toHaveBeenCalledWith("a1", query);
  });

  it.each(["headCoach", "coach", "guardian", "adultStudent", "teenStudent"])(
    "refuses %s before reading anything",
    async (role) => {
      const read = vi.fn();

      await expect(getRegistrationChoiceHandler(request(query, role), read)).rejects.toMatchObject({
        code: "permission-denied",
      });
      expect(read).not.toHaveBeenCalled();
    },
  );

  it("refuses an office account whose role has since changed", async () => {
    const read = vi.fn();
    const stale = request(query, "administrator");
    syntheticAuthUsers.set("user-1", {
      uid: "user-1",
      disabled: false,
      customClaims: { academyId: "a1", role: "coach" },
      tokensValidAfterTime: "2020-01-01T00:00:00.000Z",
    });

    await expect(getRegistrationChoiceHandler(stale, read)).rejects.toMatchObject({
      code: "permission-denied",
    });
    expect(read).not.toHaveBeenCalled();
  });

  it("refuses a malformed query from the office", async () => {
    const read = vi.fn();

    await expect(
      getRegistrationChoiceHandler(request({ ...query, membershipId: "m-1" }, "owner"), read),
    ).rejects.toMatchObject({ code: "invalid-argument" });
    expect(read).not.toHaveBeenCalled();
  });
});
