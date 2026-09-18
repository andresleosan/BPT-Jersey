import { describe, expect, it } from "vitest";

import businessCriteriaJson from "../../../../docs/data/ibjjf-levels-business-criteria.sanitized.json";
import observedJson from "../../../../docs/data/ibjjf-levels-observed.sanitized.json";
import { academyDateOf } from "../members/member-profile-contracts";
import { buildStudentProgressSummary, parseLevelCatalogSource } from "./level-contracts";
import {
  computeLevelProgress,
  countClassesAtLevel,
  daysAtLevel,
  isLevelCalendarDate,
  jerseyDateOf,
  listPromotionGaps,
  minimumDaysOf,
  skillCategory,
} from "./level-progress";

const catalogResult = parseLevelCatalogSource(observedJson, businessCriteriaJson);
if (!catalogResult.ok) throw new Error("v1 catalogue must parse");
const catalog = catalogResult.value;

describe("computeLevelProgress", () => {
  it("averages capped criteria and floors to an integer", () => {
    expect(
      computeLevelProgress({
        classes: { done: 6, min: 10 },
        days: { done: 30, min: 30 },
        skills: [],
      }),
    ).toBe(80);
    expect(
      computeLevelProgress({
        classes: { done: 40, min: 10 },
        days: { done: 90, min: 30 },
        skills: [],
      }),
    ).toBe(100);
    expect(
      computeLevelProgress({
        classes: { done: 2, min: 3 },
        days: { done: 0, min: null },
        skills: [],
      }),
    ).toBe(66);
  });

  it("weights skills by their required scores and caps each score", () => {
    expect(
      computeLevelProgress({
        classes: { done: 10, min: 10 },
        days: { done: 30, min: 30 },
        skills: [
          { score: 5, required: 3 },
          { score: 1, required: 3 },
        ],
      }),
    ).toBe(88);
  });

  it("excludes criteria without a minimum and returns 100 when nothing is required", () => {
    expect(
      computeLevelProgress({
        classes: { done: 0, min: 0 },
        days: { done: 0, min: null },
        skills: [],
      }),
    ).toBe(100);
    expect(
      computeLevelProgress({
        classes: { done: 29, min: 100 },
        days: { done: 0, min: null },
        skills: [],
      }),
    ).toBe(29);
  });

  it("is 0 when every required criterion has no progress", () => {
    expect(
      computeLevelProgress({
        classes: { done: 0, min: 25 },
        days: { done: 0, min: 90 },
        skills: [{ score: 0, required: 3 }],
      }),
    ).toBe(0);
  });

  it("is exactly 100 when every minimum is exactly met, and no more when over-met", () => {
    const exactlyMet = computeLevelProgress({
      classes: { done: 25, min: 25 },
      days: { done: 90, min: 90 },
      skills: [{ score: 3, required: 3 }],
    });
    const overMet = computeLevelProgress({
      classes: { done: 2_500, min: 25 },
      days: { done: 9_000, min: 90 },
      skills: [{ score: 300, required: 3 }],
    });
    expect(exactlyMet).toBe(100);
    expect(overMet).toBe(100);
  });

  it("caps each criterion on its own, so an over-met one cannot pay for an unmet one", () => {
    // classes 11/10 would be 110% uncapped; capped it is 100%, and the mean stays below 100,
    // so this proves the per-criterion cap without leaning on the final 0-100 clamp.
    expect(
      computeLevelProgress({
        classes: { done: 11, min: 10 },
        days: { done: 0, min: 90 },
        skills: [{ score: 0, required: 3 }],
      }),
    ).toBe(33);
  });

  it("caps each skill on its own, so an over-met skill cannot pay for an unmet one", () => {
    expect(
      computeLevelProgress({
        classes: { done: 0, min: null },
        days: { done: 0, min: null },
        skills: [
          { score: 30, required: 3 },
          { score: 0, required: 3 },
        ],
      }),
    ).toBe(50);
  });

  it("treats an absent component differently from a present but unmet one", () => {
    const absentClasses = computeLevelProgress({
      classes: { done: 0, min: null },
      days: { done: 10, min: 10 },
      skills: [],
    });
    const unmetClasses = computeLevelProgress({
      classes: { done: 0, min: 10 },
      days: { done: 10, min: 10 },
      skills: [],
    });
    expect(absentClasses).toBe(100);
    expect(unmetClasses).toBe(50);
    expect(
      computeLevelProgress({
        classes: { done: 0, min: null },
        days: { done: 0, min: null },
        skills: [{ score: 0, required: 0 }],
      }),
    ).toBe(100);
  });

  it("clamps negative progress to zero instead of subtracting from the mean", () => {
    expect(
      computeLevelProgress({
        classes: { done: -50, min: 10 },
        days: { done: 30, min: 30 },
        skills: [],
      }),
    ).toBe(50);
    expect(
      computeLevelProgress({
        classes: { done: 0, min: null },
        days: { done: 0, min: null },
        skills: [{ score: -9, required: 3 }],
      }),
    ).toBe(0);
  });

  it("always returns an integer inside 0-100", () => {
    for (let done = 0; done <= 37; done += 1) {
      const percent = computeLevelProgress({
        classes: { done, min: 37 },
        days: { done, min: 7 },
        skills: [{ score: done, required: 11 }],
      });
      expect(Number.isInteger(percent)).toBe(true);
      expect(percent).toBeGreaterThanOrEqual(0);
      expect(percent).toBeLessThanOrEqual(100);
    }
  });
});

