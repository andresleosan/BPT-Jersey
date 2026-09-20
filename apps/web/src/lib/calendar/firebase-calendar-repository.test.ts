import { beforeEach, describe, expect, it, vi } from "vitest";
import { PLAN_CATALOG } from "@bpt-jersey/domain/memberships";

const schedule = vi.hoisted(() => ({
  listSessions: vi.fn(),
  getScheduleCatalog: vi.fn(),
  listStudentBookings: vi.fn(),
  listStudentAttendance: vi.fn(),
  requestBooking: vi.fn(),
  cancelBooking: vi.fn(),
  selfCheckIn: vi.fn(),
  listSessionBookedCounts: vi.fn(),
}));
const penalties = vi.hoisted(() => ({ listNoShowPenalties: vi.fn() }));
vi.mock("../schedule-client", () => schedule);
vi.mock("../membership-client", () => ({ listAvailableMembershipPlans: async () => PLAN_CATALOG }));
vi.mock("../student-group-access-client", () => ({ getStudentGroupAccess: async (studentId: string) => ({ studentId, programIds: [], revision: 0, dateOfBirth: null }) }));
const waitlist = vi.hoisted(() => ({ listClientMemberships: vi.fn() }));
const family = vi.hoisted(() => ({ getFamily: vi.fn() }));
vi.mock("../waitlist-client", () => waitlist);
vi.mock("../family-client", () => family);
vi.mock("../no-show-penalties-client", () => penalties);

import { createFirebaseCalendarRepository } from "./firebase-calendar-repository";

describe("firebase calendar repository", () => {
  beforeEach(() => {
    waitlist.listClientMemberships.mockResolvedValue([
      { membershipId: "m-1", studentId: "s-1", planId: "bpt-jersey-adult", status: "active", startsAt: "2026-08-01T00:00:00Z", endsAt: "2026-10-01T00:00:00Z" },
    ]);
    schedule.listSessions.mockResolvedValue([{ sessionId: "s1" }]);
    schedule.getScheduleCatalog.mockResolvedValue({
      locations: [],
      programs: [{ programId: "p" }],
    });
    schedule.listStudentBookings.mockResolvedValue([]);
    schedule.listStudentAttendance.mockResolvedValue([]);
    schedule.listSessionBookedCounts.mockResolvedValue({ s1: 20 });
    penalties.listNoShowPenalties.mockResolvedValue([]);
  });

  it("loads the week with real booked counts", async () => {
    const repo = createFirebaseCalendarRepository({
      role: "adultStudent",
      displayName: "Alex Demo",
    });
    const week = await repo.loadWeek("s-1", "2026-09-14T00:00:00.000Z", "2026-09-20T23:59:59.999Z");
    expect(schedule.listSessionBookedCounts).toHaveBeenCalledWith({
      from: "2026-09-14T00:00:00.000Z",
      to: "2026-09-20T23:59:59.999Z",
    });
    expect(week.bookedCounts).toEqual({ s1: 20 });
    expect(week.programs).toEqual([{ programId: "p" }]);
  });

  it("keeps rendering the calendar when booked counts fail to load", async () => {
    schedule.listSessionBookedCounts.mockRejectedValue(new Error("permission-denied"));
    const repo = createFirebaseCalendarRepository({
      role: "adultStudent",
      displayName: "Alex Demo",
    });
    const week = await repo.loadWeek("s-1", "2026-09-14T00:00:00.000Z", "2026-09-20T23:59:59.999Z");
    expect(week.bookedCounts).toEqual({});
    expect(week.sessions).toEqual([{ sessionId: "s1" }]);
  });

  it("keeps member and week data usable when the office-only penalty read is denied", async () => {
    penalties.listNoShowPenalties.mockRejectedValue(new Error("permission-denied"));
    const repo = createFirebaseCalendarRepository({
      role: "adultStudent",
      displayName: "Alex Demo",
    });

    const [member, week, noShowPenalties] = await Promise.all([
      repo.loadMember(),
      repo.loadWeek("s-1", "2026-09-14T00:00:00.000Z", "2026-09-20T23:59:59.999Z"),
      repo.loadPenalties("s-1"),
    ]);

    expect(noShowPenalties).toEqual([]);
    expect(member.participants).toHaveLength(1);
    expect(week.sessions).toEqual([{ sessionId: "s1" }]);
  });

  it("builds the adult participant from the plan catalogue", async () => {
    const repo = createFirebaseCalendarRepository({
      role: "adultStudent",
      displayName: "Alex Demo",
    });
    const member = await repo.loadMember();
    expect(member.participants).toEqual([
      expect.objectContaining({ studentId: "s-1", firstName: "Alex", participantType: "adult", membershipStartsAt: "2026-08-01T00:00:00Z", membershipEndsAt: "2026-10-01T00:00:00Z" }),
    ]);
  });

  it("takes a Town Kids & Teens member's band from their birth date, with the plan's weekly limit", async () => {
    const thirteen = `${new Date().getUTCFullYear() - 13}-01-01`;
    waitlist.listClientMemberships.mockResolvedValue([
      { membershipId: "m-2", studentId: "s-2", planId: "town-kids-2x", status: "active" },
    ]);
    family.getFamily.mockResolvedValue({
      students: [{ studentId: "s-2", fullName: "Maya Demo", dateOfBirth: thirteen }],
    });
    const repo = createFirebaseCalendarRepository({ role: "guardian", displayName: "Jordan Demo" });
    const member = await repo.loadMember();
    expect(member.participants).toEqual([
      expect.objectContaining({
        studentId: "s-2",
        firstName: "Maya",
        participantType: "teens",
        weeklyClassLimit: 2,
      }),
    ]);
  });

  it("delegates member clock-in to the selfCheckIn callable", async () => {
    const input = {
      sessionId: "s-1",
      studentId: "s-1",
      position: { latitude: 49.183954, longitude: -2.107142, accuracyMeters: 12 },
    };
    const attendance = { attendanceId: "s-1__s-1", method: "self" };
    schedule.selfCheckIn.mockResolvedValue(attendance);

    await expect(
      createFirebaseCalendarRepository({ role: "adultStudent", displayName: "Alex Demo" }).clockIn(
        input,
      ),
    ).resolves.toEqual(attendance);
    expect(schedule.selfCheckIn).toHaveBeenCalledWith(input);
  });
});
