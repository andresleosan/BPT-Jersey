import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const healthApi = vi.hoisted(() => ({
  getHealthProfile: vi.fn(),
  createHealthProfileChangeRequest: vi.fn(),
  cancelHealthProfileChangeRequest: vi.fn(),
}));

vi.mock("../../../lib/health-client", () => healthApi);

import { HealthSupportPanel } from "./health-support-panel";

const profile = {
  healthProfileId: "student-secret-id",
  studentId: "student-secret-id",
  minimumOperationalSupport: ["supervision"],
  conditionSummary: "Meet guardian at reception.",
  reviewState: "current",
  expiresAt: null,
  status: "active",
  schemaVersion: "1",
} as const;

const request = {
  requestId: "request-secret-id",
  academyId: "academy-secret-id",
  healthProfileId: "student-secret-id",
  studentId: "student-secret-id",
  requestedBy: "guardian-secret-id",
  proposedMinimumOperationalSupport: ["mobility"],
  proposedConditionSummary: "Needs a clear route.",
  proposedExpiresAt: null,
  status: "pending",
  createdAt: "2026-08-24T10:00:00Z",
  createdBy: "guardian-secret-id",
  updatedAt: "2026-08-24T10:00:00Z",
  updatedBy: "guardian-secret-id",
  schemaVersion: "1",
  reviewedAt: null,
  reviewedBy: null,
} as const;

describe("HealthSupportPanel", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("shows the redacted support view without internal identifiers or staff reference", async () => {
    healthApi.getHealthProfile.mockResolvedValue(profile);
    render(
      <HealthSupportPanel
        instanceId="health-support-1"
        studentId="student-secret-id"
        studentName="Synthetic Minor"
      />,
    );

    expect(
      await screen.findByRole("heading", { name: "Support for Synthetic Minor" }),
    ).toBeVisible();
    expect(screen.getByText("Additional supervision")).toBeVisible();
    expect(
      screen.queryByText(/student-secret-id|academy-secret-id|staffReferenceLabel/i),
    ).not.toBeInTheDocument();
  });

  it("submits and cancels a guardian change request", async () => {
    healthApi.getHealthProfile.mockResolvedValue(profile);
    healthApi.createHealthProfileChangeRequest.mockResolvedValue(request);
    healthApi.cancelHealthProfileChangeRequest.mockResolvedValue({
      ...request,
      status: "cancelled",
    });
    const user = userEvent.setup();
    render(
      <HealthSupportPanel
        instanceId="health-support-1"
        studentId="student-1"
        studentName="Synthetic Minor"
      />,
    );

    await user.click(await screen.findByRole("button", { name: "Request a change" }));
    await user.click(screen.getByLabelText("Mobility support"));
    await user.click(screen.getByRole("button", { name: "Send for review" }));

    await waitFor(() =>
      expect(healthApi.createHealthProfileChangeRequest).toHaveBeenCalledWith({
        studentId: "student-1",
        proposedMinimumOperationalSupport: ["supervision", "mobility"],
        proposedConditionSummary: "Meet guardian at reception.",
        proposedExpiresAt: null,
      }),
    );
    expect(screen.getByText("A change request is awaiting academy review.")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Cancel request" }));
    await waitFor(() =>
      expect(healthApi.cancelHealthProfileChangeRequest).toHaveBeenCalledWith("request-secret-id"),
    );
    expect(screen.getByText("The pending request was cancelled.")).toBeVisible();
  });
});
