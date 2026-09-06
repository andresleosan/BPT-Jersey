import { describe, expect, it } from "vitest";

import businessCriteriaJson from "../../../../docs/data/ibjjf-levels-business-criteria.sanitized.json";
import observedJson from "../../../../docs/data/ibjjf-levels-observed.sanitized.json";
import {
  ageInCompletedYears,
  buildStudentProgressSummary,
  describeAgeBand,
  evaluateAgeBand,
  generateRecognitionCandidates,
  parseLevelCatalogSource,
  type CanonicalLevelCatalog,
  type EvaluationRecord,
  type EvaluationScore,
} from "./level-contracts";

/**
 * T113: the age bands the DOCX fix for every rank of the catalog, applied to recognition proposals.
 * Belts and stripes are still never granted automatically (BRIEF): the band only filters candidates.
 */
const catalogResult = parseLevelCatalogSource(observedJson, businessCriteriaJson);
if (!catalogResult.ok) throw new Error("Catalog parsing failed");
const catalog: CanonicalLevelCatalog = catalogResult.value;

const ordered = [...catalog.definitions].sort((left, right) => left.sequence - right.sequence);
function definition(key: string) {
  const found = ordered.find((entry) => entry.definitionKey === key);
  if (found === undefined) throw new Error(`Missing definition ${key}`);
  return found;
}

// The real crossing of the catalog: the last 4-7 stripe is followed by the first 7-10 belt, so a
// six year old sitting at the top of the younger track is simply not old enough for the next rank.
const lastOfYoungTrack = definition("grey-and-black-4-5-and-5-7yo-11th-stripe");
const firstOfOlderTrack = definition("white-belt-kids-7-8-and-8-10-yo");
// A rank of the younger track, whose own band tops out at 7.
const youngTrackStripe = definition("white-4-5-and-5-7yo-2nd-stripe");

const now = "2026-09-05T12:00:00.000Z";

/** A date of birth that makes somebody exactly `years` old on the day of the calculation. */
function bornForAge(years: number): string {
  return `${2026 - years}-03-01`;
}

/** Every skill the target rank requires, evaluated at the top score, so only the age is left. */
function passingEvaluations(targetKey: string, studentId: string): readonly EvaluationRecord[] {
  return catalog.requirements
    .filter((requirement) => requirement.definitionKey === targetKey)
    .map((requirement, index) =>
      Object.freeze({
        evaluationId: `ev-${index}`,
        academyId: "academy-1",
        studentId,
        sessionId: "session-1",
        definitionKey: targetKey,
        skillKey: requirement.skillKey,
        score: 5 as EvaluationScore,
        evidenceNotes: "Synthetic evidence for the age band tests.",
        evaluatorId: "coach-1",
        evaluatorRole: "headCoach" as const,
        evaluatedAt: "2026-08-01T00:00:00.000Z",
        schemaVersion: "1" as const,
        createdAt: "2026-08-01T00:00:00.000Z",
        createdBy: "coach-1",
        updatedAt: "2026-08-01T00:00:00.000Z",
        updatedBy: "coach-1",
      }),
    );
}

describe("ageInCompletedYears (T113)", () => {
  it("counts completed years, not started ones", () => {
    expect(ageInCompletedYears("2019-09-05", now)).toBe(7);
    expect(ageInCompletedYears("2019-09-06", now)).toBe(6);
    expect(ageInCompletedYears("2019-09-04", now)).toBe(7);
  });

  it("handles a leap-day birth without inventing a day", () => {
    expect(ageInCompletedYears("2016-02-29", "2026-02-28T12:00:00.000Z")).toBe(9);
    expect(ageInCompletedYears("2016-02-29", "2026-03-01T12:00:00.000Z")).toBe(10);
  });

  it("returns null rather than a wrong number", () => {
    expect(ageInCompletedYears("not-a-date", now)).toBeNull();
    expect(ageInCompletedYears("2019-9-5", now)).toBeNull();
    expect(ageInCompletedYears("2030-01-01", now)).toBeNull();
    expect(ageInCompletedYears("2019-09-05", "not-a-time")).toBeNull();
  });
});

