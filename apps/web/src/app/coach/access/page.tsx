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
    <section
      className="admin-section"
      aria-labelledby="access-title"
      style={{ maxWidth: "42rem", width: "100%", marginInline: "auto" }}
    >
      <p className="account-eyebrow">BPT Jersey / Coach</p>
      <h1 id="access-title">My sign-in</h1>
      <p>Keep your coach profile, classes and permissions together.</p>
      <h2>Google account</h2>
      <p>
        {linked
          ? "Google is linked to this coach profile."
          : "Link your own Google account after signing in with the staff ID provided by the office."}
      </p>
      <button
        className="button button-secondary"
        disabled={busy || linked}
        onClick={() => void linkGoogle()}
      >
        {linked ? "Google linked" : busy ? "Please wait…" : "Link Google account"}
      </button>
      <h2 style={{ marginTop: "2rem" }}>Change staff password</h2>
      <p>Your numeric staff ID continues to work after linking Google.</p>
      <form className="login-form" onSubmit={(event) => void changePassword(event)}>
        <div className="login-field">
          <label htmlFor="access-id">Staff ID</label>
          <input
            id="access-id"
            autoComplete="username"
            inputMode="numeric"
            maxLength={6}
            value={staffNumber}
            onChange={(e) => setStaffNumber(e.target.value)}
            required
          />
        </div>
        <div className="login-field">
          <label htmlFor="access-current">Current password</label>
          <input
            id="access-current"
            type="password"
            autoComplete="current-password"
            maxLength={128}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>
        <div className="login-field">
          <label htmlFor="access-new">New password</label>
          <input
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
        <div className="login-field">
          <label htmlFor="access-confirm">Confirm new password</label>
          <input
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
        <button className="button" disabled={busy}>
          {busy ? "Please wait…" : "Change password"}
        </button>
      </form>
      {error && <p role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
    </section>
  );
}
