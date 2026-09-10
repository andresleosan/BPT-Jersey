import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  getOutstandingDisclaimers: vi.fn(),
  acceptDisclaimer: vi.fn(),
  withdrawDisclaimerAcceptance: vi.fn(),
  listDisclaimers: vi.fn(),
  publishDisclaimer: vi.fn(),
  withdrawDisclaimer: vi.fn(),
  disclaimerAudienceLabel: (audience: string) => audience,
  disclaimerChangedError:
    "This disclaimer was updated while you were reading it. Please read the new version.",
}));

vi.mock("../../lib/disclaimers-client", () => api);

import { DisclaimersPanel } from "./disclaimers";

const hash = "a".repeat(64);

function outstanding(overrides: Record<string, unknown> = {}) {
  return {
    studentId: "student-1",
    disclaimer: {
      disclaimerId: "photo-consent__v1",
      key: "photo-consent",
      versionLabel: "v1",
      title: "Photography at open mat",
      body: "Synthetic placeholder body for the pilot.",
      required: true,
      contentHash: hash,
      effectiveAt: "2026-09-01T00:00:00.000Z",
    },
    previouslyAcceptedVersionLabel: null,
    ...overrides,
  };
}

describe("account disclaimers panel (T117)", () => {
  beforeEach(() => {
    api.getOutstandingDisclaimers.mockResolvedValue([]);
    api.acceptDisclaimer.mockResolvedValue({ acceptanceId: "a-1", status: "accepted" });
  });

  afterEach(() => {
    cleanup();
    api.getOutstandingDisclaimers.mockReset();
    api.acceptDisclaimer.mockReset();
  });

  it("announces loading and then an honest empty state", async () => {
    render(<DisclaimersPanel studentId="student-1" />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading your disclaimers");
    expect(await screen.findByText("There is nothing for you to read right now.")).toBeVisible();
  });

  it("shows the text and accepts it with the hash that was rendered", async () => {
    api.getOutstandingDisclaimers.mockResolvedValue([outstanding()]);
    render(<DisclaimersPanel studentId="student-1" />);

    expect(await screen.findByRole("heading", { name: "Photography at open mat" })).toBeVisible();
    expect(screen.getByText("Synthetic placeholder body for the pilot.")).toBeVisible();
    expect(screen.getByText(/Required · version v1/)).toBeVisible();

    await userEvent.setup().click(screen.getByRole("button", { name: "Accept this version" }));
    await waitFor(() =>
      expect(api.acceptDisclaimer).toHaveBeenCalledWith({
        disclaimerId: "photo-consent__v1",
        studentId: "student-1",
        contentHash: hash,
      }),
    );
    // Once accepted it leaves the list without a reload.
    expect(await screen.findByText("There is nothing for you to read right now.")).toBeVisible();
  });

  it("says plainly when a re-consent is being asked for", async () => {
    api.getOutstandingDisclaimers.mockResolvedValue([
      outstanding({ previouslyAcceptedVersionLabel: "v1" }),
    ]);
    render(<DisclaimersPanel studentId="student-1" />);

    expect(await screen.findByText(/You accepted version v1/)).toBeVisible();
    expect(screen.getByText(/wording has changed/)).toBeVisible();
  });

  it("marks an optional disclaimer as optional", async () => {
    api.getOutstandingDisclaimers.mockResolvedValue([
      { ...outstanding(), disclaimer: { ...outstanding().disclaimer, required: false } },
    ]);
    render(<DisclaimersPanel studentId="student-1" />);
    expect(await screen.findByText(/Optional · version v1/)).toBeVisible();
  });

  it("tells the participant to read again when the text changed under them", async () => {
    api.getOutstandingDisclaimers.mockResolvedValue([outstanding()]);
    // Rejected, not thrown: the real client is async, so a synchronous throw would not be a
    // faithful stand-in for it.
    api.acceptDisclaimer.mockImplementation(() =>
      Promise.reject(new Error(api.disclaimerChangedError)),
    );
    render(<DisclaimersPanel studentId="student-1" />);

    await userEvent
      .setup()
      .click(await screen.findByRole("button", { name: "Accept this version" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Please read the new version.");
    // The entry stays on the list: nothing was recorded.
    expect(screen.getByRole("heading", { name: "Photography at open mat" })).toBeVisible();
  });

  it("reports a generic error when the list cannot be read", async () => {
    api.getOutstandingDisclaimers.mockImplementation(() =>
      Promise.reject(new Error("Unable to load your disclaimers. Please try again.")),
    );
    render(<DisclaimersPanel studentId="student-1" />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Unable to load your disclaimers.");
  });

  it("reloads when the participant being viewed changes", async () => {
    api.getOutstandingDisclaimers.mockResolvedValue([outstanding()]);
    const { rerender } = render(<DisclaimersPanel studentId="student-1" />);
    await screen.findByRole("heading", { name: "Photography at open mat" });

    rerender(<DisclaimersPanel studentId="student-2" />);
    await waitFor(() =>
      expect(api.getOutstandingDisclaimers).toHaveBeenLastCalledWith("student-2"),
    );
  });
});
