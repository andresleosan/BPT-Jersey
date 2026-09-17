import {
  classActorGroups,
  classAuditActions,
  type ClassActorGroup,
  type ClassActorRole,
  type ClassAuditAction,
  type ClassAuditSource,
} from "./audit-event";

/** The ten filters Regyfit offers over its registrations log, kept name for name. */
export const classHistoryRegistrationTypes = Object.freeze([
  "all",
  "member-bookings",
  "member-cancellations",
  "dropin-bookings",
  "dropin-cancellations",
  "coach-bookings",
  "coach-cancellations",
  "coach-dropin-bookings",
  "coach-dropin-cancellations",
  "attendance",
] as const);

export type ClassHistoryRegistrationType = (typeof classHistoryRegistrationTypes)[number];

export function isClassHistoryRegistrationType(
  value: unknown,
): value is ClassHistoryRegistrationType {
  return (
    typeof value === "string" &&
    classHistoryRegistrationTypes.includes(value as ClassHistoryRegistrationType)
  );
}

export type ClassHistoryFilter = Readonly<{
  actions: readonly ClassAuditAction[];
  groups: readonly ClassActorGroup[];
}>;

const attendanceActions = Object.freeze([
  "attendance.checked_in",
  "attendance.corrected",
  "attendance.proximity_override",
  "student.checked_out",
] as const);

function filter(
  actions: readonly ClassAuditAction[],
  groups: readonly ClassActorGroup[],
): ClassHistoryFilter {
  return Object.freeze({
    actions: Object.freeze([...actions]),
    groups: Object.freeze([...groups]),
  });
}

const filtersByRegistrationType: Readonly<
  Record<ClassHistoryRegistrationType, ClassHistoryFilter>
> = Object.freeze({
  all: filter(classAuditActions, classActorGroups),
  "member-bookings": filter(["booking.created"], ["member"]),
  "member-cancellations": filter(["booking.cancelled"], ["member"]),
  "dropin-bookings": filter(["dropin.created"], ["member"]),
  "dropin-cancellations": filter(["dropin.cancelled"], ["member"]),
  "coach-bookings": filter(["booking.created"], ["staff"]),
  "coach-cancellations": filter(["booking.cancelled"], ["staff"]),
  "coach-dropin-bookings": filter(["dropin.created"], ["staff"]),
  "coach-dropin-cancellations": filter(["dropin.cancelled"], ["staff"]),
  attendance: filter(attendanceActions, ["staff", "system"]),
});

/** What one Regyfit filter means in the audit log: which actions, written by whom. */
export function registrationTypeFilter(type: ClassHistoryRegistrationType): ClassHistoryFilter {
  return filtersByRegistrationType[type];
}

export type ClassHistorySentenceInput = Readonly<{
  action: ClassAuditAction;
  actorGroup: ClassActorGroup;
  studentName: string | null;
  actorName: string | null;
  programName: string | null;
  /** Null for attendance events written before the class block existed. */
  sessionStartAt: string | null;
}>;

/** One row of the log as the admin panel and the PDF both read it. */
export type ClassHistoryRow = Readonly<{
  id: string;
  occurredAt: string;
  action: ClassAuditAction;
  actorId: string;
  actorRole: ClassActorRole;
  actorGroup: ClassActorGroup;
  actorName: string | null;
  actorIp: string | null;
  studentId: string | null;
  studentName: string | null;
  sessionId: string | null;
  sessionStartAt: string | null;
  programId: string | null;
  programName: string | null;
  locationId: string | null;
  source: ClassAuditSource;
  sentence: string;
}>;

/** The filters one listing ran with, echoed back so the PDF can print them. */
export type ClassHistoryFilterSummary = Readonly<{
  since: string;
  actorId: string | null;
  registrationType: ClassHistoryRegistrationType;
  limit: number;
}>;

export type ListClassHistoryInput = Readonly<{
  academyId: string;
  since: string;
  actorId: string | null;
  registrationType: ClassHistoryRegistrationType;
  limit: number;
  cursor: string | null;
}>;

