"use client";

import { useEffect, useMemo, useState } from "react";
import type { CSSProperties, ReactElement } from "react";
import type { LocationRecord } from "@bpt-jersey/domain/schedule";
import { useCompactCalendar } from "./use-compact-calendar";
import { safeTypeColour } from "./type-colour";
import {
  compressEmptyRows,
  countSessionDays,
  dayLabel,
  weekDays,
  layoutWeek,
  localParts,
  markerBand,
  mondayOf,
  nowMarker,
} from "./week-grid";
import type { GridSession, PlacedSession } from "./week-grid";

export type CalendarViewProps = Readonly<{
  view: "week" | "month" | "day";
  loading?: boolean;
  selectedDate?: string | undefined;
  onSelectDate?: ((date: string) => void) | undefined;
  locations?: readonly LocationRecord[];
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

function occupancyLabel(session: GridSession): string {
  return session.capacity === null
    ? "Set capacity"
    : `${session.booked ?? "—"} / ${session.capacity}`;
}

function EventButton({
  session,
  firstRow,
  timezone,
  onOpen,
}: {
  session: PlacedSession;
  firstRow: number;
  timezone: string;
  onOpen: (sessionId: string) => void;
}): ReactElement {
  const cancelled = session.status === "cancelled";
  // Only a validated hex reaches the style attribute; anything else leaves the card without a rule.
  const colour = cancelled ? null : safeTypeColour(session.colour);
  const time = `${timeLabel(session.startAt, timezone)} – ${timeLabel(session.endAt, timezone)}`;
  const occupancy = occupancyLabel(session);
  const style = {
    gridRow: `${session.rowStart - firstRow + 1} / span ${session.rowSpan}`,
    gridColumn: session.columns > 1 ? `${session.column + 1}` : "1 / -1",
    ...(colour === null ? {} : { "--type-colour": colour }),
  } as CSSProperties;
  const name = [
    session.title,
    time,
    session.capacity === null ? occupancy : `${occupancy} booked`,
    session.typeName,
    cancelled ? "Cancelled" : undefined,
  ]
    .filter((part) => part !== undefined && part !== "")
    .join(", ");
  return (
    <button
      type="button"
      className={colour === null ? "cs-event" : "cs-event cs-event-typed"}
      data-status={cancelled ? "cancelled" : undefined}
      style={style}
      title={session.title}
      aria-label={name}
      onClick={() => onOpen(session.sessionId)}
    >
      <span className="cs-event-title">{session.title}</span>
      <span className="cs-event-time">{time}</span>
      {session.typeName ? <span className="cs-event-type">{session.typeName}</span> : null}
      <span className="cs-event-chip">{occupancy}</span>
    </button>
  );
}

type BandRows = Readonly<{ startRow: number; endRow: number }>;

function DayRows({
  date,
  label,
  band,
  fromHour,
  sessions,
  columns,
  timezone,
  canEdit,
  today,
  nowShare,
  onOpen,
  onCreate,
}: {
  date: string;
  label: string;
  band: BandRows;
  fromHour: number;
  sessions: readonly PlacedSession[];
  columns: number;
  timezone: string;
  canEdit: boolean;
  today: boolean;
  nowShare: number | null;
  onOpen: (sessionId: string) => void;
  onCreate: (date: string, startTime: string) => void;
}): ReactElement {
  const rows = band.endRow - band.startRow;
  return (
    <div className="cs-day" data-today={today ? "true" : undefined}>
      <div
        className="cs-day-grid"
        style={
          {
            display: "grid",
            gridTemplateRows: `repeat(${rows}, 1.6rem)`,
            gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
            // The now line is painted by the grid background (see `.cs-day-grid[style*="--now"]`).
            ...(nowShare === null ? {} : { "--now": String(nowShare) }),
          } as CSSProperties
        }
      >
        {Array.from({ length: rows }, (_, index) => {
          const time = hhmm(fromHour + (band.startRow + index) / 2);
          const style: CSSProperties = { gridRow: `${index + 1} / span 1`, gridColumn: "1 / -1" };
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
        {sessions
          .filter((session) => session.rowStart >= band.startRow && session.rowStart < band.endRow)
          .map((session) => (
            <EventButton
              key={session.sessionId}
              session={session}
              firstRow={band.startRow}
              timezone={timezone}
              onOpen={onOpen}
            />
          ))}
      </div>
    </div>
  );
}

function HourLabels({ band, fromHour }: { band: BandRows; fromHour: number }): ReactElement {
  const rows = band.endRow - band.startRow;
  return (
    <div className="cs-hours">
      <div
        className="cs-hours-labels"
        style={{ display: "grid", gridTemplateRows: `repeat(${rows}, 1.6rem)` }}
      >
        {Array.from({ length: rows }, (_, index) => band.startRow + index)
          .filter((row) => row % 2 === 0)
          .map((row) => (
            <span key={row} style={{ gridRow: `${row - band.startRow + 1} / span 2` }}>
              {hhmm(fromHour + row / 2)}
            </span>
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
  const days = onlyDate ? layout.days.filter((d) => d.date === onlyDate) : layout.days;
  const bands = useMemo(
    () => compressEmptyRows({ days, hours: layout.hours }),
    [days, layout.hours],
  );
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(() => new Set());
  const marker = nowMarker(useNow(), mondayOf(weekStart), timezone, window);
  const now = marker?.top == null ? null : markerBand(bands, marker.top);
  const fromHour = layout.hours[0] ?? window.fromHour;
  const columnsOf = (day: (typeof days)[number]) =>
    Math.max(1, ...day.sessions.map((session) => session.columns));
  const toggle = (startRow: number) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(startRow)) next.delete(startRow);
      else next.add(startRow);
      return next;
    });
  return (
    <div
      className="cs-week"
      style={{
        gridTemplateColumns: `3.5rem ${days.map((day) => `minmax(${Math.max(8, ...day.sessions.map((session) => session.columns * 5))}rem, 1fr)`).join(" ")}`,
      }}
    >
      <div className="cs-day-header" aria-hidden="true" />
      {days.map((day) => {
        const today = marker?.date === day.date;
        return (
          <div key={day.date} className="cs-day" data-today={today ? "true" : undefined}>
            <div className="cs-day-header" aria-current={today ? "date" : undefined}>
              <span>{day.label}</span>
              <span className="cs-day-counts">
                {day.classes} classes &middot; {day.registrations ?? "—"} registrations
              </span>
            </div>
          </div>
        );
      })}
      {bands.map((band, index) => {
        const open = band.kind === "rows" || expanded.has(band.startRow);
        const nowShare = now?.band === index ? now.share : null;
        const toggleButton =
          band.kind === "gap" ? (
            <button
              key={`gap-${band.startRow}`}
              type="button"
              className="cs-gap"
              aria-expanded={open}
              style={
                {
                  gridColumn: "1 / -1",
                  ...(!open && nowShare !== null && marker?.date
                    ? { "--now": String(nowShare) }
                    : {}),
                } as CSSProperties
              }
              onClick={() => toggle(band.startRow)}
            >
              {band.label}
            </button>
          ) : null;
        if (!open) return toggleButton;
        return [
          toggleButton,
          <HourLabels key={`hours-${band.startRow}`} band={band} fromHour={fromHour} />,
          ...days.map((day) => (
            <DayRows
              key={`${day.date}-${band.startRow}`}
              date={day.date}
              label={day.label}
              band={band}
              fromHour={fromHour}
              sessions={day.sessions}
              columns={columnsOf(day)}
              timezone={timezone}
              canEdit={canEdit}
              today={marker?.date === day.date}
              nowShare={marker?.date === day.date ? nowShare : null}
              onOpen={onOpen}
              onCreate={onCreate}
            />
          )),
        ];
      })}
    </div>
  );
}

function DayAgenda({
  selectedDate,
  onSelectDate,
  weekStart,
  sessions,
  timezone,
  canEdit,
  onOpen,
  onCreate,
  view,
  loading,
  locations = [],
}: CalendarViewProps): ReactElement {
  const [selected, setSelected] = useState("");
  const dates = view === "day" ? [weekStart] : weekDays(mondayOf(weekStart));
  const today = localParts(useNow(), timezone).date;
  const requested = selectedDate ?? selected;
  const date = dates.includes(requested) ? requested : dates.includes(today) ? today : dates[0]!;
  const byDate = useMemo(() => {
    const grouped = new Map<string, GridSession[]>();
    for (const row of sessions) {
      const day = localParts(row.startAt, timezone).date;
      const rows = grouped.get(day) ?? [];
      rows.push(row);
      grouped.set(day, rows);
    }
    for (const rows of grouped.values())
      rows.sort((a, b) => a.startAt.localeCompare(b.startAt) || a.title.localeCompare(b.title));
    return grouped;
  }, [sessions, timezone]);
  const own = byDate.get(date) ?? [];
  return (
    <div className="cs-agenda">
      {view === "week" ? (
        <label className="cs-field">
          <span>Day to show</span>
          <select
            value={date}
            onChange={(event) => {
              setSelected(event.target.value);
              onSelectDate?.(event.target.value);
            }}
          >
            {dates.map((day) => (
              <option key={day} value={day}>
                {dayLabel(day)}
                {loading ? "" : ` · ${byDate.get(day)?.length ?? 0} classes`}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <h3>{dayLabel(date)}</h3>
      )}
      {canEdit ? (
        <button type="button" className="cs-button" onClick={() => onCreate(date, "17:00")}>
          Add a class
        </button>
      ) : null}
      {loading && own.length === 0 ? (
        <div className="cs-agenda-skeleton" aria-hidden="true">
          <div />
          <div />
          <div />
        </div>
      ) : null}
      {own.map((row) => (
        <button
          key={row.sessionId}
          type="button"
          className="cs-event cs-agenda-event"
          data-status={row.status === "cancelled" ? "cancelled" : undefined}
          onClick={() => onOpen(row.sessionId)}
        >
          <span className="cs-event-time">
            {timeLabel(row.startAt, timezone)} – {timeLabel(row.endAt, timezone)}
          </span>
          <span className="cs-event-title">{row.title}</span>
          <span>
            {locations.find((location) => location.locationId === row.locationId)?.name ??
              "Location loading…"}
          </span>
          <span>
            {row.capacity === null
              ? "Set capacity"
              : `${row.booked ?? "—"} / ${row.capacity} registered`}
          </span>
          {row.status === "cancelled" ? <span>Cancelled</span> : null}
        </button>
      ))}
      {!loading && own.length === 0 ? (
        <p className="cs-placeholder">No classes match this day and these filters.</p>
      ) : null}
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
  const compact = useCompactCalendar();
  if (compact)
    return (
      <div className="cs-month-weeks">
        {days
          .filter((_, index) => index % 7 === 0)
          .map((date) => {
            const dates = weekDays(date);
            const classes = dates.reduce((sum, day) => sum + (counts.get(day)?.classes ?? 0), 0);
            return (
              <button
                key={date}
                type="button"
                className="cs-month-week cs-button"
                onClick={() => onSelectWeek(date)}
              >
                <span>
                  {dayLabel(date)} – {dayLabel(dates[6]!)}
                </span>
                <span>{classes} classes · Open week</span>
              </button>
            );
          })}
      </div>
    );

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
              {count.classes} classes &middot; {count.registrations ?? "—"} registrations
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function CalendarView({
  selectedDate,
  onSelectDate,
  loading = false,
  locations = [],
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
  const compact = useCompactCalendar();
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
  if (compact)
    return (
      <DayAgenda
        selectedDate={selectedDate}
        onSelectDate={onSelectDate}
        view={view}
        weekStart={weekStart}
        sessions={sessions}
        timezone={timezone}
        window={window}
        canEdit={canEdit}
        onOpen={onOpen}
        onCreate={onCreate}
        onSelectWeek={onSelectWeek}
        loading={loading}
        locations={locations}
      />
    );
  const onlyDate: string | undefined = view === "day" ? weekStart : undefined;
  return (
    <WeekOrDay
      key={`${mondayOf(weekStart)}-${onlyDate ?? "week"}`}
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
