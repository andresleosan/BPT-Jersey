import type { SessionStatus } from "@bpt-jersey/domain/schedule";

export type GridSession = Readonly<{
  sessionId: string;
  title: string;
  startAt: string;
  endAt: string;
  colour: string;
  booked: number;
  capacity: number | null;
  status: SessionStatus;
  locationId: string;
  programId: string;
  instructorIds: readonly string[];
}>;
export type PlacedSession = GridSession &
  Readonly<{ rowStart: number; rowSpan: number; column: number; columns: number }>;
export type DayLayout = Readonly<{
  date: string;
  label: string;
  sessions: readonly PlacedSession[];
  classes: number;
  registrations: number;
}>;

const dayNames = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

function ymd(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function mondayOf(date: string): string {
  const d = new Date(`${date}T00:00:00.000Z`);
  const offset = (d.getUTCDay() + 6) % 7;
  return ymd(new Date(d.getTime() - offset * 86_400_000));
}

export function weekDays(weekStart: string): readonly string[] {
  const start = new Date(`${weekStart}T00:00:00.000Z`).getTime();
  return Array.from({ length: 7 }, (_, i) => ymd(new Date(start + i * 86_400_000)));
}

export function dayLabel(date: string): string {
  const d = new Date(`${date}T00:00:00.000Z`);
  return `${dayNames[d.getUTCDay()]} ${d.getUTCDate()}/${d.getUTCMonth() + 1}`;
}

/** Local calendar date and fractional hour of an instant in the academy timezone. */
export function localParts(iso: string, timezone: string): { date: string; hour: number } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(new Date(iso));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    hour: Number(get("hour")) + Number(get("minute")) / 60,
  };
}

export function layoutWeek(
  sessions: readonly GridSession[],
  weekStart: string,
  timezone: string,
  window: { fromHour: number; toHour: number },
): { days: readonly DayLayout[]; hours: readonly number[] } {
  const hours = Array.from(
    { length: window.toHour - window.fromHour + 1 },
    (_, i) => window.fromHour + i,
  );
  const days = weekDays(weekStart).map((date) => {
    const own = sessions
      .map((s) => ({
        s,
        start: localParts(s.startAt, timezone),
        end: localParts(s.endAt, timezone),
      }))
      .filter(({ start }) => start.date === date)
      .sort((a, b) => a.start.hour - b.start.hour || a.s.title.localeCompare(b.s.title));
    const placed: PlacedSession[] = [];
    const active: { end: number; column: number }[] = [];
    for (const { s, start, end } of own) {
      for (let i = active.length - 1; i >= 0; i -= 1)
        if (active[i]!.end <= start.hour) active.splice(i, 1);
      const held = new Set(active.map((a) => a.column));
      const column = held.has(0) ? (held.has(1) ? 0 : 1) : 0;
      active.push({ end: end.hour, column });
      const rowStart = Math.max(0, Math.round((start.hour - window.fromHour) * 2));
      const rowSpan = Math.max(1, Math.round((end.hour - start.hour) * 2));
      placed.push({ ...s, rowStart, rowSpan, column, columns: 1 });
    }
    // second pass: every session that overlapped anything gets two columns
    const columns = placed.map((p) =>
      placed.some(
        (q) =>
          q !== p && q.rowStart < p.rowStart + p.rowSpan && p.rowStart < q.rowStart + q.rowSpan,
      )
        ? 2
        : 1,
    );
    const final = placed.map((p, i) => ({ ...p, columns: columns[i]! }));
    return Object.freeze({
      date,
      label: dayLabel(date),
      sessions: Object.freeze(final),
      classes: own.filter(({ s }) => s.status !== "cancelled").length,
      registrations: own.reduce((sum, { s }) => sum + (s.status === "cancelled" ? 0 : s.booked), 0),
    });
  });
  return Object.freeze({ days: Object.freeze(days), hours: Object.freeze(hours) });
}
