import { describe, expect, it } from "vitest";

import {
  calendarMaxOffsetDays,
  canCancelBooking,
  canViewMemberSession,
  cancelDeadlineLabel,
  clampOffset,
  dateKeyInJersey,
  deriveSessionStatus,
  formatDayHeading,
  formatSessionTimeRange,
  jerseyWeekKey,
  lockedReasonLabel,
  memberGroupLabel,
  nextOffset,
  prevOffset,
  sessionSite,
  visibleDays,
  type CalendarMemberContext,
} from "./member-calendar-contracts";
import type {
  AttendanceRecord,
  BookingRecord,
  ProgramRecord,
  SessionRecord,
} from "./schedule-contracts";

// Wednesday 2026-09-16 14:00 BST (13:00Z)
const wednesday = new Date("2026-09-16T13:00:00Z");
// Saturday 2026-09-19 14:00 BST
const saturday = new Date("2026-09-19T13:00:00Z");
// Sunday 2026-09-20 14:00 BST
const sunday = new Date("2026-09-20T13:00:00Z");

describe("dateKeyInJersey", () => {
  it("uses the Jersey calendar day, not UTC", () => {
    // 23:30Z on the 16th is 00:30 BST on the 17th
    expect(dateKeyInJersey(new Date("2026-09-16T23:30:00Z"))).toBe("2026-09-17");
  });
});

describe("visibleDays / day", () => {
  it("shows today alone", () => {
    const days = visibleDays({ now: wednesday, mode: "day", offset: 0 });
    expect(days.map((d) => d.dateKey)).toEqual(["2026-09-16"]);
    expect(days[0]?.isToday).toBe(true);
    expect(days[0]?.weekday).toBe("Wed");
    expect(days[0]?.dayNumber).toBe(16);
  });

  it("shows the single day offset days from today", () => {
    const days = visibleDays({ now: wednesday, mode: "day", offset: 3 });
    expect(days.map((d) => d.dateKey)).toEqual(["2026-09-19"]);
  });

  it("skips Sunday unless it is included", () => {
    expect(visibleDays({ now: sunday, mode: "day", offset: 0 }).map((d) => d.dateKey)).toEqual([
      "2026-09-21",
    ]);
    expect(visibleDays({ now: wednesday, mode: "day", offset: 4 }).map((d) => d.dateKey)).toEqual([
      "2026-09-21",
    ]);
    expect(
      visibleDays({ now: wednesday, mode: "day", offset: 4, includeSunday: true }).map((d) => d.dateKey),
    ).toEqual(["2026-09-20"]);
  });

  it("gives each day UTC bounds covering the Jersey day", () => {
    const [day] = visibleDays({ now: wednesday, mode: "day", offset: 0 });
    expect(day?.startAt).toBe("2026-09-15T23:00:00.000Z"); // 00:00 BST
    expect(day?.endAt).toBe("2026-09-16T23:00:00.000Z");
  });
});

describe("visibleDays / week", () => {
  it("shows Monday to Saturday of the current week", () => {
    const days = visibleDays({ now: wednesday, mode: "week", offset: 0 });
    expect(days.map((d) => d.dateKey)).toEqual([
      "2026-09-14",
      "2026-09-15",
      "2026-09-16",
      "2026-09-17",
      "2026-09-18",
      "2026-09-19",
    ]);
    expect(days[2]?.isToday).toBe(true);
  });

  it("shows Monday to Sunday when Sunday is included", () => {
    const days = visibleDays({ now: wednesday, mode: "week", offset: 0, includeSunday: true });
    expect(days.map((d) => d.dateKey)).toHaveLength(7);
    expect(days[6]?.dateKey).toBe("2026-09-20");
  });

  it("on Sunday shows the coming week", () => {
    const days = visibleDays({ now: sunday, mode: "week", offset: 0 });
    expect(days[0]?.dateKey).toBe("2026-09-21");
  });

  it("shifts by whole weeks", () => {
    const days = visibleDays({ now: wednesday, mode: "week", offset: 1 });
    expect(days[0]?.dateKey).toBe("2026-09-21");
  });
});

