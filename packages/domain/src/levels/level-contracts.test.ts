import { describe, expect, it } from "vitest";

import businessCriteriaJson from "../../../../docs/data/ibjjf-levels-business-criteria.sanitized.json";
import observedJson from "../../../../docs/data/ibjjf-levels-observed.sanitized.json";
import {
  buildEvaluationId,
  buildStudentProgressSummary,
  parseLevelCatalogProjection,
  parseLevelCatalogSource,
  parseRecordEvaluationInput,
  type CanonicalLevelCatalog,
  type EvaluationRecord,
  type EvaluationScore,
  type LevelCatalogProjection,
  type RecordEvaluationInput,
  type StudentProgressSummary,
} from "./level-contracts";

describe("Level Contracts", () => {
  it("parses valid observed and business criteria JSON into canonical catalog", () => {
    const result = parseLevelCatalogSource(observedJson, businessCriteriaJson);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected ok result");

    const catalog: CanonicalLevelCatalog = result.value;
    expect(catalog.system.displayName).toBe("JIU-JITSU - IBJJF");
    expect(catalog.system.schemaVersion).toBe(1);
    expect(catalog.definitions).toHaveLength(171);

    const belts = catalog.definitions.filter((d) => d.kind === "belt");
    const stripes = catalog.definitions.filter((d) => d.kind === "stripe");
    expect(belts).toHaveLength(27);
    expect(stripes).toHaveLength(144);

    expect(catalog.skills).toHaveLength(11);
    expect(catalog.requirements).toHaveLength(165);
  });

  it("prioritizes DOCX criteria while retaining observedCriteria", () => {
    const customBusiness = {
      ...businessCriteriaJson,
      levels: {
        ...businessCriteriaJson.levels,
        "white-belt-kids-4-5-and-5-7-yo": {
          minAge: 4,
          maxAge: 7,
          minClasses: 10,
          minimumTime: { years: 0, months: 1, days: 0 },
        },
      },
    };

    const result = parseLevelCatalogSource(observedJson, customBusiness);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected ok result");

    const target = result.value.definitions.find(
      (d) => d.definitionKey === "white-belt-kids-4-5-and-5-7-yo",
    );
    expect(target).toBeDefined();
    expect(target?.criteria.minClasses).toBe(10);
    expect(target?.criteria.minAge).toBe(4);
    expect(target?.observedCriteria.minClasses).toBe(4);
  });

  it("rejects missing DOCX criteria for a level key", () => {
    const incompleteBusiness = {
      ...businessCriteriaJson,
      levels: { ...businessCriteriaJson.levels },
    };
    // @ts-expect-error test deletion of key
    delete incompleteBusiness.levels["white-belt-kids-4-5-and-5-7-yo"];

    const result = parseLevelCatalogSource(observedJson, incompleteBusiness);
    expect(result.ok).toBe(false);
  });

  it("rejects orphan parentKey", () => {
    const badObserved = {
      ...observedJson,
      levels: observedJson.levels.map((l) =>
        l.key === "white-4-5-and-5-7yo-1st-stripe" ? { ...l, parentKey: "non-existent-parent" } : l,
      ),
    };

    const result = parseLevelCatalogSource(badObserved, businessCriteriaJson);
    expect(result.ok).toBe(false);
  });

  it("rejects duplicate level keys", () => {
    const badObserved = {
      ...observedJson,
      levels: [...observedJson.levels, { ...observedJson.levels[0] }],
    };

    const result = parseLevelCatalogSource(badObserved, businessCriteriaJson);
    expect(result.ok).toBe(false);
  });

  it("rejects invalid visual color format", () => {
    const badObserved = {
      ...observedJson,
      levels: observedJson.levels.map((l, index) =>
        index === 0
          ? { ...l, visual: { ...l.visual, colors: ["invalid-color", "#ffffff", "#ffffff"] } }
          : l,
      ),
    };

    const result = parseLevelCatalogSource(badObserved, businessCriteriaJson);
    expect(result.ok).toBe(false);
  });

  it("rejects invalid skill minimumRating (out of 1-5)", () => {
    const badObserved = {
      ...observedJson,
      skillCatalog: observedJson.skillCatalog.map((s, idx) =>
        idx === 0 ? { ...s, minimumRating: 6 } : s,
      ),
    };

    const result = parseLevelCatalogSource(badObserved, businessCriteriaJson);
    expect(result.ok).toBe(false);
  });

  it("rejects prototype pollution and hostile getters", () => {
    const hostileObject = Object.create({ malicious: true });
    hostileObject.schemaVersion = 1;

    const result = parseLevelCatalogSource(hostileObject, businessCriteriaJson);
    expect(result.ok).toBe(false);
  });

  it("parses and freezes safe level catalog projection", () => {
    const catalogResult = parseLevelCatalogSource(observedJson, businessCriteriaJson);
    if (!catalogResult.ok) throw new Error("Catalog source parsing failed");

    const rawProjection: LevelCatalogProjection = {
      system: catalogResult.value.system,
      definitions: catalogResult.value.definitions,
      skills: catalogResult.value.skills,
      requirements: catalogResult.value.requirements,
      sourceHash: "test-hash-123456",
    };

    const projectionResult = parseLevelCatalogProjection(rawProjection);
    expect(projectionResult.ok).toBe(true);
    if (!projectionResult.ok) throw new Error("Projection parsing failed");

    expect(Object.isFrozen(projectionResult.value)).toBe(true);
    expect(Object.isFrozen(projectionResult.value.definitions)).toBe(true);
  });

  describe("Technical Evaluations (T039)", () => {
    it("builds valid deterministic/traceable evaluation ID", () => {
      const id1 = buildEvaluationId("std-1", "guard-pass", "2026-09-01T10:00:00Z");
      expect(id1).toBe("eval_std-1_guard-pass_2026-09-01T10:00:00Z");

      const id2 = buildEvaluationId("std-2", "armbar");
      expect(id2.startsWith("eval_std-2_armbar_")).toBe(true);
    });

    it("parses and validates valid evaluation input", () => {
      const validInput: RecordEvaluationInput = {
        studentId: "student-1",
        definitionKey: "white-1",
        skillKey: "guard-pass-knee-cut",
        score: 4,
        evidenceNotes: "Excellent weight distribution and head control during sparring.",
      };

      const result = parseRecordEvaluationInput(validInput);
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("Expected ok result");
      expect(result.value.score).toBe(4);
      expect(result.value.studentId).toBe("student-1");
      expect(Object.isFrozen(result.value)).toBe(true);
    });

    it("rejects score outside 1-5 range", () => {
      const invalid0 = parseRecordEvaluationInput({
        studentId: "student-1",
        definitionKey: "white-1",
        skillKey: "guard-pass",
        score: 0 as unknown as EvaluationScore,
        evidenceNotes: "Too low",
      });
      expect(invalid0.ok).toBe(false);

      const invalid6 = parseRecordEvaluationInput({
        studentId: "student-1",
        definitionKey: "white-1",
        skillKey: "guard-pass",
        score: 6 as unknown as EvaluationScore,
        evidenceNotes: "Too high",
      });
      expect(invalid6.ok).toBe(false);

      const nonInt = parseRecordEvaluationInput({
        studentId: "student-1",
        definitionKey: "white-1",
        skillKey: "guard-pass",
        score: 3.5 as unknown as EvaluationScore,
        evidenceNotes: "Non integer",
      });
      expect(nonInt.ok).toBe(false);
    });

    it("rejects missing or too short evidence notes", () => {
      const shortNotes = parseRecordEvaluationInput({
        studentId: "student-1",
        definitionKey: "white-1",
        skillKey: "guard-pass",
        score: 3,
        evidenceNotes: "ok",
      });
      expect(shortNotes.ok).toBe(false);

      const emptyNotes = parseRecordEvaluationInput({
        studentId: "student-1",
        definitionKey: "white-1",
        skillKey: "guard-pass",
        score: 3,
        evidenceNotes: "   ",
      });
      expect(emptyNotes.ok).toBe(false);
    });

    it("rejects invalid studentId or skillKey format", () => {
      const badStudent = parseRecordEvaluationInput({
        studentId: "bad/student id",
        definitionKey: "white-1",
        skillKey: "guard-pass",
        score: 3,
        evidenceNotes: "Good technique shown.",
      });
      expect(badStudent.ok).toBe(false);

      const badSkill = parseRecordEvaluationInput({
        studentId: "student-1",
        definitionKey: "white-1",
        skillKey: "bad skill spaces",
        score: 3,
        evidenceNotes: "Good technique shown.",
      });
      expect(badSkill.ok).toBe(false);
    });
  });

  describe("Student Progress Summary & Skill Checklist (T040)", () => {
    const catalogResult = parseLevelCatalogSource(observedJson, businessCriteriaJson);
    if (!catalogResult.ok) throw new Error("Catalog source parsing failed");
    const catalog = catalogResult.value;

    it("calculates progress toward next belt/stripe and builds skill checklist", () => {
      // Suppose student is currently white belt 0 (or first level: white-0 / sequence 1)
      const firstDef = catalog.definitions[0]!;
      const secondDef = catalog.definitions[1]!;
      const req =
        catalog.requirements.find((r) => r.definitionKey === secondDef.definitionKey) ??
        catalog.requirements[0]!;

      // Mock student evaluations: 1 skill evaluated at score 4
      const evaluations: EvaluationRecord[] = [
        {
          evaluationId: "eval-1",
          academyId: "acad-1",
          studentId: "std-1",
          definitionKey: firstDef.definitionKey,
          skillKey: req.skillKey,
          score: 4,
          evidenceNotes: "Solid execution during sparring.",
          evaluatorId: "coach-1",
          evaluatorRole: "coach",
          evaluatedAt: "2026-08-10T10:00:00Z",
          schemaVersion: "1",
          createdAt: "2026-08-10T10:00:00Z",
          createdBy: "coach-1",
          updatedAt: "2026-08-10T10:00:00Z",
          updatedBy: "coach-1",
        },
      ];

      const summary: StudentProgressSummary = buildStudentProgressSummary({
        catalog,
        studentId: "std-1",
        currentDefinitionKey: firstDef.definitionKey,
        evaluations,
        attendedClassesCount: 15,
        totalHours: 22.5,
        currentLevelStartedAt: "2026-06-01T00:00:00Z",
        now: "2026-09-01T00:00:00Z",
      });

      expect(summary.studentId).toBe("std-1");
      expect(summary.currentDefinition.definitionKey).toBe(firstDef.definitionKey);
      expect(summary.targetDefinition?.definitionKey).toBe(secondDef.definitionKey);
      expect(summary.totalAttendedClasses).toBe(15);
      expect(summary.totalHours).toBe(22.5);

      // Check skill checklist
      expect(summary.skillChecklist.length).toBeGreaterThan(0);
      const item = summary.skillChecklist.find((i) => i.skillKey === req.skillKey);
      expect(item).toBeDefined();
      expect(item?.currentScore).toBe(4);
      expect(item?.isCompleted).toBe(true);

      // Check criteria
      expect(summary.criteria.classes.completed).toBe(15);
      expect(summary.criteria.time.elapsedDays).toBe(92); // ~92 days between June 1 and Sept 1
    });

    it("handles max rank student where targetDefinition is null", () => {
      const lastDef = catalog.definitions[catalog.definitions.length - 1]!;

      const summary = buildStudentProgressSummary({
        catalog,
        studentId: "master-1",
        currentDefinitionKey: lastDef.definitionKey,
        evaluations: [],
        attendedClassesCount: 500,
        totalHours: 750,
      });

      expect(summary.currentDefinition.definitionKey).toBe(lastDef.definitionKey);
      expect(summary.targetDefinition).toBeNull();
      expect(summary.criteria.overallEligible).toBe(true);
      expect(summary.skillChecklist).toHaveLength(0);
    });
  });
});
