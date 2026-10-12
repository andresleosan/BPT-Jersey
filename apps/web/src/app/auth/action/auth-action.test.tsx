import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  applyEmailAction: vi.fn(),
  checkAccountLink: vi.fn(),
  confirmNewPassword: vi.fn(),
  prepareAccountAction: vi.fn(),
  sendPasswordReset: vi.fn(),
  signOutFromAuth: vi.fn(),
}));
vi.mock("../../../lib/auth-client", async () => ({
  ...api,
  actionErrorMessage: (
    await vi.importActual<typeof import("../../../lib/auth-client")>("../../../lib/auth-client")
  ).actionErrorMessage,
}));

import { AuthAction } from "./auth-action";

function openLink(query: string) {
  window.history.pushState(null, "", `/auth/action${query}`);
  return render(<AuthAction />);
}

afterEach(cleanup);
beforeEach(() => {
  vi.resetAllMocks();
  api.signOutFromAuth.mockResolvedValue(undefined);
  api.applyEmailAction.mockResolvedValue(undefined);
  api.confirmNewPassword.mockResolvedValue(undefined);
  api.sendPasswordReset.mockResolvedValue(undefined);
});

describe("Firebase Auth email action page", () => {
  it("drops the code from the address bar and refuses an incomplete link without calling Firebase", async () => {
    openLink("?mode=resetPassword&apiKey=other-project");
    expect(await screen.findByRole("heading", { name: "Link not valid" })).toBeTruthy();
    expect(window.location.search).toBe("");
    expect(api.prepareAccountAction).not.toHaveBeenCalled();
    expect(api.checkAccountLink).not.toHaveBeenCalled();
    expect(screen.getByRole("link", { name: "Go to sign-in" }).getAttribute("href")).toBe("/login");
  });

  it("resets a password after App Check, with the 12-character rule, and signs a stale session out", async () => {
    api.checkAccountLink.mockResolvedValue({
      operation: "PASSWORD_RESET",
      email: "member@example.test",
    });
    openLink("?mode=resetPassword&oobCode=Code_123456-abc&continueUrl=https%3A%2F%2Fevil.example");
    expect(await screen.findByRole("heading", { name: "Choose a new password" })).toBeTruthy();
    expect(window.location.search).toBe("");
    expect(screen.getByText("For member@example.test.")).toBeTruthy();
    expect(api.prepareAccountAction.mock.invocationCallOrder[0]!).toBeLessThan(
      api.checkAccountLink.mock.invocationCallOrder[0]!,
    );

    const password = screen.getByLabelText("New password");
    const confirm = screen.getByLabelText("Confirm new password");
    fireEvent.change(password, { target: { value: "too-short" } });
    fireEvent.click(screen.getByRole("button", { name: "Save new password" }));
    expect(
      await screen.findByText("Choose a new password of at least 12 characters."),
    ).toBeTruthy();
    fireEvent.change(password, { target: { value: "a-long-new-password" } });
    fireEvent.change(confirm, { target: { value: "a-different-password" } });
    fireEvent.click(screen.getByRole("button", { name: "Save new password" }));
    expect(await screen.findByText("The new passwords do not match.")).toBeTruthy();
    expect(api.confirmNewPassword).not.toHaveBeenCalled();

    fireEvent.change(confirm, { target: { value: "a-long-new-password" } });
    fireEvent.click(screen.getByRole("button", { name: "Save new password" }));
    expect(await screen.findByRole("heading", { name: "Password changed" })).toBeTruthy();
    expect(api.confirmNewPassword).toHaveBeenCalledWith("Code_123456-abc", "a-long-new-password");
    expect(api.signOutFromAuth).toHaveBeenCalledOnce();
    expect(screen.getByRole("link", { name: "Go to sign-in" }).getAttribute("href")).toBe("/login");
  });

  it("does not spend an email change code until the person confirms it", async () => {
    api.checkAccountLink.mockResolvedValue({
      operation: "VERIFY_AND_CHANGE_EMAIL",
      email: "new@example.test",
    });
    openLink("?mode=verifyAndChangeEmail&oobCode=Code_change_1");
    expect(await screen.findByRole("heading", { name: "Confirm your new email" })).toBeTruthy();
    expect(screen.getByText("Your sign-in email will change to new@example.test.")).toBeTruthy();
    expect(api.applyEmailAction).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Confirm email change" }));
    expect(await screen.findByRole("heading", { name: "Email changed" })).toBeTruthy();
    expect(api.applyEmailAction).toHaveBeenCalledOnce();
    expect(api.applyEmailAction).toHaveBeenCalledWith("Code_change_1");
    expect(screen.getByRole("link", { name: "Go to sign-in" }).getAttribute("href")).toBe(
      "/login?returnTo=%2Faccount%2Fsettings",
    );
  });

  it("undoes an email change and offers a reset with the non-enumerating notice", async () => {
    api.checkAccountLink.mockResolvedValue({
      operation: "RECOVER_EMAIL",
      email: "old@example.test",
    });
    openLink("?mode=recoverEmail&oobCode=Code_recover1");
    fireEvent.click(await screen.findByRole("button", { name: "Restore my email" }));
    expect(await screen.findByRole("heading", { name: "Email change undone" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Send a password reset email" }));
    expect(
      await screen.findByText("If that email can receive a reset, instructions are on the way."),
    ).toBeTruthy();
    expect(api.sendPasswordReset).toHaveBeenCalledWith("old@example.test");
    expect(screen.getByRole("link", { name: "Go to sign-in" }).getAttribute("href")).toBe(
      "/login?returnTo=%2Faccount%2Fsettings",
    );
  });

  it("refuses a link whose code does something other than its mode says", async () => {
    api.checkAccountLink.mockResolvedValue({
      operation: "VERIFY_AND_CHANGE_EMAIL",
      email: "new@example.test",
    });
    openLink("?mode=recoverEmail&oobCode=Code_swapped1");
    expect(await screen.findByRole("heading", { name: "Link not valid" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Restore my email" })).toBeNull();
    expect(api.applyEmailAction).not.toHaveBeenCalled();
  });

  it("explains an expired link with a safe message", async () => {
    api.checkAccountLink.mockRejectedValue({ code: "auth/expired-action-code", message: "raw" });
    openLink("?mode=resetPassword&oobCode=Code_expired1");
    expect((await screen.findByRole("alert")).textContent).toMatch(/expired/);
    expect(screen.queryByText("raw")).toBeNull();
  });

  it("stops before any Auth call when App Check cannot start", async () => {
    api.prepareAccountAction.mockImplementation(() => {
      throw new Error("A Firebase App Check site key is required.");
    });
    openLink("?mode=resetPassword&oobCode=Code_noappcheck");
    expect(await screen.findByRole("heading", { name: "Link not valid" })).toBeTruthy();
    expect(api.checkAccountLink).not.toHaveBeenCalled();
    expect(screen.queryByText(/site key/)).toBeNull();
  });

  it("treats a second-factor revert link as not used and never applies it", async () => {
    openLink("?mode=revertSecondFactorAddition&oobCode=Code_mfa_12345");
    expect(await screen.findByRole("heading", { name: "Link not used" })).toBeTruthy();
    await waitFor(() => expect(window.location.search).toBe(""));
    expect(api.prepareAccountAction).not.toHaveBeenCalled();
    expect(api.applyEmailAction).not.toHaveBeenCalled();
  });
});
