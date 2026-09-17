/**
 * Member calendar (/account) — pure rules for what a member sees and may do.
 *
 * Spec: docs/superpowers/specs/2026-09-10-member-calendar-design.md
 * Every day, label and deadline is computed in Europe/Jersey. Nothing here touches Firebase.
 */
import { isWithinBookingCutoff } from "./schedule-contracts";
import type {
  AttendanceRecord,
  BookingRecord,
  ProgramRecord,
  SessionRecord,
} from "./schedule-contracts";
import type { ParticipantType, Site, WeeklyClassLimit } from "../memberships/plan-contracts";

export const calendarTimeZone = "Europe/Jersey";
export const calendarMaxOffsetDays = 14;
export const calendarCutoffMinutes = 60;

export type CalendarViewport = "phone" | "desktop";

export type CalendarDay = Readonly<{
  dateKey: string; // YYYY-MM-DD in Jersey
  weekday: string; // Mon … Sat
  dayNumber: number;
  isToday: boolean;
  startAt: string; // UTC ISO, 00:00 Jersey
  endAt: string; // UTC ISO, 00:00 Jersey of the next day
}>;

const dayMs = 24 * 60 * 60 * 1000;

const partsFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: calendarTimeZone,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

type JerseyParts = Readonly<{
  year: number;
  month: number;
  day: number;
  weekday: string;
  hour: number;
  minute: number;
}>;

function jerseyParts(date: Date): JerseyParts {
  const parts: Record<string, string> = {};
  for (const part of partsFormatter.formatToParts(date)) {
    parts[part.type] = part.value;
  }
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    weekday: parts.weekday ?? "",
    hour: Number(parts.hour),
    minute: Number(parts.minute),
  };
}