describe("countClassesAtLevel", () => {
  const attendedAt = [
    "2026-06-30T18:00:00.000Z",
    "2026-08-31T18:00:00.000Z",
    "2026-09-01T06:00:00.000Z",
    "2026-09-05T18:00:00.000Z",
  ];

  it("counts BPT attendance since the level start without a baseline", () => {
    expect(
      countClassesAtLevel({
        attendedAt,
        currentLevelStartedAt: "2026-07-01T00:00:00.000Z",
        importedBaseline: null,
      }),
    ).toEqual({ imported: 0, bpt: 3, total: 3 });
  });

  it("adds the baseline and counts BPT attendance from the cutoff day, once", () => {
    expect(
      countClassesAtLevel({
        attendedAt,
        currentLevelStartedAt: "2026-07-01T00:00:00.000Z",
        importedBaseline: { classes: 9, cutoff: "2026-09-01", source: "regyfit-import" },
      }),
    ).toEqual({ imported: 9, bpt: 2, total: 11 });
  });

  it("stops at an inclusive end day", () => {
    expect(
      countClassesAtLevel({
        attendedAt,
        currentLevelStartedAt: "2026-07-01T00:00:00.000Z",
        importedBaseline: null,
        until: "2026-09-01",
      }),
    ).toEqual({ imported: 0, bpt: 2, total: 2 });
  });

  it("counts every attendance when the level has no start date", () => {
    expect(
      countClassesAtLevel({ attendedAt, currentLevelStartedAt: null, importedBaseline: null }),
    ).toEqual({ imported: 0, bpt: 4, total: 4 });
  });

  it("ignores unparseable attendance instants instead of counting them", () => {
    expect(
      countClassesAtLevel({
        attendedAt: [...attendedAt, "not-a-date", ""],
        currentLevelStartedAt: "2026-07-01T00:00:00.000Z",
        importedBaseline: null,
      }),
    ).toEqual({ imported: 0, bpt: 3, total: 3 });
  });

  it("returns the baseline alone when no BPT attendance qualifies", () => {
    expect(
      countClassesAtLevel({
        attendedAt,
        currentLevelStartedAt: "2027-01-01T00:00:00.000Z",
        importedBaseline: { classes: 42, cutoff: "2027-01-01", source: "regyfit-import" },
      }),
    ).toEqual({ imported: 42, bpt: 0, total: 42 });
  });
});