describe("offset navigation", () => {
  it("day: next moves one day, skips Sunday and stops at the cap", () => {
    expect(nextOffset("day", 0, wednesday, true)).toBe(1);
    expect(nextOffset("day", 3, wednesday)).toBe(5); // Wed+4 = Sun → 5
    expect(nextOffset("day", 3, wednesday, true)).toBe(4);
    expect(nextOffset("day", calendarMaxOffsetDays, wednesday)).toBeNull();
    expect(nextOffset("day", calendarMaxOffsetDays - 1, wednesday)).toBe(14);
  });

  it("day: from Saturday the next day shown is Monday unless Sunday is included", () => {
    expect(nextOffset("day", 0, saturday)).toBe(2);
    expect(nextOffset("day", 0, saturday, true)).toBe(1);
  });

  it("day: prev stops at zero", () => {
    expect(prevOffset("day", 0, wednesday)).toBeNull();
    expect(prevOffset("day", 5, wednesday)).toBe(3); // 4 would be Sunday
    expect(prevOffset("day", 5, wednesday, true)).toBe(4);
  });

  it("week: next/prev move one week, capped so Monday ≤ today+14", () => {
    expect(nextOffset("week", 0, wednesday)).toBe(1);
    expect(nextOffset("week", 1, wednesday)).toBe(2); // Mon 28 Sep = today+12 ✓
    expect(nextOffset("week", 2, wednesday)).toBeNull(); // Mon 5 Oct = today+19 ✗
    expect(prevOffset("week", 0, wednesday)).toBeNull();
  });

  it("clampOffset keeps values inside [0, cap]", () => {
    expect(clampOffset("day", -3, wednesday)).toBe(0);
    expect(clampOffset("day", 40, wednesday)).toBe(14);
    expect(clampOffset("week", 9, wednesday)).toBe(2);
  });
});

// ── Status derivation ──

const audit = {
  schemaVersion: "1" as const,
  createdAt: "2026-09-01T00:00:00.000Z",
  createdBy: "seed",
  updatedAt: "2026-09-01T00:00:00.000Z",
  updatedBy: "seed",
};

const teensProgram: ProgramRecord = {
  programId: "prog-teens",
  academyId: "bpt",
  name: "Teens BJJ",
  ageBand: "teens",
  discipline: "bjj",
  level: "all-levels",
  active: true,
  schemaVersion: "1",
};
const openMatProgram: ProgramRecord = {
  ...teensProgram,
  programId: "prog-om",
  name: "Open Mat",
  ageBand: "all",
  discipline: "open-mat",
};
const kidsProgram: ProgramRecord = {
  ...teensProgram,
  programId: "prog-kids",
  name: "Kids BJJ",
  ageBand: "kids",
};

// Wednesday 2026-09-16 18:00 BST = 17:00Z
const session: SessionRecord = {
  sessionId: "s1",
  academyId: "bpt",
  classId: null,
  programId: "prog-teens",
  locationId: "town",
  instructorId: "coach",
  title: "Teens BJJ",
  startAt: "2026-09-16T17:00:00.000Z",
  endAt: "2026-09-16T18:00:00.000Z",
  capacity: 20,
  minParticipants: 4,
  status: "scheduled",
  isSeminar: false,
  cancellationReason: null,
  ...audit,
};

const maya: CalendarMemberContext = {
  studentId: "maya",
  membershipId: "m-maya",
  participantType: "teens",
  planClassSites: ["Town"],
  planOpenMatSites: ["Town"],
  weeklyClassLimit: 2,
};

const booking: BookingRecord = {
  bookingId: "b1",
  academyId: "bpt",
  sessionId: "s1",
  studentId: "maya",
  membershipId: "m-maya",
  status: "confirmed",
  requestedAt: "2026-09-10T10:00:00.000Z",
  cancelledAt: null,
  cancellationReason: null,
  ...audit,
};

function attendance(state: AttendanceRecord["state"]): AttendanceRecord {
  return {
    attendanceId: "a1",
    academyId: "bpt",
    sessionId: "s1",
    studentId: "maya",
    method: "manual",
    state,
    occurredAt: "2026-09-16T17:05:00.000Z",
    notes: null,
    correctionOf: null,
    ...audit,
  };
}

const twoHoursBefore = new Date("2026-09-16T15:00:00Z");
const thirtyMinBefore = new Date("2026-09-16T16:30:00Z");

