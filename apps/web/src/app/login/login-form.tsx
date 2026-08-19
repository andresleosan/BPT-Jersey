"use client";

import { useState, useSyncExternalStore, type FormEvent } from "react";

import {
  createClientWithEmail,
  sendPasswordReset,
  signInWithEmail,
  signInWithGoogle,
} from "../../lib/auth-client";
import { defaultDestination, sanitizeReturnPath, toAuthMessage } from "../../lib/login-flow";
import type { AuthDestination, LoginRole } from "../../lib/login-flow";

type LoginMode = "sign-in" | "create-client";
type FieldErrors = Readonly<{ email?: string; password?: string }>;

type LoginFormProps = Readonly<{
  initialRole: LoginRole;
  returnPath?: AuthDestination;
}>;

function validEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

function destinationAfterLogin(role: LoginRole, returnPath?: AuthDestination): void {
  window.location.assign(defaultDestination(role, returnPath));
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

export function LoginForm({ initialRole, returnPath: initialReturnPath }: LoginFormProps) {
  const [selectedRole, setSelectedRole] = useState<LoginRole | undefined>();
  const [mode, setMode] = useState<LoginMode>("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [authError, setAuthError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const locationSearch = useLocationSearch();
  const queryParams = new URLSearchParams(locationSearch);
  const queryRole = queryParams.get("role");
  const queryRoleValue =
    queryRole === "administrator" || queryRole === "client" ? queryRole : undefined;
  const queryReturnPath = sanitizeReturnPath(queryParams.get("returnTo"));
  const activeRole: LoginRole = selectedRole ?? queryRoleValue ?? initialRole;
  const returnPath = queryReturnPath ?? initialReturnPath;

  const isCreating = mode === "create-client" && activeRole === "client";
  const contextTitle = activeRole === "administrator" ? "Team access" : "Client account";
  const submitLabel = busy
    ? isCreating
      ? "Creating account"
      : "Signing in"
    : isCreating
      ? "Create client account"
      : "Sign in";

  function changeRole(nextRole: LoginRole): void {
    if (busy) {
      return;
    }

    setSelectedRole(nextRole);
    if (nextRole === "administrator") {
      setMode("sign-in");
    }
    setFieldErrors({});
    setAuthError("");
    setNotice("");
  }

  function validate(): FieldErrors {
    const nextErrors: { email?: string; password?: string } = {};

    if (!validEmail(email)) {
      nextErrors.email = "Enter a valid email address.";
    }
    if (!password.trim()) {
      nextErrors.password = "Password is required.";
    }

    return nextErrors;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setAuthError("");
    setNotice("");

    const nextErrors = validate();
    setFieldErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      return;
    }

    setBusy(true);
    try {
      if (isCreating) {
        await createClientWithEmail(email, password);
      } else {
        await signInWithEmail(email, password);
      }
      destinationAfterLogin(activeRole, returnPath);
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

    try {
      await signInWithGoogle();
      destinationAfterLogin(activeRole, returnPath);
    } catch (error) {
      setAuthError(toAuthMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function handlePasswordReset(): Promise<void> {
    setAuthError("");
    setNotice("");

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
        <p className="account-eyebrow">BPT Jersey / Account access</p>
        <h1 id="login-title">{contextTitle}</h1>
        <p>
          {activeRole === "administrator"
            ? "Use your provisioned academy account to enter the operations workspace."
            : "Sign in to manage your account and reach the authenticated client area."}
        </p>
      </div>

      <fieldset className="login-role-selector" disabled={busy}>
        <legend>Choose your access context</legend>
        <div className="login-role-options">
          <button
            aria-pressed={activeRole === "administrator"}
            onClick={() => changeRole("administrator")}
            type="button"
          >
            Administrator
          </button>
          <button
            aria-pressed={activeRole === "client"}
            onClick={() => changeRole("client")}
            type="button"
          >
            Client
          </button>
        </div>
      </fieldset>

      <form
        className="login-form"
        id="login-form"
        onSubmit={(event) => void handleSubmit(event)}
        noValidate
        tabIndex={-1}
      >
        <div className="login-field">
          <label htmlFor="login-email">Email address</label>
          <input
            aria-describedby={fieldErrors.email ? "login-email-error" : undefined}
            aria-invalid={fieldErrors.email ? "true" : "false"}
            autoComplete="email"
            id="login-email"
            onChange={(event) => setEmail(event.target.value)}
            type="email"
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
        {activeRole === "client" ? (
          <button
            className="login-mode-toggle"
            disabled={busy}
            onClick={() => {
              setMode(isCreating ? "sign-in" : "create-client");
              setFieldErrors({});
              setAuthError("");
              setNotice("");
            }}
            type="button"
          >
            {isCreating ? "Back to sign in" : "Create client account"}
          </button>
        ) : (
          <a
            className="login-context-link"
            href="/login?role=client"
            onClick={(event) => {
              event.preventDefault();
              changeRole("client");
            }}
          >
            Back to client access
          </a>
        )}
      </div>
    </section>
  );
}
