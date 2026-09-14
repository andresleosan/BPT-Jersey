import { beforeEach, describe, expect, it, vi } from "vitest";

const schedule = vi.hoisted(() => ({
  listSessions: vi.fn(),
  getScheduleCatalog: vi.fn(),
  listStudentBookings: vi.fn(),
  listStudentAttendance: vi.fn(),
  requestBooking: vi.fn(),
  cancelBooking: vi.fn(),
  listSessionBookedCounts: vi.fn(),
}));
vi.mock("../schedule-client", () => schedule);
vi.mock("../waitlist-client", () => ({
  listClientMemberships: vi
    .fn()
    .mockResolvedValue([{ membershipId: "m-1", studentId: "s-1", planId: "bpt-jersey-adult", status: "active" }]),
}));
vi.mock("../family-client", () => ({ getFamily: vi.fn() }));
vi.mock("../no-show-penalties-client", () => ({ listNoShowPenalties: vi.fn().mockResolvedValue([]) }));

import { createFirebaseCalendarRepository } from "./firebase-calendar-repository";

describe("firebase calendar repository", () => {
  beforeEach(() => {
    schedule.listSessions.mockResolvedValue([{ sessionId: "s1" }]);
    schedule.getScheduleCatalog.mockResolvedValue({ locations: [], programs: [{ programId: "p" }] });
    schedule.listStudentBookings.mockResolvedValue([]);
    schedule.listStudentAttendance.mockResolvedValue([]);
    schedule.listSessionBookedCounts.mockResolvedValue({ s1: 20 });
  });

  it("loads the week with real booked counts", async () => {
    const repo = createFirebaseCalendarRepository({ role: "adultStudent", displayName: "Alex Demo" });
    const week = await repo.loadWeek("s-1", "2026-09-14T00:00:00.000Z", "2026-09-20T23:59:59.999Z");
    expect(schedule.listSessionBookedCounts).toHaveBeenCalledWith({
      from: "2026-09-14T00:00:00.000Z",
      to: "2026-09-20T23:59:59.999Z",
    });
    expect(week.bookedCounts).toEqual({ s1: 20 });
    expect(week.programs).toEqual([{ programId: "p" }]);
  });

  it("builds the adult participant from the plan catalogue", async () => {
    const repo = createFirebaseCalendarRepository({ role: "adultStudent", displayName: "Alex Demo" });
    const member = await repo.loadMember();
    expect(member.participants).toEqual([
      expect.objectContaining({ studentId: "s-1", firstName: "Alex", participantType: "adult" }),
    ]);
  });
});
