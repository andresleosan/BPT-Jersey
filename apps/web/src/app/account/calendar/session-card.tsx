"use client";

import { useState } from "react";

import {
  canCancelBooking,
  formatSessionTimeRange,
  lockedReasonLabel,
  sessionSite,
  type DerivedSessionStatus,
} from "@bpt-jersey/domain/schedule/member-calendar";
import type { BookingRecord, ProgramRecord, SessionRecord } from "@bpt-jersey/domain/schedule";

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

export function SessionCard({ entry, now, busy, note, onBook, onCancelRequest }: SessionCardProps) {
  const [showReason, setShowReason] = useState(false);
  const { session, program, derived } = entry;
  const status = derived.status;
  const site = sessionSite(session);

  let action: React.ReactNode;
  if (status === "open") {
    action = (
      <button
        className="session-action"
        disabled={busy}
        onClick={() => onBook(entry)}
        type="button"
      >
        Book
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
      <p className="session-title">{session.title}</p>
      <p className="session-site">{site}</p>
      {action}
      {note ? (
        <p className="session-note" role="status">
          {note}
        </p>
      ) : null}
    </li>
  );
}
