import { describe, expect, it, vi } from "vitest";

import { createGetPreClassViewHandler } from "./pre-class-callables";
import { PreClassError, type PreClassService } from "./pre-class-service";
import { scheduleCallableOptions } from "./schedule-callable-options";

function fakeRequest(data: unknown, role = "coach", uid = "staff-1") {
  return { auth: { uid, token: { academyId: "academy-1", role } }, data } as never;
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
