import { describe, expect, it } from "vitest";

import {
  classHistoryRegistrationTypes,
  composeClassHistorySentence,
  formatJerseyMoment,
  isClassHistoryRegistrationType,
  jerseyWallClockToInstant,
  registrationTypeFilter,
} from "./class-history-contracts";

const base = {
  action: "booking.created" as const,
  actorGroup: "member" as const,
  studentName: "Olivia Lewis",
  actorName: "Connor Hoopes",
  programName: "GI Beginners Lunchtime",
  sessionStartAt: "2026-09-16T17:30:00Z",
};

describe("composeClassHistorySentence", () => {
  it("writes the member booking sentence", () => {
    expect(composeClassHistorySentence(base)).toBe(
      "Olivia Lewis booked the class of 16 Sep 2026 at 18:30",
    );
  });

  it("names the staff member who booked on somebody's behalf", () => {
    expect(composeClassHistorySentence({ ...base, actorGroup: "staff" })).toBe(
      "Olivia Lewis was booked by Connor Hoopes into GI Beginners Lunchtime on 16 Sep 2026 at 18:30",
    );
  });

  it("writes the member cancellation sentence", () => {
    expect(composeClassHistorySentence({ ...base, action: "booking.cancelled" })).toBe(
      "Olivia Lewis cancelled the booking for the class of 16 Sep 2026 at 18:30",
    );
  });

  it("writes the drop-in sentences", () => {
    expect(composeClassHistorySentence({ ...base, action: "dropin.created" })).toBe(
      "Olivia Lewis booked a drop-in for the class of 16 Sep 2026 at 18:30",
    );
    expect(composeClassHistorySentence({ ...base, action: "dropin.cancelled" })).toBe(
      "Olivia Lewis cancelled the drop-in for the class of 16 Sep 2026 at 18:30",
    );
  });

  it("writes the attendance sentence", () => {
    expect(
      composeClassHistorySentence({
        ...base,
        action: "attendance.checked_in",
        actorGroup: "staff",
      }),
    ).toBe("Attendance was marked for the class of 16 Sep 2026 at 18:30");
  });

  it("marks attendance without a date when the event carries no class block", () => {
    expect(
      composeClassHistorySentence({
        ...base,
        action: "attendance.checked_in",
        actorGroup: "staff",
        sessionStartAt: null,
      }),
    ).toBe("Attendance was marked");
  });

  it("drops an unparseable session start instead of printing Invalid Date", () => {
    expect(composeClassHistorySentence({ ...base, sessionStartAt: "not-a-date" })).toBe(
      "Olivia Lewis booked the class",
    );
  });

  it("writes the check-out sentence", () => {
    expect(
      composeClassHistorySentence({
        ...base,
        action: "student.checked_out",
        actorGroup: "staff",
      }),
    ).toBe("Olivia Lewis was checked out of the class of 16 Sep 2026 at 18:30");
  });

  it("falls back to Former member when the student is gone", () => {
    expect(composeClassHistorySentence({ ...base, studentName: null })).toBe(
      "Former member booked the class of 16 Sep 2026 at 18:30",
    );
  });

  it("names the system and the class when the actor and the program are unknown", () => {
    expect(
      composeClassHistorySentence({
        ...base,
        actorGroup: "system",
        actorName: null,
        programName: null,
      }),
    ).toBe("Olivia Lewis was booked by the system into the class on 16 Sep 2026 at 18:30");
  });

  it("prints Jersey local time, not UTC", () => {
    // 2026-01-16 is GMT in Jersey; 2026-09-16 is BST (+1).
    expect(composeClassHistorySentence({ ...base, sessionStartAt: "2026-01-16T17:30:00Z" })).toBe(
      "Olivia Lewis booked the class of 16 Jan 2026 at 17:30",
    );
    expect(composeClassHistorySentence(base)).toContain("at 18:30");
  });
});

