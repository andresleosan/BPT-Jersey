import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  getCurrentWaiverAdmin: vi.fn(),
  publishWaiverVersion: vi.fn(),
  withdrawCurrentWaiver: vi.fn(),
}));
vi.mock("../../../lib/waiver-client", () => api);
import AdminWaiversPage from "./page";

const clauses = [
  {
    key: "photoVideo",
    heading: "Photo and video",
    body: "Reviewed media wording.",
    required: false,
  },
  {
    key: "medicalTreatment",
    heading: "Medical treatment",
    body: "Reviewed medical wording.",
    required: true,
  },
  { key: "hygiene", heading: "Hygiene", body: "Reviewed hygiene wording.", required: true },
  {
    key: "dataProtection",
    heading: "Data protection",
    body: "Reviewed data wording.",
    required: true,
  },
] as const;
const version = {
  waiverVersionId: "waiver-1",
  versionLabel: "pilot-2026-08",
  title: "Reviewed waiver",
  introduction: "Reviewed introduction.",
  clauses,
  contentHash: "a".repeat(64),
  effectiveAt: "2026-08-25T12:00:00Z",
  schemaVersion: "1",
} as const;

describe("admin waivers page", () => {
  afterEach(() => {
    cleanup();
    Object.values(api).forEach((mock) => mock.mockReset());
  });

  it("warns that no legal template is bundled and publishes all fixed clauses", async () => {
    api.getCurrentWaiverAdmin.mockResolvedValue(null);
    api.publishWaiverVersion.mockResolvedValue(version);
    const user = userEvent.setup();
    render(<AdminWaiversPage />);
    expect(await screen.findByText(/No legal wording is bundled/i)).toBeVisible();
    fireEvent.change(screen.getByLabelText("Version label"), {
      target: { value: "pilot-2026-08" },
    });
    fireEvent.change(screen.getByLabelText("Waiver title"), {
      target: { value: "Reviewed waiver" },
    });
    fireEvent.change(screen.getByLabelText("Introduction"), {
      target: { value: "Reviewed introduction." },
    });
    fireEvent.change(screen.getByLabelText("Effective date and time"), {
      target: { value: "2026-08-25T12:00" },
    });
    for (const clause of clauses) {
      fireEvent.change(screen.getByLabelText(`${clause.heading} wording`), {
        target: { value: clause.body },
      });
      if (clause.required) await user.click(screen.getByLabelText(`${clause.heading} is required`));
    }
    await user.click(
      screen.getByLabelText("I confirm this wording is approved for the synthetic pilot"),
    );
    await user.click(screen.getByRole("button", { name: "Publish immutable version" }));
    await waitFor(() =>
      expect(api.publishWaiverVersion).toHaveBeenCalledWith(
        expect.objectContaining({
          versionLabel: "pilot-2026-08",
          confirmReviewed: true,
          clauses: expect.arrayContaining([
            expect.objectContaining({ key: "dataProtection", required: true }),
          ]),
        }),
      ),
    );
    expect(await screen.findByText("Waiver version published.")).toBeVisible();
  });

  it("shows and withdraws the current version without deletion", async () => {
    api.getCurrentWaiverAdmin.mockResolvedValue(version);
    api.withdrawCurrentWaiver.mockResolvedValue(version);
    const user = userEvent.setup();
    render(<AdminWaiversPage />);
    expect(await screen.findByText("pilot-2026-08")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Withdraw current version" }));
    expect(api.withdrawCurrentWaiver).toHaveBeenCalledWith("waiver-1");
    expect(
      await screen.findByText("Current waiver withdrawn without deleting history."),
    ).toBeVisible();
  });

  it("renders a safe loading error", async () => {
    api.getCurrentWaiverAdmin.mockRejectedValue(new Error("private data"));
    render(<AdminWaiversPage />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Unable to load the current waiver");
    expect(screen.queryByText("private data")).not.toBeInTheDocument();
  });
});
