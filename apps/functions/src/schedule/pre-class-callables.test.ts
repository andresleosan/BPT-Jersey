import { describe, expect, it, vi } from "vitest";

const syntheticAuthUsers = vi.hoisted(() => new Map<string, Record<string, unknown>>());
vi.mock("firebase-admin/auth", () => ({
  getAuth: () => ({
    getUser: async (uid: string) => syntheticAuthUsers.get(uid),
  }),
}));
vi.mock("firebase-admin/firestore", () => ({
  getFirestore: () => ({
    doc: () => ({ get: async () => ({ data: () => ({ courseId: "course-1" }) }) }),
  }),
}));
vi.mock("../courses/course-authorization.js", () => ({
  requireCourseActor: async () => ({ uid: "staff-1", academyId: "academy-1", role: "coach" }),
}));
vi.mock("../courses/course-roster.js", () => ({
  getCourseRoster: async () => ({ session: { sessionId: "session-1" }, attendees: [] }),
}));

import { createGetPreClassViewHandler, getPreClassView } from "./pre-class-callables";
import { PreClassError, type PreClassService } from "./pre-class-service";
import { scheduleCallableOptions } from "./schedule-callable-options";

function fakeRequest(data: unknown, role = "coach", uid = "staff-1") {
  syntheticAuthUsers.set(uid, {
    uid,
    disabled: false,
    customClaims: { academyId: "academy-1", role },
    tokensValidAfterTime: "2020-01-01T00:00:00.000Z",
  });
  return {
    app: { appId: "synthetic-app" },
    auth: { uid, token: { academyId: "academy-1", role, auth_time: 1_700_000_000 } },
    data,
  } as never;
}

function service(overrides: Partial<PreClassService> = {}): PreClassService {
  return {
    getPreClassView: vi.fn().mockResolvedValue({
      session: { sessionId: "session-1" },
      attendees: [],
      evidence: {
        open: true,
        windowDays: 56,
        minAttendances: 2,
        comparableSessionCount: 0,
        bookedCount: 0,
        suggestedCount: 0,
      },
      refreshedAt: "2026-09-08T17:00:00.000Z",
    }),
    ...overrides,
  };
}

describe("pre-class view callable (T114)", () => {
  it("rides the schedule callable options, so App Check is required and consumed", () => {
    expect(scheduleCallableOptions).toMatchObject({
      enforceAppCheck: true,
      consumeAppCheckToken: true,
    });
  });

  it("lets every staff role prepare a class of their own academy", async () => {
    for (const role of ["owner", "administrator", "headCoach", "coach"]) {
      const preClass = service();
      await createGetPreClassViewHandler({ service: preClass })(
        fakeRequest({ sessionId: "session-1" }, role),
      );
      expect(preClass.getPreClassView).toHaveBeenCalledWith({
        academyId: "academy-1",
        sessionId: "session-1",
      });
    }
  });

  it.each(["guardian", "adultStudent"])("refuses %s", async (role) => {
    await expect(
      createGetPreClassViewHandler({ service: service() })(
        fakeRequest({ sessionId: "session-1" }, role, "client-1"),
      ),
    ).rejects.toMatchObject({ code: "permission-denied" });
  });

  it("refuses an unauthenticated caller", async () => {
    await expect(
      createGetPreClassViewHandler({ service: service() })({ data: null } as never),
    ).rejects.toMatchObject({ code: "unauthenticated" });
  });

  it.each([
    ["no payload", null],
    ["a payload that is not an object", "session-1"],
    ["an empty session", { sessionId: "" }],
    ["an unknown key", { sessionId: "session-1", windowDays: 7 }],
  ])("refuses %s", async (_label, data) => {
    await expect(
      createGetPreClassViewHandler({ service: service() })(fakeRequest(data)),
    ).rejects.toMatchObject({ code: "invalid-argument" });
  });

  it("returns the view under a single key", async () => {
    const result = await createGetPreClassViewHandler({ service: service() })(
      fakeRequest({ sessionId: "session-1" }),
    );
    expect(Object.keys(result)).toEqual(["view"]);
  });

  it("refuses a staff token issued before a demotion or a session revocation (N-03)", async () => {
    const preClass = service();
    const demoted = fakeRequest({ sessionId: "session-1" }, "coach", "coach-9");
    syntheticAuthUsers.set("coach-9", {
      uid: "coach-9",
      disabled: false,
      customClaims: { academyId: "academy-1", role: "adultStudent" },
      tokensValidAfterTime: "2020-01-01T00:00:00.000Z",
    });
    await expect(
      createGetPreClassViewHandler({ service: preClass })(demoted),
    ).rejects.toMatchObject({ code: "permission-denied" });
    const revoked = fakeRequest({ sessionId: "session-1" }, "headCoach", "coach-10");
    syntheticAuthUsers.set("coach-10", {
      uid: "coach-10",
      disabled: false,
      customClaims: { academyId: "academy-1", role: "headCoach" },
      tokensValidAfterTime: "2030-01-01T00:00:00.000Z",
    });
    await expect(
      createGetPreClassViewHandler({ service: preClass })(revoked),
    ).rejects.toMatchObject({ code: "unauthenticated" });
    expect(preClass.getPreClassView).not.toHaveBeenCalled();
  });

  it("checks the live session on the course roster path too (N-03)", async () => {
    await expect(getPreClassView.run(fakeRequest({ sessionId: "session-1" }))).resolves.toEqual({
      view: { session: { sessionId: "session-1" }, attendees: [] },
    });
    const revoked = fakeRequest({ sessionId: "session-1" }, "coach", "coach-11");
    syntheticAuthUsers.set("coach-11", {
      uid: "coach-11",
      disabled: false,
      customClaims: { academyId: "academy-1", role: "coach" },
      tokensValidAfterTime: "2030-01-01T00:00:00.000Z",
    });
    await expect(getPreClassView.run(revoked)).rejects.toMatchObject({
      code: "unauthenticated",
    });
  });

  it("translates store failures into safe codes", async () => {
    for (const [code, expected] of [
      ["invalid", "invalid-argument"],
      ["not-found", "not-found"],
      ["tenant", "permission-denied"],
      ["conflict", "failed-precondition"],
    ] as const) {
      await expect(
        createGetPreClassViewHandler({
          service: service({
            getPreClassView: vi.fn().mockRejectedValue(new PreClassError(code, "nope")),
          }),
        })(fakeRequest({ sessionId: "session-1" })),
      ).rejects.toMatchObject({ code: expected });
    }
    await expect(
      createGetPreClassViewHandler({
        service: service({
          getPreClassView: vi.fn().mockRejectedValue(new Error("firestore exploded")),
        }),
      })(fakeRequest({ sessionId: "session-1" })),
    ).rejects.toMatchObject({ code: "internal" });
  });
});
