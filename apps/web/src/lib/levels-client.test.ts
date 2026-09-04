import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import businessCriteriaJson from "../../../../docs/data/ibjjf-levels-business-criteria.sanitized.json";
import observedJson from "../../../../docs/data/ibjjf-levels-observed.sanitized.json";
import { parseLevelCatalogSource } from "@bpt-jersey/domain/levels";
import {
  approvePromotion,
  getLevelCatalog,
  getProgressReport,
  getStudentProgressSummary,
  listGraduations,
  listMedicalLeaves,
  listRecognitionCandidates,
  listStudentEvaluations,
  recordEvaluation,
  recordMedicalLeave,
  rejectPromotion,
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

let mockCallableResult: unknown = { data: mockProjection };
let mockCallableError: Error | null = null;
let mockCallableInvocations = 0;
const originalLevelsBackend = process.env.NEXT_PUBLIC_LEVELS_BACKEND;

vi.mock("firebase/functions", () => ({
  httpsCallable: () => async () => {
    mockCallableInvocations += 1;
    if (mockCallableError) throw mockCallableError;
    return mockCallableResult;
  },
}));

vi.mock("./firebase-client", () => ({
  getFirebaseFunctions: () => ({}),
}));

describe("Levels Web Client", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_LEVELS_BACKEND = "true";
    mockCallableError = null;
    mockCallableResult = { data: mockProjection };
    mockCallableInvocations = 0;
  });

  afterAll(() => {
    if (originalLevelsBackend === undefined) {
      delete process.env.NEXT_PUBLIC_LEVELS_BACKEND;
    } else {
      process.env.NEXT_PUBLIC_LEVELS_BACKEND = originalLevelsBackend;
    }
  });

  it("loads the bundled canonical catalog when the connected backend is disabled", async () => {
    delete process.env.NEXT_PUBLIC_LEVELS_BACKEND;

    const catalog = await getLevelCatalog();

    expect(catalog.system.systemId).toBe("ibjjf-v1");
    expect(catalog.definitions).toHaveLength(171);
    expect(catalog.system.counts).toEqual({ definitions: 171, belts: 27, stripes: 144 });
    expect(catalog.skills).toHaveLength(11);
    expect(catalog.requirements).toHaveLength(165);
    expect(catalog.sourceHash).toMatch(/^bundled:/u);
    expect(mockCallableInvocations).toBe(0);
  });

  it("fetches and validates published level catalog", async () => {
    const catalog = await getLevelCatalog();
    expect(catalog.system.systemId).toBe("ibjjf-v1");
    expect(catalog.definitions).toHaveLength(171);
    expect(catalog.skills).toHaveLength(11);
    expect(catalog.requirements).toHaveLength(165);
    expect(mockCallableInvocations).toBe(1);
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
      sessionId: "session-1",
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
          state: "initialized",
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
    expect(progress.state).toBe("initialized");
    if (progress.state !== "initialized") throw new Error("expected initialized progress");
    expect(progress.criteria.overallEligible).toBe(true);
    expect(progress.totalAttendedClasses).toBe(25);
  });

  it("fetches and validates the aggregate progress report", async () => {
    mockCallableError = null;
    mockCallableResult = {
      data: {
        report: {
          activeStudentCount: 2,
          assessedStudentCount: 1,
          unassessedStudentCount: 1,
          totalEvaluationCount: 1,
          assessmentCoveragePercentage: 50,
          recognitionCandidateCount: 2,
          eligibleForPromotionCount: 1,
          levelBreakdown: [
            {
              definitionKey: "white-0",
              definitionName: "White Belt",
              studentCount: 2,
              assessedStudentCount: 1,
              eligibleForPromotionCount: 1,
            },
          ],
          skillCoverage: [
            {
              skillKey: "guard",
              displayLabel: "Guard",
              assessedStudentCount: 1,
              coveragePercentage: 50,
            },
          ],
          calculatedAt: "2026-08-23T12:00:00.000Z",
        },
      },
    };

    const report = await getProgressReport();
    expect(report.assessmentCoveragePercentage).toBe(50);
    expect(report.levelBreakdown[0]?.studentCount).toBe(2);
  });

  it("rejects malformed aggregate progress reports with a safe error", async () => {
    mockCallableError = null;
    mockCallableResult = { data: { report: { activeStudentCount: 2 } } };

    await expect(getProgressReport()).rejects.toThrow(
      "Unable to load progress report. Please try again.",
    );
  });
  it("records medical leave and lists student medical leaves", async () => {
    mockCallableError = null;
    mockCallableResult = {
      data: {
        medicalLeave: {
          leaveId: "leave-1",
          studentId: "std-1",
          startDate: "2026-08-01T00:00:00Z",
          endDate: "2026-08-15T00:00:00Z",
          reasonCode: "recovery",
        },
      },
    };

    const record = await recordMedicalLeave({
      studentId: "std-1",
      startDate: "2026-08-01T00:00:00Z",
      endDate: "2026-08-15T00:00:00Z",
      reasonCode: "recovery",
    });

    expect(record.studentId).toBe("std-1");
    expect(record.reasonCode).toBe("recovery");

    mockCallableResult = {
      data: {
        medicalLeaves: [record],
      },
    };

    const leaves = await listMedicalLeaves("std-1");
    expect(leaves).toHaveLength(1);
    expect(leaves[0]?.leaveId).toBe("leave-1");
  });

  it("lists recognition candidates for staff", async () => {
    mockCallableError = null;
    mockCallableResult = {
      data: {
        candidates: [
          {
            studentId: "std-ready",
            studentName: "Carlos Gracie",
            isEligibleForPromotion: true,
            readinessPercentage: 100,
          },
        ],
      },
    };

    const candidates = await listRecognitionCandidates();
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.studentName).toBe("Carlos Gracie");
  });

  it("approves promotion, rejects promotion and lists graduations", async () => {
    mockCallableError = null;
    mockCallableResult = {
      data: {
        graduation: {
          graduationId: "grad-1",
          studentId: "std-1",
          fromDefinitionKey: "white-0",
          toDefinitionKey: "white-1",
          status: "approved",
          decisionNotes: "Technical excellence.",
          decidedBy: "coach-1",
          decidedByRole: "headCoach",
          decidedAt: "2026-08-23T12:00:00Z",
          ceremonyDate: "2026-09-01T18:00:00Z",
        },
      },
    };

    const approved = await approvePromotion({
      studentId: "std-1",
      fromDefinitionKey: "white-0",
      toDefinitionKey: "white-1",
      decisionNotes: "Technical excellence.",
      ceremonyDate: "2026-09-01T18:00:00Z",
    });

    expect(approved.status).toBe("approved");
    expect(approved.studentId).toBe("std-1");

    mockCallableResult = {
      data: {
        graduation: {
          graduationId: "grad-2",
          studentId: "std-2",
          fromDefinitionKey: "current",
          toDefinitionKey: "white-1",
          status: "rejected",
          decisionNotes: "More time in guard sparring needed.",
          decidedBy: "coach-1",
          decidedByRole: "headCoach",
          decidedAt: "2026-08-23T12:00:00Z",
          ceremonyDate: null,
        },
      },
    };

    const rejected = await rejectPromotion({
      studentId: "std-2",
      targetDefinitionKey: "white-1",
      decisionNotes: "More time in guard sparring needed.",
    });

    expect(rejected.status).toBe("rejected");

    mockCallableResult = {
      data: {
        graduations: [approved],
      },
    };

    const history = await listGraduations("std-1");
    expect(history).toHaveLength(1);
    expect(history[0]?.status).toBe("approved");
  });
});
