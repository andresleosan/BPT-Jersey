"use client";

import type { SessionRecord } from "@bpt-jersey/domain/schedule";
import {
  deriveRosterTag,
  type PreClassAttendee,
  type RosterTag,
} from "@bpt-jersey/domain/schedule/pre-class";

export type SessionRosterState =
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "ready"; attendees: readonly PreClassAttendee[] }>
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

/**
 * One class of the day: who booked, who is already on the mat (green), who is still expected
 * (grey) and who has not clocked in although the class started (red). The coach records the
 * arrival from here; the server still decides the persisted state.
 */
export function SessionRoster({
  busyStudentId,
  nowMs,
  onClockIn,
  roster,
  session,
}: {
  busyStudentId?: string;
  nowMs: number;
  onClockIn: (studentId: string, displayName: string) => void;
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
            {session.title} · Coach {session.instructorId}
          </h3>
          <p>
            {timeOf(session.startAt)} - {timeOf(session.endAt)} · {booked.length} booked
            {cancelled ? (
              <span className="attendance-tag attendance-tag-late">Cancelled</span>
            ) : null}
          </p>
        </div>
        <p className="attendance-counters" aria-label="Roster counts">
          <span className="attendance-counter-ready">{`${ready} ready`}</span>
          <span className="attendance-counter-waiting">{`${waiting} waiting`}</span>
          <span className="attendance-counter-late">{`${late} late`}</span>
        </p>
      </div>
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
    </section>
  );
}