describe("dates and categories", () => {
  it("measures whole days at a level", () => {
    expect(daysAtLevel("2026-07-01T00:00:00.000Z", "2026-09-10T00:00:00.000Z")).toBe(71);
    expect(daysAtLevel(null, "2026-09-10T00:00:00.000Z")).toBe(0);
    expect(daysAtLevel("2026-09-11T00:00:00.000Z", "2026-09-10T00:00:00.000Z")).toBe(0);
  });

  it("floors a part day and is 0 on the day the level opened", () => {
    expect(daysAtLevel("2026-09-10T00:00:00.000Z", "2026-09-10T23:59:59.000Z")).toBe(0);
    expect(daysAtLevel("2026-09-10T00:00:00.000Z", "2026-09-11T00:00:00.000Z")).toBe(1);
    expect(daysAtLevel("2026-09-10T00:00:00.000Z", "not-a-date")).toBe(0);
  });

  it("converts minimum time with the existing rule", () => {
    expect(minimumDaysOf({ years: 0, months: 2, days: 15 })).toBe(75);
    expect(minimumDaysOf(null)).toBeNull();
  });

  it("converts minimum time exactly as buildStudentProgressSummary always has", () => {
    expect(minimumDaysOf({ years: 2, months: 0, days: 0 })).toBe(730);
    expect(minimumDaysOf({ years: 0, months: 0, days: 0 })).toBe(0);
  });

  it("reads the Jersey calendar day and validates dates", () => {
    expect(jerseyDateOf("2026-09-10T23:30:00.000Z")).toBe("2026-09-11");
    expect(jerseyDateOf("2026-12-10T23:30:00.000Z")).toBe("2026-12-10");
    expect(isLevelCalendarDate("2026-02-28")).toBe(true);
    expect(isLevelCalendarDate("2026-02-30")).toBe(false);
    expect(isLevelCalendarDate("2026-9-1")).toBe(false);
  });

  it("agrees with the academy day helper the member profile already uses", () => {
    for (const instant of [
      "2026-09-10T23:30:00.000Z",
      "2026-12-10T23:30:00.000Z",
      "2026-03-29T00:30:00.000Z",
      "2026-10-25T01:30:00.000Z",
      "2026-01-01T00:00:00.000Z",
    ]) {
      expect(jerseyDateOf(instant)).toBe(academyDateOf(instant));
    }
  });

  it("rejects calendar dates that do not exist and accepts leap days", () => {
    expect(isLevelCalendarDate("2024-02-29")).toBe(true);
    expect(isLevelCalendarDate("2026-02-29")).toBe(false);
    expect(isLevelCalendarDate("2026-13-01")).toBe(false);
    expect(isLevelCalendarDate("2026-00-10")).toBe(false);
    expect(isLevelCalendarDate("2026-04-31")).toBe(false);
    expect(isLevelCalendarDate("2026-09-01T00:00:00.000Z")).toBe(false);
  });

  it("derives skill categories from the label prefix", () => {
    expect(skillCategory("Warm Up 10 - Sprawl Walking Backwards")).toBe("Warm Up");
    expect(skillCategory("Guard Passing - Knee Cut")).toBe("Guard Passing");
    expect(skillCategory("Guard Passing")).toBe("Fundamentals");
    expect(skillCategory("Takedowns & Throws")).toBe("Fundamentals");
  });
});

