import { describe, expect, it } from "vitest";
import type { EvaluationRecord, LevelCatalogProjection } from "./level-contracts";
import { buildProgressReport } from "./level-contracts";

const definition = (
  definitionKey: string,
  name: string,
  sequence: number,
  minClasses: number | null,
) => ({
  definitionKey,
  systemId: "test-system",
  kind: "belt" as const,
  parentDefinitionKey: null,
  name,
  sequence,
  stripeNumber: null,
  criteria: { minAge: null, maxAge: null, minClasses, minimumTime: null },
  observedCriteria: { minAge: null, maxAge: null, minClasses: null, minimumTime: null },
  visual: {
    colorMode: 1,
    colors: ["#FFFFFF"],
    stripeColor: null,
    stripeCenter: null,
    stripeWidth: null,
    stripePosition: null,
  },
  observedSkillRequirementSetKey: null,
  observedSkillRequirementsState: "not_observed",
  anomalyFlags: [],
  schemaVersion: 1 as const,
});

const catalog = {
  system: {
    systemId: "test-system",
    displayName: "Test progression",
    schemaVersion: 1,
    precedence: {
      businessRules: "brief",
      hierarchyVisualsAndObservedSkills: "source",
      conflicts: "brief",
    },
    counts: { definitions: 2, belts: 2, stripes: 0 },
    skillCatalog: [
      { key: "guard", displayLabel: "Guard", observedLabel: null, minimumRating: 3, sequence: 1 },
    ],
  },
  definitions: [
    definition("white-0", "White Belt", 0, null),
    definition("white-1", "White Stripe", 1, 1),
  ],
  skills: [
    { key: "guard", displayLabel: "Guard", observedLabel: null, minimumRating: 3, sequence: 1 },
  ],
  requirements: [
    {
      requirementKey: "req-1",
      systemId: "test-system",
      definitionKey: "white-1",
      skillKey: "guard",
      minimumRating: 3,
      inheritance: "replace" as const,
      schemaVersion: 1 as const,
    },
  ],
  sourceHash: "test-hash",
} as unknown as LevelCatalogProjection;

const evaluation: EvaluationRecord = {
  evaluationId: "eval-1",
  academyId: "academy-1",
  studentId: "student-1",
  sessionId: "session-1",
  definitionKey: "white-1",
  skillKey: "guard",
  score: 4,
  evidenceNotes: "Clear evidence in sparring.",
  evaluatorId: "coach-1",
  evaluatorRole: "coach",
  evaluatedAt: "2026-08-20T12:00:00.000Z",
  schemaVersion: "1",
  createdAt: "2026-08-20T12:00:00.000Z",
  createdBy: "coach-1",
  updatedAt: "2026-08-20T12:00:00.000Z",
  updatedBy: "coach-1",
};

describe("buildProgressReport", () => {
  it("aggregates coverage and readiness without returning student identifiers", () => {
    const report = buildProgressReport({
      catalog,
      students: [
        { studentId: "student-1", currentDefinitionKey: "white-0" },
        { studentId: "student-2", currentDefinitionKey: "white-0" },
      ],
      evaluations: [evaluation],
      attendances: [{ studentId: "student-1", attendedAt: "2026-08-20T12:00:00.000Z" }],
      now: "2026-08-23T12:00:00.000Z",
    });

    expect(report.activeStudentCount).toBe(2);
    expect(report.assessedStudentCount).toBe(1);
    expect(report.unassessedStudentCount).toBe(1);
    expect(report.totalEvaluationCount).toBe(1);
    expect(report.assessmentCoveragePercentage).toBe(50);
    expect(report.recognitionCandidateCount).toBe(2);
    expect(report.eligibleForPromotionCount).toBe(1);
    expect(report.skillCoverage[0]).toMatchObject({
      skillKey: "guard",
      assessedStudentCount: 1,
      coveragePercentage: 50,
    });
    expect(JSON.stringify(report)).not.toContain("student-1");
    expect(JSON.stringify(report)).not.toContain("student-2");
  });

  it("returns zero-safe metrics for an empty academy", () => {
    const report = buildProgressReport({
      catalog,
      students: [],
      evaluations: [],
      attendances: [],
      now: "2026-08-23T12:00:00.000Z",
    });

    expect(report.activeStudentCount).toBe(0);
    expect(report.assessmentCoveragePercentage).toBe(0);
    expect(report.levelBreakdown).toEqual([]);
    expect(report.skillCoverage[0]?.coveragePercentage).toBe(0);
  });
});
