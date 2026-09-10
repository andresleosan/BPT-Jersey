import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  listDisclaimers: vi.fn(),
  publishDisclaimer: vi.fn(),
  withdrawDisclaimer: vi.fn(),
  getOutstandingDisclaimers: vi.fn(),
  acceptDisclaimer: vi.fn(),
  withdrawDisclaimerAcceptance: vi.fn(),
  disclaimerAudienceLabel: (audience: string) =>
    audience === "adult" ? "Adults" : audience === "minor" ? "Minors" : "Everyone",
  disclaimerChangedError: "changed",
}));

vi.mock("../../../lib/disclaimers-client", () => api);

import { DisclaimerAdminPanel } from "./disclaimer-admin";

function adoption(
  overrides: { disclaimer?: Record<string, unknown>; acceptedCount?: number } = {},
) {
  const { disclaimer: disclaimerOverrides, ...rest } = overrides;
  return {
    disclaimer: {
      disclaimerId: "photo-consent__v1",
      academyId: "academy-1",
      key: "photo-consent",
      versionLabel: "v1",
      title: "Photography at open mat",
      body: "Synthetic placeholder body for the pilot.",
      audience: "all",
      required: true,
      contentHash: "a".repeat(64),
      status: "published",
      effectiveAt: "2026-09-01T00:00:00.000Z",
      publishedAt: "2026-09-01T00:00:00.000Z",
      publishedBy: "owner-1",
      supersededBy: null,
      withdrawnAt: null,
      schemaVersion: "1",
      ...(disclaimerOverrides ?? {}),
    },
    acceptedCount: 3,
    // `rest` on purpose: spreading `overrides` here would replace the whole disclaimer object
    // with the partial one above, which silently produced rows without an id.
    ...rest,
  };
}

describe("admin disclaimers panel (T117)", () => {
  beforeEach(() => {
    api.listDisclaimers.mockResolvedValue([]);
    api.publishDisclaimer.mockResolvedValue({ key: "photo-consent", versionLabel: "v2" });
    api.withdrawDisclaimer.mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
    api.listDisclaimers.mockReset();
    api.publishDisclaimer.mockReset();
    api.withdrawDisclaimer.mockReset();
  });

  it("says the platform ships no wording", async () => {
    render(<DisclaimerAdminPanel />);
    expect(await screen.findByText(/ships no disclaimer wording/i)).toBeVisible();
    expect(screen.getByText("No disclaimer has been published.")).toBeVisible();
  });

  it("shows adoption as a count and never as a list of people", async () => {
    api.listDisclaimers.mockResolvedValue([adoption()]);
    render(<DisclaimerAdminPanel />);

    const table = await screen.findByRole("table", { name: "Published disclaimers" });
    const row = within(table).getAllByRole("row")[1];
    expect(row).toBeDefined();
    expect(within(row!).getByText("photo-consent")).toBeVisible();
    expect(within(row!).getByText("Everyone")).toBeVisible();
    expect(within(row!).getByText("3")).toBeVisible();
    expect(table.textContent).not.toContain("student");
  });

  it("warns that publishing over a live key asks everyone again", async () => {
    api.listDisclaimers.mockResolvedValue([adoption()]);
    render(<DisclaimerAdminPanel />);
    await screen.findByRole("table", { name: "Published disclaimers" });

    await userEvent.setup().type(screen.getByLabelText("Disclaimer key"), "photo-consent");
    expect(await screen.findByText(/Everyone who accepted it will be asked again/)).toBeVisible();
  });

  it("publishes what office typed and reloads the list", async () => {
    render(<DisclaimerAdminPanel />);
    await screen.findByText("No disclaimer has been published.");

    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Disclaimer key"), "photo-consent");
    await user.type(screen.getByLabelText("Disclaimer version"), "v2");
    await user.type(screen.getByLabelText("Disclaimer title"), "Photography at open mat");
    await user.type(
      screen.getByLabelText("Disclaimer text"),
      "Synthetic body written by the academy.",
    );
    await user.selectOptions(screen.getByLabelText("Disclaimer audience"), "minor");
    await user.type(screen.getByLabelText("Disclaimer effective from"), "2026-10-01");
    await user.click(screen.getByRole("button", { name: "Publish disclaimer" }));

    await waitFor(() =>
      expect(api.publishDisclaimer).toHaveBeenCalledWith({
        key: "photo-consent",
        versionLabel: "v2",
        title: "Photography at open mat",
        body: "Synthetic body written by the academy.",
        audience: "minor",
        required: true,
        effectiveAt: "2026-10-01T00:00:00.000Z",
      }),
    );
    expect(api.listDisclaimers).toHaveBeenCalledTimes(2);
  });

  it("withdraws a live disclaimer and offers no action on one already gone", async () => {
    api.listDisclaimers.mockResolvedValue([adoption()]);
    render(<DisclaimerAdminPanel />);
    await userEvent.setup().click(await screen.findByRole("button", { name: "Withdraw" }));
    await waitFor(() => expect(api.withdrawDisclaimer).toHaveBeenCalledWith("photo-consent__v1"));

    cleanup();
    api.listDisclaimers.mockResolvedValue([adoption({ disclaimer: { status: "superseded" } })]);
    render(<DisclaimerAdminPanel />);
    await screen.findByRole("table", { name: "Published disclaimers" });
    expect(screen.queryByRole("button", { name: "Withdraw" })).toBeNull();
  });

  it("reports a generic error when the list or the publish fails", async () => {
    api.listDisclaimers.mockImplementation(() =>
      Promise.reject(new Error("Unable to load disclaimers. Please try again.")),
    );
    render(<DisclaimerAdminPanel />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Unable to load disclaimers.");
  });
});
