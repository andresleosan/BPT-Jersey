import type { CalendarMember, CalendarWeekData } from "./calendar-repository";

/**
 * The last member and weeks this browser showed, so /account paints at once on the next visit
 * while the live load runs (stale-while-revalidate). Server checks still decide every booking.
 * Keyed by Firebase uid, cleared on sign-out, dropped after a week.
 * ponytail: whole-snapshot JSON in localStorage; move to IndexedDB if it ever holds more weeks.
 */
const prefix = "bpt-member-calendar:";
const maxAgeMs = 7 * 86_400_000;
const maxWeeks = 6;

type Snapshot = {
  savedAt: number;
  member?: CalendarMember;
  weeks: Record<string, CalendarWeekData>;
};

function read(key: string): Snapshot | undefined {
  try {
    const value = JSON.parse(window.localStorage.getItem(prefix + key) ?? "null") as Snapshot | null;
    return value && Date.now() - value.savedAt < maxAgeMs ? value : undefined;
  } catch {
    return undefined;
  }
}

function write(key: string, update: (current: Snapshot) => Snapshot): void {
  try {
    const next = update(read(key) ?? { savedAt: Date.now(), weeks: {} });
    const weeks = Object.entries(next.weeks).slice(-maxWeeks);
    window.localStorage.setItem(
      prefix + key,
      JSON.stringify({ ...next, savedAt: Date.now(), weeks: Object.fromEntries(weeks) }),
    );
  } catch {
    // Full or blocked storage only costs the instant first paint.
  }
}

export const weekCacheKey = (studentId: string, from: string, to: string) =>
  `${studentId}|${from}|${to}`;

export function cachedMember(key: string): CalendarMember | undefined {
  return read(key)?.member;
}

export function cachedWeek(key: string, week: string): CalendarWeekData | undefined {
  return read(key)?.weeks[week];
}

export function saveCachedMember(key: string, member: CalendarMember): void {
  write(key, (current) => ({ ...current, member }));
}

export function saveCachedWeek(key: string, week: string, data: CalendarWeekData): void {
  write(key, (current) => {
    const weeks = { ...current.weeks };
    delete weeks[week]; // re-insert last so the trim keeps the most recent weeks
    return { ...current, weeks: { ...weeks, [week]: data } };
  });
}

export function clearCalendarCache(key: string): void {
  try {
    window.localStorage.removeItem(prefix + key);
  } catch {
    // Nothing stored, nothing to clear.
  }
}
