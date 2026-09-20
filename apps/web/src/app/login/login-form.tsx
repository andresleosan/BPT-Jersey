"use client";

import { useState, useSyncExternalStore, type FormEvent } from "react";
import type { UserCredential } from "firebase/auth";

import {
  createClientWithEmail,
  refreshAuthToken,
  sendPasswordReset,
  signInWithEmail,
  signInWithGoogle,
  signOutFromAuth,
} from "../../lib/auth-client";
import {
  memberDestination,
  memberLoginPath,
  navigateTo,
  notStaffAccountMessage,
  resolveStaffDestination,
  sanitizeReturnPath,
  sanitizeStaffReturnPath,
  toAuthMessage,
} from "../../lib/login-flow";
import type { LoginAudience, StaffDestination } from "../../lib/login-flow";
import { acceptStaffInvitation } from "../../lib/team-access-client";
import { isStaffNumber, signInWithStaffId } from "../../lib/staff-login-client";

type LoginMode = "sign-in" | "create-client";
type FieldErrors = Readonly<{ email?: string; password?: string }>;

type LoginFormProps = Readonly<{
  /** Members sign in from the home page; staff sign in from the unlinked staff page. */
  audience: LoginAudience;
}>;

function validEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

function subscribeToLocation(onChange: () => void): () => void {
  window.addEventListener("popstate", onChange);
  return () => window.removeEventListener("popstate", onChange);
}

function useLocationSearch(): string {
  return useSyncExternalStore(
    subscribeToLocation,
    () => window.location.search,
    () => "",
  );
}

