import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({ linkStaffGoogle: vi.fn(), changeStaffPassword: vi.fn() }));
vi.mock("../../../lib/staff-login-client", () => ({
  ...api,
  currentStaffAccess: () => ({ googleLinked: false }),
  isStaffNumber: (value: string) => /^\d{6}$/.test(value),
  staffAccessError: () => "Unable to update access.",
}));
import CoachAccessPage from "./page";
afterEach(cleanup);
beforeEach(() => {
  vi.resetAllMocks();
  api.linkStaffGoogle.mockResolvedValue(undefined);
  api.changeStaffPassword.mockResolvedValue(undefined);
});
describe("coach account controls", () => {
  it("links Google to the existing profile and confirms completion", async () => {
    render(<CoachAccessPage />);
    fireEvent.click(screen.getByRole("button", { name: "Link Google account" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Google linked" })).toBeDisabled(),
    );
    expect(api.linkStaffGoogle).toHaveBeenCalledOnce();
  });
  it("preserves password validation and clears secret inputs on success", async () => {
    render(<CoachAccessPage />);
    fireEvent.change(screen.getByLabelText("Staff ID"), { target: { value: "123456" } });
    fireEvent.change(screen.getByLabelText("Current password"), {
      target: { value: "synthetic-current" },
    });
    fireEvent.change(screen.getByLabelText("New password"), {
      target: { value: "synthetic-new-password" },
    });
    fireEvent.change(screen.getByLabelText("Confirm new password"), {
      target: { value: "does-not-match" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Change password" }));
    expect(api.changeStaffPassword).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Confirm new password"), {
      target: { value: "synthetic-new-password" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Change password" }));
    expect(await screen.findByText("Your staff password has been changed.")).toBeInTheDocument();
    expect(api.changeStaffPassword).toHaveBeenCalledWith(
      "123456",
      "synthetic-current",
      "synthetic-new-password",
    );
    expect(screen.getByLabelText("Current password")).toHaveValue("");
    expect(screen.getByLabelText("New password")).toHaveValue("");
  });
});
