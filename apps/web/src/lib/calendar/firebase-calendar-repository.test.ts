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
const profile = vi.hoisted(() => ({ getClientProfile: vi.fn() }));
const courses = vi.hoisted(() => ({
  courseApi: {
    participants: vi.fn(),
    calendar: vi.fn(),
    absence: vi.fn(),
    checkIn: vi.fn(),
  },
}));
vi.mock("../schedule-client", () => schedule);
vi.mock("../membership-client", () => ({ listAvailableMembershipPlans: async () => PLAN_CATALOG }));
vi.mock("../student-group-access-client", () => ({ getStudentGroupAccess: async (studentId: string) => ({ studentId, programIds: [], revision: 0, dateOfBirth: null }) }));
const waitlist = vi.hoisted(() => ({ listClientMemberships: vi.fn() }));
const family = vi.hoisted(() => ({ getFamily: vi.fn() }));
vi.mock("../waitlist-client", () => waitlist);
vi.mock("../family-client", () => family);
vi.mock("../no-show-penalties-client", () => penalties);
vi.mock("../profile-client", () => profile);
vi.mock("../courses/course-client", () => courses);

import { createFirebaseCalendarRepository } from "./firebase-calendar-repository";

describe("firebase calendar repository", () => {
  beforeEach(() => {
    profile.getClientProfile.mockResolvedValue({
      user: { displayName: "Alex Demo" },
      student: {
        studentId: "s-1", fullName: "Alex Demo", dateOfBirth: "1990-01-01",
        trainingCenter: "Town",
      },
    });
    family.getFamily.mockResolvedValue(undefined);
    courses.courseApi.participants.mockResolvedValue({ items: [], cursor: null });
    courses.courseApi.calendar.mockResolvedValue({
      sessions: [], bookings: [], attendance: [], cursor: null,
    });
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
    await repo.loadMember();
    const week = await repo.loadWeek("s-1", "2026-09-14T00:00:00.000Z", "2026-09-20T23:59:59.999Z");
    expect(schedule.listSessionBookedCounts).toHaveBeenCalledWith({
      from: "2026-09-14T00:00:00.000Z",
      to: "2026-09-20T23:59:59.999Z",
    });
    expect(week.bookedCounts).toEqual({ s1: 20 });
    expect(week.programs).toEqual(expect.arrayContaining([{ programId: "p" }]));
  });

  it("keeps rendering the calendar when booked counts fail to load", async () => {
    schedule.listSessionBookedCounts.mockRejectedValue(new Error("permission-denied"));
    const repo = createFirebaseCalendarRepository({
      role: "adultStudent",
      displayName: "Alex Demo",
    });
    await repo.loadMember();
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

    const member = await repo.loadMember();
    const [week, noShowPenalties] = await Promise.all([
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

  it("loads a canonical adult without membership and only exposes the Intro Class at their centre", async () => {
    waitlist.listClientMemberships.mockResolvedValue([]);
    schedule.listSessions.mockResolvedValue([
      { sessionId: "intro-town", accessMode: "intro", locationId: "town" },
      { sessionId: "intro-west", accessMode: "intro", locationId: "west" },
      { sessionId: "ordinary", accessMode: "membership", locationId: "town" },
    ]);
    const repo = createFirebaseCalendarRepository({ role: "adultStudent", displayName: "Alex Demo" });

    const member = await repo.loadMember();
    const week = await repo.loadWeek("s-1", "2026-09-14T00:00:00.000Z", "2026-09-20T23:59:59.999Z");

    expect(member.participants[0]).toMatchObject({
      studentId: "s-1", membershipId: null, introSite: "Town", hasActiveMembership: false,
    });
    expect(week.sessions).toEqual([{ sessionId: "intro-town", accessMode: "intro", locationId: "town" }]);
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
