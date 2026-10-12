"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";

import {
  actionErrorMessage,
  applyEmailAction,
  checkAccountLink,
  confirmNewPassword,
  prepareAccountAction,
  sendPasswordReset,
  signOutFromAuth,
} from "../../../lib/auth-client";

type ApplyMode = "verifyEmail" | "verifyAndChangeEmail" | "recoverEmail";
type View =
  | { kind: "checking" }
  | { kind: "invalid" }
  | { kind: "unsupported" }
  | { kind: "failed"; message: string }
  | { kind: "reset"; code: string; email: string }
  | { kind: "confirm"; mode: ApplyMode; code: string; email: string | undefined }
  | { kind: "done"; mode: "resetPassword" | ApplyMode; email: string | undefined };
type FieldErrors = Readonly<{ password?: string; confirm?: string }>;

// Firebase action codes are URL-safe tokens; anything else is not worth a call.
const actionCodePattern = /^[A-Za-z0-9_-]{8,512}$/u;
// The operation Firebase reports for each link mode: an edited link whose code does something else
// is refused before any button or form appears.
const expectedOperation: Readonly<Record<string, string>> = {
  resetPassword: "PASSWORD_RESET",
  verifyEmail: "VERIFY_EMAIL",
  verifyAndChangeEmail: "VERIFY_AND_CHANGE_EMAIL",
  recoverEmail: "RECOVER_EMAIL",
};

const headings: Record<View["kind"], string> = {
  checking: "Checking your link",
  invalid: "Link not valid",
  unsupported: "Link not used",
  failed: "Link not valid",
  reset: "Choose a new password",
  confirm: "Confirm your email",
  done: "Done",
};
const confirmText: Record<
  ApplyMode,
  Readonly<{ heading: string; intro: string; button: string }>
> = {
  verifyEmail: {
    heading: "Confirm your email",
    intro: "Confirm that this email address is yours.",
    button: "Confirm email",
  },
  verifyAndChangeEmail: {
    heading: "Confirm your new email",
    intro: "Your sign-in email will change to",
    button: "Confirm email change",
  },
  recoverEmail: {
    heading: "Undo the email change",
    intro: "Your sign-in email will go back to",
    button: "Restore my email",
  },
};
const doneHeadings: Record<"resetPassword" | ApplyMode, string> = {
  resetPassword: "Password changed",
  verifyEmail: "Email confirmed",
  verifyAndChangeEmail: "Email changed",
  recoverEmail: "Email change undone",
};

function SignInLink({ href = "/login" }: Readonly<{ href?: string }>) {
  return (
    <a className="button button-primary login-submit" href={href}>
      Go to sign-in
    </a>
  );
}

