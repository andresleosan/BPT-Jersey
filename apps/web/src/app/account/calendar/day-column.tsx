"use client";

import { formatDayHeading, type CalendarDay } from "@bpt-jersey/domain/schedule/member-calendar";

import { SessionCard, type CalendarEntry } from "./session-card";

type DayColumnProps = Readonly<{
  day: CalendarDay;
  entries: readonly CalendarEntry[];
  loading: boolean;
  now: Date;
  busyKey: string;
  hasTrial?: boolean;
  studentId?: string | undefined;
  notes: Readonly<Record<string, string>>;
  onBook: (entry: CalendarEntry) => void;
  onCancelRequest: (entry: CalendarEntry) => void;
}>;

export function DayColumn(props: DayColumnProps) {
  const headingId = `day-${props.day.dateKey}`;
  let body: React.ReactNode;
  if (props.loading) {
    body = (
      <div aria-busy="true" className="day-list">
        <div className="skeleton-card" />
        <div className="skeleton-card" />
        <div className="skeleton-card" />
      </div>
    );
  } else if (props.entries.length === 0) {
    body = <p className="day-empty">No classes to book</p>;
  } else {
    body = (
      <ul className="day-list">
        {props.entries.map((entry) => (
          <SessionCard
            busy={props.busyKey === entry.session.sessionId}
            entry={entry}
            hasTrial={props.hasTrial ?? false}
            key={entry.session.sessionId}
            note={props.notes[entry.session.sessionId]}
            studentId={props.studentId}
            now={props.now}
            onBook={props.onBook}
            onCancelRequest={props.onCancelRequest}
          />
        ))}
      </ul>
    );
  }

  return (
    <section
      aria-labelledby={headingId}
      className={`day-column${props.day.isToday ? " day-column--today" : ""}`}
      data-date={props.day.dateKey}
    >
      <h2 className="day-heading" id={headingId}>
        {formatDayHeading(props.day)}
      </h2>
      {body}
    </section>
  );
}