describe("deriveSessionStatus", () => {
  const base = {
    session,
    program: teensProgram,
    member: maya,
    bookedCount: 3,
    now: twoHoursBefore,
  };

  it("shows paid period limits while retaining previous bookings and attendance", () => {
    const expired = {
      ...base,
      member: {
        ...maya,
        membershipStartsAt: "2026-08-01T00:00:00Z",
        membershipEndsAt: session.startAt,
      },
    };
    expect(deriveSessionStatus(expired)).toEqual({ status: "locked", lockedReason: "paid_period" });
    expect(deriveSessionStatus({ ...expired, booking }).status).toBe("booked");
    expect(deriveSessionStatus({ ...expired, attendance: attendance("attended") }).status).toBe(
      "attended",
    );
    expect(
      deriveSessionStatus({
        ...base,
        member: { ...maya, membershipStartsAt: session.startAt, membershipEndsAt: null },
      }).status,
    ).toBe("open");
  });

  it("is open when in group, bookable and not booked", () => {
    expect(deriveSessionStatus(base)).toEqual({ status: "open" });
  });

  it("locks a private lesson as arranged by the office unless the member is booked on it", () => {
    const privateLesson = { ...base, session: { ...session, accessMode: "private-lesson" as const } };
    expect(deriveSessionStatus(privateLesson)).toEqual({
      status: "locked",
      lockedReason: "office_arranged",
    });
    expect(deriveSessionStatus({ ...privateLesson, booking }).status).toBe("booked");
    expect(lockedReasonLabel("office_arranged", "Town", "adult")).toBe("Arranged by the office");
  });

  it("is booked when a booking is confirmed or requested", () => {
    expect(deriveSessionStatus({ ...base, booking }).status).toBe("booked");
    expect(
      deriveSessionStatus({ ...base, booking: { ...booking, status: "requested" } }).status,
    ).toBe("booked");
  });

  it("ignores a cancelled booking", () => {
    expect(
      deriveSessionStatus({ ...base, booking: { ...booking, status: "cancelled" } }).status,
    ).toBe("open");
  });

  it("is missed only for no_show", () => {
    expect(
      deriveSessionStatus({ ...base, booking, attendance: attendance("no_show") }).status,
    ).toBe("missed");
    expect(deriveSessionStatus({ ...base, booking, attendance: attendance("absent") }).status).toBe(
      "booked",
    );
  });

  it("is attended for attended or late", () => {
    expect(
      deriveSessionStatus({ ...base, booking, attendance: attendance("attended") }).status,
    ).toBe("attended");
    expect(deriveSessionStatus({ ...base, booking, attendance: attendance("late") }).status).toBe(
      "attended",
    );
  });

  it("closes 60 minutes before start when not booked, but a booking stays booked", () => {
    expect(deriveSessionStatus({ ...base, now: thirtyMinBefore }).status).toBe("closed");
    expect(deriveSessionStatus({ ...base, booking, now: thirtyMinBefore }).status).toBe("booked");
  });

  it("closes once the session is active or completed", () => {
    expect(
      deriveSessionStatus({ ...base, session: { ...session, status: "completed" } }).status,
    ).toBe("closed");
  });

  it("is full at capacity when not booked", () => {
    expect(deriveSessionStatus({ ...base, bookedCount: 20 }).status).toBe("full");
  });

  it("locks sessions of another age band", () => {
    expect(
      deriveSessionStatus({
        ...base,
        session: { ...session, programId: "prog-kids" },
        program: kidsProgram,
        bookedCount: 0,
      }),
    ).toEqual({ status: "locked", lockedReason: "age_band" });
  });

  it("locks sessions at a site the plan does not cover", () => {
    expect(
      deriveSessionStatus({ ...base, session: { ...session, locationId: "west" }, bookedCount: 0 }),
    ).toEqual({
      status: "locked",
      lockedReason: "site",
    });
  });

  it("opens one intro session at the selected site without a membership", () => {
    const introMember = {
      ...maya,
      membershipId: null,
      introSite: "Town" as const,
      hasActiveMembership: false,
      hasAttendedIntro: false,
    };

    expect(
      deriveSessionStatus({
        ...base,
        session: { ...session, accessMode: "intro" },
        member: introMember,
      }),
    ).toEqual({ status: "open" });
  });

  it("locks intro sessions after attendance or membership activation", () => {
    const introSession = { ...session, accessMode: "intro" as const };
    const member = {
      ...maya,
      membershipId: null,
      introSite: "Town" as const,
      hasActiveMembership: false,
      hasAttendedIntro: false,
    };

    expect(deriveSessionStatus({ ...base, session: introSession, member: { ...member, hasAttendedIntro: true } })).toEqual({
      status: "locked",
      lockedReason: "paid_period",
    });
    expect(deriveSessionStatus({ ...base, session: introSession, member: { ...member, hasActiveMembership: true } })).toEqual({
      status: "locked",
      lockedReason: "paid_period",
    });
  });

  it("limits intro booking to the selected site", () => {
    expect(
      deriveSessionStatus({
        ...base,
        session: { ...session, accessMode: "intro" },
        member: {
          ...maya,
          membershipId: null,
          introSite: "West",
          hasActiveMembership: false,
          hasAttendedIntro: false,
        },
      }),
    ).toEqual({ status: "locked", lockedReason: "site" });
  });

  it("locks open mats at a site outside the plan's open-mat sites, and allows the covered one", () => {
    const westOpenMat = { ...session, programId: "prog-om", locationId: "west" as const };
    expect(
      deriveSessionStatus({
        ...base,
        session: westOpenMat,
        program: openMatProgram,
        bookedCount: 0,
      }),
    ).toEqual({
      status: "locked",
      lockedReason: "open_mat",
    });
    expect(
      deriveSessionStatus({
        ...base,
        session: { ...westOpenMat, locationId: "town" },
        program: openMatProgram,
        bookedCount: 0,
      }).status,
    ).toBe("open");
  });

  it("locked beats missed (a wrong-group session is never coloured)", () => {
    expect(
      deriveSessionStatus({
        ...base,
        session: { ...session, programId: "prog-kids" },
        program: kidsProgram,
        attendance: attendance("no_show"),
        bookedCount: 0,
      }).status,
    ).toBe("locked");
  });
  it("locks a class once the weekly class limit is used, but never an open mat or a booked class", () => {
    expect(deriveSessionStatus({ ...base, weeklyClassesBooked: 2 })).toEqual({
      status: "locked",
      lockedReason: "weekly_limit",
    });
    expect(deriveSessionStatus({ ...base, weeklyClassesBooked: 1 }).status).toBe("open");
    expect(
      deriveSessionStatus({ ...base, program: openMatProgram, weeklyClassesBooked: 2 }).status,
    ).toBe("open");
    expect(deriveSessionStatus({ ...base, booking, weeklyClassesBooked: 2 }).status).toBe("booked");
    expect(
      deriveSessionStatus({
        ...base,
        member: { ...maya, weeklyClassLimit: null },
        weeklyClassesBooked: 9,
      }).status,
    ).toBe("open");
  });

  it("shows a class past the cut-off as closed, not weekly-limited, when the limit is used", () => {
    expect(deriveSessionStatus({ ...base, now: thirtyMinBefore, weeklyClassesBooked: 2 })).toEqual({
      status: "closed",
    });
  });

  it("closes a session that has no capacity set", () => {
    expect(deriveSessionStatus({ ...base, session: { ...session, capacity: null } }).status).toBe(
      "closed",
    );
  });
});

