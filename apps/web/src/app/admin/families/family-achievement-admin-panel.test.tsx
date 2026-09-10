import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const achievementApi = vi.hoisted(() => ({
  getFamilyAchievementSummary: vi.fn(),
}));

vi.mock("../../../lib/family-achievement-client", () => achievementApi);

import { FamilyAchievementAdminPanel } from "./family-achievement-admin-panel";

const summary = {
  familyId: "family-secret-id",
  generatedAt: "2026-08-31T12:00:00.000Z",
  members: [
    {
      studentId: "student-secret-id",
      displayName: "Synthetic Minor",
      participantType: "minor",
      goals: [
        {
          goalId: "goal-secret-id",
          label: "Family classes",
          metric: "classes_attended",
          target: 10,
          progress: 4,
          status: "in_progress",
        },
      ],
      achievementCandidates: [],
    },
  ],
  adultComparison: [],
} as const;

describe("FamilyAchievementAdminPanel", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("loads a read-only summary on demand without exposing internal identifiers", async () => {
    achievementApi.getFamilyAchievementSummary.mockResolvedValue(summary);
    const user = userEvent.setup();
    render(<FamilyAchievementAdminPanel familyId="family-secret-id" instanceId="achievements-1" />);

    await user.click(screen.getByRole("button", { name: "Open achievement summary" }));

    expect(await screen.findByRole("heading", { name: "Achievements snapshot" })).toBeVisible();
    expect(screen.getByText("Synthetic Minor")).toBeVisible();
    expect(screen.getByText("Family classes")).toBeVisible();
    expect(screen.getByText("4 / 10 classes attended")).toBeVisible();
    expect(
      screen.queryByText(/family-secret-id|student-secret-id|goal-secret-id/i),
    ).not.toBeInTheDocument();
    expect(achievementApi.getFamilyAchievementSummary).toHaveBeenCalledWith("family-secret-id");
  });

  it("shows a safe error when the summary cannot be loaded", async () => {
    achievementApi.getFamilyAchievementSummary.mockRejectedValue(new Error("private details"));
    const user = userEvent.setup();
    render(<FamilyAchievementAdminPanel familyId="family-1" instanceId="achievements-1" />);

    await user.click(screen.getByRole("button", { name: "Open achievement summary" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Unable to load family achievements. Please try again.",
    );
    expect(screen.queryByText("private details")).not.toBeInTheDocument();
  });
});
