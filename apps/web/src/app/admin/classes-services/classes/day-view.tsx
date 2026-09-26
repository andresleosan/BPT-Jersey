"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactElement, RefObject } from "react";
import { safeTypeColour } from "./type-colour";
import { dayLabel, localParts } from "./week-grid";
import type { GridSession } from "./week-grid";

export type DayViewProps = Readonly<{
  sessions: readonly GridSession[];
  date: string;
  timezone: string;
  canEdit: boolean;
  onOpen: (sessionId: string) => void;
  onCreate: (date: string, startTime: string) => void;
}>;

/** Side by side while every card gets at least this much width; otherwise rows. */
const minCardRem = 12;

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function hhmm(hour: number): string {
  return `${pad(Math.floor(hour))}:${pad(Math.round((hour % 1) * 60))}`;
}

type Slot = Readonly<{
  start: number;
  end: number;
  sessions: readonly (GridSession & { start: number; end: number })[];
}>;

/** Classes of one day grouped into time slots: a slot holds every class overlapping another. */
function slotsOf(sessions: readonly GridSession[], date: string, timezone: string): Slot[] {
  const own = sessions
    .map((session) => {
      const start = localParts(session.startAt, timezone);
      const end = localParts(session.endAt, timezone);
      // A class running past midnight ends at the end of this day's axis.
      return {
        ...session,
        date: start.date,
        start: start.hour,
        end: end.date === start.date ? end.hour : 24,
      };
    })
    .filter((session) => session.date === date)
    .sort((a, b) => a.start - b.start || a.title.localeCompare(b.title));
  const slots: {
    start: number;
    end: number;
    sessions: (GridSession & { start: number; end: number })[];
  }[] = [];
  for (const session of own) {
    const last = slots.at(-1);
    if (last && session.start < last.end) {
      last.sessions.push(session);
      last.end = Math.max(last.end, session.end);
    } else {
      slots.push({ start: session.start, end: session.end, sessions: [session] });
    }
  }
  return slots;
}

/** The current instant, refreshed every minute so the now line moves while the page is open. */
export function useNow(): string {
  const [now, setNow] = useState(() => new Date().toISOString());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date().toISOString()), 60_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

/** Width of the element in px, or `null` until measured (and where ResizeObserver is missing). */
function useWidth(): [RefObject<HTMLDivElement | null>, number | null] {
  const ref = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState<number | null>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setWidth(entry.contentRect.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}

function DayCard({
  session,
  onOpen,
}: {
  session: GridSession & { start: number; end: number };
  onOpen: (sessionId: string) => void;
}): ReactElement {
  const cancelled = session.status === "cancelled";
  const colour = cancelled ? null : safeTypeColour(session.colour);
  const time = `${hhmm(session.start)} – ${hhmm(session.end)}`;
  const occupancy =
    session.capacity === null ? "Set capacity" : `${session.booked ?? "—"} / ${session.capacity}`;
  const coaches = session.coachNames?.join(", ");
  const details = [session.locationName, coaches].filter(Boolean).join(" · ");
  return (
    <button
      type="button"
      className={colour === null ? "cs-dayview-card" : "cs-dayview-card cs-event-typed"}
      data-status={cancelled ? "cancelled" : undefined}
      style={colour === null ? undefined : ({ "--type-colour": colour } as CSSProperties)}
      onClick={() => onOpen(session.sessionId)}
    >
      <span className="cs-dayview-title">{session.title}</span>
      <span className="cs-dayview-time">{time}</span>
      <span className="cs-dayview-occupancy">{occupancy}</span>
      {!cancelled && session.capacity !== null && session.booked !== null ? (
        <span
          role="meter"
          aria-label="Occupancy"
          aria-valuemin={0}
          aria-valuemax={session.capacity}
          aria-valuenow={session.booked}
          className="cs-dayview-meter"
        >
          <span
            style={{
              width: `${Math.min(100, session.capacity === 0 ? 100 : (session.booked / session.capacity) * 100)}%`,
            }}
          />
        </span>
      ) : null}
      {details ? <span className="cs-dayview-detail">{details}</span> : null}
      {session.typeName ? <span className="cs-dayview-detail">{session.typeName}</span> : null}
      {cancelled ? <span className="cs-dayview-status">Cancelled</span> : null}
    </button>
  );
}

/** One day on a desktop: a time axis on the left and each time slot's classes beside it. */
export function DayView({
  sessions,
  date,
  timezone,
  canEdit,
  onOpen,
  onCreate,
}: DayViewProps): ReactElement {
  const slots = useMemo(() => slotsOf(sessions, date, timezone), [sessions, date, timezone]);
  const now = localParts(useNow(), timezone);
  const today = now.date === date;
  const [ref, width] = useWidth();
  const rem =
    typeof document === "undefined"
      ? 16
      : Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  // The now line sits before the first slot still to start.
  const nowIndex = today ? slots.findIndex((slot) => slot.start > now.hour) : -1;
  const line = (
    <p key="now" className="cs-dayview-now">
      <span>Now {hhmm(now.hour)}</span>
    </p>
  );
  return (
    <div className="cs-dayview" ref={ref}>
      <div className="cs-dayview-header" aria-current={today ? "date" : undefined}>
        <h3>{dayLabel(date)}</h3>
        {canEdit ? (
          <button type="button" className="cs-button" onClick={() => onCreate(date, "17:00")}>
            Add a class
          </button>
        ) : null}
      </div>
      {slots.length === 0 ? (
        <p className="cs-placeholder">No classes match this day and these filters.</p>
      ) : null}
      <div className="cs-dayview-slots">
        {slots.map((slot, index) => {
          const fits = width === null || slot.sessions.length * minCardRem * rem <= width;
          return [
            index === nowIndex ? line : null,
            <section
              key={`${slot.start}-${slot.sessions[0]!.sessionId}`}
              className="cs-dayview-slot"
              data-layout={fits ? "columns" : "rows"}
              aria-label={`${hhmm(slot.start)} – ${hhmm(slot.end)}`}
            >
              <span className="cs-dayview-axis">{hhmm(slot.start)}</span>
              <div
                className="cs-dayview-cards"
                style={
                  fits
                    ? { gridTemplateColumns: `repeat(${slot.sessions.length}, minmax(0, 1fr))` }
                    : undefined
                }
              >
                {slot.sessions.map((session) => (
                  <DayCard key={session.sessionId} session={session} onOpen={onOpen} />
                ))}
              </div>
            </section>,
          ];
        })}
        {today && nowIndex === -1 && slots.length > 0 ? line : null}
      </div>
    </div>
  );
}
