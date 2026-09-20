"use client";

import { useEffect, useMemo, useState } from "react";
import type { CSSProperties, ReactElement } from "react";
import { countSessionDays, layoutWeek, localParts, mondayOf, nowMarker } from "./week-grid";
import type { GridSession, PlacedSession } from "./week-grid";

export type CalendarViewProps = Readonly<{
  view: "week" | "month" | "day";
  weekStart: string;
  sessions: readonly GridSession[];
  timezone: string;
  // Named "window" for the grid's visible hour range; deliberately shadows the DOM global (ruled name).
  window: { fromHour: number; toHour: number };
  canEdit: boolean;
  onOpen: (sessionId: string) => void;
  onCreate: (date: string, startTime: string) => void;
  onSelectWeek: (weekStart: string) => void;
}>;

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function hhmm(hour: number): string {
  return `${pad(Math.floor(hour))}:${pad(Math.round((hour % 1) * 60))}`;
}

function timeLabel(iso: string, timezone: string): string {
  const { hour } = localParts(iso, timezone);
  return hhmm(hour);
}

const monthNames = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** The current instant, refreshed every minute so the now line moves while the page is open. */
function useNow(): string {
  const [now, setNow] = useState(() => new Date().toISOString());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date().toISOString()), 60_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

function EventButton({
  session,
  timezone,
  onOpen,
}: {
  session: PlacedSession;
  timezone: string;
  onOpen: (sessionId: string) => void;
}): ReactElement {
  const cancelled = session.status === "cancelled";
  const style: CSSProperties = {
    gridRow: `${session.rowStart + 1} / span ${session.rowSpan}`,
    gridColumn: session.columns > 1 ? `${session.column + 1}` : "1 / -1",
    ...(cancelled ? {} : { background: session.colour }),
  };
  return (
    <button
      type="button"
      className="cs-event"
      data-status={cancelled ? "cancelled" : undefined}
      style={style}
      onClick={() => onOpen(session.sessionId)}
    >
      <span className="cs-event-title">{session.title}</span>
      <span className="cs-event-time">
        {timeLabel(session.startAt, timezone)} - {timeLabel(session.endAt, timezone)}
      </span>
      <span className="cs-event-chip">
        {session.capacity === null ? "Set capacity" : `${session.booked} / ${session.capacity}`}
      </span>
      {/* `data-status` only paints; the state has to reach a screen reader as words too. */}
      {cancelled ? <span className="visually-hidden">Cancelled</span> : null}
    </button>
  );
}

function DayColumn({
  date,
  label,
  sessions,
  classes,
  registrations,
  hours,
  timezone,
  canEdit,
  today,
  nowTop,
  onOpen,
  onCreate,
}: {
  date: string;
  label: string;
  sessions: readonly PlacedSession[];
  classes: number;
  registrations: number;
  hours: readonly number[];
  timezone: string;
  canEdit: boolean;
  today: boolean;
  nowTop: number | null;
  onOpen: (sessionId: string) => void;
  onCreate: (date: string, startTime: string) => void;
}): ReactElement {
  const columns = Math.max(1, ...sessions.map((session) => session.columns));
  const halfHours = (hours.length - 1) * 2;
  return (
    <div className="cs-day" data-today={today ? "true" : undefined}>
      <div className="cs-day-header" aria-current={today ? "date" : undefined}>
        <span>{label}</span>
        <span className="cs-day-counts">
          {classes} classes &middot; {registrations} registrations
        </span>
      </div>
      <div
        className="cs-day-grid"
        style={
          {
            display: "grid",
            gridTemplateRows: `repeat(${halfHours}, 1.6rem)`,
            gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
            // The now line is painted by the grid background (see `.cs-day-grid[style*="--now"]`).
            ...(nowTop === null ? {} : { "--now": String(nowTop) }),
          } as CSSProperties
        }
      >
        {Array.from({ length: halfHours }, (_, row) => {
          const hour = hours[0]! + row / 2;
          const time = hhmm(hour);
          const style: CSSProperties = { gridRow: `${row + 1} / span 1`, gridColumn: "1 / -1" };
          return canEdit ? (
            <button
              key={time}
              type="button"
              className="cs-slot"
              tabIndex={-1}
              style={style}
              aria-label={`Create a class on ${label} at ${time}`}
              onClick={() => onCreate(date, time)}
            />
          ) : (
            <span key={time} className="cs-slot" aria-hidden="true" style={style} />
          );
        })}
        {sessions.map((session) => (
          <EventButton
            key={session.sessionId}
            session={session}
            timezone={timezone}
            onOpen={onOpen}
          />
        ))}
      </div>
    </div>
  );
}

