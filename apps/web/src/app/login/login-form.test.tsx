import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const authOperations = vi.hoisted(() => ({
  createClientWithEmail: vi.fn(),
  sendPasswordReset: vi.fn(),
  signInWithEmail: vi.fn(),
  signInWithGoogle: vi.fn(),
}));

vi.mock("../../lib/auth-client", () => authOperations);

vi.mock("../../lib/login-flow", async () => {
  const actual =
    await vi.importActual<typeof import("../../lib/login-flow")>("../../lib/login-flow");
  return actual;
});

import { LoginForm } from "./login-form";

describe("LoginForm", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("shows client registration and accessible controls for client context", () => {
    render(<LoginForm initialRole="client" />);

    expect(screen.getByRole("button", { name: "Client" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Administrator" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(screen.getByRole("button", { name: "Create client account" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Continue with Google" })).toBeVisible();
    expect(screen.getByLabelText("Email address")).toBeVisible();
    expect(screen.getByLabelText("Password")).toBeVisible();
  });

  it("hides client registration for administrator context", () => {
    render(<LoginForm initialRole="administrator" />);

    expect(screen.getByRole("button", { name: "Administrator" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.queryByRole("button", { name: "Create client account" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to client access" })).toBeVisible();
  });

  it("changes role context without creating an administrative permission", async () => {
    const user = userEvent.setup();
    render(<LoginForm initialRole="administrator" />);

    await user.click(screen.getByRole("button", { name: "Client" }));

    expect(screen.getByRole("button", { name: "Create client account" })).toBeVisible();
    expect(screen.getByText("Client account")).toBeVisible();
  });

  it("blocks invalid email and password submission accessibly", async () => {
    const user = userEvent.setup();
    render(<LoginForm initialRole="client" />);

    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(screen.getByLabelText("Email address")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("Password")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("alert")).toHaveTextContent(
      /enter a valid email|password is required/i,
    );
    expect(authOperations.signInWithEmail).not.toHaveBeenCalled();
  });

  it("disables duplicate actions while an email sign-in is pending", async () => {
    authOperations.signInWithEmail.mockReturnValue(new Promise<void>(() => undefined));
    const user = userEvent.setup();
    render(<LoginForm initialRole="client" />);

    await user.type(screen.getByLabelText("Email address"), "client@example.test");
    await user.type(screen.getByLabelText("Password"), "password");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(screen.getByRole("button", { name: "Signing in" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Continue with Google" })).toBeDisabled();
  });

  it("renders a generic Firebase error without infrastructure details", async () => {
    authOperations.signInWithEmail.mockRejectedValue({
      code: "auth/invalid-credential",
      message: "token=private-value",
    });
    const user = userEvent.setup();
    render(<LoginForm initialRole="client" />);

    await user.type(screen.getByLabelText("Email address"), "client@example.test");
    await user.type(screen.getByLabelText("Password"), "password");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(/couldn't sign you in/i),
    );
    expect(screen.getByRole("alert")).not.toHaveTextContent(
      /private-value|auth\/invalid-credential/i,
    );
  });

  it("keeps an MFA-required email failure inside the MFA-free login flow", async () => {
    authOperations.signInWithEmail.mockRejectedValue({
      code: "auth/multi-factor-auth-required",
      message: "resolver=private-value",
    });
    const user = userEvent.setup();
    render(<LoginForm initialRole="administrator" />);

    await user.type(screen.getByLabelText("Email address"), "admin@example.test");
    await user.type(screen.getByLabelText("Password"), "password");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/couldn't complete/i));
    expect(screen.getByRole("heading", { name: "Team access" })).toBeVisible();
    expect(screen.getByLabelText("Email address")).toBeVisible();
    expect(
      screen.queryByRole("heading", { name: /verify your authenticator/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).not.toHaveTextContent(
      /private-value|auth\/multi-factor-auth-required/i,
    );
  });

  it("keeps an MFA-required Google failure inside the MFA-free login flow", async () => {
    authOperations.signInWithGoogle.mockRejectedValue({
      code: "auth/multi-factor-auth-required",
      message: "resolver=private-value",
    });
    const user = userEvent.setup();
    render(<LoginForm initialRole="administrator" />);

    await user.click(screen.getByRole("button", { name: "Continue with Google" }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/couldn't complete/i));
    expect(screen.getByRole("heading", { name: "Team access" })).toBeVisible();
    expect(screen.getByLabelText("Email address")).toBeVisible();
    expect(
      screen.queryByRole("heading", { name: /verify your authenticator/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).not.toHaveTextContent(
      /private-value|auth\/multi-factor-auth-required/i,
    );
  });
});