export function LoginForm({ audience }: LoginFormProps) {
  const isStaff = audience === "staff";
  const [mode, setMode] = useState<LoginMode>("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [authError, setAuthError] = useState("");
  const [notice, setNotice] = useState("");
  const [existingStaffDestination, setExistingStaffDestination] = useState<StaffDestination>();
  const [busy, setBusy] = useState(false);
  const locationSearch = useLocationSearch();
  const queryReturnTo = new URLSearchParams(locationSearch).get("returnTo");

  const isCreating = !isStaff && mode === "create-client";
  const contextTitle = isStaff ? "Staff sign-in" : "Client account";
  const submitLabel = busy
    ? isCreating
      ? "Creating account"
      : "Signing in"
    : isCreating
      ? "Create client account"
      : "Sign in";

  function clearMessages(): void {
    setFieldErrors({});
    setAuthError("");
    setNotice("");
    setExistingStaffDestination(undefined);
  }

  function validate(): FieldErrors {
    const nextErrors: { email?: string; password?: string } = {};

    if (!validEmail(email) && !(isStaff && isStaffNumber(email))) {
      nextErrors.email = isStaff
        ? "Enter your six-digit staff ID or email address."
        : "Enter a valid email address.";
    }
    if (!password.trim()) {
      nextErrors.password = "Password is required.";
    }

    return nextErrors;
  }

  async function completeSignIn(credential: UserCredential, googleSignIn = false): Promise<void> {
    if (!isStaff) {
      navigateTo(memberDestination(sanitizeReturnPath(queryReturnTo)));
      return;
    }

    if (googleSignIn) {
      try {
        await acceptStaffInvitation();
      } catch (error) {
        const existing = await refreshAuthToken(credential.user);
        const destination = resolveStaffDestination(
          { academyId: existing.claims.academyId, role: existing.claims.role },
          sanitizeStaffReturnPath(queryReturnTo),
        );
        if (!destination) throw error;
        setNotice(
          "We could not check pending access. You can retry or continue with your existing staff role.",
        );
        setExistingStaffDestination(destination);
        return;
      }
    }

    // The staff page never trusts the form: the ID token claims decide where this person works.
    const token = await refreshAuthToken(credential.user);
    const destination = resolveStaffDestination(
      { academyId: token.claims.academyId, role: token.claims.role },
      sanitizeStaffReturnPath(queryReturnTo),
    );
    if (!destination) {
      await signOutFromAuth();
      setAuthError(notStaffAccountMessage);
      return;
    }

    navigateTo(destination);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setAuthError("");
    setNotice("");
    setExistingStaffDestination(undefined);

    const nextErrors = validate();
    setFieldErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      return;
    }

    setBusy(true);
    try {
      const credential = isCreating
        ? await createClientWithEmail(email, password)
        : isStaff && isStaffNumber(email)
          ? await signInWithStaffId(email, password)
          : await signInWithEmail(email, password);
      await completeSignIn(credential);
    } catch (error) {
      setAuthError(toAuthMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function handleGoogle(): Promise<void> {
    setBusy(true);
    setAuthError("");
    setNotice("");
    setExistingStaffDestination(undefined);

    try {
      const credential = await signInWithGoogle();
      await completeSignIn(credential, true);
    } catch (error) {
      setAuthError(toAuthMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function handlePasswordReset(): Promise<void> {
    setAuthError("");
    setNotice("");
    setExistingStaffDestination(undefined);

    if (isStaff && isStaffNumber(email)) {
      setNotice(
        "For a forgotten staff ID password, contact the office. If you have linked Google, you can sign in with Google and ask the office to reset your staff password.",
      );
      return;
    }

    if (!validEmail(email)) {
      setFieldErrors({ email: "Enter your email address to reset your password." });
      return;
    }

    setBusy(true);
    try {
      await sendPasswordReset(email);
      setNotice("If that email can receive a reset, instructions are on the way.");
    } catch {
      setAuthError("We couldn't send reset instructions. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="login-card" aria-labelledby="login-title">
      <div className="login-card-heading">
        <p className="account-eyebrow">
          {isStaff ? "BPT Jersey / Staff access" : "BPT Jersey / Account access"}
        </p>
        <h1 id="login-title">{contextTitle}</h1>
        <p>
          {isStaff
            ? "Enter your staff ID or email and password. If you have linked Google, you can also sign in below."
            : "Sign in to manage your account and reach the authenticated client area."}
        </p>
      </div>

      <form
        className="login-form"
        id="login-form"
        onSubmit={(event) => void handleSubmit(event)}
        noValidate
        tabIndex={-1}
      >
        <div className="login-field">
          <label htmlFor="login-email">
            {isStaff ? "Staff ID or email address" : "Email address"}
          </label>
          <input
            aria-describedby={fieldErrors.email ? "login-email-error" : undefined}
            aria-invalid={fieldErrors.email ? "true" : "false"}
            autoComplete={isStaff ? "username" : "email"}
            id="login-email"
            onChange={(event) => setEmail(event.target.value)}
            type={isStaff ? "text" : "email"}
            value={email}
          />
          {fieldErrors.email ? (
            <p className="login-field-error" id="login-email-error">
              {fieldErrors.email}
            </p>
          ) : null}
        </div>

        <div className="login-field">
          <label htmlFor="login-password">Password</label>
          <input
            aria-describedby={fieldErrors.password ? "login-password-error" : undefined}
            aria-invalid={fieldErrors.password ? "true" : "false"}
            autoComplete={isCreating ? "new-password" : "current-password"}
            id="login-password"
            onChange={(event) => setPassword(event.target.value)}
            type="password"
            value={password}
          />
          {fieldErrors.password ? (
            <p className="login-field-error" id="login-password-error">
              {fieldErrors.password}
            </p>
          ) : null}
        </div>

        {Object.keys(fieldErrors).length > 0 ? (
          <p className="login-message login-message-error" role="alert">
            Check the highlighted fields and try again. {Object.values(fieldErrors).join(" ")}
          </p>
        ) : null}
        {authError ? (
          <p className="login-message login-message-error" role="alert">
            {authError}
          </p>
        ) : null}
        {existingStaffDestination && (
          <button
            className="login-submit"
            type="button"
            onClick={() => navigateTo(existingStaffDestination)}
          >
            Continue with existing staff access
          </button>
        )}
        {notice ? (
          <p className="login-message" role="status">
            {notice}
          </p>
        ) : null}

        <button className="button button-primary login-submit" disabled={busy} type="submit">
          {submitLabel}
        </button>
        <button
          className="button button-secondary login-google"
          disabled={busy}
          onClick={() => void handleGoogle()}
          type="button"
        >
          Continue with Google
        </button>
        <button
          className="login-reset"
          disabled={busy}
          onClick={() => void handlePasswordReset()}
          type="button"
        >
          Forgot password?
        </button>
      </form>

      <div className="login-secondary-actions">
        {audience === "member" ? (
          <a className="login-context-link" href="/login/recover">
            Already a member? Recover your access
          </a>
        ) : null}
        {isStaff ? (
          <a className="login-context-link" href={memberLoginPath}>
            Not a coach or office member? Member sign-in
          </a>
        ) : (
          <button
            className="login-mode-toggle"
            disabled={busy}
            onClick={() => {
              setMode(isCreating ? "sign-in" : "create-client");
              clearMessages();
            }}
            type="button"
          >
            {isCreating ? "Back to sign in" : "Create client account"}
          </button>
        )}
      </div>
    </section>
  );
}