describe("listPromotionGaps", () => {
  const base = {
    definitions: catalog.definitions,
    requirements: catalog.requirements,
    fromDefinitionKey: "white-belt",
    skillScores: {},
    ageYears: 30,
  };

  it("is empty when the next level is met", () => {
    expect(
      listPromotionGaps({
        ...base,
        toDefinitionKey: "white-1st-stripe",
        classesDone: 25,
        daysDone: 75,
      }),
    ).toEqual([]);
  });

  it("names skipped stripes and unmet criteria in plain text", () => {
    expect(
      listPromotionGaps({
        ...base,
        toDefinitionKey: "white-2nd-stripe",
        classesDone: 11,
        daysDone: 71,
      }),
    ).toEqual(["Skips 1 stripe", "Classes 11/25 not met", "Days 71/75 not met"]);
  });

  it("names skipped belts, unmet skill minimums and the age band", () => {
    expect(
      listPromotionGaps({
        ...base,
        fromDefinitionKey: "white-belt-kids-4-5-and-5-7-yo",
        toDefinitionKey: "white-4-5-and-5-7yo-2nd-stripe",
        classesDone: 4,
        daysDone: 30,
        skillScores: { "tie-the-belt": 2 },
        ageYears: 9,
      }),
    ).toEqual(["Skips 1 stripe", "Skills 1/11 at minimum not met", "Age band not met"]);
    expect(
      listPromotionGaps({ ...base, toDefinitionKey: "blue-belt", classesDone: 50, daysDone: 400 }),
    ).toEqual(["Skips 4 stripes"]);
  });

  it("refuses unknown definitions", () => {
    expect(() =>
      listPromotionGaps({ ...base, toDefinitionKey: "unknown", classesDone: 0, daysDone: 0 }),
    ).toThrow("Level definition is not available");
    expect(() =>
      listPromotionGaps({
        ...base,
        fromDefinitionKey: "unknown",
        toDefinitionKey: "white-1st-stripe",
        classesDone: 0,
        daysDone: 0,
      }),
    ).toThrow("Level definition is not available");
  });

  it("reports no skip for the immediate next level and pluralises counts", () => {
    const immediate = listPromotionGaps({
      ...base,
      toDefinitionKey: "white-1st-stripe",
      classesDone: 0,
      daysDone: 0,
    });
    expect(immediate).not.toContain("Skips 1 stripe");
    expect(
      listPromotionGaps({ ...base, toDefinitionKey: "blue-belt", classesDone: 50, daysDone: 400 }),
    ).toEqual(["Skips 4 stripes"]);
  });

  it("reports the age gap only when the target defines a band", () => {
    // Every v1 definition carries a band, so the bandless branch needs a stripped catalogue.
    const bandless = catalog.definitions.map((definition) => ({
      ...definition,
      criteria: { ...definition.criteria, minAge: null, maxAge: null },
    }));
    expect(
      listPromotionGaps({
        ...base,
        definitions: bandless,
        toDefinitionKey: "white-1st-stripe",
        classesDone: 25,
        daysDone: 75,
        ageYears: null,
      }),
    ).toEqual([]);
    expect(
      listPromotionGaps({
        ...base,
        toDefinitionKey: "white-1st-stripe",
        classesDone: 25,
        daysDone: 75,
        ageYears: null,
      }),
    ).toEqual(["Age band not met"]);
    expect(
      listPromotionGaps({
        ...base,
        toDefinitionKey: "white-1st-stripe",
        classesDone: 25,
        daysDone: 75,
        ageYears: 15,
      }),
    ).toEqual(["Age band not met"]);
  });
});

describe("buildStudentProgressSummary with the single formula", () => {
  it("counts the imported baseline and reports progressPercent from computeLevelProgress", () => {
    const summary = buildStudentProgressSummary({
      catalog,
      studentId: "student-1",
      currentDefinitionKey: "white-belt",
      evaluations: [],
      attendedClassesCount: 40,
      classesAtLevel: { imported: 9, bpt: 2, total: 11 },
      currentLevelStartedAt: "2026-07-01T00:00:00.000Z",
      dateOfBirth: "1990-01-01",
      now: "2026-09-10T00:00:00.000Z",
    });
    expect(summary.criteria.classes).toEqual({
      required: 25,
      completed: 11,
      imported: 9,
      met: false,
    });
    expect(summary.criteria.time).toEqual({ requiredDays: 75, elapsedDays: 71, met: false });
    expect(summary.totalAttendedClasses).toBe(40);
    expect(summary.progressPercent).toBe(
      computeLevelProgress({
        classes: { done: 11, min: 25 },
        days: { done: 71, min: 75 },
        skills: [],
      }),
    );
    expect(summary.progressPercent).toBe(69);
  });

  it("is 100 at the top of the catalogue, where there is no next level to progress towards", () => {
    const summary = buildStudentProgressSummary({
      catalog,
      studentId: "student-1",
      currentDefinitionKey: "red-belt",
      evaluations: [],
      attendedClassesCount: 0,
      currentLevelStartedAt: null,
      now: "2026-09-10T00:00:00.000Z",
    });
    expect(summary.targetDefinition).toBeNull();
    expect(summary.progressPercent).toBe(100);
  });

  it("falls back to the total attended count when classesAtLevel is omitted", () => {
    const summary = buildStudentProgressSummary({
      catalog,
      studentId: "student-1",
      currentDefinitionKey: "white-belt",
      evaluations: [],
      attendedClassesCount: 40,
      currentLevelStartedAt: "2026-07-01T00:00:00.000Z",
      dateOfBirth: "1990-01-01",
      now: "2026-09-10T00:00:00.000Z",
    });
    expect(summary.criteria.classes).toEqual({
      required: 25,
      completed: 40,
      imported: 0,
      met: true,
    });
    expect(summary.progressPercent).toBe(
      computeLevelProgress({
        classes: { done: 40, min: 25 },
        days: { done: 71, min: 75 },
        skills: [],
      }),
    );
  });
});
