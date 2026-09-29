"use client";

import { useEffect, useState } from "react";

import { searchAttendanceMembers } from "../../../lib/schedule-client";
import type { SessionRecord } from "@bpt-jersey/domain/schedule";
import {
  deriveRosterTag,
  type PreClassAttendee,
  type RosterTag,
} from "@bpt-jersey/domain/schedule/pre-class";

export type SessionRosterState =
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "ready"; attendees: readonly PreClassAttendee[]; cursor?: string | null }>
  | Readonly<{ status: "error" }>;

const tagLabels: Readonly<Record<RosterTag, string>> = {
  ready: "Ready",
  booked: "Booked",
  late: "Late",
  no_show: "No-show",
  absent: "Absent",
};

function timeOf(iso: string): string {
  return iso.slice(11, 16);
}

type MemberMatch = Readonly<{ studentId: string; fullName: string }>;

/** Staff find a member who did not book and mark them present with one click. */
function WalkInSearch({
  busy,
  onWalkIn,
  sessionTitle,
}: {
  busy: boolean;
  onWalkIn: (studentId: string, displayName: string) => void;
  sessionTitle: string;
}) {
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<readonly MemberMatch[]>([]);
  const [status, setStatus] = useState("");

  useEffect(() => {
    const needle = query.trim();
    if (needle.length < 2) {
      setMatches([]);
      setStatus("");
      return;
    }
    let active = true;
    // Waits for a pause in typing so each keystroke does not reach the server.
    const timer = setTimeout(() => {
      setStatus("Searching...");
      searchAttendanceMembers(needle).then(
        (found) => {
          if (!active) return;
          setMatches(found);
          setStatus(found.length === 0 ? "No active member matches that name." : "");
        },
        () => {
          if (active) setStatus("Unable to search members. Try again.");
        },
      );
    }, 300);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [query]);

  return (
    <div className="attendance-walk-in">
      <label className="attendance-walk-in-field">
        <span>Add a member who didn&apos;t book</span>
        <input
          aria-label={`Search a member to mark present in ${sessionTitle}`}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Type at least two letters of their name"
          type="search"
          value={query}
        />
      </label>
      {status ? <p role="status">{status}</p> : null}
      {matches.length > 0 ? (
        <ul className="attendance-walk-in-results">
          {matches.map((member) => (
            <li key={member.studentId}>
              <button
                aria-label={`Mark ${member.fullName} present`}
                className="button"
                disabled={busy}
                onClick={() => {
                  onWalkIn(member.studentId, member.fullName);
                  setQuery("");
                }}
                type="button"
              >
                {member.fullName}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/**
 * One class of the day: who booked, who is already on the mat (green), who is still expected
 * (grey) and who has not clocked in although the class started (red). The coach records the
 * arrival from here; the server still decides the persisted state.
 */
export function SessionRoster({
  busyStudentId,
  onLoadMore,
  nowMs,
  onClockIn,
  onWalkIn,
  roster,
  session,
}: {
  busyStudentId?: string;
  onLoadMore?: () => void;
  nowMs: number;
  onClockIn: (studentId: string, displayName: string) => void;
  onWalkIn?: (studentId: string, displayName: string) => void;
  roster: SessionRosterState;
  session: SessionRecord;
}) {
  const cancelled = session.status === "cancelled";
  const booked =
    roster.status === "ready" ? roster.attendees.filter((a) => a.source === "booked") : [];
  const rows = booked.map((attendee) => ({
    attendee,
    tag: deriveRosterTag(attendee.status, session.startAt, nowMs),
  }));
  const ready = rows.filter((row) => row.tag === "ready").length;
  const waiting = rows.filter((row) => row.tag === "booked").length;
  const late = rows.length - ready - waiting;
  const titleId = `roster-${session.sessionId}-title`;

  return (
    <section className="attendance-session-block" aria-labelledby={titleId}>
      <div className="attendance-session-block-heading">
        <div>
          <h3 id={titleId}>
            {session.title} · Coach {session.instructorName ?? session.instructorId}
          </h3>
          <p>
            {timeOf(session.startAt)} - {timeOf(session.endAt)} · {booked.length} booked
            {cancelled ? (
              <span className="attendance-tag attendance-tag-cancelled">Cancelled</span>
            ) : null}
          </p>
        </div>
        <p className="attendance-counters" aria-label="Roster counts">
          <span className="attendance-counter-ready">{`${ready} ready`}</span>
          <span className="attendance-counter-waiting">{`${waiting} waiting`}</span>
          <span className="attendance-counter-late">{`${late} late`}</span>
        </p>
      </div>
      {roster.status === "ready" && roster.cursor && onLoadMore ? <button className="button" onClick={onLoadMore} type="button">Load more participants</button> : null}
      {roster.status === "loading" ? <p role="status">Loading roster...</p> : null}
      {roster.status === "error" ? (
        <p role="alert">Unable to load this roster. It will retry shortly.</p>
      ) : null}
      {roster.status === "ready" && booked.length === 0 ? (
        <p className="admin-empty-state">Nobody has booked this class.</p>
      ) : null}
      {rows.length > 0 ? (
        <ul className="attendance-roster" aria-label={`${session.title} roster`}>
          {rows.map(({ attendee, tag }) => {
            const busy = busyStudentId !== undefined;
            const mine = busyStudentId === attendee.studentId;
            return (
              <li key={attendee.studentId}>
                <span className="attendance-roster-name">{attendee.displayName}</span>
                <span className={`attendance-tag attendance-tag-${tag}`}>{tagLabels[tag]}</span>
                {!cancelled && (tag === "booked" || tag === "late") ? (
                  <button
                    aria-label={`Clock in ${attendee.displayName}`}
                    className="button attendance-clock-in"
                    disabled={busy}
                    onClick={() => onClockIn(attendee.studentId, attendee.displayName)}
                    type="button"
                  >
                    {mine ? "Clocking in..." : "Clock in"}
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
      {!cancelled && onWalkIn ? (
        <WalkInSearch
          busy={busyStudentId !== undefined}
          onWalkIn={onWalkIn}
          sessionTitle={session.title}
        />
      ) : null}
    </section>
  );
}
