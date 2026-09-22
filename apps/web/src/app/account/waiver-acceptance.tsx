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
 * Members who joined before online registration accept the same waiver once per student. The
 * server says who is still missing; once saved, the panel never comes back for that student.
 */
export function WaiverAcceptance() {
  const [status, setStatus] = useState<EnrolmentWaiverStatus>();
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Readonly<{ kind: "saved" | "error"; text: string }>>();

  useEffect(() => {
    let active = true;
    // Non-blocking: if the check fails, the calendar stays usable and the panel asks next visit.
    void getEnrolmentWaiverStatus()
      .then((value) => {
        if (active) setStatus(value);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  if (!status || (status.pending.length === 0 && message?.kind !== "saved")) return null;
  if (status.pending.length === 0) {
    return (
      <p className="waiver-band-saved" role="status">
        {message?.text}
      </p>
    );
  }

  async function save(): Promise<void> {
    if (!status || chosen.size === 0 || busy) return;
    setBusy(true);
    setMessage(undefined);
    try {
      const accepted = new Set(
        await acceptEnrolmentWaiver({ version: status.version, studentIds: [...chosen] }),
      );
      setStatus({
        ...status,
        pending: status.pending.filter((student) => !accepted.has(student.studentId)),
      });
      setChosen(new Set());
      setMessage({ kind: "saved", text: "Thank you. Your acceptance is saved." });
    } catch (error) {
      setMessage({
        kind: "error",
        text: error instanceof Error ? error.message : "Your acceptance could not be saved.",
      });
    } finally {
      setBusy(false);
    }
  }

  const single = status.pending.length === 1;
  return (
    <section className="waiver-band" aria-labelledby="waiver-band-title">
      <h2 className="waiver-band-title" id="waiver-band-title">
        Accept the academy waiver
      </h2>
      <p className="waiver-band-intro">
        {enrolmentWaiverTermsTitle}, version {status.version}. New members accept it when they
        register; please read it and accept it once
        {single ? "" : " for each member on your account"}.
      </p>
      <EnrolmentWaiverText />
      <p className="waiver-band-ack">{enrolmentWaiverTermsAcknowledgement}</p>
      <fieldset className="waiver-band-people" disabled={busy}>
        <legend>{single ? "Your acceptance" : "Accept for"}</legend>
        {status.pending.map((student) => (
          <label className="enrol-waiver-accept" key={student.studentId}>
            <input
              checked={chosen.has(student.studentId)}
              onChange={(event) =>
                setChosen((current) => {
                  const next = new Set(current);
                  if (event.target.checked) next.add(student.studentId);
                  else next.delete(student.studentId);
                  return next;
                })
              }
              type="checkbox"
            />
            <span>I accept these terms for {student.fullName}</span>
          </label>
        ))}
      </fieldset>
      <button
        className="session-action"
        disabled={busy || chosen.size === 0}
        onClick={() => void save()}
        type="button"
      >
        {busy ? "Saving..." : "Save acceptance"}
      </button>
      {message ? (
        <p
          className={message.kind === "error" ? "waiver-band-error" : "waiver-band-saved"}
          role={message.kind === "error" ? "alert" : "status"}
        >
          {message.text}
        </p>
      ) : null}
    </section>
  );
}
