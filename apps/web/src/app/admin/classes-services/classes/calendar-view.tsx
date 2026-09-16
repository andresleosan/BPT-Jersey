"use client";

import type { CSSProperties, ReactElement } from "react";
import { layoutWeek, localParts, mondayOf } from "./week-grid";
import type { GridSession, PlacedSession } from "./week-grid";

export type CalendarViewProps = Readonly<{
  view: "week" | "month" | "day";
  weekStart: string;
  sessions: readonly GridSession[];
  timezone: string;
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

function EventButton({
  session,
  timezone,
  onOpen,
}: {
  session: PlacedSession;
  timezone: string;
  onOpen: (sessionId: string) => void;
}): ReactElement {
  const style: CSSProperties = {
    gridRow: `${session.rowStart + 1} / span ${session.rowSpan}`,
    gridColumn: session.columns === 2 ? `${session.column + 1}` : "1 / span 2",
    background: session.colour,
  };
  return (
    <button
      type="button"
      className="cs-event"
      data-status={session.status === "cancelled" ? "cancelled" : undefined}
      style={style}
      onClick={() => onOpen(session.sessionId)}
    >
      <span className="cs-event-title">{session.title}</span>
      <span className="cs-event-time">
        {timeLabel(session.startAt, timezone)} - {timeLabel(session.endAt, timezone)}
      </span>
      <span className="cs-event-chip">
        {session.booked} / {session.capacity ?? "∞"}
      </span>
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
  onOpen: (sessionId: string) => void;
  onCreate: (date: string, startTime: string) => void;
}): ReactElement {
  const halfHours = (hours.length - 1) * 2;
  return (
    <div className="cs-day">
      <div className="cs-day-header">
        <span>{label}</span>
        <span className="cs-day-counts">
          {classes} classes &middot; {registrations} registrations
        </span>
      </div>
      <div
        className="cs-day-grid"
        style={{
          display: "grid",
          gridTemplateRows: `repeat(${halfHours}, 1.6rem)`,
          gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
        }}
      >
        {canEdit
          ? Array.from({ length: halfHours }, (_, row) => {
              const hour = hours[0]! + row / 2;
              const time = hhmm(hour);
              return (
                <button
                  key={time}
                  type="button"
                  className="cs-slot"
                  style={{ gridRow: `${row + 1} / span 1`, gridColumn: "1 / span 2" }}
                  aria-label={`Create a class on ${label} at ${time}`}
                  onClick={() => onCreate(date, time)}
                />
              );
            })
          : null}
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
  onlyDate?: string;
}): ReactElement {
  const layout = layoutWeek(sessions, mondayOf(weekStart), timezone, window);
  const days = onlyDate ? layout.days.filter((d) => d.date === onlyDate) : layout.days;
  return (
    <div className="cs-week">
      <div className="cs-hours">
        {layout.hours.map((h) => (
          <span key={h}>{pad(h)}:00</span>
        ))}
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
  window,
  onSelectWeek,
}: {
  weekStart: string;
  sessions: readonly GridSession[];
  timezone: string;
  window: { fromHour: number; toHour: number };
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
  const counts = new Map<string, { classes: number; registrations: number }>();
  // build counts via layoutWeek per distinct Monday covered by the grid
  const mondays = new Set(days.map((d) => mondayOf(d)));
  for (const m of mondays) {
    const layout = layoutWeek(sessions, m, timezone, window);
    for (const d of layout.days)
      counts.set(d.date, { classes: d.classes, registrations: d.registrations });
  }

  return (
    <div className="cs-month">
      {days.map((date) => {
        const d = new Date(`${date}T00:00:00.000Z`);
        const outside = d.getUTCMonth() !== month;
        const count = counts.get(date) ?? { classes: 0, registrations: 0 };
        return (
          <button
            key={date}
            type="button"
            className="cs-month-cell"
            data-outside={outside ? "true" : undefined}
            onClick={() => onSelectWeek(mondayOf(date))}
          >
            <span className="cs-month-day">{d.getUTCDate()}</span>
            {count.classes > 0 ? (
              <span className="cs-month-counts">
                {count.classes} classes &middot; {count.registrations} registrations
              </span>
            ) : null}
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
        window={window}
        onSelectWeek={onSelectWeek}
      />
    );
  }
  if (view === "day") {
    return (
      <WeekOrDay
        weekStart={weekStart}
        sessions={sessions}
        timezone={timezone}
        window={window}
        canEdit={canEdit}
        onOpen={onOpen}
        onCreate={onCreate}
        onlyDate={weekStart}
      />
    );
  }
  return (
    <WeekOrDay
      weekStart={weekStart}
      sessions={sessions}
      timezone={timezone}
      window={window}
      canEdit={canEdit}
      onOpen={onOpen}
      onCreate={onCreate}
    />
  );
}
