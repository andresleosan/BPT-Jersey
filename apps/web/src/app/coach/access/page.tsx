"use client";
import { useEffect, useState, type FormEvent } from "react";
import {
  changeStaffPassword,
  completeInitialStaffPassword,
  currentStaffAccess,
  isStaffNumber,
  linkStaffGoogle,
  staffAccessError,
} from "../../../lib/staff-login-client";
import { AdminSectionHeader } from "../../admin/admin-ui";

export default function CoachAccessPage() {
  const [linked, setLinked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [staffNumber, setStaffNumber] = useState("");
  const [password, setPassword] = useState("");
  const [next, setNext] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [initialRequired, setInitialRequired] = useState(false);
  useEffect(() => {
    setLinked(currentStaffAccess().googleLinked);
    setInitialRequired(new URLSearchParams(window.location.search).get("required") === "1");
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
  async function completeInitial(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (next.length < 12 || next.length > 128 || next !== confirmation) {
      setError("Your new password must have 12 to 128 characters and both copies must match.");
      return;
    }
    setBusy(true);
    try {
      const token = await completeInitialStaffPassword(next);
      const role = token.claims.role;
      window.location.assign(role === "owner" || role === "administrator" ? "/admin" : "/coach");
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
    <section className="coach-access" aria-label="My sign-in">
      <AdminSectionHeader
        eyebrow="Coach / Access"
        title="My sign-in"
        description="Keep your coach profile, classes and permissions together."
      />
      {error && (
        <p className="admin-panel-card shop-admin-notice shop-admin-notice-error" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="admin-panel-card shop-admin-notice shop-admin-notice-success" role="status">
          {message}
        </p>
      )}
      <div className="coach-access-grid">
        {initialRequired ? (
          <section className="admin-panel-card" aria-labelledby="initial-password-title">
            <div className="admin-panel-card-heading">
              <h3 id="initial-password-title">Replace your initial password</h3>
            </div>
            <p>Choose a private password before continuing, or link Google above.</p>
            <form className="coach-access-form" onSubmit={(event) => void completeInitial(event)}>
              <label htmlFor="initial-new">New password</label>
              <input
                className="coach-input"
                id="initial-new"
                type="password"
                minLength={12}
                maxLength={128}
                value={next}
                onChange={(event) => setNext(event.target.value)}
                required
              />
              <label htmlFor="initial-confirm">Confirm new password</label>
              <input
                className="coach-input"
                id="initial-confirm"
                type="password"
                minLength={12}
                maxLength={128}
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
                required
              />
              <button className="admin-auth-button coach-button" disabled={busy} type="submit">
                Replace initial password
              </button>
            </form>
          </section>
        ) : null}
        <section className="admin-panel-card" aria-labelledby="google-title">
          <div className="admin-panel-card-heading">
            <h3 id="google-title">Google account</h3>
          </div>
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
        <section className="admin-panel-card" aria-labelledby="password-title">
          <div className="admin-panel-card-heading">
            <h3 id="password-title">Change staff password</h3>
          </div>
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
