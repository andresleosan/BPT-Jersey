"use client";
import { useEffect, useState, type FormEvent } from "react";
import {
  changeStaffPassword,
  currentStaffAccess,
  isStaffNumber,
  linkStaffGoogle,
  staffAccessError,
} from "../../../lib/staff-login-client";

export default function CoachAccessPage() {
  const [linked, setLinked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [staffNumber, setStaffNumber] = useState("");
  const [password, setPassword] = useState("");
  const [next, setNext] = useState("");
  const [confirmation, setConfirmation] = useState("");
  useEffect(() => {
    setLinked(currentStaffAccess().googleLinked);
  }, []);
  async function linkGoogle() {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await linkStaffGoogle();
      setLinked(true);
      setMessage(
        "Google linked. You can now use Google or your staff ID and password at Staff sign-in.",
      );
    } catch (cause) {
      setError(staffAccessError(cause));
    } finally {
      setBusy(false);
    }
  }
  async function changePassword(event: FormEvent) {
    event.preventDefault();
    setError("");
    setMessage("");
    if (
      !isStaffNumber(staffNumber) ||
      !password ||
      next.length < 12 ||
      next.length > 128 ||
      next !== confirmation
    ) {
      setError(
        "Enter your staff ID and current password. Your new password must have 12 to 128 characters and both copies must match.",
      );
      return;
    }
    setBusy(true);
    try {
      await changeStaffPassword(staffNumber.trim(), password, next);
      setPassword("");
      setNext("");
      setConfirmation("");
      setMessage("Your staff password has been changed.");
    } catch (cause) {
      setError(staffAccessError(cause));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="coach-access" aria-labelledby="access-title">
      <header className="coach-header-section">
        <div>
          <p className="account-eyebrow">BPT Jersey / Coach</p>
          <h1 id="access-title">My sign-in</h1>
          <p>Keep your coach profile, classes and permissions together.</p>
        </div>
      </header>
      {error && (
        <p className="notification notification-error" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="notification notification-success" role="status">
          {message}
        </p>
      )}
      <div className="coach-access-grid">
        <section className="admin-panel-card coach-card" aria-labelledby="google-title">
          <h2 id="google-title">Google account</h2>
          <p>
            {linked
              ? "Google is linked to this coach profile."
              : "Link your own Google account after signing in with the staff ID provided by the office."}
          </p>
          <button
            type="button"
            className="admin-home-link coach-button"
            disabled={busy || linked}
            onClick={() => void linkGoogle()}
          >
            {linked ? "Google linked" : busy ? "Please wait…" : "Link Google account"}
          </button>
        </section>
        <section className="admin-panel-card coach-card" aria-labelledby="password-title">
          <h2 id="password-title">Change staff password</h2>
          <p>
            Your numeric staff ID continues to work after linking Google. Use 12 to 128 characters
            for your new password.
          </p>
          <form className="coach-access-form" onSubmit={(event) => void changePassword(event)}>
            <div className="coach-field">
              <label htmlFor="access-id">Staff ID</label>
              <input
                className="coach-input"
                disabled={busy}
                id="access-id"
                autoComplete="username"
                inputMode="numeric"
                maxLength={6}
                value={staffNumber}
                onChange={(e) => setStaffNumber(e.target.value)}
                required
              />
            </div>
            <div className="coach-field">
              <label htmlFor="access-current">Current password</label>
              <input
                className="coach-input"
                disabled={busy}
                id="access-current"
                type="password"
                autoComplete="current-password"
                maxLength={128}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            <div className="coach-field">
              <label htmlFor="access-new">New password</label>
              <input
                className="coach-input"
                disabled={busy}
                id="access-new"
                type="password"
                autoComplete="new-password"
                minLength={12}
                maxLength={128}
                value={next}
                onChange={(e) => setNext(e.target.value)}
                required
              />
            </div>
            <div className="coach-field">
              <label htmlFor="access-confirm">Confirm new password</label>
              <input
                className="coach-input"
                disabled={busy}
                id="access-confirm"
                type="password"
                autoComplete="new-password"
                minLength={12}
                maxLength={128}
                value={confirmation}
                onChange={(e) => setConfirmation(e.target.value)}
                required
              />
            </div>
            <button className="admin-auth-button coach-button" disabled={busy}>
              {busy ? "Please wait…" : "Change password"}
            </button>
          </form>
        </section>
      </div>
    </section>
  );
}