function pad(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

export function dateKeyInJersey(date: Date): string {
  const { year, month, day } = jerseyParts(date);
  return `${year}-${pad(month)}-${pad(day)}`;
}

function splitKey(dateKey: string): [number, number, number] {
  const [year, month, day] = dateKey.split("-").map(Number);
  return [year ?? 1970, month ?? 1, day ?? 1];
}

/** Monday (YYYY-MM-DD) of the Jersey week holding `iso`; the week the booking limit counts. */
export function jerseyWeekKey(iso: string): string {
  const [year, month, day] = splitKey(dateKeyInJersey(new Date(iso)));
  const noon = new Date(Date.UTC(year, month - 1, day, 12));
  const mondayOffset = (noon.getUTCDay() + 6) % 7;
  return new Date(noon.getTime() - mondayOffset * dayMs).toISOString().slice(0, 10);
}

/** Noon UTC of the given Jersey date key: always inside that Jersey day (UTC+0 or +1). */
function noonAnchor(dateKey: string): Date {
  const [year, month, day] = splitKey(dateKey);
  return new Date(Date.UTC(year, month - 1, day, 12));
}

/** Offset of Jersey from UTC at `date`, in minutes (0 in winter, 60 in summer). */
function jerseyOffsetMinutes(date: Date): number {
  const { year, month, day, hour, minute } = jerseyParts(date);
  const asUtc = Date.UTC(year, month - 1, day, hour, minute);
  return Math.round((asUtc - date.getTime()) / 60000);
}

function jerseyMidnight(dateKey: string): Date {
  const [year, month, day] = splitKey(dateKey);
  const localMidnightAsUtc = Date.UTC(year, month - 1, day, 0);
  return new Date(localMidnightAsUtc - jerseyOffsetMinutes(noonAnchor(dateKey)) * 60000);
}

const weekdayIndex: Readonly<Record<string, number>> = Object.freeze({
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
  Sun: 7,
});

function dayFromAnchor(anchor: Date, todayKey: string): CalendarDay {
  const key = dateKeyInJersey(anchor);
  const { weekday, day } = jerseyParts(anchor);
  return Object.freeze({
    dateKey: key,
    weekday,
    dayNumber: day,
    isToday: key === todayKey,
    startAt: jerseyMidnight(key).toISOString(),
    endAt: jerseyMidnight(dateKeyInJersey(new Date(anchor.getTime() + dayMs))).toISOString(),
  });
}

function isSunday(anchor: Date): boolean {
  return jerseyParts(anchor).weekday === "Sun";
}

function todayAnchor(now: Date): Date {
  return noonAnchor(dateKeyInJersey(now));
}

function mondayOfWeek(anchor: Date): Date {
  const index = weekdayIndex[jerseyParts(anchor).weekday] ?? 1;
  return new Date(anchor.getTime() - (index - 1) * dayMs);
}

/** Monday the desktop view starts from at offset 0: this week's, or next week's on a Sunday. */
function baseMonday(today: Date): Date {
  return isSunday(today) ? new Date(today.getTime() + dayMs) : mondayOfWeek(today);
}

function desktopMaxOffset(now: Date): number {
  const today = todayAnchor(now);
  const monday = baseMonday(today);
  const cap = today.getTime() + calendarMaxOffsetDays * dayMs;
  let offset = 0;
  while (monday.getTime() + (offset + 1) * 7 * dayMs <= cap) offset += 1;
  return offset;
}

export function clampOffset(viewport: CalendarViewport, offset: number, now: Date): number {
  const max = viewport === "phone" ? calendarMaxOffsetDays : desktopMaxOffset(now);
  if (!Number.isFinite(offset) || offset < 0) return 0;
  return Math.min(Math.trunc(offset), max);
}

export function visibleDays(input: {
  now: Date;
  viewport: CalendarViewport;
  offset: number;
}): readonly CalendarDay[] {
  const todayKey = dateKeyInJersey(input.now);
  const today = todayAnchor(input.now);
  const offset = clampOffset(input.viewport, input.offset, input.now);

  if (input.viewport === "phone") {
    const days: CalendarDay[] = [];
    let cursor = new Date(today.getTime() + offset * dayMs);
    while (days.length < 2) {
      if (!isSunday(cursor)) days.push(dayFromAnchor(cursor, todayKey));
      cursor = new Date(cursor.getTime() + dayMs);
    }
    return Object.freeze(days);
  }

  const monday = new Date(baseMonday(today).getTime() + offset * 7 * dayMs);
  return Object.freeze(
    [0, 1, 2, 3, 4, 5].map((step) =>
      dayFromAnchor(new Date(monday.getTime() + step * dayMs), todayKey),
    ),
  );
}

export function nextOffset(viewport: CalendarViewport, offset: number, now: Date): number | null {
  if (viewport === "desktop") {
    const next = offset + 1;
    return next <= desktopMaxOffset(now) ? next : null;
  }
  const today = todayAnchor(now);
  let next = offset + 1;
  if (isSunday(new Date(today.getTime() + next * dayMs))) next += 1;
  return next <= calendarMaxOffsetDays ? next : null;
}

export function prevOffset(viewport: CalendarViewport, offset: number, now: Date): number | null {
  if (offset <= 0) return null;
  if (viewport === "desktop") return offset - 1;
  const today = todayAnchor(now);
  let prev = offset - 1;
  if (isSunday(new Date(today.getTime() + prev * dayMs))) prev -= 1;
  return prev < 0 ? null : prev;
}

// ── Session status ──

export const calendarSessionStatuses = Object.freeze([
  "open",
  "booked",
  "attended",
  "missed",
  "closed",
  "full",
  "locked",
] as const);
export type CalendarSessionStatus = (typeof calendarSessionStatuses)[number];

export type LockedReason = "age_band" | "site" | "open_mat" | "weekly_limit";

export type CalendarMemberContext = Readonly<{
  studentId: string;
  membershipId: string;
  participantType: ParticipantType;
  planClassSites: readonly Site[];
  planOpenMatSites: readonly Site[];
  weeklyClassLimit: WeeklyClassLimit;
}>;

export type DerivedSessionStatus = Readonly<{
  status: CalendarSessionStatus;
  lockedReason?: LockedReason;
}>;

export function sessionSite(session: Pick<SessionRecord, "locationId">): Site {
  return session.locationId === "town" ? "Town" : "West";
}

function lockedReasonFor(
  session: SessionRecord,
  program: ProgramRecord,
  member: CalendarMemberContext,
): LockedReason | undefined {
  if (program.ageBand !== "all" && program.ageBand !== member.participantType) return "age_band";
  const site = sessionSite(session);
  if (program.discipline === "open-mat") {
    return member.planOpenMatSites.includes(site) ? undefined : "open_mat";
  }
  return member.planClassSites.includes(site) ? undefined : "site";
}

export function deriveSessionStatus(input: {
  session: SessionRecord;
  program: ProgramRecord;
  member: CalendarMemberContext;
  booking?: BookingRecord | undefined;
  attendance?: AttendanceRecord | undefined;
  bookedCount: number;
  weeklyClassesBooked?: number;
  now: Date;
}): DerivedSessionStatus {
  const lockedReason = lockedReasonFor(input.session, input.program, input.member);
  if (lockedReason) return Object.freeze({ status: "locked", lockedReason });

  if (input.attendance?.state === "no_show") return Object.freeze({ status: "missed" });
  if (input.attendance?.state === "attended" || input.attendance?.state === "late") {
    return Object.freeze({ status: "attended" });
  }

  const booked =
    input.booking !== undefined &&
    (input.booking.status === "confirmed" || input.booking.status === "requested");
  if (booked) return Object.freeze({ status: "booked" });

  if (
    input.program.discipline !== "open-mat" &&
    input.member.weeklyClassLimit !== null &&
    (input.weeklyClassesBooked ?? 0) >= input.member.weeklyClassLimit
  ) {
    return Object.freeze({ status: "locked", lockedReason: "weekly_limit" });
  }

  const bookable =
    input.session.status === "scheduled" &&
    isWithinBookingCutoff(input.session.startAt, input.now.toISOString(), calendarCutoffMinutes);
  if (!bookable || input.session.capacity === null) return Object.freeze({ status: "closed" });
  if (input.session.capacity !== null && input.bookedCount >= input.session.capacity) {
    return Object.freeze({ status: "full" });
  }
  return Object.freeze({ status: "open" });
}

export function canCancelBooking(session: Pick<SessionRecord, "startAt">, now: Date): boolean {
  return isWithinBookingCutoff(session.startAt, now.toISOString(), calendarCutoffMinutes);
}

const timeFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: calendarTimeZone,
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function jerseyTime(iso: string): string {
  return timeFormatter.format(new Date(iso));
}

export function cancelDeadlineLabel(session: Pick<SessionRecord, "startAt">): string {
  return jerseyTime(
    new Date(Date.parse(session.startAt) - calendarCutoffMinutes * 60000).toISOString(),
  );
}

export function formatSessionTimeRange(session: Pick<SessionRecord, "startAt" | "endAt">): string {
  return `${jerseyTime(session.startAt)}–${jerseyTime(session.endAt)}`;
}

const longWeekday: Readonly<Record<string, string>> = Object.freeze({
  Mon: "Monday",
  Tue: "Tuesday",
  Wed: "Wednesday",
  Thu: "Thursday",
  Fri: "Friday",
  Sat: "Saturday",
  Sun: "Sunday",
});

export function formatDayHeading(day: Pick<CalendarDay, "weekday" | "dayNumber">): string {
  return `${longWeekday[day.weekday] ?? day.weekday} ${day.dayNumber}`;
}

export function memberGroupLabel(participantType: ParticipantType): string {
  if (participantType === "kids") return "Kids";
  if (participantType === "teens") return "Teens";
  return "Adults";
}

export function lockedReasonLabel(
  reason: LockedReason,
  site: Site,
  programAgeBand: ProgramRecord["ageBand"],
): string {
  if (reason === "age_band") {
    const group =
      programAgeBand === "kids" ? "Kids" : programAgeBand === "teens" ? "Teens" : "Adults";
    return `${group} only`;
  }
  if (reason === "site") return `Your plan doesn't cover ${site}`;
  if (reason === "weekly_limit") return "Weekly class limit reached";
  return `Open Mats at ${site} aren't in your plan`;
}