describe("jerseyWeekKey", () => {
  it("returns the Jersey Monday, including late Sunday UTC that is already Monday in BST", () => {
    expect(jerseyWeekKey("2026-09-16T17:00:00.000Z")).toBe("2026-09-14");
    expect(jerseyWeekKey("2026-09-20T22:30:00.000Z")).toBe("2026-09-14");
    expect(jerseyWeekKey("2026-09-20T23:30:00.000Z")).toBe("2026-09-21");
  });
});

describe("lockedReasonLabel weekly limit", () => {
  it("names the weekly limit", () => {
    expect(lockedReasonLabel("weekly_limit", "Town", "teens")).toBe("Weekly class limit reached");
  });
});

describe("cancel rules and labels", () => {
  it("allows cancelling until exactly 60 minutes before", () => {
    expect(canCancelBooking(session, new Date("2026-09-16T16:00:00Z"))).toBe(true);
    expect(canCancelBooking(session, new Date("2026-09-16T16:00:01Z"))).toBe(false);
  });

  it("labels the deadline and time range in Jersey time", () => {
    expect(cancelDeadlineLabel(session)).toBe("17:00");
    expect(formatSessionTimeRange(session)).toBe("18:00–19:00");
  });

  it("maps sites, groups and locked reasons to copy", () => {
    expect(sessionSite(session)).toBe("Town");
    expect(memberGroupLabel("teens")).toBe("Teens");
    expect(lockedReasonLabel("age_band", "Town", "kids")).toBe("Kids only");
    expect(lockedReasonLabel("site", "Town", "teens")).toBe("Your plan doesn't cover Town");
    expect(lockedReasonLabel("open_mat", "West", "teens")).toBe(
      "Open Mats at West aren't in your plan",
    );
  });

  it("formats a day heading", () => {
    expect(formatDayHeading({ weekday: "Wed", dayNumber: 16 })).toBe("Wednesday 16");
  });
});