const monthNames = Object.freeze([
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const);

const jerseyParts = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Jersey",
  year: "numeric",
  month: "numeric",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/** "16 Sep 2026 at 18:30" in Jersey local time, or null when there is no session to name. */
export function formatJerseyMoment(value: string | null): string | null {
  if (value === null) return null;
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return null;
  const parts = new Map(
    jerseyParts.formatToParts(new Date(timestamp)).map((part) => [part.type, part.value]),
  );
  const day = parts.get("day");
  const month = parts.get("month");
  const year = parts.get("year");
  const hour = parts.get("hour");
  const minute = parts.get("minute");
  if (
    day === undefined ||
    month === undefined ||
    year === undefined ||
    hour === undefined ||
    minute === undefined
  ) {
    return null;
  }
  const monthName = monthNames[Number(month) - 1];
  if (monthName === undefined) return null;
  // Intl writes midnight as 24 in some ICU builds; the log reads it as 00.
  const displayHour = hour === "24" ? "00" : hour;
  return `${day} ${monthName} ${year} at ${displayHour}:${minute}`;
}

const jerseyWallParts = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Jersey",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/u;
const isoTimePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/u;

/** The Jersey wall clock at one instant, expressed as the milliseconds that clock reads. */
function jerseyWallClockAt(instantMs: number): number {
  const parts = new Map(
    jerseyWallParts.formatToParts(new Date(instantMs)).map((part) => [part.type, part.value]),
  );
  // Intl writes midnight as 24 in some ICU builds; the clock reads it as 00.
  const hourPart = parts.get("hour");
  return Date.UTC(
    Number(parts.get("year")),
    Number(parts.get("month")) - 1,
    Number(parts.get("day")),
    hourPart === "24" ? 0 : Number(hourPart),
    Number(parts.get("minute")),
    Number(parts.get("second")),
  );
}

/**
 * The UTC instant of a date and time the operator typed on a Jersey clock, as an ISO string.
 *
 * Everything this feature shows is Jersey local - the sentences, the PDF's file name - so a filter
 * read as UTC would silently drop the first hour of every summer day, Jersey being UTC+1 on BST.
 * There is no date library here, so the offset is found with Intl: guess with the offset that
 * applies at the naive instant, then re-check with the offset that applies at the guess, which
 * settles a DST change in either direction. Returns null for anything that is not a "YYYY-MM-DD"
 * date and a "HH:MM" time, rather than inventing a moment nobody asked for.
 */
export function jerseyWallClockToInstant(date: string, time: string): string | null {
  if (!isoDatePattern.test(date) || !isoTimePattern.test(time)) return null;
  const naive = Date.parse(`${date}T${time}:00Z`);
  if (Number.isNaN(naive)) return null;
  const first = naive - (jerseyWallClockAt(naive) - naive);
  const second = naive - (jerseyWallClockAt(first) - first);
  const instant = jerseyWallClockAt(second) === naive ? second : first;
  return `${new Date(instant).toISOString().slice(0, 19)}Z`;
}

function theClassOf(moment: string | null): string {
  return moment === null ? "the class" : `the class of ${moment}`;
}

function onMoment(moment: string | null): string {
  return moment === null ? "" : ` on ${moment}`;
}

/**
 * The English sentence one log row shows. Everything the reader needs is in the sentence, so a
 * missing student, actor, program or session never leaves a blank or an "Invalid Date" behind.
 */
export function composeClassHistorySentence(input: ClassHistorySentenceInput): string {
  const student = input.studentName ?? "Former member";
  const moment = formatJerseyMoment(input.sessionStartAt);

  if (input.action === "attendance.checked_in" || input.action === "attendance.corrected") {
    return moment === null
      ? "Attendance was marked"
      : `Attendance was marked for the class of ${moment}`;
  }
  if (input.action === "attendance.proximity_override") {
    return moment === null
      ? "Attendance was marked outside the class location"
      : `Attendance was marked outside the class location for the class of ${moment}`;
  }
  if (input.action === "student.checked_out") {
    return `${student} was checked out of ${theClassOf(moment)}`;
  }

  if (input.actorGroup === "member") {
    switch (input.action) {
      case "booking.created":
        return `${student} booked ${theClassOf(moment)}`;
      case "booking.cancelled":
        return `${student} cancelled the booking for ${theClassOf(moment)}`;
      case "dropin.created":
        return `${student} booked a drop-in for ${theClassOf(moment)}`;
      case "dropin.cancelled":
        return `${student} cancelled the drop-in for ${theClassOf(moment)}`;
    }
  }

  const actor =
    input.actorName ?? (input.actorGroup === "system" ? "the system" : "a member of staff");
  const program = input.programName ?? "the class";
  switch (input.action) {
    case "booking.created":
      return `${student} was booked by ${actor} into ${program}${onMoment(moment)}`;
    case "booking.cancelled":
      return `${student} was removed by ${actor} from ${program}${onMoment(moment)}`;
    case "dropin.created":
      return `${student} was given a drop-in by ${actor} into ${program}${onMoment(moment)}`;
    case "dropin.cancelled":
      return `${student} had a drop-in cancelled by ${actor} for ${program}${onMoment(moment)}`;
  }
}
