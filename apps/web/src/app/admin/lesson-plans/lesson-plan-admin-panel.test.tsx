import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  getLessonPlan: vi.fn(),
  approveLessonPlan: vi.fn(),
}));

vi.mock("../../../lib/lesson-planning-client", () => api);

import { LessonPlanAdminPanel } from "./lesson-plan-admin-panel";

const view = {
  plan: {
    planId: "plan-secret",
    academyId: "academy-1",
    title: "Synthetic guard passing",
    libraryId: "library-secret",
    libraryVersion: 1,
    status: "submitted",
    activities: [
      {
        activityId: "activity-secret",
        kind: "technique",
        techniqueId: "technique-secret",
        durationMinutes: 30,
        sequence: 1,
      },
    ],
    approvedByStaffId: null,
    approvedAt: null,
  },
  library: {
    libraryId: "library-secret",
    version: 1,
    status: "published",
    publishedAt: "2026-08-31T10:00:00.000Z",
    techniques: [
      {
        techniqueId: "technique-secret",
        label: "Guard pass",
        skillKey: "guard-pass",
        sequence: 1,
        active: true,
      },
    ],
  },
} as const;

describe("LessonPlanAdminPanel", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("loads the versioned content and allows a head coach to approve it", async () => {
    api.getLessonPlan.mockResolvedValue(view);
    api.approveLessonPlan.mockResolvedValue({
      ...view.plan,
      status: "approved",
      approvedByStaffId: "head-coach-1",
      approvedAt: "2026-08-31T11:00:00.000Z",
    });
    const user = userEvent.setup();
    render(<LessonPlanAdminPanel canApprove />);

    await user.type(screen.getByLabelText("Plan reference"), "plan-secret");
    await user.click(screen.getByRole("button", { name: "Load lesson plan" }));

    expect(await screen.findByRole("heading", { name: "Synthetic guard passing" })).toBeVisible();
    expect(screen.getByText("Guard pass")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Approve lesson plan" }));

    expect(await screen.findByRole("status")).toHaveTextContent("Approved");
    expect(api.approveLessonPlan).toHaveBeenCalledWith("plan-secret", view.library);
    expect(
      screen.queryByText(/library-secret|technique-secret|activity-secret/i),
    ).not.toBeInTheDocument();
  });

  it("shows a safe error when loading fails", async () => {
    api.getLessonPlan.mockRejectedValue(new Error("private backend details"));
    const user = userEvent.setup();
    render(<LessonPlanAdminPanel canApprove={false} />);

    await user.type(screen.getByLabelText("Plan reference"), "plan-1");
    await user.click(screen.getByRole("button", { name: "Load lesson plan" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Unable to load the lesson plan. Please try again.",
    );
    expect(screen.queryByText("private backend details")).not.toBeInTheDocument();
  });
});
