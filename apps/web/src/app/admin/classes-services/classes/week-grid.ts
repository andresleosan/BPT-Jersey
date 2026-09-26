import type { SessionStatus } from "@bpt-jersey/domain/schedule";

export type GridSession = Readonly<{
  sessionId: string;
  title: string;
  startAt: string;
  endAt: string;
  colour: string;
  /** The class type's name, shown in text next to its colour rule. */
  typeName?: string;
  booked: number | null;
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
  registrations: number | null;
}>;

export type WeekLayout = Readonly<{ days: readonly DayLayout[]; hours: readonly number[] }>;
export type RowBand =
  | Readonly<{ kind: "rows"; startRow: number; endRow: number }>
  | Readonly<{ kind: "gap"; startRow: number; endRow: number; label: string }>;

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

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timezone: string): Intl.DateTimeFormat {
  const cached = formatterCache.get(timezone);
  if (cached) return cached;
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  formatterCache.set(timezone, formatter);
  return formatter;
}

/** Local calendar date and fractional hour of an instant in the academy timezone. */
export function localParts(iso: string, timezone: string): { date: string; hour: number } {
  const parts = formatterFor(timezone).formatToParts(new Date(iso));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    hour: Number(get("hour")) + Number(get("minute")) / 60,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function layoutWeek(
  sessions: readonly GridSession[],
  weekStart: string,
  timezone: string,
  window: { fromHour: number; toHour: number },
): WeekLayout {
  const rows = (window.toHour - window.fromHour) * 2;
  const hours = Array.from(
    { length: window.toHour - window.fromHour + 1 },
    (_, i) => window.fromHour + i,
  );
  const byDate = new Map<
    string,
    { s: GridSession; start: { date: string; hour: number }; end: { date: string; hour: number } }[]
  >();
  for (const s of sessions) {
    const start = localParts(s.startAt, timezone);
    const end = localParts(s.endAt, timezone);
    const group = byDate.get(start.date);
    const entry = { s, start, end };
    if (group) group.push(entry);
    else byDate.set(start.date, [entry]);
  }
  const days = weekDays(weekStart).map((date) => {
    const own = (byDate.get(date) ?? [])
      .slice()
      .sort((a, b) => a.start.hour - b.start.hour || a.s.title.localeCompare(b.s.title));
    const placed: PlacedSession[] = [];
    let group: PlacedSession[] = [];
    let ends: number[] = [];
    let groupEnd = -1;
    function finishGroup(): void {
      for (const session of group) placed.push({ ...session, columns: ends.length });
      group = [];
      ends = [];
    }
    for (const { s, start, end } of own) {
      const rowStart = clamp(Math.round((start.hour - window.fromHour) * 2), 0, rows - 1);
      const rowEnd = clamp(Math.round((end.hour - window.fromHour) * 2), rowStart + 1, rows);
      if (rowStart >= groupEnd) finishGroup();
      let column = ends.findIndex((value) => value <= rowStart);
      if (column === -1) column = ends.length;
      ends[column] = rowEnd;
      groupEnd = Math.max(groupEnd, rowEnd);
      group.push({ ...s, rowStart, rowSpan: rowEnd - rowStart, column, columns: 1 });
    }
    finishGroup();
    return Object.freeze({
      date,
      label: dayLabel(date),
      sessions: Object.freeze(placed),
      classes: own.filter(({ s }) => s.status !== "cancelled").length,
      registrations: own.some(({ s }) => s.status !== "cancelled" && s.booked === null)
        ? null
        : own.reduce((sum, { s }) => sum + (s.status === "cancelled" ? 0 : (s.booked ?? 0)), 0),
    });
  });
  return Object.freeze({ days: Object.freeze(days), hours: Object.freeze(hours) });
}

function hhmm(hour: number): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(Math.floor(hour))}:${pad(Math.round((hour % 1) * 60))}`;
}

/**
 * Splits the half-hour rows into bands: whole hours with no class on any day of the layout fold
 * into one labelled "gap" band; hours holding any part of a class stay as rows.
 */
export function compressEmptyRows(layout: WeekLayout): readonly RowBand[] {
  const fromHour = layout.hours[0] ?? 0;
  const rows = (layout.hours.length - 1) * 2;
  const busy = new Array<boolean>(rows).fill(false);
  for (const day of layout.days)
    for (const session of day.sessions)
      for (let row = session.rowStart; row < session.rowStart + session.rowSpan; row += 1)
        busy[row] = true;
  const bands: RowBand[] = [];
  for (let start = 0; start < rows; start += 2) {
    const end = Math.min(start + 2, rows);
    const empty = busy.slice(start, end).every((value) => !value);
    const last = bands.at(-1);
    if (last && (last.kind === "gap") === empty) {
      bands[bands.length - 1] = { ...last, endRow: end };
    } else {
      bands.push(
        empty
          ? { kind: "gap", startRow: start, endRow: end, label: "" }
          : { kind: "rows", startRow: start, endRow: end },
      );
    }
  }
  return Object.freeze(
    bands.map((band) =>
      band.kind === "gap"
        ? {
            ...band,
            label: `${hhmm(fromHour + band.startRow / 2)} – ${hhmm(fromHour + band.endRow / 2)} · no classes`,
          }
        : band,
    ),
  );
}

/** The band holding the now line (`top` as a 0–1 share of the rows) and its share of that band. */
export function markerBand(
  bands: readonly RowBand[],
  top: number,
): { band: number; share: number } | null {
  const rows = bands.at(-1)?.endRow ?? 0;
  const at = top * rows;
  const band = bands.findIndex(
    (candidate, index) =>
      at >= candidate.startRow && (at < candidate.endRow || index === bands.length - 1),
  );
  if (band === -1) return null;
  const { startRow, endRow } = bands[band]!;
  return { band, share: (at - startRow) / (endRow - startRow) };
}

/**
 * Today's column and the height of the "now" line as a share (0–1) of the visible hours, or
 * `top: null` when the current time is outside them. `null` when today is not in the week shown.
 */
export function nowMarker(
  nowIso: string,
  weekStart: string,
  timezone: string,
  window: { fromHour: number; toHour: number },
): { date: string; top: number | null } | null {
  const { date, hour } = localParts(nowIso, timezone);
  if (!weekDays(weekStart).includes(date)) return null;
  const inside = hour >= window.fromHour && hour <= window.toHour;
  return {
    date,
    top: inside ? (hour - window.fromHour) / (window.toHour - window.fromHour) : null,
  };
}

/** Month summaries need one date conversion per class, with no week layout or overlap calculation. */
export function countSessionDays(
  sessions: readonly GridSession[],
  timezone: string,
): ReadonlyMap<string, { classes: number; registrations: number | null }> {
  const counts = new Map<string, { classes: number; registrations: number | null }>();
  for (const session of sessions) {
    if (session.status === "cancelled") continue;
    const date = localParts(session.startAt, timezone).date;
    const count = counts.get(date) ?? { classes: 0, registrations: 0 };
    count.classes += 1;
    count.registrations =
      count.registrations === null || session.booked === null
        ? null
        : count.registrations + session.booked;
    counts.set(date, count);
  }
  return counts;
}
