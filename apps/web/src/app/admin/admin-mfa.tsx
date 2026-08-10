"use client";

import { useEffect, useState } from "react";
import type { User } from "firebase/auth";

import {
  beginTotpEnrollment,
  completeTotpEnrollment,
  type MfaEnrollment,
} from "../../lib/auth-client";
import { isValidTotpCode, toMfaMessage } from "../../lib/mfa-flow";
import { useAdminSession } from "../../lib/admin-auth";

function MfaCodeField({
  code,
  disabled,
  onChange,
}: {
  code: string;
  disabled: boolean;
  onChange: (code: string) => void;
}) {
  return (
    <div className="admin-mfa-field">
      <label htmlFor="admin-mfa-code">Authenticator code</label>
      <input
        autoComplete="one-time-code"
        autoFocus
        disabled={disabled}
        id="admin-mfa-code"
        inputMode="numeric"
        maxLength={6}
        onChange={(event) => onChange(event.target.value.replace(/\D/g, "").slice(0, 6))}
        pattern="[0-9]{6}"
        type="text"
        value={code}
      />
    </div>
  );
}

function MfaError({ message }: { message: string }) {
  return (
    <p className="admin-mfa-error" role="alert">
      {message}
    </p>
  );
}

export function AdminMfaEnrollment({ onComplete }: { onComplete(): Promise<void> }) {
  const { signOut, user } = useAdminSession();
  const [enrollment, setEnrollment] = useState<MfaEnrollment>();
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;

    async function prepareEnrollment(currentUser: User): Promise<void> {
      try {
        const nextEnrollment = await beginTotpEnrollment(currentUser, currentUser.email ?? "");
        if (active) {
          setEnrollment(nextEnrollment);
        }
      } catch (nextError) {
        if (active) {
          setError(toMfaMessage(nextError));
        }
      }
    }

    if (user) {
      void prepareEnrollment(user);
    }

    return () => {
      active = false;
    };
  }, [user]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError("");

    if (!enrollment || !isValidTotpCode(code)) {
      setError("Enter the six-digit code shown in your authenticator app.");
      return;
    }

    setBusy(true);
    try {
      await completeTotpEnrollment(enrollment, code);
      setCode("");
      await onComplete();
    } catch (nextError) {
      setError(toMfaMessage(nextError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="admin-auth-state admin-mfa-state" aria-labelledby="admin-mfa-title">
      <p className="admin-eyebrow">BPT Jersey / Account security</p>
      <h1 id="admin-mfa-title">Set up your authenticator</h1>
      <p>
        Scan this one-time setup code with your authenticator app, then enter the six-digit code it
        provides. Do not share the setup screen.
      </p>
      {enrollment ? (
        <div className="admin-mfa-setup" aria-live="polite">
          {/* The Auth provider returns an in-memory otpauth URI for this one-time visual. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={enrollment.qrCodeUrl} alt="Authenticator setup QR code" />
          <p>Keep this setup screen open while you add the account.</p>
        </div>
      ) : (
        <p role="status" aria-live="polite">
          Preparing your one-time setup...
        </p>
      )}
      <form className="admin-mfa-form" onSubmit={(event) => void handleSubmit(event)} noValidate>
        <MfaCodeField code={code} disabled={busy || !enrollment} onChange={setCode} />
        {error ? <MfaError message={error} /> : null}
        <button className="admin-auth-button" disabled={busy || !enrollment} type="submit">
          {busy ? "Completing setup" : "Complete setup"}
        </button>
      </form>
      <button
        className="admin-mfa-cancel"
        disabled={busy}
        onClick={() => void signOut()}
        type="button"
      >
        Cancel and sign out
      </button>
    </main>
  );
}

export function AdminMfaChallenge({
  onCancel,
  onComplete,
}: {
  onCancel?: () => Promise<void>;
  onComplete(code: string): Promise<void>;
}) {
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError("");

    if (!isValidTotpCode(code)) {
      setError("Enter the six-digit code shown in your authenticator app.");
      return;
    }

    setBusy(true);
    try {
      await onComplete(code);
    } catch (nextError) {
      setError(toMfaMessage(nextError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="admin-auth-state admin-mfa-state" aria-labelledby="admin-mfa-title">
      <p className="admin-eyebrow">BPT Jersey / Account security</p>
      <h1 id="admin-mfa-title">Verify your authenticator</h1>
      <p>Enter the current six-digit code from your authenticator app to continue.</p>
      <p className="admin-mfa-status" role="status" aria-live="polite">
        Your administrative workspace stays locked until the code is verified.
      </p>
      <form className="admin-mfa-form" onSubmit={(event) => void handleSubmit(event)} noValidate>
        <MfaCodeField code={code} disabled={busy} onChange={setCode} />
        {error ? <MfaError message={error} /> : null}
        <button className="admin-auth-button" disabled={busy} type="submit">
          {busy ? "Verifying code" : "Verify code"}
        </button>
      </form>
      {onCancel ? (
        <button
          className="admin-mfa-cancel"
          disabled={busy}
          onClick={() => void onCancel()}
          type="button"
        >
          Cancel and sign out
        </button>
      ) : null}
    </main>
  );
}
