"use client";

import Link from "next/link";

import type { CalendarDay } from "@bpt-jersey/domain/schedule/member-calendar";

import type { CalendarParticipant } from "../../../lib/calendar";

type CalendarHeaderProps = Readonly<{
  displayName: string;
  participants: readonly CalendarParticipant[];
  selectedStudentId: string;
  onSelectStudent: (studentId: string) => void;
  days: readonly CalendarDay[];
  canPrev: boolean;
  canNext: boolean;
  onPrev: () => void;
  onNext: () => void;
  onSignOut: () => void;
  /** A teen account neither sees nor manages the plan (B3). */
  showPlanLink?: boolean;
}>;

export function CalendarHeader(props: CalendarHeaderProps) {
  const firstName = props.displayName.trim().split(/\s+/u)[0] || "Member";
  return (
    <header className="member-header">
      <div className="member-header-top">
        <p className="member-eyebrow">BPT Jersey / Member</p>
        <div className="member-header-actions">
          {props.showPlanLink === false ? null : (
            <Link className="member-plan-link" href="/account/membership">
              My plan
            </Link>
          )}
          <button className="member-signout" onClick={props.onSignOut} type="button">
            Sign out
          </button>
        </div>
      </div>
      <h1 className="member-name">{firstName}</h1>
      <nav aria-label="Account" className="member-links">
        <Link href="/account/courses">Courses</Link>
        <Link href="/account/progress">Progress</Link>
        <Link href="/account/competitors">Competitors</Link>
        <Link href="/account/settings">Settings</Link>
      </nav>
      {props.participants.length > 1 ? (
        <ul aria-label="Choose member" className="member-chips" role="group">
          {props.participants.map((participant) => {
            const active = participant.studentId === props.selectedStudentId;
            return (
              <li key={participant.studentId}>
                <button
                  aria-pressed={active}
                  className={`member-chip${active ? " member-chip--active" : ""}`}
                  onClick={() => props.onSelectStudent(participant.studentId)}
                  type="button"
                >
                  {participant.firstName}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
      <div className="day-strip-row">
        <button
          aria-label="Earlier"
          className="day-nav"
          disabled={!props.canPrev}
          onClick={props.onPrev}
          type="button"
        >
          ‹
        </button>
        <ol className="day-strip">
          {props.days.map((day) => (
            <li
              aria-current={day.isToday ? "date" : undefined}
              className={`day-pill${day.isToday ? " day-pill--today" : ""}`}
              key={day.dateKey}
            >
              <span>{day.weekday}</span>
              <span>{day.dayNumber}</span>
            </li>
          ))}
        </ol>
        <button
          aria-label="Later"
          className="day-nav"
          disabled={!props.canNext}
          onClick={props.onNext}
          type="button"
        >
          ›
        </button>
      </div>
    </header>
  );
}
