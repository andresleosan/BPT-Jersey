import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const authOperations = vi.hoisted(() => ({
  createClientWithEmail: vi.fn(),
  refreshAuthToken: vi.fn(),
  sendPasswordReset: vi.fn(),
  signInWithEmail: vi.fn(),
  signInWithGoogle: vi.fn(),
  signOutFromAuth: vi.fn(),
}));
const navigation = vi.hoisted(() => ({ navigateTo: vi.fn() }));

vi.mock("../../lib/auth-client", () => authOperations);

vi.mock("../../lib/login-flow", async () => {
  const actual =
    await vi.importActual<typeof import("../../lib/login-flow")>("../../lib/login-flow");
  return { ...actual, navigateTo: navigation.navigateTo };
});

import { LoginForm } from "./login-form";

const signedInUser = { uid: "user-1", email: "person@example.test" };

async function signInWithEmailAs(email: string): Promise<void> {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Email address"), email);
  await user.type(screen.getByLabelText("Password"), "password");
  await user.click(screen.getByRole("button", { name: "Sign in" }));
}

describe("LoginForm", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    window.history.replaceState({}, "", "/");
  });

  it("offers members registration, Google and password reset with no staff context", () => {
    render(<LoginForm audience="member" />);

    expect(screen.getByRole("heading", { name: "Client account" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Create client account" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Continue with Google" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Forgot password?" })).toBeVisible();
    expect(screen.getByLabelText("Email address")).toBeVisible();
    expect(screen.getByLabelText("Password")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Administrator" })).not.toBeInTheDocument();
    expect(screen.queryByText(/staff|administrator|coach/i)).not.toBeInTheDocument();
  });

  it("ignores a legacy role parameter on the member form", () => {
    window.history.replaceState({}, "", "/login?role=administrator");
    render(<LoginForm audience="member" />);

    expect(screen.getByRole("heading", { name: "Client account" })).toBeVisible();
    expect(screen.queryByText(/staff/i)).not.toBeInTheDocument();
  });

  it("hides registration for staff and points non-staff back to the member sign-in", () => {
    render(<LoginForm audience="staff" />);

    expect(screen.getByRole("heading", { name: "Staff sign-in" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Create client account" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /member sign-in/i })).toHaveAttribute("href", "/login");
    expect(screen.getByRole("button", { name: "Continue with Google" })).toBeVisible();
  });

  it("blocks invalid email and password submission accessibly", async () => {
    const user = userEvent.setup();
    render(<LoginForm audience="member" />);

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
    render(<LoginForm audience="member" />);

    await signInWithEmailAs("client@example.test");

    expect(screen.getByRole("button", { name: "Signing in" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Continue with Google" })).toBeDisabled();
  });

  it("renders a generic Firebase error without infrastructure details", async () => {
    authOperations.signInWithEmail.mockRejectedValue({
      code: "auth/invalid-credential",
      message: "token=private-value",
    });
    render(<LoginForm audience="member" />);

    await signInWithEmailAs("client@example.test");

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(/couldn't sign you in/i),
    );
    expect(screen.getByRole("alert")).not.toHaveTextContent(
      /private-value|auth\/invalid-credential/i,
    );
    expect(navigation.navigateTo).not.toHaveBeenCalled();
  });

  it("sends a member to the allowlisted return path after signing in", async () => {
    window.history.replaceState({}, "", "/login?returnTo=%2Fshop");
    authOperations.signInWithEmail.mockResolvedValue({ user: signedInUser });
    render(<LoginForm audience="member" />);

    await signInWithEmailAs("client@example.test");

    await waitFor(() => expect(navigation.navigateTo).toHaveBeenCalledWith("/shop"));
    expect(authOperations.refreshAuthToken).not.toHaveBeenCalled();
  });

  it("sends a member to the account home when the return path is not allowlisted", async () => {
    window.history.replaceState({}, "", "/login?returnTo=%2Fadmin");
    authOperations.signInWithEmail.mockResolvedValue({ user: signedInUser });
    render(<LoginForm audience="member" />);

    await signInWithEmailAs("client@example.test");

    await waitFor(() => expect(navigation.navigateTo).toHaveBeenCalledWith("/account"));
  });

  it("routes an office account to the admin workspace by its claims", async () => {
    authOperations.signInWithEmail.mockResolvedValue({ user: signedInUser });
    authOperations.refreshAuthToken.mockResolvedValue({
      claims: { academyId: "demo-academy", role: "administrator" },
    });
    render(<LoginForm audience="staff" />);

    await signInWithEmailAs("office@example.test");

    await waitFor(() => expect(navigation.navigateTo).toHaveBeenCalledWith("/admin"));
    expect(authOperations.refreshAuthToken).toHaveBeenCalledWith(signedInUser);
    expect(authOperations.signOutFromAuth).not.toHaveBeenCalled();
  });

  it("routes a coach to the coach portal, honouring a coach return path", async () => {
    window.history.replaceState({}, "", "/staff/login?returnTo=%2Fcoach%2Flevels");
    authOperations.signInWithGoogle.mockResolvedValue({ user: signedInUser });
    authOperations.refreshAuthToken.mockResolvedValue({
      claims: { academyId: "demo-academy", role: "coach" },
    });
    const user = userEvent.setup();
    render(<LoginForm audience="staff" />);

    await user.click(screen.getByRole("button", { name: "Continue with Google" }));

    await waitFor(() => expect(navigation.navigateTo).toHaveBeenCalledWith("/coach/levels"));
  });

  it("signs a non-staff account straight back out of the staff page", async () => {
    authOperations.signInWithEmail.mockResolvedValue({ user: signedInUser });
    authOperations.refreshAuthToken.mockResolvedValue({
      claims: { academyId: "demo-academy", role: "guardian" },
    });
    render(<LoginForm audience="staff" />);

    await signInWithEmailAs("parent@example.test");

    await waitFor(() => expect(authOperations.signOutFromAuth).toHaveBeenCalledOnce());
    expect(screen.getByRole("alert")).toHaveTextContent(/not a staff account/i);
    expect(screen.getByRole("alert")).not.toHaveTextContent(/guardian|demo-academy|user-1/);
    expect(navigation.navigateTo).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Email address")).toBeVisible();
  });

  it("keeps an MFA-required email failure inside the MFA-free staff flow", async () => {
    authOperations.signInWithEmail.mockRejectedValue({
      code: "auth/multi-factor-auth-required",
      message: "resolver=private-value",
    });
    render(<LoginForm audience="staff" />);

    await signInWithEmailAs("admin@example.test");

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/couldn't complete/i));
    expect(screen.getByRole("heading", { name: "Staff sign-in" })).toBeVisible();
    expect(screen.getByLabelText("Email address")).toBeVisible();
    expect(
      screen.queryByRole("heading", { name: /verify your authenticator/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).not.toHaveTextContent(
      /private-value|auth\/multi-factor-auth-required/i,
    );
  });

  it("keeps an MFA-required Google failure inside the MFA-free staff flow", async () => {
    authOperations.signInWithGoogle.mockRejectedValue({
      code: "auth/multi-factor-auth-required",
      message: "resolver=private-value",
    });
    const user = userEvent.setup();
    render(<LoginForm audience="staff" />);

    await user.click(screen.getByRole("button", { name: "Continue with Google" }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/couldn't complete/i));
    expect(screen.getByRole("heading", { name: "Staff sign-in" })).toBeVisible();
    expect(screen.getByLabelText("Email address")).toBeVisible();
    expect(
      screen.queryByRole("heading", { name: /verify your authenticator/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).not.toHaveTextContent(
      /private-value|auth\/multi-factor-auth-required/i,
    );
  });
});
