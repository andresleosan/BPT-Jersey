import { describe, expect, it } from "vitest";
import type { ProgressReport } from "@bpt-jersey/domain/levels";
import { createGetProgressReportHandler } from "./progress-report-callables";
import type { ProgressReportStore } from "./progress-report-service";

const report: ProgressReport = {
  activeStudentCount: 2,
  assessedStudentCount: 1,
  unassessedStudentCount: 1,
  totalEvaluationCount: 1,
  assessmentCoveragePercentage: 50,
  recognitionCandidateCount: 2,
  eligibleForPromotionCount: 1,
  levelBreakdown: [],
  skillCoverage: [],
  calculatedAt: "2026-08-23T12:00:00.000Z",
};

function request(data: unknown, role = "owner", uid: string | null = "staff-1") {
  return {
    auth: uid ? { uid, token: { academyId: "academy-1", role } } : undefined,
    data,
  } as never;
}

describe("progress report callable", () => {
  it("allows staff and preserves the aggregate-only response", async () => {
    const store: ProgressReportStore = {
      getProgressReport: async (academyId) => {
        expect(academyId).toBe("academy-1");
        return report;
      },
    };
    const handler = createGetProgressReportHandler({ store });

    const response = await handler(request(null, "headCoach"));
    expect(response.report).toEqual(report);
    expect(JSON.stringify(response)).not.toContain("student-");
  });

  it("rejects clients, payloads and unauthenticated calls", async () => {
    const store: ProgressReportStore = {
      getProgressReport: async () => report,
    };
    const handler = createGetProgressReportHandler({ store });

    await expect(handler(request(null, "adultStudent", "student-1"))).rejects.toThrow(
      "Staff role required",
    );
    await expect(handler(request({}, "owner"))).rejects.toThrow("does not accept a payload");
    await expect(handler(request(null, "owner", null))).rejects.toThrow();
  });
});