describe("evaluateAgeBand (T113)", () => {
  it("is met by anybody when the rank carries no band", () => {
    expect(
      evaluateAgeBand({ criteria: { minAge: null, maxAge: null }, dateOfBirth: null, now }),
    ).toEqual({ requiredMinAge: null, requiredMaxAge: null, ageYears: null, met: true });
  });

  it("is not met when the rank has a band and the date of birth is unknown", () => {
    for (const dateOfBirth of [null, "not-a-date"]) {
      expect(
        evaluateAgeBand({ criteria: { minAge: 7, maxAge: 10 }, dateOfBirth, now }),
      ).toMatchObject({ ageYears: null, met: false });
    }
    // Not supplied at all is the same answer as supplied and unusable.
    expect(evaluateAgeBand({ criteria: { minAge: 7, maxAge: 10 }, now })).toMatchObject({
      ageYears: null,
      met: false,
    });
  });

  it("holds back a student below the minimum and one above the maximum", () => {
    expect(
      evaluateAgeBand({ criteria: { minAge: 7, maxAge: 10 }, dateOfBirth: bornForAge(6), now }).met,
    ).toBe(false);
    expect(
      evaluateAgeBand({ criteria: { minAge: 7, maxAge: 10 }, dateOfBirth: bornForAge(11), now })
        .met,
    ).toBe(false);
  });

  it("treats both ends as inclusive, which is how the bands of the catalog share a boundary", () => {
    // A seven year old belongs to the 4-7 track and to the 7-10 track at once, exactly as the
    // catalog states it.
    expect(
      evaluateAgeBand({ criteria: { minAge: 4, maxAge: 7 }, dateOfBirth: bornForAge(7), now }).met,
    ).toBe(true);
    expect(
      evaluateAgeBand({ criteria: { minAge: 7, maxAge: 10 }, dateOfBirth: bornForAge(7), now }).met,
    ).toBe(true);
    expect(
      evaluateAgeBand({ criteria: { minAge: 4, maxAge: 7 }, dateOfBirth: bornForAge(4), now }).met,
    ).toBe(true);
    expect(
      evaluateAgeBand({ criteria: { minAge: 4, maxAge: 7 }, dateOfBirth: bornForAge(3), now }).met,
    ).toBe(false);
  });

  it("applies an open-ended band on either side", () => {
    expect(
      evaluateAgeBand({ criteria: { minAge: 16, maxAge: null }, dateOfBirth: bornForAge(33), now })
        .met,
    ).toBe(true);
    expect(
      evaluateAgeBand({ criteria: { minAge: 16, maxAge: null }, dateOfBirth: bornForAge(15), now })
        .met,
    ).toBe(false);
    expect(
      evaluateAgeBand({ criteria: { minAge: null, maxAge: 7 }, dateOfBirth: bornForAge(8), now })
        .met,
    ).toBe(false);
  });

  it("is met by anybody when the target rank does not exist", () => {
    expect(evaluateAgeBand({ criteria: null, dateOfBirth: null, now }).met).toBe(true);
  });
});

describe("describeAgeBand (T113)", () => {
  it("names the band a coach is looking at", () => {
    expect(
      describeAgeBand(
        evaluateAgeBand({ criteria: { minAge: 7, maxAge: 10 }, dateOfBirth: bornForAge(6), now }),
      ),
    ).toBe("Age: 6 against band 7-10 (Not met)");
    expect(
      describeAgeBand(
        evaluateAgeBand({
          criteria: { minAge: 16, maxAge: null },
          dateOfBirth: bornForAge(33),
          now,
        }),
      ),
    ).toBe("Age: 33 against band 16+ (Met)");
    expect(
      describeAgeBand(
        evaluateAgeBand({ criteria: { minAge: null, maxAge: 7 }, dateOfBirth: null, now }),
      ),
    ).toBe("Age: band up to 7 required, date of birth unknown (Not met)");
    expect(
      describeAgeBand(
        evaluateAgeBand({ criteria: { minAge: null, maxAge: null }, dateOfBirth: null, now }),
      ),
    ).toBe("Age: no band on this rank (Met)");
  });
});

