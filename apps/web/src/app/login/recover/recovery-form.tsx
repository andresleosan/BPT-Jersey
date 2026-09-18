"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type {
  CompleteMemberRecoveryResult,
  MemberRecoveryProfile,
} from "@bpt-jersey/domain/members/recovery";
import { beginMemberRecovery, completeMemberRecovery } from "../../../lib/member-recovery-client";
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
  if (code === "auth/weak-password") return "Choose a stronger password and try again.";
  if (code === "auth/invalid-credential")
    return "We could not sign you in. Check your details or reset your password.";
  return genericError;
}
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
  const inFlight = useRef(false);
  const restored = useRef(false);

  async function showOutcome(id: string, fields?: MemberRecoveryProfile) {
    const outcome = await completeMemberRecovery({
      recoveryId: id,
      ...(fields ? { profile: fields } : {}),
    });
    setResult(outcome);
    if (outcome.status === "profile-required") setProfile(outcome.profile ?? {});
    if (outcome.status === "linked") {
      await refreshRecoverySession();
      saveTicket();
      navigateTo("/account");
    }
  }
  async function run(action: () => Promise<void>) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    try {
      await action();
    } catch (failure) {
      setError(safeError(failure));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  useEffect(() => {
    const saved = readTicket();
    if (saved) setTicket(saved);
    return subscribeRecoverySession((current) => {
      setSession(current);
      if (saved && current && !restored.current) {
        restored.current = true;
        void run(async () => {
          await refreshRecoverySession();
          await showOutcome(saved);
        });
      }
    });
    // Restore once; subsequent authentication actions explicitly complete their own request.
  }, []);
  async function start(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    await run(async () => {
      const begun = await beginMemberRecovery({
        fullName: String(data.get("fullName")).trim(),
        email: String(data.get("previousEmail")).trim(),
      });
      setTicket(begun.recoveryId);
      saveTicket(begun.recoveryId);
    });
  }
  async function authenticate(kind: "google" | "create" | "sign-in") {
    if (!ticket) return;
    await run(async () => {
      try {
        const current = await recoverySignIn(kind, email, password);
        setSession(current);
        setPassword("");
        await showOutcome(ticket);
      } catch (failure) {
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
      void run(async () => {
        setSession(await refreshRecoverySession());
        await showOutcome(ticket);
      });
  }
  function restart() {
    saveTicket();
    setTicket(undefined);
    setResult(undefined);
    setProfile({});
    setError(undefined);
    setNotice(undefined);
    setPassword("");
  }
  const choices = ticket && !result;
  return (
    <section className="login-form recovery-form" aria-labelledby="recovery-title" aria-busy={busy}>
      <p className="login-eyebrow">Existing members</p>
      <h1 id="recovery-title">Recover your access</h1>
      <p>Reconnect your account with your BPT Jersey membership.</p>
      {error ? (
        <p role="alert" className="login-error">
          {error}
        </p>
      ) : null}
      {notice ? <p role="status">{notice}</p> : null}
      {!ticket ? (
        <form onSubmit={(event) => void start(event)}>
          <fieldset disabled={busy} className="recovery-fields">
            <label>
              Full name
              <input name="fullName" autoComplete="name" required maxLength={160} />
            </label>
            <label>
              Previous email address
              <input
                name="previousEmail"
                type="email"
                autoComplete="email"
                required
                maxLength={320}
              />
            </label>
            <p>
              Enter the name and email you used when you joined. If your email has changed, you can
              use a new address in the next step.
            </p>
            <button className="button button-primary" type="submit">
              Find my membership
            </button>
          </fieldset>
        </form>
      ) : null}
      {choices ? (
        <>
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
                  void run(async () => {
                    await signOutRecovery();
                    setSession(null);
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
                        void run(async () => {
                          if (!email.trim()) {
                            setError("Enter your email address first.");
                            return;
                          }
                          await resetRecoveryPassword(email);
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
          <h2>Verify your email</h2>
          <p>
            Send a verification email to {session?.email ?? "your account address"}, then open its
            link and return here.
          </p>
          <button
            type="button"
            className="button button-secondary"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await sendRecoveryVerification();
                setNotice("Verification email sent. Check your inbox and spam folder.");
              })
            }
          >
            Send verification email
          </button>
          <button type="button" className="button button-primary" disabled={busy} onClick={check}>
            I have verified my email
          </button>
        </div>
      ) : null}
      {result?.status === "pending-review" ? (
        <div>
          <h2>Request awaiting review</h2>
          <p>
            The office will check your identity before restoring access. Contact BPT Jersey if you
            need help or no longer know your previous email. Requests for children need the guardian
            process.
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
          onSubmit={(event) => {
            event.preventDefault();
            if (ticket)
              void run(async () => {
                if (!profile.trainingTimePreferences?.length) {
                  setError("Choose at least one training time.");
                  return;
                }
                await showOutcome(ticket, profile);
              });
          }}
        >
          <h2>Complete your details</h2>
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
        <p role="status">Access restored. Opening your account...</p>
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
