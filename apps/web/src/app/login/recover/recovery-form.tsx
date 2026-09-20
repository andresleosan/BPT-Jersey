"use client";
import { useEffect, useEffectEvent, useRef, useState, type FormEvent } from "react";
import type {
  CompleteMemberRecoveryResult,
  MemberRecoveryProfile,
} from "@bpt-jersey/domain/members/recovery";
import {
  recoverySignIn,
  refreshRecoverySession,
  sendRecoveryVerification,
  subscribeRecoverySession,
  signOutRecovery,
  resetRecoveryPassword,
  type RecoverySession,
} from "../../../lib/member-recovery-auth";
import { navigateTo } from "../../../lib/login-flow";
import { loadRecoveryClient } from "../../../lib/member-recovery-loader";

// Keep validation and callable code out of the initial form bundle. Focusing the
// form warms the chunk without sending a request or creating a recovery ticket.
function prepareRecoveryClient() {
  void loadRecoveryClient().catch(() => {
    // Submission retries the import and reports a safe error if it still fails.
  });
}

const ticketKey = "bpt-member-recovery";
const genericError = "Unable to continue. Please try again or contact the BPT Jersey office.";
function saveTicket(value?: string) {
  try {
    if (value) sessionStorage.setItem(ticketKey, value);
    else sessionStorage.removeItem(ticketKey);
  } catch {
    /* Recovery can continue without browser storage. */
  }
}
function readTicket(): string | undefined {
  try {
    const value = sessionStorage.getItem(ticketKey);
    return value && /^[a-f0-9]{64}$/u.test(value) ? value : undefined;
  } catch {
    return undefined;
  }
}
function safeError(error: unknown): string {
  const code =
    typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
  if (code.endsWith("resource-exhausted") || code === "auth/too-many-requests")
    return "Too many attempts. Please wait a few minutes and try again.";
  if (code.endsWith("not-found") || code.endsWith("deadline-exceeded"))
    return "This recovery request has expired. Please start again.";
  if (code === "auth/network-request-failed" || code === "functions/unavailable")
    return "We could not connect. Check your connection and try again. Your details are still here.";
  if (code === "auth/popup-blocked")
    return "Allow pop-ups to continue with Google, or use email and password below.";
  if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request")
    return "The Google sign-in window was closed. Try again or use email and password below.";
  if (code === "auth/weak-password") return "Choose a stronger password and try again.";
  if (code === "auth/invalid-credential")
    return "We could not sign you in. Check your details or reset your password.";
  return genericError;
}
type RecoveryOperation = { generation: number; request: number; current: () => boolean };
export function RecoveryForm() {
  const [ticket, setTicket] = useState<string>();
  const [session, setSession] = useState<RecoverySession | null>(null);
  const [result, setResult] = useState<CompleteMemberRecoveryResult>();
  const [profile, setProfile] = useState<MemberRecoveryProfile>({});
  const [mode, setMode] = useState<"create" | "sign-in">("create");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const formRegion = useRef<HTMLElement>(null);
  const inFlight = useRef(false);
  const restored = useRef(false);
  const currentSession = useRef<RecoverySession | null>(null);
  const identityGeneration = useRef(0);
  const requestGeneration = useRef(0);
  const [opening, setOpening] = useState(false);

  function acceptSession(current: RecoverySession | null) {
    if (currentSession.current?.uid !== current?.uid) {
      identityGeneration.current += 1;
      inFlight.current = false;
      setBusy(false);
      setResult(undefined);
      setProfile({});
      setError(undefined);
      setNotice(undefined);
      setOpening(false);
      setEmail("");
      setPassword("");
      setMode("create");
    }
    currentSession.current = current;
    setSession(current);
  }
  async function finalize(operation: RecoveryOperation) {
    const refreshed = await refreshRecoverySession(currentSession.current?.uid);
    if (!operation.current() || refreshed.uid !== currentSession.current?.uid) return;
    setOpening(true);
    saveTicket();
    navigateTo("/account");
  }
  async function showOutcome(
    id: string,
    operation: RecoveryOperation,
    fields?: MemberRecoveryProfile,
  ) {
    const { completeMemberRecovery } = await loadRecoveryClient();
    if (!operation.current()) return;
    const outcome = await completeMemberRecovery({
      recoveryId: id,
      ...(fields ? { profile: fields } : {}),
    });
    if (!operation.current()) return;
    setResult(outcome);
    if (outcome.status === "profile-required") setProfile(outcome.profile ?? {});
    if (outcome.status === "linked") await finalize(operation);
  }
  async function run(action: (operation: RecoveryOperation) => Promise<void>) {
    if (inFlight.current) return;
    const operation: RecoveryOperation = {
      generation: identityGeneration.current,
      request: ++requestGeneration.current,
      current: () =>
        operation.generation === identityGeneration.current &&
        operation.request === requestGeneration.current,
    };
    inFlight.current = true;
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    try {
      await action(operation);
    } catch (failure) {
      if (operation.current()) setError(safeError(failure));
    } finally {
      if (operation.current()) {
        inFlight.current = false;
        setBusy(false);
      }
    }
  }
  const observeSession = useEffectEvent((current: RecoverySession | null, saved?: string) => {
    const alreadyContinuing = inFlight.current;
    acceptSession(current);
    if (saved && current && !restored.current) {
      restored.current = true;
      if (alreadyContinuing) return;
      void run(async (operation) => {
        await refreshRecoverySession(current.uid);
        if (operation.current()) await showOutcome(saved, operation);
      });
    }
  });
  useEffect(() => {
    const saved = readTicket();
    if (saved) setTicket(saved);
    let unsubscribe: (() => void) | undefined;
    try {
      unsubscribe = subscribeRecoverySession((current) => observeSession(current, saved));
    } catch (failure) {
      setError(safeError(failure));
    }
    return () => {
      identityGeneration.current += 1;
      inFlight.current = false;
      restored.current = false;
      unsubscribe?.();
    };
    // Restore once; subsequent authentication actions explicitly complete their own request.
  }, []);
  async function start(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const previousEmail = String(data.get("previousEmail") ?? "").trim();
    await run(async (operation) => {
      const { beginMemberRecovery } = await loadRecoveryClient();
      if (!operation.current()) return;
      const begun = await beginMemberRecovery({
        fullName: String(data.get("fullName")).trim(),
        ...(previousEmail ? { email: previousEmail } : {}),
      });
      if (!operation.current()) return;
      setTicket(begun.recoveryId);
      saveTicket(begun.recoveryId);
    });
  }
  async function authenticate(kind: "google" | "create" | "sign-in") {
    if (!ticket) return;
    await run(async (operation) => {
      const initialUid = currentSession.current?.uid;
      try {
        const current = await recoverySignIn(kind, email, password);
        // Firebase can notify the observer before the sign-in promise resolves.
        // Permit only this action's initial sign-in transition, never a later switch/logout.
        if (operation.request !== requestGeneration.current) return;
        if (
          !operation.current() &&
          !(
            initialUid === undefined &&
            currentSession.current?.uid === current.uid &&
            identityGeneration.current === operation.generation + 1
          )
        )
          return;
        acceptSession(current);
        operation.generation = identityGeneration.current;
        inFlight.current = true;
        setBusy(true);
        setPassword("");
        if (kind === "create") {
          // Bind the request before email delivery so it is visible to the office even if delivery fails.
          await showOutcome(ticket, operation);
          if (!operation.current()) return;
          setResult({ status: "verify-email" });
          try {
            await sendRecoveryVerification(current.uid);
            if (!operation.current()) return;
            setNotice("Verification email sent. Check your inbox and spam folder.");
          } catch {
            if (!operation.current()) return;
            setError(
              "Your account was created, but we could not send the verification email. Please use Resend verification email.",
            );
            return;
          }
        }
        if (kind !== "create" && operation.current()) await showOutcome(ticket, operation);
      } catch (failure) {
        if (!operation.current()) return;
        const code =
          typeof failure === "object" && failure !== null && "code" in failure ? failure.code : "";
        if (
          code === "auth/email-already-in-use" ||
          code === "auth/account-exists-with-different-credential"
        ) {
          setMode("sign-in");
          setPassword("");
          setError(
            "This email already has an account. Sign in with its existing password or use Google.",
          );
        } else throw failure;
      }
    });
  }
  function check() {
    if (ticket)
      void run(async (operation) => {
        const current = await refreshRecoverySession(currentSession.current?.uid);
        if (!operation.current() || current.uid !== currentSession.current?.uid) return;
        acceptSession(current);
        await showOutcome(ticket, operation);
      });
  }
  function restart() {
    requestGeneration.current += 1;
    setOpening(false);
    saveTicket();
    setTicket(undefined);
    setResult(undefined);
    setProfile({});
    setError(undefined);
    setNotice(undefined);
    setPassword("");
  }
  useEffect(() => {
    if (!ticket) return;
    formRegion.current?.querySelector<HTMLElement>("h2")?.focus();
  }, [ticket, result?.status]);
  const choices = ticket && !result;
  return (
    <section
      ref={formRegion}
      className="login-form recovery-form"
      aria-labelledby="recovery-title"
      onFocusCapture={prepareRecoveryClient}
    >
      <p className="login-eyebrow">Existing members</p>
      <h1 id="recovery-title">Recover your access</h1>
      <p>Reconnect your account with your BPT Jersey membership.</p>
      {error ? (
        <p role="alert" className="login-error">
          {error}
        </p>
      ) : null}
      <p className="recovery-feedback" role="status" aria-live="polite" aria-atomic="true">
        {busy
          ? ticket
            ? "Please wait while we update your recovery request..."
            : "Finding your membership..."
          : notice}
      </p>
      {!ticket ? (
        <form aria-busy={busy} onSubmit={(event) => void start(event)}>
          <fieldset disabled={busy} className="recovery-fields">
            <label>
              Full name
              <input name="fullName" autoComplete="name" required maxLength={160} />
            </label>
            <label>
              Previous email address (optional)
              <input
                name="previousEmail"
                type="email"
                autoComplete="email"
                aria-describedby="previous-email-help"
                maxLength={320}
              />
            </label>
            <p id="previous-email-help">
              Enter the full name you used when you joined. Leave the email blank if you did not
              have one or cannot remember it. You can use Google or a new email address in the next
              step. The office will check your identity before linking a new address.
            </p>
            <button className="button button-primary" type="submit">
              {busy ? "Finding your membership..." : "Find my membership"}
            </button>
          </fieldset>
        </form>
      ) : null}
      {choices ? (
        <>
          <h2 tabIndex={-1}>Choose how to sign in</h2>
          <p>
            Continue to verify your email and request access. If your details need checking, the
            office will review your request.
          </p>
          {session ? (
            <div>
              <p>Signed in as {session.email ?? "your current account"}.</p>
              <button
                type="button"
                className="button button-primary"
                disabled={busy}
                onClick={check}
              >
                Continue with this account
              </button>
              <button
                type="button"
                className="login-mode-toggle"
                disabled={busy}
                onClick={() =>
                  void run(async (operation) => {
                    await signOutRecovery();
                    if (operation.current()) acceptSession(null);
                  })
                }
              >
                Use a different account
              </button>
            </div>
          ) : (
            <>
              <button
                className="button button-secondary"
                disabled={busy}
                type="button"
                onClick={() => void authenticate("google")}
              >
                Continue with Google
              </button>
              <form
                aria-busy={busy}
                onSubmit={(event) => {
                  event.preventDefault();
                  void authenticate(mode);
                }}
              >
                <fieldset className="recovery-fields" disabled={busy}>
                  <label>
                    Email address
                    <input
                      type="email"
                      autoComplete="email"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      required
                      maxLength={320}
                    />
                  </label>
                  <label>
                    {mode === "create" ? "New password" : "Password"}
                    <input
                      type="password"
                      autoComplete={mode === "create" ? "new-password" : "current-password"}
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      required
                      minLength={mode === "create" ? 8 : 1}
                    />
                  </label>
                  {mode === "create" ? (
                    <p>Use at least 8 characters. You will need to verify this email address.</p>
                  ) : null}
                  <button className="button button-primary" type="submit">
                    {mode === "create" ? "Create account and continue" : "Sign in and continue"}
                  </button>
                  <button
                    type="button"
                    className="login-mode-toggle"
                    onClick={() => {
                      setMode(mode === "create" ? "sign-in" : "create");
                      setPassword("");
                    }}
                  >
                    {mode === "create" ? "I already have an account" : "Create a new account"}
                  </button>
                  {mode === "sign-in" ? (
                    <button
                      type="button"
                      className="login-reset"
                      onClick={() =>
                        void run(async (operation) => {
                          if (!email.trim()) {
                            setError("Enter your email address first.");
                            return;
                          }
                          await resetRecoveryPassword(email);
                          if (!operation.current()) return;
                          setNotice(
                            "If a password account exists for that email, you will receive a reset link. Return here after resetting your password.",
                          );
                        })
                      }
                    >
                      Forgot password?
                    </button>
                  ) : null}
                </fieldset>
              </form>
            </>
          )}
        </>
      ) : null}
      {result?.status === "verify-email" ? (
        <div>
          <h2 tabIndex={-1}>Verify your email</h2>
          <p>
            Verify {session?.email ?? "your account address"} by opening the link in your
            verification email, then return here.
          </p>
          <button
            type="button"
            className="button button-secondary"
            disabled={busy}
            onClick={() =>
              void run(async (operation) => {
                await sendRecoveryVerification(currentSession.current?.uid);
                if (!operation.current()) return;
                setNotice("Verification email sent. Check your inbox and spam folder.");
              })
            }
          >
            Resend verification email
          </button>
          <button type="button" className="button button-primary" disabled={busy} onClick={check}>
            I have verified my email
          </button>
        </div>
      ) : null}
      {result?.status === "pending-review" ? (
        <div>
          <h2 tabIndex={-1}>Request awaiting review</h2>
          <p>
            Your request has been sent to the office under Enrolment requests. An administrator will
            verify your old membership before approving access to your existing profile and history.
            Contact BPT Jersey if you need help or no longer know your previous email. Requests for
            children need the guardian process.
          </p>
          <button type="button" className="button button-secondary" disabled={busy} onClick={check}>
            Check request status
          </button>
        </div>
      ) : null}
      {result?.status === "rejected" ? (
        <p role="status">
          We could not approve this request. Contact the BPT Jersey office for help.
        </p>
      ) : null}
      {result?.status === "profile-required" ? (
        <form
          aria-busy={busy}
          onSubmit={(event) => {
            event.preventDefault();
            if (ticket)
              void run(async (operation) => {
                if (!profile.trainingTimePreferences?.length) {
                  setError("Choose at least one training time.");
                  return;
                }
                await showOutcome(ticket, operation, profile);
              });
          }}
        >
          <h2 tabIndex={-1}>Complete your details</h2>
          <p>Please confirm the details needed for your member account.</p>
          <fieldset className="recovery-fields" disabled={busy}>
            <label>
              Date of birth
              <input
                type="date"
                required
                value={profile.dateOfBirth ?? ""}
                onChange={(event) => setProfile({ ...profile, dateOfBirth: event.target.value })}
              />
            </label>
            <label>
              Phone number
              <input
                type="tel"
                autoComplete="tel"
                required
                minLength={7}
                maxLength={40}
                value={profile.phoneNumber ?? ""}
                onChange={(event) => setProfile({ ...profile, phoneNumber: event.target.value })}
              />
            </label>
            <label>
              Training centre
              <select
                required
                value={profile.trainingCenter ?? ""}
                onChange={(event) =>
                  setProfile({ ...profile, trainingCenter: event.target.value as "Town" | "West" })
                }
              >
                <option value="" disabled>
                  Choose a centre
                </option>
                <option value="Town">Town</option>
                <option value="West">West</option>
              </select>
            </label>
            <fieldset>
              <legend>Preferred training times</legend>
              {(["morning", "afternoon", "evening"] as const).map((time) => (
                <label className="recovery-checkbox" key={time}>
                  <input
                    type="checkbox"
                    checked={profile.trainingTimePreferences?.includes(time) ?? false}
                    onChange={(event) =>
                      setProfile({
                        ...profile,
                        trainingTimePreferences: event.target.checked
                          ? [...(profile.trainingTimePreferences ?? []), time]
                          : profile.trainingTimePreferences?.filter((value) => value !== time),
                      })
                    }
                  />
                  {time[0]?.toUpperCase()}
                  {time.slice(1)}
                </label>
              ))}
            </fieldset>
            <button type="submit" className="button button-primary">
              Save and recover access
            </button>
          </fieldset>
        </form>
      ) : null}
      {result?.status === "linked" ? (
        <div>
          <p role="status">
            {opening
              ? "Access restored. Opening your account..."
              : "Your membership is linked. Finish opening your account."}
          </p>
          {!opening ? (
            <button
              type="button"
              className="button button-primary"
              disabled={busy}
              onClick={() => void run(finalize)}
            >
              Retry opening your account
            </button>
          ) : null}
        </div>
      ) : null}
      {ticket ? (
        <button type="button" className="login-mode-toggle" disabled={busy} onClick={restart}>
          Start again
        </button>
      ) : null}
      <a className="login-context-link" href="/login">
        Back to sign in
      </a>
    </section>
  );
}
