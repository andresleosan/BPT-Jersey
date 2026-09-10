import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  getProgressReport: vi.fn(),
}));

vi.mock("../../../lib/levels-client", () => api);

import { ProgressReportCard } from "./progress-report-card";

const report = {
  activeStudentCount: 12,
  assessedStudentCount: 9,
  unassessedStudentCount: 3,
  totalEvaluationCount: 21,
  assessmentCoveragePercentage: 75,
  recognitionCandidateCount: 8,
  eligibleForPromotionCount: 2,
  levelBreakdown: [
    {
      definitionKey: "white-0",
      definitionName: "White Belt",
      studentCount: 12,
      assessedStudentCount: 9,
      eligibleForPromotionCount: 2,
    },
  ],
  skillCoverage: [
    {
      skillKey: "guard",
      displayLabel: "Guard",
      assessedStudentCount: 9,
      coveragePercentage: 75,
    },
  ],
  calculatedAt: "2026-08-23T12:00:00.000Z",
};

describe("ProgressReportCard", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("renders aggregate coverage and readiness without student identifiers", async () => {
    api.getProgressReport.mockResolvedValue(report);

    render(<ProgressReportCard />);

    expect(await screen.findByRole("heading", { name: "Progress coverage" })).toBeVisible();
    expect(screen.getAllByText("75%")).toHaveLength(2);
    expect(screen.getByText("Recognition candidates")).toBeVisible();
    expect(screen.getByText("Guard")).toBeVisible();
    expect(screen.queryByText(/student-/i)).not.toBeInTheDocument();
  });

  it("shows a safe retry state when the report cannot load", async () => {
    api.getProgressReport.mockRejectedValue(
      new Error("Unable to load progress report. Please try again."),
    );

    render(<ProgressReportCard />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Unable to load progress report. Please try again.",
    );
    expect(screen.getByRole("button", { name: "Retry progress report" })).toBeVisible();
  });
});
