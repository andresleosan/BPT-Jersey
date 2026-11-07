import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  db: {} as Record<string, unknown>,
  users: new Map<string, Record<string, unknown>>(),
}));
vi.mock("firebase-admin/auth", () => ({
  getAuth: () => ({ getUser: async (uid: string) => state.users.get(uid) }),
}));
vi.mock("firebase-admin/firestore", async (importOriginal) => ({
  ...(await importOriginal<typeof import("firebase-admin/firestore")>()),
  getFirestore: () => state.db,
}));

import * as booking from "./booking-transaction-service";
import * as intro from "./intro-booking-service";
import { createStaffWalkInAttendanceHandler } from "./schedule-callables";
import type { ScheduleStore } from "./schedule-service";

describe("office manual attendance callable", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    state.users.clear();
  });

  function fixture(role: string, membership: boolean, alreadyBooked = false) {
    const transaction = {};
    const memberDoc = {
      id: "membership-1",
      data: () => ({
        status: "active",
        startsAt: "2026-01-01T00:00:00.000Z",
        endsAt: null,
        planId: "monthly-plan",
      }),
    };
    const query = (path: string) => ({
      where: () => query(path),
      limit: () => query(path),
      get: async () =>
        path.endsWith("/memberships")
          ? { docs: membership ? [memberDoc] : [] }
          : { empty: !alreadyBooked, docs: alreadyBooked ? [{}] : [] },
    });
    state.db = {
      collection: query,
      doc: (path: string) => ({
        get: async () => ({
          data: () =>
            path.includes("/sessions/")
              ? { status: "scheduled", startAt: new Date().toISOString() }
              : { billingPeriod: "monthly" },
        }),
      }),
      runTransaction: async (body: (tx: unknown) => unknown) => body(transaction),
    };
    state.users.set("staff-1", {
      uid: "staff-1",
      disabled: false,
      customClaims: { academyId: "demo-academy", role },
      tokensValidAfterTime: "2020-01-01T00:00:00.000Z",
    });
    const recordCheckIn = vi.fn().mockResolvedValue({ state: "attended", method: "manual" });
    const confirm = vi
      .spyOn(booking, "confirmBookingInTransaction")
      .mockResolvedValue({ status: "confirmed" } as never);
    const trial = vi
      .spyOn(intro, "requestIntroBooking")
      .mockResolvedValue({ status: "confirmed" } as never);
    const handler = createStaffWalkInAttendanceHandler({
      store: { recordCheckIn } as unknown as ScheduleStore,
    });
    const request = {
      app: { appId: "synthetic-app" },
      auth: {
        uid: "staff-1",
        token: { academyId: "demo-academy", role, auth_time: 1_700_000_000 },
      },
      data: { sessionId: "session-1", studentId: "student-1" },
    };
    return { handler, request, recordCheckIn, confirm, trial };
  }

  it.each([
    ["owner", true],
    ["administrator", true],
    ["owner", false],
    ["administrator", false],
  ] as const)(
    "passes verified %s authority to the correct booking service, membership=%s",
    async (role, membership) => {
      const test = fixture(role, membership);
      await expect(test.handler(test.request as never)).resolves.toEqual({
        attendance: { state: "attended", method: "manual" },
      });
      const expected = {
        academyId: "demo-academy",
        actorId: "staff-1",
        actorRole: role,
        walkIn: true,
      };
      if (membership) {
        expect(test.confirm).toHaveBeenCalledWith(
          expect.objectContaining({
            ...expected,
            request: {
              sessionId: "session-1",
              studentId: "student-1",
              membershipId: "membership-1",
            },
          }),
        );
        expect(test.trial).not.toHaveBeenCalled();
      } else {
        expect(test.trial).toHaveBeenCalledWith(
          state.db,
          expect.objectContaining({
            ...expected,
            sessionId: "session-1",
            studentId: "student-1",
          }),
        );
        expect(test.confirm).not.toHaveBeenCalled();
      }
      expect(test.recordCheckIn).toHaveBeenCalledWith(
        "demo-academy",
        { sessionId: "session-1", studentId: "student-1", method: "manual" },
        "staff-1",
        undefined,
        role,
        null,
      );
    },
  );

  it("records an existing confirmed booking without trying to recreate it", async () => {
    const test = fixture("owner", true, true);
    await test.handler(test.request as never);
    expect(test.confirm).not.toHaveBeenCalled();
    expect(test.trial).not.toHaveBeenCalled();
    expect(test.recordCheckIn).toHaveBeenCalledOnce();
  });

  it.each(["coach", "headCoach"])(
    "ignores browser attempts to make %s an owner or waive age",
    async (role) => {
      const test = fixture(role, true);
      test.confirm.mockRejectedValue(
        new booking.BookingTransactionError("ineligible", "Wrong age", "age-centre"),
      );
      await expect(
        test.handler({
          ...test.request,
          data: {
            ...test.request.data,
            actorRole: "owner",
            walkIn: true,
            groupOverride: true,
            ageEligibilityWaived: true,
          },
        } as never),
      ).rejects.toMatchObject({ code: "failed-precondition" });
      expect(test.confirm).toHaveBeenCalledWith(
        expect.objectContaining({ actorRole: role, walkIn: true }),
      );
      expect(test.confirm.mock.calls[0]?.[0]).not.toHaveProperty("groupOverride");
      expect(test.recordCheckIn).not.toHaveBeenCalled();
    },
  );

  it("refuses a member even if the payload claims owner authority", async () => {
    const test = fixture("adultStudent", true);
    await expect(
      test.handler({
        ...test.request,
        data: {
          ...test.request.data,
          actorRole: "owner",
          walkIn: true,
        },
      } as never),
    ).rejects.toMatchObject({ code: "permission-denied" });
    expect(test.confirm).not.toHaveBeenCalled();
    expect(test.recordCheckIn).not.toHaveBeenCalled();
  });
});
