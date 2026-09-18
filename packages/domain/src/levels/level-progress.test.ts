import { describe, expect, it } from "vitest";

import businessCriteriaJson from "../../../../docs/data/ibjjf-levels-business-criteria.sanitized.json";
import observedJson from "../../../../docs/data/ibjjf-levels-observed.sanitized.json";
import { academyDateOf } from "../members/member-profile-contracts";
import {
  buildStudentProgressSummary,
  parseLevelCatalogSource,
  type EvaluationRecord,
} from "./level-contracts";
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

  it("returns 0 rather than NaN when an input is not a finite number", () => {
    expect(
      computeLevelProgress({
        classes: { done: Number.NaN, min: 10 },
        days: { done: 30, min: 30 },
        skills: [],
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

  it("counts the whole promotion day toward the new level, and the day before toward neither", () => {
    // Spec §6.2 compares DATES: a member who trained at 10:00 and 18:00 and was promoted at 12:00
    // has three classes at the new level (the 9 imported are gone), not two. An instant comparison
    // would drop the 10:00 class from both levels.
    expect(
      countClassesAtLevel({
        attendedAt: ["2026-07-01T10:00:00.000Z", "2026-07-01T18:00:00.000Z"],
        currentLevelStartedAt: "2026-07-01T12:00:00.000Z",
        importedBaseline: null,
      }),
    ).toEqual({ imported: 0, bpt: 2, total: 2 });
    expect(
      countClassesAtLevel({
        attendedAt: ["2026-06-30T23:59:59.999Z"],
        currentLevelStartedAt: "2026-07-01T12:00:00.000Z",
        importedBaseline: null,
      }),
    ).toEqual({ imported: 0, bpt: 0, total: 0 });
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

  it("counts a class ON the cutoff day from BPT exactly once, never from the baseline too", () => {
    // The cutoff is the FIRST day counted from BPT attendance; the baseline stops the day before.
    // A class on the cutoff day is therefore one BPT class on top of the baseline, not a duplicate
    // and not a class that vanishes.
    expect(
      countClassesAtLevel({
        attendedAt: ["2026-09-01T06:00:00.000Z"],
        currentLevelStartedAt: "2026-07-01T00:00:00.000Z",
        importedBaseline: { classes: 9, cutoff: "2026-09-01", source: "regyfit-import" },
      }),
    ).toEqual({ imported: 9, bpt: 1, total: 10 });
    expect(
      countClassesAtLevel({
        attendedAt: ["2026-08-31T23:59:59.999Z"],
        currentLevelStartedAt: "2026-07-01T00:00:00.000Z",
        importedBaseline: { classes: 9, cutoff: "2026-09-01", source: "regyfit-import" },
      }),
    ).toEqual({ imported: 9, bpt: 0, total: 9 });
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
  // Every skill the catalogue asks for anywhere, at the top score: what is left is the skips.
  const topScores: Readonly<Record<string, number>> = Object.fromEntries(
    catalog.requirements.map((requirement) => [requirement.skillKey, 5]),
  );
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

  it("names skipped stripes, unmet skill minimums and the age band", () => {
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

  it("names skipped belts, with the noun and the belt/stripe order the dialog shows", () => {
    expect(
      listPromotionGaps({
        ...base,
        toDefinitionKey: "purple-belt",
        classesDone: 9999,
        daysDone: 9999,
      }),
    ).toEqual(["Skips 1 belt", "Skips 8 stripes"]);
    expect(
      listPromotionGaps({
        ...base,
        toDefinitionKey: "brown-belt",
        classesDone: 9999,
        daysDone: 9999,
      }),
    ).toEqual(["Skips 2 belts", "Skips 12 stripes"]);
  });

  /**
   * Review of Task 9 (Major-2): the catalogue lays its four age-band ladders end to end on one
   * global sequence, so skips are counted only inside the target's own ladder. These four cases are
   * pinned against the REAL 171-level catalogue, never a fixture, because the bug was the real
   * catalogue's shape.
   */
  describe("counts skips only inside the target's own age-band ladder", () => {
    it("reports no belt or stripe skip for a child ageing out of the 7–10 ladder", () => {
      // The ordinary next step for a child who has aged out: the last 7–10 white stripe to the
      // teens white belt. Counting the global sequence called this "Skips 5 belts, Skips 40
      // stripes" and forced the head coach to justify a promotion that skips nothing.
      const gaps = listPromotionGaps({
        ...base,
        fromDefinitionKey: "white-7-8-and-8-10yo-8th-stripe",
        toDefinitionKey: "white-belt-teens-10-12-and-13-15-yo",
        classesDone: 9999,
        daysDone: 9999,
        skillScores: topScores,
        ageYears: 11,
      });
      expect(gaps).toEqual([]);
    });

    it("still names a genuine two-belt skip inside the adult ladder", () => {
      expect(
        listPromotionGaps({
          ...base,
          fromDefinitionKey: "white-belt",
          toDefinitionKey: "brown-belt",
          classesDone: 9999,
          daysDone: 9999,
        }),
      ).toEqual(["Skips 2 belts", "Skips 12 stripes"]);
    });

    it("still names a single skipped stripe inside the teens ladder, in the singular", () => {
      expect(
        listPromotionGaps({
          ...base,
          fromDefinitionKey: "white-belt-teens-10-12-and-13-15-yo",
          toDefinitionKey: "white-teens-10-12-and-13-15yo-2nd-stripe",
          classesDone: 9999,
          daysDone: 9999,
          skillScores: topScores,
          ageYears: 13,
        }),
      ).toEqual(["Skips 1 stripe"]);
    });

    it("is empty for a within-ladder move that meets everything", () => {
      expect(
        listPromotionGaps({
          ...base,
          fromDefinitionKey: "white-belt-teens-10-12-and-13-15-yo",
          toDefinitionKey: "white-teens-10-12-and-13-15yo-1st-stripe",
          classesDone: 9999,
          daysDone: 9999,
          skillScores: topScores,
          ageYears: 13,
        }),
      ).toEqual([]);
    });
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
    expect(typeof summary.progressPercent).toBe("number");
  });

  it("is null at the top of the catalogue, where there is no next level to progress towards", () => {
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
    expect(summary.progressPercent).toBeNull();
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

describe("DECISION 6: the latest rating for a skill is the one that counts", () => {
  const current = catalog.definitions[0]!.definitionKey;
  const target = catalog.definitions[1]!.definitionKey;
  const requirements = catalog.requirements.filter((r) => r.definitionKey === target);
  const beltSkill = "tie-the-belt";

  function rating(
    over: Readonly<{
      evaluationId: string;
      skillKey: string;
      score: number;
      evaluatedAt: string;
      studentId?: string;
    }>,
  ): EvaluationRecord {
    return {
      evaluationId: over.evaluationId,
      academyId: "acad-1",
      studentId: over.studentId ?? "student-1",
      sessionId: null,
      definitionKey: current,
      skillKey: over.skillKey,
      score: over.score as EvaluationRecord["score"],
      evidenceNotes: "Rated in the Manage view.",
      evaluatorId: "coach-1",
      evaluatorRole: "coach",
      evaluatedAt: over.evaluatedAt,
      schemaVersion: "1",
      createdAt: over.evaluatedAt,
      createdBy: "coach-1",
      updatedAt: over.evaluatedAt,
      updatedBy: "coach-1",
    };
  }

  /** The operator's own scenario: every required skill at 5, classes met, the level just started. */
  function summaryOf(evaluations: readonly EvaluationRecord[], definitionKey = current) {
    return buildStudentProgressSummary({
      catalog,
      studentId: "student-1",
      currentDefinitionKey: definitionKey,
      evaluations,
      classesAtLevel: { imported: 0, bpt: 4, total: 4 },
      currentLevelStartedAt: "2026-09-18T00:00:00.000Z",
      dateOfBirth: "2020-01-01",
      now: "2026-09-18T00:00:00.000Z",
    });
  }

  const allFive = requirements.map((requirement, index) =>
    rating({
      evaluationId: `eval-${index}`,
      skillKey: requirement.skillKey,
      score: 5,
      evaluatedAt: "2026-09-18T10:00:00.000Z",
    }),
  );

  it("lowers readiness when a coach corrects a rating downward (the operator's scenario)", () => {
    const before = summaryOf(allFive);
    expect(before.progressPercent).toBe(66);
    expect(before.criteria.skills).toEqual({
      total: 11,
      completed: 11,
      met: true,
      percentage: 100,
    });

    const corrected = summaryOf([
      ...allFive,
      rating({
        evaluationId: "eval-correction",
        skillKey: beltSkill,
        score: 1,
        evaluatedAt: "2026-09-18T10:00:01.000Z",
      }),
    ]);
    expect(corrected.progressPercent).toBe(65);
    expect(corrected.criteria.skills).toEqual({
      total: 11,
      completed: 10,
      met: false,
      percentage: 91,
    });
    expect(corrected.criteria.overallEligible).toBe(false);
    expect(corrected.skillChecklist.find((item) => item.skillKey === beltSkill)).toMatchObject({
      requiredScore: 2,
      currentScore: 1,
      latestScore: 1,
      isCompleted: false,
      evaluationCount: 2,
      lastEvaluatedAt: "2026-09-18T10:00:01.000Z",
    });
  });

  it("reads a single rating, and both directions of a re-rating, off the latest evaluatedAt", () => {
    const single = summaryOf([
      rating({
        evaluationId: "eval-a",
        skillKey: beltSkill,
        score: 3,
        evaluatedAt: "2026-09-18T10:00:00.000Z",
      }),
    ]).skillChecklist.find((item) => item.skillKey === beltSkill);
    expect(single).toMatchObject({ currentScore: 3, isCompleted: true, evaluationCount: 1 });

    const ascending = summaryOf([
      rating({
        evaluationId: "eval-a",
        skillKey: beltSkill,
        score: 1,
        evaluatedAt: "2026-09-18T10:00:00.000Z",
      }),
      rating({
        evaluationId: "eval-b",
        skillKey: beltSkill,
        score: 4,
        evaluatedAt: "2026-09-18T11:00:00.000Z",
      }),
    ]).skillChecklist.find((item) => item.skillKey === beltSkill);
    expect(ascending).toMatchObject({ currentScore: 4, isCompleted: true, evaluationCount: 2 });

    const descending = summaryOf([
      rating({
        evaluationId: "eval-a",
        skillKey: beltSkill,
        score: 4,
        evaluatedAt: "2026-09-18T10:00:00.000Z",
      }),
      rating({
        evaluationId: "eval-b",
        skillKey: beltSkill,
        score: 1,
        evaluatedAt: "2026-09-18T11:00:00.000Z",
      }),
    ]).skillChecklist.find((item) => item.skillKey === beltSkill);
    expect(descending).toMatchObject({
      currentScore: 1,
      latestScore: 1,
      isCompleted: false,
      evaluationCount: 2,
    });
  });

  it("breaks a tie on evaluatedAt by evaluationId, whatever order the store returned", () => {
    const tied = [
      rating({
        evaluationId: "eval-a",
        skillKey: beltSkill,
        score: 5,
        evaluatedAt: "2026-09-18T10:00:00.000Z",
      }),
      rating({
        evaluationId: "eval-b",
        skillKey: beltSkill,
        score: 1,
        evaluatedAt: "2026-09-18T10:00:00.000Z",
      }),
    ];
    const forwards = summaryOf(tied).skillChecklist.find((item) => item.skillKey === beltSkill);
    const backwards = summaryOf([...tied].reverse()).skillChecklist.find(
      (item) => item.skillKey === beltSkill,
    );
    expect(forwards).toEqual(backwards);
    expect(forwards).toMatchObject({ currentScore: 1, isCompleted: false, evaluationCount: 2 });
  });

  it("leaves a skill that was never rated at zero, and another student's ratings out", () => {
    const summary = summaryOf([
      rating({
        evaluationId: "eval-other",
        skillKey: beltSkill,
        score: 5,
        evaluatedAt: "2026-09-18T10:00:00.000Z",
        studentId: "student-2",
      }),
    ]);
    expect(summary.skillChecklist.find((item) => item.skillKey === beltSkill)).toMatchObject({
      currentScore: 0,
      latestScore: 0,
      isCompleted: false,
      evaluationCount: 0,
      lastEvaluatedAt: null,
    });
    expect(summary.criteria.skills).toEqual({ total: 11, completed: 0, met: false, percentage: 0 });
  });

  it("counts only the required skills that are rated, and ignores ratings of other skills", () => {
    const summary = summaryOf([
      rating({
        evaluationId: "eval-a",
        skillKey: requirements[0]!.skillKey,
        score: 5,
        evaluatedAt: "2026-09-18T10:00:00.000Z",
      }),
      rating({
        evaluationId: "eval-b",
        skillKey: requirements[1]!.skillKey,
        score: 5,
        evaluatedAt: "2026-09-18T10:00:00.000Z",
      }),
      rating({
        evaluationId: "eval-c",
        skillKey: "a-skill-the-next-rank-does-not-require",
        score: 5,
        evaluatedAt: "2026-09-18T10:00:00.000Z",
      }),
    ]);
    expect(summary.criteria.skills).toEqual({
      total: 11,
      completed: 2,
      met: false,
      percentage: 18,
    });
  });

  it("is unaffected by a re-rating at a level whose next rank defines no skill minimums", () => {
    const withoutMinimums = catalog.definitions.find((definition) => {
      const next = catalog.definitions.find((d) => d.sequence === definition.sequence + 1);
      return (
        next !== undefined &&
        !catalog.requirements.some((r) => r.definitionKey === next.definitionKey)
      );
    });
    expect(withoutMinimums).toBeDefined();
    const bare = summaryOf([], withoutMinimums!.definitionKey);
    const rerated = summaryOf(
      [
        rating({
          evaluationId: "eval-a",
          skillKey: beltSkill,
          score: 5,
          evaluatedAt: "2026-09-18T10:00:00.000Z",
        }),
        rating({
          evaluationId: "eval-b",
          skillKey: beltSkill,
          score: 1,
          evaluatedAt: "2026-09-18T11:00:00.000Z",
        }),
      ],
      withoutMinimums!.definitionKey,
    );
    expect(bare.skillChecklist).toHaveLength(0);
    expect(bare.criteria.skills).toEqual({ total: 0, completed: 0, met: true, percentage: 100 });
    expect(rerated.progressPercent).toBe(bare.progressPercent);
    expect(rerated.criteria.skills).toEqual(bare.criteria.skills);
  });
});