export function AuthAction() {
  const [view, setView] = useState<View>({ kind: "checking" });
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [failure, setFailure] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const query = new URLSearchParams(window.location.search);
    // continueUrl and apiKey are ignored: each mode has a fixed landing, and the config is our own.
    const mode = query.get("mode") ?? "";
    const code = query.get("oobCode") ?? "";
    // The one-time code leaves the address bar (history, screenshots) before anything else runs.
    window.history.replaceState(null, "", window.location.pathname);
    void (async () => {
      if (mode === "revertSecondFactorAddition") return setView({ kind: "unsupported" });
      if (!Object.hasOwn(expectedOperation, mode) || !actionCodePattern.test(code))
        return setView({ kind: "invalid" });
      try {
        prepareAccountAction();
        const link = await checkAccountLink(code);
        if (link.operation !== expectedOperation[mode]) return setView({ kind: "invalid" });
        if (mode === "resetPassword") setView({ kind: "reset", code, email: link.email ?? "" });
        else setView({ kind: "confirm", mode: mode as ApplyMode, code, email: link.email });
      } catch (error) {
        setView({ kind: "failed", message: actionErrorMessage(error) });
      }
    })();
  }, []);

  async function saveNewPassword(
    event: FormEvent<HTMLFormElement>,
    current: Extract<View, { kind: "reset" }>,
  ) {
    event.preventDefault();
    const next: { password?: string; confirm?: string } = {};
    if (password.length < 12) next.password = "Choose a new password of at least 12 characters.";
    else if (password.length > 128)
      next.password = "Choose a new password of 128 characters or fewer.";
    if (confirm !== password) next.confirm = "The new passwords do not match.";
    setFieldErrors(next);
    if (next.password || next.confirm) return;
    setBusy(true);
    setFailure("");
    try {
      await confirmNewPassword(current.code, password);
      // The reset ends every session; a stale one in this browser would only fail later.
      await signOutFromAuth().catch(() => undefined);
      setView({ kind: "done", mode: "resetPassword", email: current.email });
    } catch (error) {
      setFailure(actionErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function applyAction(current: Extract<View, { kind: "confirm" }>) {
    setBusy(true);
    setFailure("");
    try {
      await applyEmailAction(current.code);
      if (current.mode !== "verifyEmail") await signOutFromAuth().catch(() => undefined);
      setView({ kind: "done", mode: current.mode, email: current.email });
    } catch (error) {
      setFailure(actionErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function offerReset(email: string) {
    setBusy(true);
    setNotice("");
    setFailure("");
    try {
      await sendPasswordReset(email);
      setNotice("If that email can receive a reset, instructions are on the way.");
    } catch {
      setFailure("We couldn't send reset instructions. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const heading =
    view.kind === "confirm"
      ? confirmText[view.mode].heading
      : view.kind === "done"
        ? doneHeadings[view.mode]
        : headings[view.kind];
  const failureMessage = failure ? (
    <p className="login-message login-message-error" role="alert">
      {failure}
    </p>
  ) : null;

  return (
    <section
      aria-labelledby="auth-action-title"
      className="login-card"
      id="auth-action"
      tabIndex={-1}
    >
      <div className="login-card-heading">
        <p className="account-eyebrow">BPT Jersey / Account access</p>
        <h1 id="auth-action-title">{heading}</h1>
      </div>

      {view.kind === "checking" ? (
        <p className="login-message" role="status">
          Checking your link…
        </p>
      ) : null}

      {view.kind === "invalid" || view.kind === "unsupported" || view.kind === "failed" ? (
        <>
          {view.kind === "failed" ? (
            <p className="login-message login-message-error" role="alert">
              {view.message}
            </p>
          ) : (
            <p>
              {view.kind === "invalid"
                ? "This link is incomplete. Open the latest email we sent you, or ask for a new one from the sign-in page."
                : "BPT Jersey does not use this kind of link. If you did not expect it, contact the academy."}
            </p>
          )}
          <SignInLink />
        </>
      ) : null}

      {view.kind === "reset" ? (
        <form
          className="login-form"
          noValidate
          onSubmit={(event) => void saveNewPassword(event, view)}
        >
          <p>For {view.email}.</p>
          {/* Lets password managers file the new password under the right account. */}
          <input
            autoComplete="username"
            hidden
            name="username"
            readOnly
            type="email"
            value={view.email}
          />
          <div className="login-field">
            <label htmlFor="auth-action-password">New password</label>
            <input
              aria-describedby={
                fieldErrors.password ? "auth-action-password-error" : "auth-action-password-help"
              }
              aria-invalid={fieldErrors.password ? "true" : "false"}
              autoComplete="new-password"
              id="auth-action-password"
              onChange={(event) => setPassword(event.target.value)}
              type="password"
              value={password}
            />
            {fieldErrors.password ? (
              <p className="login-field-error" id="auth-action-password-error">
                {fieldErrors.password}
              </p>
            ) : (
              <p className="login-field-help" id="auth-action-password-help">
                Use 12 to 128 characters.
              </p>
            )}
          </div>
          <div className="login-field">
            <label htmlFor="auth-action-confirm">Confirm new password</label>
            <input
              aria-describedby={fieldErrors.confirm ? "auth-action-confirm-error" : undefined}
              aria-invalid={fieldErrors.confirm ? "true" : "false"}
              autoComplete="new-password"
              id="auth-action-confirm"
              onChange={(event) => setConfirm(event.target.value)}
              type="password"
              value={confirm}
            />
            {fieldErrors.confirm ? (
              <p className="login-field-error" id="auth-action-confirm-error">
                {fieldErrors.confirm}
              </p>
            ) : null}
          </div>
          {failureMessage}
          <button className="button button-primary login-submit" disabled={busy} type="submit">
            {busy ? "Saving…" : "Save new password"}
          </button>
        </form>
      ) : null}

      {view.kind === "confirm" ? (
        <>
          <p>
            {confirmText[view.mode].intro}
            {view.mode !== "verifyEmail" && view.email ? ` ${view.email}.` : ""}
          </p>
          {failureMessage}
          <button
            className="button button-primary login-submit"
            disabled={busy}
            onClick={() => void applyAction(view)}
            type="button"
          >
            {busy ? "Please wait…" : confirmText[view.mode].button}
          </button>
        </>
      ) : null}

      {view.kind === "done" ? (
        <>
          <p className="login-message" role="status">
            {view.mode === "resetPassword"
              ? "Sign in with your new password."
              : view.mode === "verifyEmail"
                ? "Your email address is confirmed."
                : view.mode === "verifyAndChangeEmail"
                  ? `Your sign-in email is now ${view.email ?? "the new address"}. Sign in with it.`
                  : `Your sign-in email is ${view.email ?? "the previous address"} again. If you did not ask for the change, reset your password now.`}
          </p>
          {view.mode === "recoverEmail" && view.email ? (
            <>
              {notice ? (
                <p className="login-message" role="status">
                  {notice}
                </p>
              ) : null}
              {failureMessage}
              <button
                className="login-reset"
                disabled={busy}
                onClick={() => void offerReset(view.email!)}
                type="button"
              >
                Send a password reset email
              </button>
            </>
          ) : null}
          {/* After an email change or its undo, settings copies the sign-in email into the profile. */}
          <SignInLink
            href={
              view.mode === "verifyAndChangeEmail" || view.mode === "recoverEmail"
                ? "/login?returnTo=%2Faccount%2Fsettings"
                : "/login"
            }
          />
        </>
      ) : null}
    </section>
  );
}