describe("buildStudentProgressSummary with the age band (T113)", () => {
  const base = {
    catalog,
    studentId: "student-1",
    evaluations: passingEvaluations(firstOfOlderTrack.definitionKey, "student-1"),
    attendedClassesCount: 400,
    currentLevelStartedAt: "2020-01-01T00:00:00.000Z",
    now,
  } as const;

  it("reports the band of the target rank, not of the current one", () => {
    const summary = buildStudentProgressSummary({
      ...base,
      currentDefinitionKey: lastOfYoungTrack.definitionKey,
      dateOfBirth: bornForAge(6),
    });
    expect(summary.targetDefinition?.definitionKey).toBe(firstOfOlderTrack.definitionKey);
    expect(summary.criteria.age).toEqual({
      requiredMinAge: 7,
      requiredMaxAge: 10,
      ageYears: 6,
      met: false,
    });
  });

  it("holds back a student who meets everything else but is too young", () => {
    const summary = buildStudentProgressSummary({
      ...base,
      currentDefinitionKey: lastOfYoungTrack.definitionKey,
      dateOfBirth: bornForAge(6),
    });
    expect(summary.criteria.classes.met).toBe(true);
    expect(summary.criteria.time.met).toBe(true);
    expect(summary.criteria.skills.met).toBe(true);
    expect(summary.criteria.overallEligible).toBe(false);
  });

  it("clears the same student once they reach the band", () => {
    const summary = buildStudentProgressSummary({
      ...base,
      currentDefinitionKey: lastOfYoungTrack.definitionKey,
      dateOfBirth: bornForAge(7),
    });
    expect(summary.criteria.age.met).toBe(true);
    expect(summary.criteria.overallEligible).toBe(true);
  });

  it("holds back a student who has aged out of the track they sit on", () => {
    const nextOfYoungTrack = ordered.find(
      (entry) => entry.sequence === youngTrackStripe.sequence + 1,
    );
    const summary = buildStudentProgressSummary({
      ...base,
      evaluations: passingEvaluations(nextOfYoungTrack!.definitionKey, "student-1"),
      currentDefinitionKey: youngTrackStripe.definitionKey,
      dateOfBirth: bornForAge(9),
    });
    expect(summary.criteria.age).toMatchObject({ requiredMaxAge: 7, ageYears: 9, met: false });
    expect(summary.criteria.overallEligible).toBe(false);
  });

  it("fails closed when the rank has a band and no date of birth was supplied", () => {
    const summary = buildStudentProgressSummary({
      ...base,
      currentDefinitionKey: lastOfYoungTrack.definitionKey,
    });
    expect(summary.criteria.age).toMatchObject({ ageYears: null, met: false });
    expect(summary.criteria.overallEligible).toBe(false);
  });
});

describe("generateRecognitionCandidates with the age band (T113)", () => {
  const attendances = Array.from({ length: 40 }, (_, index) => ({
    studentId: "student-young",
    attendedAt: `2026-0${(index % 8) + 1}-0${(index % 9) + 1}T10:00:00.000Z`,
  }));

  function candidatesFor(age: number, studentId = "student-young") {
    return generateRecognitionCandidates({
      catalog,
      students: [
        {
          studentId,
          studentName: "Synthetic Child",
          currentDefinitionKey: lastOfYoungTrack.definitionKey,
          currentLevelStartedAt: "2020-01-01T00:00:00.000Z",
          dateOfBirth: bornForAge(age),
        },
      ],
      evaluations: passingEvaluations(firstOfOlderTrack.definitionKey, studentId),
      attendances: attendances.map((entry) => ({ ...entry, studentId })),
      now,
    });
  }

  it("does not propose a child who is too young, and says why", () => {
    const [candidate] = candidatesFor(6);
    expect(candidate?.isEligibleForPromotion).toBe(false);
    expect(candidate?.reasons).toContain("Age: 6 against band 7-10 (Not met)");
  });

  it("proposes the same child once they are old enough", () => {
    const [candidate] = candidatesFor(7);
    expect(candidate?.isEligibleForPromotion).toBe(true);
    expect(candidate?.reasons.join(" ")).not.toContain("Age:");
  });

  it("keeps readiness a measure of training, not of birthdays", () => {
    // Getting older is not progress a student makes on the mat, so the bar does not move with it.
    expect(candidatesFor(6)[0]?.readinessPercentage).toBe(candidatesFor(7)[0]?.readinessPercentage);
  });

  it("still proposes nobody automatically: the candidate is a proposal, never a promotion", () => {
    const [candidate] = candidatesFor(7);
    expect(candidate?.targetDefinitionKey).toBe(firstOfOlderTrack.definitionKey);
    expect(candidate?.currentDefinitionKey).toBe(lastOfYoungTrack.definitionKey);
  });
});