function WeekOrDay({
  weekStart,
  sessions,
  timezone,
  window,
  canEdit,
  onOpen,
  onCreate,
  onlyDate,
}: {
  weekStart: string;
  sessions: readonly GridSession[];
  timezone: string;
  window: { fromHour: number; toHour: number };
  canEdit: boolean;
  onOpen: (sessionId: string) => void;
  onCreate: (date: string, startTime: string) => void;
  onlyDate: string | undefined;
}): ReactElement {
  const layout = useMemo(
    () => layoutWeek(sessions, mondayOf(weekStart), timezone, window),
    [sessions, weekStart, timezone, window],
  );
  const marker = nowMarker(useNow(), mondayOf(weekStart), timezone, window);
  const days = onlyDate ? layout.days.filter((d) => d.date === onlyDate) : layout.days;
  return (
    <div
      className="cs-week"
      style={{
        gridTemplateColumns: `3.5rem ${days.map((day) => `minmax(${Math.max(8, ...day.sessions.map((session) => session.columns * 5))}rem, 1fr)`).join(" ")}`,
      }}
    >
      <div className="cs-hours">
        <div className="cs-day-header" aria-hidden="true" />
        <div
          className="cs-hours-labels"
          style={{ display: "grid", gridTemplateRows: `repeat(${layout.hours.length}, 3.2rem)` }}
        >
          {layout.hours.map((h) => (
            <span key={h}>{pad(h)}:00</span>
          ))}
        </div>
      </div>
      {days.map((day) => (
        <DayColumn
          key={day.date}
          date={day.date}
          label={day.label}
          sessions={day.sessions}
          classes={day.classes}
          registrations={day.registrations}
          hours={layout.hours}
          timezone={timezone}
          canEdit={canEdit}
          today={marker?.date === day.date}
          nowTop={marker?.date === day.date ? marker.top : null}
          onOpen={onOpen}
          onCreate={onCreate}
        />
      ))}
    </div>
  );
}

function MonthView({
  weekStart,
  sessions,
  timezone,
  onSelectWeek,
}: {
  weekStart: string;
  sessions: readonly GridSession[];
  timezone: string;
  onSelectWeek: (weekStart: string) => void;
}): ReactElement {
  const anchor = new Date(`${weekStart}T00:00:00.000Z`);
  const year = anchor.getUTCFullYear();
  const month = anchor.getUTCMonth();
  const firstOfMonth = `${year}-${pad(month + 1)}-01`;
  const lastDate = new Date(Date.UTC(year, month + 1, 0));
  const lastOfMonth = `${year}-${pad(month + 1)}-${pad(lastDate.getUTCDate())}`;
  const gridStart = mondayOf(firstOfMonth);
  const lastOffset = (lastDate.getUTCDay() + 6) % 7;
  const gridEndTime =
    new Date(`${lastOfMonth}T00:00:00.000Z`).getTime() + (6 - lastOffset) * 86_400_000;
  const days: string[] = [];
  for (
    let t = new Date(`${gridStart}T00:00:00.000Z`).getTime();
    t <= gridEndTime;
    t += 86_400_000
  ) {
    days.push(new Date(t).toISOString().slice(0, 10));
  }
  const counts = useMemo(() => countSessionDays(sessions, timezone), [sessions, timezone]);

  return (
    <div className="cs-month">
      {days.map((date) => {
        const d = new Date(`${date}T00:00:00.000Z`);
        const outside = d.getUTCMonth() !== month;
        const count = counts.get(date) ?? { classes: 0, registrations: 0 };
        const monday = mondayOf(date);
        const mondayDate = new Date(`${monday}T00:00:00.000Z`);
        const weekLabel = `Open the week of Monday ${mondayDate.getUTCDate()} ${monthNames[mondayDate.getUTCMonth()]} ${mondayDate.getUTCFullYear()}`;
        return (
          <button
            key={date}
            type="button"
            className="cs-month-cell"
            data-outside={outside ? "true" : undefined}
            aria-label={weekLabel}
            onClick={() => onSelectWeek(monday)}
          >
            <span className="cs-month-day">{d.getUTCDate()}</span>
            <span className="cs-month-counts">
              {count.classes} classes &middot; {count.registrations} registrations
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function CalendarView({
  view,
  weekStart,
  sessions,
  timezone,
  window,
  canEdit,
  onOpen,
  onCreate,
  onSelectWeek,
}: CalendarViewProps): ReactElement {
  if (view === "month") {
    return (
      <MonthView
        weekStart={weekStart}
        sessions={sessions}
        timezone={timezone}
        onSelectWeek={onSelectWeek}
      />
    );
  }
  const onlyDate: string | undefined = view === "day" ? weekStart : undefined;
  return (
    <WeekOrDay
      weekStart={weekStart}
      sessions={sessions}
      timezone={timezone}
      window={window}
      canEdit={canEdit}
      onOpen={onOpen}
      onCreate={onCreate}
      onlyDate={onlyDate}
    />
  );
}
