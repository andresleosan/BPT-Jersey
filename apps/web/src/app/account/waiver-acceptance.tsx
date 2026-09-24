"use client";

import Link from "next/link";

import { createContext, useCallback, useContext, useEffect, useState } from "react";

import {
  enrolmentWaiverTermsAcknowledgement,
  enrolmentWaiverTermsTitle,
} from "@bpt-jersey/domain/consents/enrolment-waiver";

import { useClientSession } from "../../lib/client-auth";
import { getMyDisclaimerStatus, type DisclaimerStatus } from "../../lib/disclaimer-status-client";
import {
  acceptEnrolmentWaiver,
  getEnrolmentWaiverStatus,
  type EnrolmentWaiverStatus,
} from "../../lib/enrolment-waiver-client";
import { EnrolmentWaiverText } from "../enrol/waiver-text";

import "./account.css";

/** Where the academy terms are accepted: the form on /account/waiver. */
const acceptTermsHref = "/account/waiver#academy-terms";
/** Where T117 disclaimers are accepted: the DisclaimersPanel on /account/waiver. */
const acceptDisclaimersHref = "/account/waiver#disclaimers-title";

type DisclaimerStatusValue = Readonly<{
  /** `undefined` while loading; `"error"` when the check failed. */
  status: DisclaimerStatus | "error" | undefined;
  retry: () => void;
}>;

// Outside a WaiverGate there is no status, which blocks: the gate fails closed.
const DisclaimerStatusContext = createContext<DisclaimerStatusValue>({
  status: "error",
  retry: () => undefined,
});

type Participant = DisclaimerStatus["participants"][number];
type CheckedParticipant = Extract<Participant, { status: "checked" }>;

/**
 * D12 / Q5 (2026-09-24): loads the terms status for exactly the calendar's participants, which the
 * calendar reports through `track`. It no longer blocks the whole account; each participant is
 * blocked on their own calendar through `gate`, and Settings, My plan and logout stay reachable
 * (other routes, R14).
 */
export function WaiverGate({
  children,
}: Readonly<{
  children: (
    gate: (studentId: string) => React.ReactNode | null,
    track: (studentIds: readonly string[]) => void,
  ) => React.ReactNode;
}>) {
  const [key, setKey] = useState("");
  const [attempt, setAttempt] = useState(0);
  // A result counts only for the ids and attempt it was fetched for; anything else is loading.
  const [loaded, setLoaded] = useState<{
    key: string;
    attempt: number;
    value: DisclaimerStatus | "error";
  }>();

  useEffect(() => {
    if (!key) return;
    let active = true;
    void getMyDisclaimerStatus(key.split("\n"))
      .then((value) => {
        if (active) setLoaded({ key, attempt, value });
      })
      .catch(() => {
        if (active) setLoaded({ key, attempt, value: "error" });
      });
    return () => {
      active = false;
    };
  }, [key, attempt]);

  const track = useCallback((studentIds: readonly string[]) => {
    setKey([...new Set(studentIds)].sort().join("\n"));
  }, []);
  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  const status =
    loaded && loaded.key === key && loaded.attempt === attempt ? loaded.value : undefined;

  // The calendar treats any non-null gate as blocked, so "clear" must be decided here, not inside
  // DisclaimerBlock: only a loaded status naming this participant as clear (or not applicable)
  // lets the calendar show.
  const gate = (studentId: string) => {
    const participant =
      status === undefined || status === "error"
        ? undefined
        : status.participants.find((candidate) => candidate.studentId === studentId);
    return participant && !pending(participant) ? null : <DisclaimerBlock studentId={studentId} />;
  };

  return (
    <DisclaimerStatusContext.Provider value={{ status, retry }}>
      {children(gate, track)}
    </DisclaimerStatusContext.Provider>
  );
}

export function useDisclaimerStatus(): DisclaimerStatusValue {
  return useContext(DisclaimerStatusContext);
}

/**
 * "not-applicable" is a participant this account may not check (e.g. course-only). It is never
 * blocked here: the server's booking path still runs its access and terms checks for them.
 */
function pending(participant: Participant): participant is CheckedParticipant {
  return participant.status === "checked" && (!participant.terms || !participant.disclaimers);
}

