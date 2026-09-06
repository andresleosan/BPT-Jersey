import { err, ok, type Result } from "../result";

/**
 * T112: the upcoming birthdays a coach greets on the mat, derived from the canonical students
 * instead of an invented sample list.
 *
 * The birth year never leaves the backend. A birthday widget cannot hide the day it celebrates -
 * that is the whole feature - but the year is not needed to greet somebody, so the projection
 * carries the name, how many days away the birthday is, whether the member is an adult or a minor
 * and, by operator decision on 2026-09-06, the age they turn. That last one is an integer, not a
 * date: "turns 9" is what a coach says on the mat, and it still does not let anybody reconstruct
 * the day of birth from a list. Office that needs the real date of birth reads the canonical
 * member record, which is where the full date lives and is audited.
 */
export const upcomingBirthdayDefaultWindowDays = 7;
export const upcomingBirthdayMaxWindowDays = 31;

export const upcomingBirthdayTrainingCenters = Object.freeze(["Town", "West"] as const);
export type UpcomingBirthdayTrainingCenter = (typeof upcomingBirthdayTrainingCenters)[number];

export const upcomingBirthdayParticipantTypes = Object.freeze(["adult", "minor"] as const);
export type UpcomingBirthdayParticipantType = (typeof upcomingBirthdayParticipantTypes)[number];

/** What the store reads out of a canonical student. `dateOfBirth` never reaches a client. */
export type UpcomingBirthdayCandidate = Readonly<{
  studentId: string;
  fullName: string;
  dateOfBirth: string;
  participantType: string;
  trainingCenter: string;
  active: boolean;
  status: string;
}>;

/** What a coach receives. No date of birth, no family or user identifier. */
export type UpcomingBirthday = Readonly<{
  studentId: string;
  displayName: string;
  /** 0 is today, 1 is tomorrow, up to the requested window. */
  daysAway: number;
  /** The age reached on the day, as a whole number of years. */
  turningAge: number;
  participantType: UpcomingBirthdayParticipantType;
  trainingCenter: UpcomingBirthdayTrainingCenter;
}>;

export type UpcomingBirthdayQuery = Readonly<{
  trainingCenter?: UpcomingBirthdayTrainingCenter;
  windowDays: number;
}>;

const dateOnlyPattern = /^\d{4}-\d{2}-\d{2}$/u;

function parts(value: string): Readonly<{ year: number; month: number; day: number }> | undefined {
  if (!dateOnlyPattern.test(value)) return undefined;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  const probe = new Date(0);
  probe.setUTCFullYear(year, month - 1, day);
  probe.setUTCHours(0, 0, 0, 0);
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    return undefined;
  }
  return Object.freeze({ year, month, day });
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** Adds whole days to a date-only value in UTC, so month and year borders are never hand-rolled. */
function addDays(date: string, days: number): string | undefined {
  const value = parts(date);
  if (value === undefined) return undefined;
  const shifted = new Date(Date.UTC(value.year, value.month - 1, value.day + days));
  return shifted.toISOString().slice(0, 10);
}

/**
 * Whether a date of birth is celebrated on a given calendar day. Somebody born on 29 February is
 * greeted on 28 February in a year that has no 29th: the alternative is skipping their birthday
 * three years out of four, which is exactly what the widget exists to prevent.
 */
export function celebratesOn(dateOfBirth: string, target: string): boolean {
  const birth = parts(dateOfBirth);
  const day = parts(target);
  if (birth === undefined || day === undefined) return false;
  if (birth.month === day.month && birth.day === day.day) return true;
  return (
    birth.month === 2 &&
    birth.day === 29 &&
    day.month === 2 &&
    day.day === 28 &&
    !isLeapYear(day.year)
  );
}

