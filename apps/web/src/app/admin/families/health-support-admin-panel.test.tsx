import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const healthApi = vi.hoisted(() => ({
  getHealthAdminProfile: vi.fn(),
  saveHealthProfile: vi.fn(),
  reviewHealthProfileChangeRequest: vi.fn(),
}));

vi.mock("../../../lib/health-client", () => healthApi);

import { HealthSupportAdminPanel } from "./health-support-admin-panel";

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

const profile = {
  healthProfileId: "student-secret-id",
  academyId: "academy-secret-id",
  studentId: "student-secret-id",
  minimumOperationalSupport: ["supervision"],
  conditionSummary: "Meet guardian at reception.",
  staffReferenceLabel: "Meet at reception",
  reviewState: "current",
  expiresAt: null,
  status: "active",
  schemaVersion: "1",
  createdAt: "2026-08-24T09:00:00Z",
  createdBy: "admin-secret-id",
  updatedAt: "2026-08-24T09:00:00Z",
  updatedBy: "admin-secret-id",
  pendingChangeRequest: request,
} as const;

const reviewedProfile = { ...profile, pendingChangeRequest: null };

describe("HealthSupportAdminPanel", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("loads a pending request on demand and approves it without exposing internal IDs", async () => {
    healthApi.getHealthAdminProfile
      .mockResolvedValueOnce(profile)
      .mockResolvedValueOnce(reviewedProfile);
    healthApi.reviewHealthProfileChangeRequest.mockResolvedValue({
      ...request,
      status: "approved",
    });
    const user = userEvent.setup();
    render(
      <HealthSupportAdminPanel
        instanceId="health-admin-1"
        studentId="student-secret-id"
        studentName="Synthetic Minor"
      />,
    );

    await user.click(screen.getByRole("button", { name: "Open support review" }));
    expect(await screen.findByText("Pending guardian request")).toBeVisible();
    expect(screen.getByText("Mobility support")).toBeVisible();
    expect(
      screen.queryByText(/student-secret-id|academy-secret-id|request-secret-id|createdBy/i),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Approve request" }));
    await waitFor(() =>
      expect(healthApi.reviewHealthProfileChangeRequest).toHaveBeenCalledWith(
        "request-secret-id",
        "approve",
      ),
    );
    expect(await screen.findByRole("status")).toHaveTextContent(
      "The requested change was approved.",
    );
  });

  it("creates a support profile from the administrative form", async () => {
    healthApi.getHealthAdminProfile.mockResolvedValue(undefined);
    healthApi.saveHealthProfile.mockResolvedValue({ ...profile, pendingChangeRequest: null });
    const user = userEvent.setup();
    render(
      <HealthSupportAdminPanel
        instanceId="health-admin-1"
        studentId="student-1"
        studentName="Synthetic Minor"
      />,
    );

    await user.click(screen.getByRole("button", { name: "Open support review" }));
    await user.click(await screen.findByRole("button", { name: "Add support profile" }));
    await user.click(screen.getByLabelText("Mobility support"));
    await user.type(screen.getByLabelText("Staff reference label"), "Clear route");
    await user.click(screen.getByRole("button", { name: "Save support profile" }));

    await waitFor(() =>
      expect(healthApi.saveHealthProfile).toHaveBeenCalledWith({
        studentId: "student-1",
        minimumOperationalSupport: ["mobility"],
        conditionSummary: "",
        staffReferenceLabel: "Clear route",
        expiresAt: null,
      }),
    );
    expect(screen.getByRole("status")).toHaveTextContent("Health support saved.");
  });
});
