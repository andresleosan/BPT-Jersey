import { describe, expect, it } from "vitest";

import businessCriteriaJson from "../../../../docs/data/ibjjf-levels-business-criteria.sanitized.json";
import observedJson from "../../../../docs/data/ibjjf-levels-observed.sanitized.json";
import { normalizeLevelCatalogSource } from "./level-source";
import { createInMemoryLevelStore } from "./level-service";

describe("Level Service & Store", () => {
  const normalized = normalizeLevelCatalogSource(observedJson, businessCriteriaJson);

  it("seeds the full catalog into Firestore store and lists published catalog", async () => {
    const store = createInMemoryLevelStore();

    const seedResult = await store.seed({
      academyId: "demo-academy",
      normalized,
    });

    expect(seedResult.systemId).toBe("ibjjf-v1");
    expect(seedResult.definitionCount).toBe(171);
    expect(seedResult.beltCount).toBe(27);
    expect(seedResult.stripeCount).toBe(144);
    expect(seedResult.skillCount).toBe(11);
    expect(seedResult.requirementCount).toBe(165);
    expect(seedResult.idempotent).toBe(false);

    const catalog = await store.listPublished("demo-academy");
    expect(catalog.system.systemId).toBe("ibjjf-v1");
    expect(catalog.definitions).toHaveLength(171);
    expect(catalog.skills).toHaveLength(11);
    expect(catalog.requirements).toHaveLength(165);
    expect(catalog.sourceHash).toBe(normalized.sourceHash);
  });

  it("is idempotent when re-seeded with identical hash", async () => {
    const store = createInMemoryLevelStore();

    await store.seed({
      academyId: "demo-academy",
      normalized,
    });

    const secondSeed = await store.seed({
      academyId: "demo-academy",
      normalized,
    });

    expect(secondSeed.idempotent).toBe(true);
  });

  it("fails closed on immutable version conflict (same systemId, different sourceHash)", async () => {
    const store = createInMemoryLevelStore();

    await store.seed({
      academyId: "demo-academy",
      normalized,
    });

    const conflicting = {
      ...normalized,
      sourceHash: "different-hash-1234567890abcdef1234567890abcdef1234567890abcdef12345678",
    };

    await expect(
      store.seed({
        academyId: "demo-academy",
        normalized: conflicting,
      }),
    ).rejects.toThrow();
  });

  it("rolls back seeded system by deleting all its documents", async () => {
    const store = createInMemoryLevelStore();

    await store.seed({
      academyId: "demo-academy",
      normalized,
    });

    const rollbackResult = await store.rollback({
      academyId: "demo-academy",
      systemId: "ibjjf-v1",
    });

    expect(rollbackResult.deletedDefinitions).toBe(171);
    expect(rollbackResult.deletedRequirements).toBe(165);
    expect(rollbackResult.deletedSystems).toBe(1);

    await expect(store.listPublished("demo-academy")).rejects.toThrow();
  });

  it("enforces tenant boundary on listPublished", async () => {
    const store = createInMemoryLevelStore();

    await store.seed({
      academyId: "academy-1",
      normalized,
    });

    await expect(store.listPublished("academy-2")).rejects.toThrow();
  });

  describe("Student Technical Evaluations Store (T039)", () => {
    it("records evaluation with audit event and retrieves student evaluations", async () => {
      const store = createInMemoryLevelStore();

      const evaluation = await store.recordEvaluation({
        academyId: "demo-academy",
        input: {
          studentId: "student-1",
          definitionKey: "white-1",
          skillKey: "guard-pass-knee-cut",
          score: 4,
          evidenceNotes: "Solid pressure pass executed during sparring session.",
        },
        evaluatorId: "coach-1",
        evaluatorRole: "coach",
      });

      expect(evaluation.evaluationId.startsWith("eval_student-1_guard-pass-knee-cut_")).toBe(true);
      expect(evaluation.score).toBe(4);
      expect(evaluation.evaluatorId).toBe("coach-1");
      expect(evaluation.evaluatorRole).toBe("coach");

      const studentEvals = await store.listStudentEvaluations("demo-academy", "student-1");
      expect(studentEvals).toHaveLength(1);
      expect(studentEvals[0]?.evaluationId).toBe(evaluation.evaluationId);
      expect(studentEvals[0]?.score).toBe(4);

      // Other student has empty list
      const otherEvals = await store.listStudentEvaluations("demo-academy", "student-2");
      expect(otherEvals).toHaveLength(0);
    });

    it("aggregates student skill summary across multiple evaluations", async () => {
      const store = createInMemoryLevelStore();

      await store.recordEvaluation({
        academyId: "demo-academy",
        input: {
          studentId: "student-1",
          definitionKey: "white-1",
          skillKey: "guard-pass-knee-cut",
          score: 2,
          evidenceNotes: "First attempt in fundamental class.",
        },
        evaluatorId: "coach-1",
        evaluatorRole: "coach",
        evaluatedAt: "2026-08-01T10:00:00Z",
      });

      await store.recordEvaluation({
        academyId: "demo-academy",
        input: {
          studentId: "student-1",
          definitionKey: "white-1",
          skillKey: "guard-pass-knee-cut",
          score: 4,
          evidenceNotes: "Much improved guard pass under resistance.",
        },
        evaluatorId: "headcoach-1",
        evaluatorRole: "headCoach",
        evaluatedAt: "2026-08-15T10:00:00Z",
      });

      const summary = await store.getStudentSkillSummary("demo-academy", "student-1");
      expect(summary["guard-pass-knee-cut"]).toBeDefined();
      expect(summary["guard-pass-knee-cut"]?.count).toBe(2);
      expect(summary["guard-pass-knee-cut"]?.maxScore).toBe(4);
      expect(summary["guard-pass-knee-cut"]?.latestScore).toBe(4);
      expect(summary["guard-pass-knee-cut"]?.lastEvaluatedAt).toBe("2026-08-15T10:00:00Z");
    });

    it("aggregates student progress summary with published catalog and attendance count", async () => {
      const store = createInMemoryLevelStore();
      await store.seed({ academyId: "demo-academy", normalized });

      await store.recordEvaluation({
        academyId: "demo-academy",
        input: {
          studentId: "student-1",
          definitionKey: "white-0",
          skillKey: "guard-pass-knee-cut",
          score: 5,
          evidenceNotes: "Mastery achieved.",
        },
        evaluatorId: "coach-1",
        evaluatorRole: "coach",
      });

      const progress = await store.getStudentProgressSummary(
        "demo-academy",
        "student-1",
        "white-0",
        "2026-01-01T00:00:00Z",
        40,
        60,
      );

      expect(progress.studentId).toBe("student-1");
      expect(progress.totalAttendedClasses).toBe(40);
      expect(progress.totalHours).toBe(60);
      expect(progress.skillChecklist.length).toBeGreaterThan(0);
    });
  });
});
