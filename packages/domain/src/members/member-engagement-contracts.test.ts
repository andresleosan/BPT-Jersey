import { describe, expect, it } from "vitest";

import {
  buildMemberStreakSummary,
  compareTechniques,
  defaultGoal,
  defaultReward,
  progressBar,
  rankNeighbours,
  seasonStartFor,
  sessionStreak,
} from "./member-engagement-contracts";

const now = "2026-09-16T10:00:00.000Z";

describe("seasonStartFor", () => {
  it("is the most recent 1 September, read on the Jersey calendar", () => {
    expect(seasonStartFor("2026-09-16T10:00:00.000Z")).toBe("2026-09-01");
    // 31 Aug 23:30Z is already 1 Sept 00:30 in Jersey (BST).
    expect(seasonStartFor("2026-08-31T23:30:00.000Z")).toBe("2026-09-01");
    expect(seasonStartFor("2026-08-31T22:30:00.000Z")).toBe("2025-09-01");
    expect(seasonStartFor("2027-03-01T12:00:00.000Z")).toBe("2026-09-01");
  });
});

describe("sessionStreak", () => {
  it("counts consecutive attendances that are at most 7 days apart, newest first", () => {
    const dates = [
      "2026-09-15T18:00:00.000Z",
      "2026-09-10T18:00:00.000Z",
      "2026-09-04T18:00:00.000Z",
      "2026-08-20T18:00:00.000Z", // 15 days before the previous one: breaks the run
      "2026-08-18T18:00:00.000Z",
    ];
    expect(sessionStreak(dates, now)).toBe(3);
  });

  it("accepts the dates in any order and ignores attendances in the future", () => {
    const dates = [
      "2026-09-10T18:00:00.000Z",
      "2026-09-20T18:00:00.000Z",
      "2026-09-15T18:00:00.000Z",
    ];
    expect(sessionStreak(dates, now)).toBe(2);
  });

  it("is 0 when the latest attendance is older than 7 days, or when there is none", () => {
    expect(sessionStreak(["2026-09-01T18:00:00.000Z", "2026-08-30T18:00:00.000Z"], now)).toBe(0);
    expect(sessionStreak([], now)).toBe(0);
  });

  it("treats exactly 7 days as still consecutive", () => {
    expect(sessionStreak(["2026-09-16T09:00:00.000Z", "2026-09-09T09:00:00.000Z"], now)).toBe(2);
  });
});

describe("progressBar", () => {
  it("reports remaining, and `almost` only when exactly one attendance is missing", () => {
    expect(progressBar({ label: "Next goal", target: 10 }, 8)).toEqual({
      label: "Next goal",
      target: 10,
      progress: 8,
      remaining: 2,
      almost: false,
      complete: false,
    });
    expect(progressBar({ label: "Next goal", target: 10 }, 9).almost).toBe(true);
  });

  it("clamps progress at the target and marks it complete", () => {
    const bar = progressBar({ label: "Next reward", target: 5 }, 7);
    expect(bar).toMatchObject({ progress: 5, remaining: 0, almost: false, complete: true });
    expect(Object.isFrozen(bar)).toBe(true);
  });
});

describe("buildMemberStreakSummary", () => {
  it("sums hours and attendances from the season start only, with the default targets", () => {
    const summary = buildMemberStreakSummary({
      now,
      attendances: [
        { occurredAt: "2026-09-15T18:00:00.000Z", durationMinutes: 90 },
        { occurredAt: "2026-09-10T18:00:00.000Z", durationMinutes: 60 },
        { occurredAt: "2026-08-28T18:00:00.000Z", durationMinutes: 60 }, // last season
      ],
    });
    expect(summary).toEqual({
      streakCount: 2,
      seasonStart: "2026-09-01",
      attendancesSinceSeasonStart: 2,
      hoursSinceSeasonStart: 2.5,
      goal: progressBar(defaultGoal, 2),
      reward: progressBar(defaultReward, 2),
    });
    expect(Object.isFrozen(summary)).toBe(true);
  });

  it("uses the targets it is given", () => {
    const summary = buildMemberStreakSummary({
      now,
      attendances: [{ occurredAt: "2026-09-15T18:00:00.000Z", durationMinutes: 60 }],
      goal: { label: "Three classes", target: 2 },
      reward: { label: "Patch", target: 1 },
    });
    expect(summary.goal.almost).toBe(true);
    expect(summary.reward.complete).toBe(true);
  });
});

describe("compareTechniques", () => {
  it("returns what each side has that the other does not, sorted and without duplicates", () => {
    expect(
      compareTechniques(["armbar", "guard-pass", "armbar"], ["guard-pass", "triangle"]),
    ).toEqual({
      theyHave: ["triangle"],
      iHave: ["armbar"],
    });
  });
});

describe("rankNeighbours", () => {
  const entries = [
    { studentId: "a", streak: 9 },
    { studentId: "b", streak: 7 },
    { studentId: "c", streak: 6 },
    { studentId: "me", streak: 5 },
    { studentId: "d", streak: 4 },
    { studentId: "e", streak: 2 },
    { studentId: "f", streak: 1 },
  ];
  const score = (entry: { streak: number }) => entry.streak;

  it("returns the two closest above and the two closest below, ordered by rank", () => {
    const result = rankNeighbours({ entries, currentStudentId: "me", score });
    expect(result?.above.map((entry) => entry.studentId)).toEqual(["b", "c"]);
    expect(result?.current.studentId).toBe("me");
    expect(result?.below.map((entry) => entry.studentId)).toEqual(["d", "e"]);
  });

  it("returns fewer neighbours at the edges and honours a custom span", () => {
    const top = rankNeighbours({ entries, currentStudentId: "a", score });
    expect(top?.above).toEqual([]);
    expect(top?.below.map((entry) => entry.studentId)).toEqual(["b", "c"]);
    const wide = rankNeighbours({ entries, currentStudentId: "me", score, span: 3 });
    expect(wide?.above.map((entry) => entry.studentId)).toEqual(["a", "b", "c"]);
  });

  it("is null when the current student is not in the list", () => {
    expect(rankNeighbours({ entries, currentStudentId: "zz", score })).toBeNull();
  });
});
