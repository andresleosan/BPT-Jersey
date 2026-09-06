import { describe, expect, it } from "vitest";

import {
  celebratesOn,
  deriveUpcomingBirthdays,
  parseUpcomingBirthdayQuery,
  upcomingBirthdayDefaultWindowDays,
  upcomingBirthdayMaxWindowDays,
  type UpcomingBirthdayCandidate,
} from "./upcoming-birthday-contracts";

function candidate(
  overrides: Partial<UpcomingBirthdayCandidate> & Pick<UpcomingBirthdayCandidate, "studentId">,
): UpcomingBirthdayCandidate {
  return Object.freeze({
    fullName: "Synthetic Member",
    dateOfBirth: "1990-06-15",
    participantType: "adult",
    trainingCenter: "Town",
    active: true,
    status: "active",
    ...overrides,
  });
}

describe("celebratesOn", () => {
  it("matches the same day and month in any year", () => {
    expect(celebratesOn("1990-06-15", "2026-06-15")).toBe(true);
    expect(celebratesOn("1990-06-15", "2026-06-16")).toBe(false);
  });

  it("greets a 29 February birth on 28 February when the year has no 29th", () => {
    expect(celebratesOn("2000-02-29", "2026-02-28")).toBe(true);
    expect(celebratesOn("2000-02-29", "2028-02-28")).toBe(false);
    expect(celebratesOn("2000-02-29", "2028-02-29")).toBe(true);
  });

  it("rejects malformed dates instead of guessing", () => {
    expect(celebratesOn("1990-13-01", "2026-06-15")).toBe(false);
    expect(celebratesOn("1990-06-15", "not-a-date")).toBe(false);
    expect(celebratesOn("1990-02-30", "2026-02-28")).toBe(false);
  });
});