// ── Trial access ──

const trial = {
  site: "West" as const,
  allowance: 2 as const,
  attendedCount: 0,
  futureBookings: 0,
  expiresAt: "2026-10-22T10:00:00.000Z",
  status: "active" as const,
};
const trialMember: CalendarMemberContext = {
  ...maya,
  membershipId: null,
  hasActiveMembership: false,
  trial,
  dateOfBirth: "1990-01-01",
};
const westIntro: SessionRecord = { ...session, locationId: "west", accessMode: "intro" };
const westClass: SessionRecord = { ...session, locationId: "west" };

describe("trial calendar access", () => {
  it("lets a 16+ trial member book intro sessions at their site only", () => {
    expect(canViewMemberSession(westIntro, teensProgram, trialMember)).toBe(true);
    expect(
      deriveSessionStatus({
        session: westClass,
        program: teensProgram,
        member: trialMember,
        bookedCount: 0,
        now: twoHoursBefore,
      }).lockedReason,
    ).toBe("trial_intro_only");
    expect(
      deriveSessionStatus({
        session: { ...westIntro, locationId: "town" },
        program: teensProgram,
        member: trialMember,
        bookedCount: 0,
        now: twoHoursBefore,
      }).lockedReason,
    ).toBe("site");
  });

  it("lets an under-16 trial member book classes of their age band", () => {
    const kid = { ...trialMember, dateOfBirth: "2018-01-01" };
    expect(canViewMemberSession(westClass, kidsProgram, kid)).toBe(true);
    expect(
      deriveSessionStatus({
        session: westClass,
        program: { ...teensProgram, ageBand: "adult" },
        member: kid,
        bookedCount: 0,
        now: twoHoursBefore,
      }).lockedReason,
    ).toBe("age_band");
  });

  it("locks everything once the allowance is used or the trial expired", () => {
    const used = { ...trialMember, trial: { ...trial, attendedCount: 1, futureBookings: 1 } };
    expect(
      deriveSessionStatus({
        session: westIntro,
        program: teensProgram,
        member: used,
        bookedCount: 0,
        now: twoHoursBefore,
      }).lockedReason,
    ).toBe("trial_ended");
    const expired = { ...trialMember, trial: { ...trial, status: "expired" as const } };
    expect(
      deriveSessionStatus({
        session: westIntro,
        program: teensProgram,
        member: expired,
        bookedCount: 0,
        now: twoHoursBefore,
      }).lockedReason,
    ).toBe("trial_ended");
  });

  it("still shows a held session as booked after the trial locks", () => {
    const used = { ...trialMember, trial: { ...trial, attendedCount: 1, futureBookings: 1 } };
    const introBooking: BookingRecord = { ...booking, sessionId: westIntro.sessionId, status: "confirmed" };
    expect(
      deriveSessionStatus({
        session: westIntro,
        program: teensProgram,
        member: used,
        booking: introBooking,
        bookedCount: 1,
        now: twoHoursBefore,
      }).status,
    ).toBe("booked");
  });

  it("labels the trial reasons", () => {
    expect(lockedReasonLabel("trial_ended", "West", "all")).toBe(
      "Your trial has ended. Choose a membership to keep training.",
    );
    expect(lockedReasonLabel("trial_intro_only", "West", "all")).toBe(
      "During your trial you can book Introduction Classes only.",
    );
  });
});
