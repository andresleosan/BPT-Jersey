"use client";

import Link from "next/link";

import type { CalendarDay } from "@bpt-jersey/domain/schedule/member-calendar";

import type { CalendarParticipant } from "../../../lib/calendar";

type CalendarHeaderProps = Readonly<{
  displayName: string;
  participants: readonly CalendarParticipant[];
  selectedStudentId: string;
  onSelectStudent: (studentId: string) => void;
  onSignOut: () => void;
  /** A teen account neither sees nor manages the plan (B3). */
  showPlanLink?: boolean;
}>;

const accountLinks = [
  { href: "/account/courses", label: "Courses & Seminars" },
  { href: "/account/progress", label: "Progress" },
  { href: "/account/competitors", label: "Competitors" },
  { href: "/account/settings", label: "Settings" },
] as const;

/** The top of /account: who is signed in, where to go next, and the only way out (Sign out). */
export function CalendarHeader(props: CalendarHeaderProps) {
  const firstName = props.displayName.trim().split(/\s+/u)[0] || "Member";
  return (
    <header className="member-header">
      <div className="member-header-top">
        <Link className="member-eyebrow" href="/account">
          BPT Jersey / Member
        </Link>
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
      <div className="member-header-main">
        <h1 className="member-name">{firstName}</h1>
        <nav aria-label="Account" className="member-links">
          {accountLinks.map((link) => (
            <Link href={link.href} key={link.href} prefetch>
              {link.label}
            </Link>
          ))}
        </nav>
      </div>
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
    </header>
  );
}

type DayStripProps = Readonly<{
  days: readonly CalendarDay[];
  canPrev: boolean;
  canNext: boolean;
  onPrev: () => void;
  onNext: () => void;
}>;

/** The week toolbar at the head of the calendar: earlier, the visible days, later. */
export function DayStrip(props: DayStripProps) {
  return (
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
  );
}
