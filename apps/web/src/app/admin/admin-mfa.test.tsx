import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const authOperations = vi.hoisted(() => ({
  beginTotpEnrollment: vi.fn(),
  completeTotpEnrollment: vi.fn(),
}));

const sessionBoundary = vi.hoisted(() => ({
  useAdminSession: vi.fn(() => ({
    status: "mfa-enrollment-required",
    user: { uid: "admin-1", email: "admin@example.test" },
    signOut: vi.fn(),
  })),
}));

vi.mock("../../lib/auth-client", () => authOperations);
vi.mock("../../lib/admin-auth", () => sessionBoundary);

import { AdminMfaChallenge, AdminMfaEnrollment } from "./admin-mfa";

describe("admin MFA UI", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("keeps enrollment blocked until a six-digit code completes the in-memory setup", async () => {
    authOperations.beginTotpEnrollment.mockResolvedValue({
      qrCodeUrl: "otpauth://synthetic-secret",
      secret: { secretKey: "synthetic-secret" },
    });
    authOperations.completeTotpEnrollment.mockResolvedValue(undefined);
    const onComplete = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();

    render(<AdminMfaEnrollment onComplete={onComplete} />);

    await waitFor(() =>
      expect(screen.getByRole("img", { name: /authenticator setup/i })).toBeVisible(),
    );
    expect(screen.getByRole("img")).not.toHaveAttribute("alt", expect.stringContaining("secret"));
    expect(screen.queryByText(/synthetic-secret|otpauth/i)).not.toBeInTheDocument();

    await user.type(screen.getByLabelText("Authenticator code"), "12345");
    await user.click(screen.getByRole("button", { name: "Complete setup" }));
    expect(authOperations.completeTotpEnrollment).not.toHaveBeenCalled();
    expect(onComplete).not.toHaveBeenCalled();

    await user.clear(screen.getByLabelText("Authenticator code"));
    await user.type(screen.getByLabelText("Authenticator code"), "123456");
    await user.click(screen.getByRole("button", { name: "Complete setup" }));

    await waitFor(() => expect(onComplete).toHaveBeenCalledOnce());
    expect(authOperations.completeTotpEnrollment).toHaveBeenCalledWith(
      expect.objectContaining({ qrCodeUrl: "otpauth://synthetic-secret" }),
      "123456",
    );
  });

  it("shows an accessible challenge and remains outside the shell on a failed code", async () => {
    const onComplete = vi.fn().mockRejectedValue(new Error("invalid"));
    const user = userEvent.setup();

    render(<AdminMfaChallenge onComplete={onComplete} />);

    expect(screen.getByRole("heading", { name: /verify your authenticator/i })).toBeVisible();
    expect(screen.getByRole("status")).toBeInTheDocument();
    await user.type(screen.getByLabelText("Authenticator code"), "123456");
    await user.click(screen.getByRole("button", { name: "Verify code" }));

    await waitFor(() => expect(screen.getByRole("alert")).toBeVisible());
    expect(screen.queryByTestId("admin-shell")).not.toBeInTheDocument();
  });
});
