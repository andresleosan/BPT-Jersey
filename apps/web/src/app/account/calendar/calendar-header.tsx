"use client";

import Link from "next/link";

import { useRef } from "react";

import type { CalendarDay, CalendarMode } from "@bpt-jersey/domain/schedule/member-calendar";

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
  { href: "/account/courses", label: "Courses & seminars" },
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
            <Link href={link.href} key={link.href}>
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
  /** One-day view: the day on screen, and choosing another pill shows that day. */
  selectedDateKey?: string | undefined;
  onSelectDay?: (dateKey: string) => void;
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
        {props.days.map((day) => {
          const className = `day-pill${day.isToday ? " day-pill--today" : ""}`;
          const onSelectDay = props.onSelectDay;
          return onSelectDay ? (
            <li key={day.dateKey}>
              <button
                aria-current={day.isToday ? "date" : undefined}
                aria-label={`${day.weekday} ${day.dayNumber}`}
                aria-pressed={day.dateKey === props.selectedDateKey}
                className={`${className} day-pill--button`}
                onClick={() => onSelectDay(day.dateKey)}
                type="button"
              >
                <span>{day.weekday}</span>
                <span>{day.dayNumber}</span>
              </button>
            </li>
          ) : (
            <li
              aria-current={day.isToday ? "date" : undefined}
              className={className}
              key={day.dateKey}
            >
              <span>{day.weekday}</span>
              <span>{day.dayNumber}</span>
            </li>
          );
        })}
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

const modes: readonly { mode: CalendarMode; label: string }[] = [
  { mode: "week", label: "Week" },
  { mode: "day", label: "Day" },
];

/** Tablet and desktop: show the whole week or one day. A radio group, so arrows move the choice. */
export function CalendarModeSwitch(
  props: Readonly<{ mode: CalendarMode; onChange: (mode: CalendarMode) => void }>,
) {
  const group = useRef<HTMLDivElement>(null);
  return (
    <div aria-label="Calendar view" className="calendar-mode" ref={group} role="radiogroup">
      {modes.map((option, index) => {
        const checked = option.mode === props.mode;
        return (
          <button
            aria-checked={checked}
            className="calendar-mode-option"
            key={option.mode}
            onClick={() => props.onChange(option.mode)}
            onKeyDown={(event) => {
              if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
              event.preventDefault();
              const other = modes[(index + 1) % modes.length]!;
              props.onChange(other.mode);
              group.current
                ?.querySelectorAll<HTMLElement>("[role='radio']")
                [(index + 1) % modes.length]?.focus();
            }}
            role="radio"
            tabIndex={checked ? 0 : -1}
            type="button"
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
