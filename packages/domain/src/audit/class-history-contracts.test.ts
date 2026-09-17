import { describe, expect, it } from "vitest";

import {
  classHistoryRegistrationTypes,
  composeClassHistorySentence,
  isClassHistoryRegistrationType,
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
