"use client";

import { useEffect, useState, type FormEvent } from "react";

import {
  adultClaimMessages,
  claimAdultAccount,
  getAdultClaimStatus,
} from "../../lib/account-settings-client";
import { useClientSession } from "../../lib/client-auth";
import { memberLoginPath } from "../../lib/login-flow";

/**
 * Q4 (ADR-019): an account a guardian set up for a 12–17 year old becomes the member's own at 18.
 * Until they set a new password the rest of /account stays behind this card. A failed or missing
 * status check shows nothing and lets the account through.
 */
export function AdultClaimGate({ children }: Readonly<{ children: React.ReactNode }>) {
  const { signOut } = useClientSession();
  const [studentId, setStudentId] = useState<string | null>();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    let active = true;
    void getAdultClaimStatus().then((status) => {
      if (active) setStudentId(status.required ? status.studentId : null);
    });
    return () => {
      active = false;
    };
  }, []);

  if (studentId === undefined) {
    return (
      <div className="adult-claim-loading" aria-busy="true" aria-label="Loading your account">
        <div className="skeleton-card" />
      </div>
    );
  }
  if (studentId === null) return <>{children}</>;
  const claimStudentId = studentId;

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(undefined);
    try {
      await claimAdultAccount({ studentId: claimStudentId, currentPassword, newPassword });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : adultClaimMessages.failed);
      setBusy(false);
      return;
    }
    await signOut().catch(() => undefined);
    // A full load drops every cached member view before the new sign-in.
    window.location.assign(new URL(`${memberLoginPath}?claimed=1`, window.location.origin).href);
  }

  return (
    <main className="adult-claim" id="main-content" aria-labelledby="adult-claim-title">
      <p className="account-eyebrow">BPT Jersey / Member</p>
      <h1 className="adult-claim-title" id="adult-claim-title">
        You&apos;re 18 — this account is now yours.
      </h1>
      <p className="adult-claim-intro">Set a new password to keep using it.</p>
      <form className="adult-claim-form" onSubmit={(event) => void submit(event)}>
        <label className="adult-claim-field" htmlFor="adult-claim-current">
          <span>Current password</span>
          <input
            autoComplete="current-password"
            disabled={busy}
            id="adult-claim-current"
            onChange={(event) => setCurrentPassword(event.target.value)}
            required
            type="password"
            value={currentPassword}
          />
        </label>
        <label className="adult-claim-field" htmlFor="adult-claim-new">
          <span>New password</span>
          <input
            aria-describedby="adult-claim-new-hint"
            autoComplete="new-password"
            disabled={busy}
            id="adult-claim-new"
            minLength={12}
            onChange={(event) => setNewPassword(event.target.value)}
            required
            type="password"
            value={newPassword}
          />
          <small id="adult-claim-new-hint">At least 12 characters.</small>
        </label>
        <button className="button button-primary" disabled={busy} type="submit">
          {busy ? "Saving..." : "Set new password"}
        </button>
      </form>
      {error ? (
        <p className="waiver-band-error" role="alert">
          {error}
        </p>
      ) : null}
    </main>
  );
}