describe("registrationTypeFilter", () => {
  it("maps the Regyfit registration types to actions and actor groups", () => {
    expect(registrationTypeFilter("member-bookings")).toEqual({
      actions: ["booking.created"],
      groups: ["member"],
    });
    expect(registrationTypeFilter("member-cancellations")).toEqual({
      actions: ["booking.cancelled"],
      groups: ["member"],
    });
    expect(registrationTypeFilter("dropin-bookings")).toEqual({
      actions: ["dropin.created"],
      groups: ["member"],
    });
    expect(registrationTypeFilter("dropin-cancellations")).toEqual({
      actions: ["dropin.cancelled"],
      groups: ["member"],
    });
    expect(registrationTypeFilter("coach-bookings")).toEqual({
      actions: ["booking.created"],
      groups: ["staff"],
    });
    expect(registrationTypeFilter("coach-cancellations")).toEqual({
      actions: ["booking.cancelled"],
      groups: ["staff"],
    });
    expect(registrationTypeFilter("coach-dropin-bookings")).toEqual({
      actions: ["dropin.created"],
      groups: ["staff"],
    });
    expect(registrationTypeFilter("coach-dropin-cancellations")).toEqual({
      actions: ["dropin.cancelled"],
      groups: ["staff"],
    });
    expect(registrationTypeFilter("attendance")).toEqual({
      actions: [
        "attendance.checked_in",
        "attendance.corrected",
        "attendance.proximity_override",
        "student.checked_out",
      ],
      groups: ["staff", "system"],
    });
  });

  it("covers every class action and actor group under all", () => {
    expect(registrationTypeFilter("all")).toEqual({
      actions: [
        "booking.created",
        "booking.cancelled",
        "dropin.created",
        "dropin.cancelled",
        "attendance.checked_in",
        "attendance.corrected",
        "attendance.proximity_override",
        "student.checked_out",
      ],
      groups: ["member", "staff", "system"],
    });
    expect(registrationTypeFilter("all").actions.length).toBe(8);
  });

  it("lists the ten Regyfit registration types and recognises only those", () => {
    expect(classHistoryRegistrationTypes.length).toBe(10);
    expect(isClassHistoryRegistrationType("coach-dropin-cancellations")).toBe(true);
    expect(isClassHistoryRegistrationType("everything")).toBe(false);
  });
});

describe("jerseyWallClockToInstant", () => {
  it("reads a winter wall clock as GMT", () => {
    expect(jerseyWallClockToInstant("2026-01-15", "00:00")).toBe("2026-01-15T00:00:00Z");
    expect(jerseyWallClockToInstant("2026-01-15", "07:30")).toBe("2026-01-15T07:30:00Z");
  });

  it("reads a summer wall clock as BST, an hour ahead of UTC", () => {
    expect(jerseyWallClockToInstant("2026-09-01", "00:00")).toBe("2026-08-31T23:00:00Z");
    expect(jerseyWallClockToInstant("2026-09-01", "07:30")).toBe("2026-09-01T06:30:00Z");
  });

  it("lands on the right side of both 2026 changeovers", () => {
    // BST starts 01:00 UTC on 29 Mar 2026: 00:59 local is still GMT, 02:00 local is already BST.
    expect(jerseyWallClockToInstant("2026-03-29", "00:59")).toBe("2026-03-29T00:59:00Z");
    expect(jerseyWallClockToInstant("2026-03-29", "02:00")).toBe("2026-03-29T01:00:00Z");
    // GMT returns 01:00 UTC on 25 Oct 2026: 00:30 local is BST, 02:00 local is GMT.
    expect(jerseyWallClockToInstant("2026-10-25", "00:30")).toBe("2026-10-24T23:30:00Z");
    expect(jerseyWallClockToInstant("2026-10-25", "02:00")).toBe("2026-10-25T02:00:00Z");
  });

  it("round-trips through formatJerseyMoment", () => {
    const instant = jerseyWallClockToInstant("2026-09-16", "18:30");
    expect(instant).toBe("2026-09-16T17:30:00Z");
    expect(formatJerseyMoment(instant)).toBe("16 Sep 2026 at 18:30");
  });

  it("refuses anything that is not a date and a time", () => {
    expect(jerseyWallClockToInstant("01/09/2026", "00:00")).toBeNull();
    expect(jerseyWallClockToInstant("2026-09-01", "7:30")).toBeNull();
    expect(jerseyWallClockToInstant("2026-09-01", "24:00")).toBeNull();
    expect(jerseyWallClockToInstant("", "")).toBeNull();
  });
});

describe("jerseyWallClockToInstant at the two readings that are not one instant", () => {
  it("resolves the ambiguous autumn hour to the earlier, BST occurrence", () => {
    // 01:30 on 25 Oct 2026 happens twice: 00:30Z on BST and 01:30Z on GMT. A "since" lower bound
    // at the earlier one still contains the later one, so no record in that hour is lost.
    expect(jerseyWallClockToInstant("2026-10-25", "01:30")).toBe("2026-10-25T00:30:00Z");
    expect(jerseyWallClockToInstant("2026-10-25", "01:00")).toBe("2026-10-25T00:00:00Z");
    expect(jerseyWallClockToInstant("2026-10-25", "01:59")).toBe("2026-10-25T00:59:00Z");
  });

  it("resolves the non-existent spring hour forward to 02:00 BST", () => {
    // 01:00-01:59 on 29 Mar 2026 never happens; the clock jumps straight to 02:00 BST, which is
    // 01:00Z - the earliest instant whose Jersey reading is not before the gap.
    expect(jerseyWallClockToInstant("2026-03-29", "01:00")).toBe("2026-03-29T01:00:00Z");
    expect(jerseyWallClockToInstant("2026-03-29", "01:30")).toBe("2026-03-29T01:00:00Z");
    expect(jerseyWallClockToInstant("2026-03-29", "01:59")).toBe("2026-03-29T01:00:00Z");
  });
});
