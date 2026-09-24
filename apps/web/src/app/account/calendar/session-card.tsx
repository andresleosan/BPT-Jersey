"use client";

import { useState } from "react";

import {
  canCancelBooking,
  formatSessionTimeRange,
  lockedReasonLabel,
  sessionSite,
  type DerivedSessionStatus,
} from "@bpt-jersey/domain/schedule/member-calendar";
import {
  ageRangeLabel,
  levelRangeLabel,
  type BookingRecord,
  type ProgramRecord,
  sessionAccessMode,
  type SessionRecord,
} from "@bpt-jersey/domain/schedule";

import { SessionDetailDialog } from "../session-detail/session-detail-dialog";

export type CalendarEntry = Readonly<{
  session: SessionRecord;
  program: ProgramRecord;
  derived: DerivedSessionStatus;
  booking?: BookingRecord | undefined;
}>;

type SessionCardProps = Readonly<{
  entry: CalendarEntry;
  now: Date;
  busy: boolean;
  /** The member is on a free trial, so an ordinary class is still one of their free ones. */
  hasTrial?: boolean;
  note?: string | undefined;
  onBook: (entry: CalendarEntry) => void;
  onCancelRequest: (entry: CalendarEntry) => void;
}>;

const staticLabels: Readonly<Record<string, string>> = Object.freeze({
  missed: "Missed",
  attended: "Attended",
  closed: "Closed",
  full: "Full",
});

export function SessionCard({
  entry,
  now,
  busy,
  hasTrial = false,
  note,
  onBook,
  onCancelRequest,
}: SessionCardProps) {
  const [showReason, setShowReason] = useState(false);
  const [showDetail, setShowDetail] = useState(false);
  const { session, program, derived } = entry;
  const status = derived.status;
  const site = sessionSite(session);
  const isIntro = sessionAccessMode(session) === "intro";
  // Only an ordinary booked class opens its plan and roster; course sessions stay as they are.
  const detailStudentId =
    status === "booked" && !session.courseId ? entry.booking?.studentId : undefined;

  let action: React.ReactNode;
  if (session.courseId && status === "booked") {
    const absent = entry.booking?.schemaVersion === "2" && entry.booking.absent;
    action = (
      <>
        <span className="session-note">
          Course included · session {session.courseOrdinal}/{session.courseSessionCount}
        </span>
        {Date.parse(session.startAt) > now.getTime() ? (
          <button
            className="session-action"
            disabled={busy}
            onClick={() => onCancelRequest(entry)}
            type="button"
          >
            {absent ? "Absent · I can attend" : "Included · Mark absent"}
          </button>
        ) : (
          <span className="session-action session-action--static">
            {absent ? "Marked absent" : "Course included"}
          </span>
        )}
      </>
    );
  } else if (status === "open") {
    action = (
      <button
        className="session-action"
        disabled={busy}
        onClick={() => onBook(entry)}
        type="button"
      >
        {isIntro ? "Book free intro" : hasTrial ? "Book free trial class" : "Book"}
      </button>
    );
  } else if (status === "booked") {
    action = canCancelBooking(session, now) ? (
      <button
        className="session-action session-action--cancel"
        disabled={busy}
        onClick={() => onCancelRequest(entry)}
        type="button"
      >
        Booked · Cancel
      </button>
    ) : (
      <>
        <span className="session-action session-action--static">Booked</span>
        <p className="session-note">Cancellations closed</p>
      </>
    );
  } else if (status === "locked") {
    action = (
      <>
        <button
          aria-expanded={showReason}
          className="session-action session-action--static"
          onClick={() => setShowReason((value) => !value)}
          type="button"
        >
          Not available
        </button>
        {showReason && derived.lockedReason ? (
          <p className="session-reason">
            {lockedReasonLabel(derived.lockedReason, site, program.ageBand)}
          </p>
        ) : null}
      </>
    );
  } else {
    action = <span className="session-action session-action--static">{staticLabels[status]}</span>;
  }

  return (
    <li
      className={`session-card session-card--${status}`}
      data-session-id={session.sessionId}
      data-status={status}
    >
      <span className="session-time">{formatSessionTimeRange(session)}</span>
      {detailStudentId ? (
        <p className="session-title">
          <button type="button" className="session-card-open" onClick={() => setShowDetail(true)}>
            {session.title}
          </button>
        </p>
      ) : (
        <p className="session-title">{session.title}</p>
      )}
      <p className="session-site">
        {site}
        {isIntro ? " · Free Intro Class" : ""}
      </p>
      {session.levelRange || session.ageRange ? (
        <p className="session-detail">{`${levelRangeLabel(session.levelRange)} · ${ageRangeLabel(session.ageRange)}`}</p>
      ) : null}
      {session.description ? <p className="session-description">{session.description}</p> : null}
      {session.curriculum ? (
        <section className="session-curriculum" aria-label="Session curriculum">
          <p className="session-curriculum-title">{session.curriculum.title}</p>
          <ul>
            {session.curriculum.techniques.map((technique) => (
              <li key={technique}>{technique}</li>
            ))}
          </ul>
          {session.curriculum.details ? (
            <p className="session-description">{session.curriculum.details}</p>
          ) : null}
        </section>
      ) : null}
      {action}
      {note ? (
        <p className="session-note" role="status">
          {note}
        </p>
      ) : null}
      {showDetail && detailStudentId ? (
        <SessionDetailDialog
          sessionId={session.sessionId}
          studentId={detailStudentId}
          onClose={() => setShowDetail(false)}
        />
      ) : null}
    </li>
  );
}
