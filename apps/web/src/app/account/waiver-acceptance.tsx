"use client";

import { useEffect, useState } from "react";

import {
  enrolmentWaiverTermsAcknowledgement,
  enrolmentWaiverTermsTitle,
} from "@bpt-jersey/domain/consents/enrolment-waiver";

import {
  acceptEnrolmentWaiver,
  getEnrolmentWaiverStatus,
  type EnrolmentWaiverStatus,
} from "../../lib/enrolment-waiver-client";
import { EnrolmentWaiverText } from "../enrol/waiver-text";

/**
 * D12 (2026-09-23): nobody reaches the member calendar before the academy terms are accepted for
 * every student on the account. The server says who is still missing and refuses a member's own
 * booking until then; this screen is where they accept. A failed check never locks anyone out:
 * the calendar opens and the booking check on the server still holds.
 */
export function WaiverGate({ children }: Readonly<{ children: React.ReactNode }>) {
  const [status, setStatus] = useState<EnrolmentWaiverStatus | "unavailable">();
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    let active = true;
    void getEnrolmentWaiverStatus()
      .then((value) => {
        if (active) setStatus(value);
      })
      .catch(() => {
        if (active) setStatus("unavailable");
      });
    return () => {
      active = false;
    };
  }, []);

  if (status === undefined) return <div className="client-auth-loading" aria-busy="true" />;
  if (status === "unavailable" || status.pending.length === 0) return <>{children}</>;
  const current = status;

  async function accept(): Promise<void> {
    if (busy || chosen.size !== current.pending.length) return;
    setBusy(true);
    setError(undefined);
    try {
      const accepted = new Set(
        await acceptEnrolmentWaiver({ version: current.version, studentIds: [...chosen] }),
      );
      setStatus({
        ...current,
        pending: current.pending.filter((student) => !accepted.has(student.studentId)),
      });
      setChosen(new Set());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Your acceptance could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  const single = current.pending.length === 1;
  return (
    <main className="waiver-gate" id="main-content" aria-labelledby="waiver-gate-title">
      <p className="account-eyebrow">BPT Jersey / Member</p>
      <h1 className="waiver-band-title" id="waiver-gate-title">
        Accept the academy terms
      </h1>
      <p className="waiver-band-intro">
        {enrolmentWaiverTermsTitle}, version {current.version}. Read it and tick the box
        {single ? "" : " for each member on your account"} to open your classes.
      </p>
      <EnrolmentWaiverText />
      <p className="waiver-band-ack">{enrolmentWaiverTermsAcknowledgement}</p>
      <fieldset className="waiver-band-people" disabled={busy}>
        <legend>{single ? "Your acceptance" : "Accept for"}</legend>
        {current.pending.map((student) => (
          <label className="enrol-waiver-accept" key={student.studentId}>
            <input
              checked={chosen.has(student.studentId)}
              onChange={(event) =>
                setChosen((previous) => {
                  const next = new Set(previous);
                  if (event.target.checked) next.add(student.studentId);
                  else next.delete(student.studentId);
                  return next;
                })
              }
              type="checkbox"
            />
            <span>I have read and accept these terms for {student.fullName}</span>
          </label>
        ))}
      </fieldset>
      <button
        className="button button-primary"
        disabled={busy || chosen.size !== current.pending.length}
        onClick={() => void accept()}
        type="button"
      >
        {busy ? "Saving..." : "Accept and continue"}
      </button>
      {error ? (
        <p className="waiver-band-error" role="alert">
          {error}
        </p>
      ) : null}
    </main>
  );
}