describe("deriveUpcomingBirthdays", () => {
  it("returns the birthdays inside the window, nearest first", () => {
    const result = deriveUpcomingBirthdays({
      today: "2026-06-15",
      windowDays: 7,
      candidates: [
        candidate({ studentId: "s-far", fullName: "Far Away", dateOfBirth: "1994-06-20" }),
        candidate({ studentId: "s-today", fullName: "Today", dateOfBirth: "1994-06-15" }),
        candidate({ studentId: "s-tomorrow", fullName: "Tomorrow", dateOfBirth: "2015-06-16" }),
      ],
    });
    expect(result.map((entry) => [entry.displayName, entry.daysAway])).toEqual([
      ["Today", 0],
      ["Tomorrow", 1],
      ["Far Away", 5],
    ]);
    // The age reached, never the year it was derived from.
    expect(result.map((entry) => entry.turningAge)).toEqual([32, 11, 32]);
    expect(JSON.stringify(result)).not.toContain("1994");
  });

  it("carries the age reached but never the date of birth (T112, 2026-09-06)", () => {
    const [entry] = deriveUpcomingBirthdays({
      today: "2026-06-15",
      windowDays: 1,
      candidates: [candidate({ studentId: "s-1", dateOfBirth: "1994-06-15" })],
    });
    expect(entry).toEqual({
      studentId: "s-1",
      displayName: "Synthetic Member",
      daysAway: 0,
      turningAge: 32,
      participantType: "adult",
      trainingCenter: "Town",
    });
    expect(JSON.stringify(entry)).not.toContain("1994");
  });

  it("leaves out anybody past the window", () => {
    expect(
      deriveUpcomingBirthdays({
        today: "2026-06-15",
        windowDays: 3,
        candidates: [candidate({ studentId: "s-1", dateOfBirth: "1994-06-20" })],
      }),
    ).toEqual([]);
  });

  it("crosses a month and a year border without arithmetic on the text", () => {
    expect(
      deriveUpcomingBirthdays({
        today: "2026-12-29",
        windowDays: 7,
        candidates: [
          candidate({ studentId: "s-newyear", fullName: "New Year", dateOfBirth: "1988-01-02" }),
          candidate({ studentId: "s-eve", fullName: "Eve", dateOfBirth: "1988-12-31" }),
        ],
      }).map((entry) => [entry.displayName, entry.daysAway]),
    ).toEqual([
      ["Eve", 2],
      ["New Year", 4],
    ]);
  });

  it("greets a leap-day member on 28 February in a common year", () => {
    expect(
      deriveUpcomingBirthdays({
        today: "2026-02-26",
        windowDays: 7,
        candidates: [candidate({ studentId: "s-leap", dateOfBirth: "2000-02-29" })],
      }).map((entry) => entry.daysAway),
    ).toEqual([2]);
  });

  it("skips members who are no longer active", () => {
    expect(
      deriveUpcomingBirthdays({
        today: "2026-06-15",
        windowDays: 7,
        candidates: [
          candidate({ studentId: "s-inactive", dateOfBirth: "1994-06-15", active: false }),
          candidate({ studentId: "s-suspended", dateOfBirth: "1994-06-15", status: "suspended" }),
        ],
      }),
    ).toEqual([]);
  });

  it("skips a malformed row instead of hiding everybody else", () => {
    const result = deriveUpcomingBirthdays({
      today: "2026-06-15",
      windowDays: 7,
      candidates: [
        candidate({ studentId: "s-broken", dateOfBirth: "not-a-date" }),
        candidate({ studentId: "s-nosite", dateOfBirth: "1994-06-15", trainingCenter: "North" }),
        candidate({ studentId: "s-blank", dateOfBirth: "1994-06-15", fullName: "   " }),
        candidate({ studentId: "s-good", fullName: "Good", dateOfBirth: "1994-06-15" }),
      ],
    });
    expect(result.map((entry) => entry.studentId)).toEqual(["s-good"]);
  });

  it("filters by site when the coach picks one", () => {
    const candidates = [
      candidate({ studentId: "s-town", fullName: "Town", dateOfBirth: "1994-06-15" }),
      candidate({
        studentId: "s-west",
        fullName: "West",
        dateOfBirth: "1994-06-15",
        trainingCenter: "West",
      }),
    ];
    expect(
      deriveUpcomingBirthdays({
        today: "2026-06-15",
        windowDays: 7,
        candidates,
        trainingCenter: "West",
      }).map((entry) => entry.studentId),
    ).toEqual(["s-west"]);
    expect(
      deriveUpcomingBirthdays({ today: "2026-06-15", windowDays: 7, candidates }).map(
        (entry) => entry.studentId,
      ),
    ).toEqual(["s-town", "s-west"]);
  });

  it("counts a member once even when the window spans a whole year", () => {
    expect(
      deriveUpcomingBirthdays({
        today: "2026-06-15",
        windowDays: upcomingBirthdayMaxWindowDays,
        candidates: [candidate({ studentId: "s-1", dateOfBirth: "1994-06-15" })],
      }),
    ).toHaveLength(1);
  });

  it("returns nothing for an invalid day or window", () => {
    const candidates = [candidate({ studentId: "s-1", dateOfBirth: "1994-06-15" })];
    expect(deriveUpcomingBirthdays({ today: "2026-13-01", windowDays: 7, candidates })).toEqual([]);
    expect(deriveUpcomingBirthdays({ today: "2026-06-15", windowDays: -1, candidates })).toEqual(
      [],
    );
    expect(
      deriveUpcomingBirthdays({
        today: "2026-06-15",
        windowDays: upcomingBirthdayMaxWindowDays + 1,
        candidates,
      }),
    ).toEqual([]);
  });
});

describe("parseUpcomingBirthdayQuery", () => {
  it("defaults to the whole week with no filter", () => {
    for (const empty of [null, undefined, {}]) {
      const parsed = parseUpcomingBirthdayQuery(empty);
      expect(parsed.ok && parsed.value).toEqual({
        windowDays: upcomingBirthdayDefaultWindowDays,
      });
    }
  });

  it("accepts a site and a window", () => {
    const parsed = parseUpcomingBirthdayQuery({ trainingCenter: "West", windowDays: 0 });
    expect(parsed.ok && parsed.value).toEqual({ trainingCenter: "West", windowDays: 0 });
  });

  it("refuses anything else", () => {
    for (const payload of [
      "Town",
      [],
      { trainingCenter: "North" },
      { trainingCenter: "Town", studentId: "s-1" },
      { windowDays: 1.5 },
      { windowDays: -1 },
      { windowDays: upcomingBirthdayMaxWindowDays + 1 },
    ]) {
      expect(parseUpcomingBirthdayQuery(payload).ok, JSON.stringify(payload)).toBe(false);
    }
  });
});
