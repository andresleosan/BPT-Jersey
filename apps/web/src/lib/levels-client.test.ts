import { describe, expect, it, vi } from "vitest";

import businessCriteriaJson from "../../../../docs/data/ibjjf-levels-business-criteria.sanitized.json";
import observedJson from "../../../../docs/data/ibjjf-levels-observed.sanitized.json";
import { parseLevelCatalogSource } from "@bpt-jersey/domain/levels";
import {
  getLevelCatalog,
  getStudentProgressSummary,
  listStudentEvaluations,
  recordEvaluation,
} from "./levels-client";

const parsed = parseLevelCatalogSource(observedJson, businessCriteriaJson);
if (!parsed.ok) throw new Error("Catalog parsing failed");

const mockProjection = {
  system: parsed.value.system,
  definitions: parsed.value.definitions,
  skills: parsed.value.skills,
  requirements: parsed.value.requirements,
  sourceHash: "test-hash-123456",
};

let mockCallableResult: any = { data: mockProjection };
let mockCallableError: any = null;

vi.mock("firebase/functions", () => ({
  httpsCallable: () => async () => {
    if (mockCallableError) throw mockCallableError;
    return mockCallableResult;
  },
}));

vi.mock("./firebase-client", () => ({
  getFirebaseFunctions: () => ({}),
}));

describe("Levels Web Client", () => {
  it("fetches and validates published level catalog", async () => {
    mockCallableError = null;
    mockCallableResult = { data: mockProjection };

    const catalog = await getLevelCatalog();
    expect(catalog.system.systemId).toBe("ibjjf-v1");
    expect(catalog.definitions).toHaveLength(171);
    expect(catalog.skills).toHaveLength(11);
    expect(catalog.requirements).toHaveLength(165);
  });

  it("throws user-facing safe error on backend failure", async () => {
    mockCallableError = new Error("Firebase internal");

    await expect(getLevelCatalog()).rejects.toThrow(
      "Unable to load level catalog. Please try again.",
    );
  });

  it("throws user-facing safe error when response is malformed", async () => {
    mockCallableError = null;
    mockCallableResult = { data: { malformed: true } };

    await expect(getLevelCatalog()).rejects.toThrow(
      "Unable to load level catalog. Please try again.",
    );
  });

  it("records evaluation with validation and safe error handling", async () => {
    mockCallableError = null;
    mockCallableResult = {
      data: {
        evaluation: {
          evaluationId: "eval_std-1_guard-pass_2026-09-01",
          studentId: "std-1",
          definitionKey: "white-1",
          skillKey: "guard-pass",
          score: 4,
          evidenceNotes: "Great control shown.",
        },
      },
    };

    const evalRecord = await recordEvaluation({
      studentId: "std-1",
      definitionKey: "white-1",
      skillKey: "guard-pass",
      score: 4,
      evidenceNotes: "Great control shown.",
    });

    expect(evalRecord.score).toBe(4);
    expect(evalRecord.studentId).toBe("std-1");
  });

  it("lists student evaluations and technical skill summary", async () => {
    mockCallableError = null;
    mockCallableResult = {
      data: {
        evaluations: [
          {
            evaluationId: "eval_std-1_guard-pass_2026-09-01",
            score: 5,
            skillKey: "guard-pass",
          },
        ],
        summary: {
          "guard-pass": {
            count: 1,
            maxScore: 5,
            latestScore: 5,
            lastEvaluatedAt: "2026-09-01T00:00:00Z",
          },
        },
      },
    };

    const res = await listStudentEvaluations("std-1");
    expect(res.evaluations).toHaveLength(1);
    expect(res.summary["guard-pass"]?.maxScore).toBe(5);
  });

  it("fetches student progress summary", async () => {
    mockCallableError = null;
    mockCallableResult = {
      data: {
        progress: {
          studentId: "std-1",
          totalAttendedClasses: 25,
          totalHours: 37.5,
          criteria: {
            classes: { required: 20, completed: 25, met: true },
            time: { requiredDays: 30, elapsedDays: 60, met: true },
            skills: { total: 4, completed: 4, met: true, percentage: 100 },
            overallEligible: true,
          },
          skillChecklist: [],
        },
      },
    };

    const progress = await getStudentProgressSummary("std-1");
    expect(progress.studentId).toBe("std-1");
    expect(progress.criteria.overallEligible).toBe(true);
    expect(progress.totalAttendedClasses).toBe(25);
  });
});


