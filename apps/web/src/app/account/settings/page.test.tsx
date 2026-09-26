import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  role: "adultStudent" as string,
  order: [] as string[],
  listMyProfiles: vi.fn(),
}));

vi.mock("../../../lib/client-auth", () => ({
  ClientAuthProvider: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ClientAuthGate: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  useClientSession: () => ({ session: { role: mocks.role } }),
}));
vi.mock("../../../lib/family-plan-client", () => ({ listMyProfiles: mocks.listMyProfiles }));
vi.mock("../../../lib/family-client", () => ({ getFamily: vi.fn() }));
vi.mock("../../../lib/account-settings-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/account-settings-client")>()),
  syncOwnAccountEmail: vi.fn(async () => {
    await Promise.resolve();
    mocks.order.push("syncOwnAccountEmail");
  }),
}));

import AccountSettingsPage from "./page";

describe("Account Settings Page", () => {
  afterEach(() => {
    cleanup();
    mocks.role = "adultStudent";
    mocks.order.length = 0;
    mocks.listMyProfiles.mockReset();
  });

  function listed(profiles: unknown[] = []) {
    mocks.listMyProfiles.mockImplementation(async () => {
      mocks.order.push("listMyProfiles");
      return profiles;
    });
  }

  it("renders the reserved route with its heading and the way back", () => {
    listed();
    render(<AccountSettingsPage />);
    expect(screen.getByRole("heading", { name: "Account settings" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "← Back to account" })).toHaveAttribute(
      "href",
      "/account",
    );
  });

  it("syncs the sign-in email before it loads the profiles", async () => {
    listed();
    render(<AccountSettingsPage />);

    await waitFor(() => expect(mocks.order).toEqual(["syncOwnAccountEmail", "listMyProfiles"]));
  });

  it("shows email and password to an adult account", () => {
    listed();
    render(<AccountSettingsPage />);

    expect(screen.getByRole("heading", { name: "Email" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Password" })).toBeInTheDocument();
  });

  it("hides email and password from a teen: their guardian controls that sign-in", () => {
    listed();
    mocks.role = "teenStudent";
    render(<AccountSettingsPage />);

    expect(screen.queryByRole("heading", { name: "Email" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Password" })).not.toBeInTheDocument();
  });

  it("hides the phone section when the profiles cannot be listed", async () => {
    mocks.listMyProfiles.mockRejectedValue(new Error("unavailable"));
    render(<AccountSettingsPage />);

    await screen.findByText("Settings are not available right now.");
    expect(screen.queryByRole("heading", { name: "Phone" })).not.toBeInTheDocument();
  });
});