function isCandidate(value: UpcomingBirthdayCandidate): boolean {
  return (
    value.active &&
    value.status === "active" &&
    upcomingBirthdayParticipantTypes.includes(
      value.participantType as UpcomingBirthdayParticipantType,
    ) &&
    upcomingBirthdayTrainingCenters.includes(
      value.trainingCenter as UpcomingBirthdayTrainingCenter,
    ) &&
    value.fullName.trim().length > 0 &&
    parts(value.dateOfBirth) !== undefined
  );
}

/**
 * The upcoming birthdays inside the window, nearest first. Only active students count: nobody
 * greets a member who has left. An unparseable or inactive row is skipped rather than failing the
 * whole panel, because one bad record must not hide everybody else's birthday.
 */
export function deriveUpcomingBirthdays(
  input: Readonly<{
    today: string;
    windowDays: number;
    candidates: readonly UpcomingBirthdayCandidate[];
    trainingCenter?: UpcomingBirthdayTrainingCenter;
  }>,
): readonly UpcomingBirthday[] {
  if (
    parts(input.today) === undefined ||
    !Number.isSafeInteger(input.windowDays) ||
    input.windowDays < 0 ||
    input.windowDays > upcomingBirthdayMaxWindowDays
  ) {
    return Object.freeze([]);
  }

  const eligible = input.candidates.filter(
    (candidate) =>
      isCandidate(candidate) &&
      (input.trainingCenter === undefined || candidate.trainingCenter === input.trainingCenter),
  );

  const found: UpcomingBirthday[] = [];
  const seen = new Set<string>();
  for (let offset = 0; offset <= input.windowDays; offset += 1) {
    const day = addDays(input.today, offset);
    if (day === undefined) break;
    for (const candidate of eligible) {
      if (seen.has(candidate.studentId) || !celebratesOn(candidate.dateOfBirth, day)) continue;
      seen.add(candidate.studentId);
      found.push(
        Object.freeze({
          studentId: candidate.studentId,
          displayName: candidate.fullName.trim(),
          daysAway: offset,
          turningAge: (parts(day)?.year ?? 0) - (parts(candidate.dateOfBirth)?.year ?? 0),
          participantType: candidate.participantType as UpcomingBirthdayParticipantType,
          trainingCenter: candidate.trainingCenter as UpcomingBirthdayTrainingCenter,
        }),
      );
    }
  }

  return Object.freeze(
    found.sort(
      (left, right) =>
        left.daysAway - right.daysAway ||
        left.displayName.localeCompare(right.displayName) ||
        left.studentId.localeCompare(right.studentId),
    ),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Closed payload: an optional site and an optional window, nothing else. */
export function parseUpcomingBirthdayQuery(input: unknown): Result<UpcomingBirthdayQuery, string> {
  if (input === null || input === undefined) {
    return ok(Object.freeze({ windowDays: upcomingBirthdayDefaultWindowDays }));
  }
  if (!isRecord(input)) return err("Birthday query must be an object");
  const permitted = ["trainingCenter", "windowDays"];
  if (Object.keys(input).some((key) => !permitted.includes(key))) {
    return err("Birthday query accepts only trainingCenter and windowDays");
  }
  const { trainingCenter, windowDays } = input;
  if (
    trainingCenter !== undefined &&
    (typeof trainingCenter !== "string" ||
      !upcomingBirthdayTrainingCenters.includes(trainingCenter as UpcomingBirthdayTrainingCenter))
  ) {
    return err("trainingCenter is invalid");
  }
  if (
    windowDays !== undefined &&
    (!Number.isSafeInteger(windowDays) ||
      (windowDays as number) < 0 ||
      (windowDays as number) > upcomingBirthdayMaxWindowDays)
  ) {
    return err("windowDays is out of range");
  }
  return ok(
    Object.freeze({
      ...(trainingCenter === undefined
        ? {}
        : { trainingCenter: trainingCenter as UpcomingBirthdayTrainingCenter }),
      windowDays: (windowDays as number | undefined) ?? upcomingBirthdayDefaultWindowDays,
    }),
  );
}