/**
 * Stands in for the calendar of one participant. Fails closed: while loading a skeleton, and when
 * the check failed (or the response does not name this participant) a Retry card, never the
 * calendar.
 */
export function DisclaimerBlock({ studentId }: Readonly<{ studentId: string }>) {
  const { status, retry } = useDisclaimerStatus();
  const { session } = useClientSession();

  if (status === undefined) return <div aria-busy="true" className="skeleton-card" />;
  const participant =
    status === "error"
      ? undefined
      : status.participants.find((candidate) => candidate.studentId === studentId);
  if (!participant) {
    return (
      <div className="calendar-error terms-block" role="alert">
        <p>We couldn&apos;t check your terms.</p>
        <button className="terms-block-action" onClick={retry} type="button">
          Retry
        </button>
      </div>
    );
  }
  if (!pending(participant)) return null;
  const termsMissing = !participant.terms;
  // A teen cannot accept (D10): their guardian does, so no button here.
  if (session?.role === "teenStudent") {
    return (
      <div className="calendar-error terms-block" role="status">
        <p>
          {termsMissing
            ? "Your parent or guardian needs to accept the academy terms first."
            : "Your parent or guardian needs to accept the disclaimers first."}
        </p>
      </div>
    );
  }
  return (
    <div className="calendar-error terms-block" role="status">
      <p>
        {participant.fullName}{" "}
        {termsMissing
          ? "needs to accept the academy terms before booking."
          : "needs to accept the disclaimers before booking."}
      </p>
      <a
        className="terms-block-action"
        href={termsMissing ? acceptTermsHref : acceptDisclaimersHref}
      >
        Review and accept
      </a>
    </div>
  );
}

/** Above the calendar: the other participants on the account who still need to accept. */
export function PendingTermsBanner({ studentId }: Readonly<{ studentId: string }>) {
  const { status } = useDisclaimerStatus();
  const { session } = useClientSession();
  if (status === undefined || status === "error") return null;
  const others = status.participants.filter(
    (participant): participant is CheckedParticipant =>
      participant.studentId !== studentId && pending(participant),
  );
  const teen = session?.role === "teenStudent";
  const terms = others.filter((participant) => !participant.terms);
  const disclaimersOnly = others.filter((participant) => participant.terms);
  const names = (list: readonly CheckedParticipant[]) =>
    list.map((participant) => participant.fullName).join(", ");
  return (
    <>
      {terms.length > 0 ? (
        <p className="calendar-trial-band" role="status">
          {names(terms)} still {terms.length === 1 ? "needs" : "need"} to accept the academy terms.{" "}
          {teen ? null : <a href={acceptTermsHref}>Review and accept</a>}
        </p>
      ) : null}
      {disclaimersOnly.length > 0 ? (
        <p className="calendar-trial-band" role="status">
          {names(disclaimersOnly)} still {disclaimersOnly.length === 1 ? "needs" : "need"} to accept
          the disclaimers. {teen ? null : <a href={acceptDisclaimersHref}>Review and accept</a>}
        </p>
      ) : null}
    </>
  );
}

/**
 * The one-off acceptance of the academy terms for members who joined before online enrolment,
 * shown on /account/waiver. The server lists who is still missing and refuses a member's own
 * booking until then; a teen account gets an empty list because their guardian accepts.
 */
export function AcademyTermsAcceptance() {
  const [status, setStatus] = useState<EnrolmentWaiverStatus | "unavailable">();
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [done, setDone] = useState(false);

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

  if (status === undefined) return null;
  if (status === "unavailable") {
    return (
      <p className="waiver-band-error" id="academy-terms" role="alert">
        The academy terms are unavailable right now. Please try again.
      </p>
    );
  }
  if (status.pending.length === 0) {
    return done ? (
      <p className="calendar-trial-band" id="academy-terms" role="status">
        Academy terms accepted. <Link href="/account">Back to your classes</Link>
      </p>
    ) : null;
  }
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
      setDone(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Your acceptance could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  const single = current.pending.length === 1;
  return (
    <section className="waiver-gate" id="academy-terms" aria-labelledby="waiver-gate-title">
      <h2 className="waiver-band-title" id="waiver-gate-title">
        Accept the academy terms
      </h2>
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
    </section>
  );
}
