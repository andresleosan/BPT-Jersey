import { deriveUpcomingBirthdays } from "../birthdays/upcoming-birthday-contracts";
import { ageInCompletedYears } from "../levels/level-contracts";

/**
 * T051V2 (E1): what the canonical member record derives instead of storing. Nothing here reads a
 * clock: callers pass the academy day, so the server and the tests agree on "today".
 */

export type BirthdayBadge =
  Readonly<{ kind: "today" }> | Readonly<{ kind: "inDays"; days: number }> | null;

export const birthdayBadgeWindowDays = 7;

/**
 * The badge in the record header. It asks the existing birthday derivation about one synthetic,
 * eligible candidate, so the 29 February rule and the day arithmetic live in one place only.
 */
export function deriveBirthdayBadge(dateOfBirth: string, today: string): BirthdayBadge {
  const [match] = deriveUpcomingBirthdays({
    today,
    windowDays: birthdayBadgeWindowDays,
    candidates: [
      {
        studentId: "record",
        fullName: "record",
        dateOfBirth,
        participantType: "adult",
        trainingCenter: "Town",
        active: true,
        status: "active",
      },
    ],
  });
  if (match === undefined) return null;
  return match.daysAway === 0
    ? Object.freeze({ kind: "today" as const })
    : Object.freeze({ kind: "inDays" as const, days: match.daysAway });
}

export type BmiCategory = "underweight" | "healthy" | "overweight" | "obese";

/** Computed on read, never stored (spec §5.5). Bounds match the DETAILS input limits. */
export function deriveBmi(
  weightKg: number | undefined,
  heightCm: number | undefined,
): Readonly<{ value: number; category: BmiCategory }> | null {
  if (
    weightKg === undefined ||
    heightCm === undefined ||
    !Number.isFinite(weightKg) ||
    !Number.isFinite(heightCm) ||
    weightKg < 1 ||
    weightKg > 400 ||
    heightCm < 30 ||
    heightCm > 250
  ) {
    return null;
  }
  const metres = heightCm / 100;
  const raw = weightKg / (metres * metres);
  const category: BmiCategory =
    raw < 18.5 ? "underweight" : raw < 25 ? "healthy" : raw < 30 ? "overweight" : "obese";
  return Object.freeze({ value: Math.round(raw * 10) / 10, category });
}

const jerseyDay = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Jersey",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** The calendar day at the academy for an instant (spec §5.3: Europe/Jersey). */
export function academyDateOf(nowIso: string): string {
  return jerseyDay.format(new Date(nowIso));
}

export function memberAgeOn(dateOfBirth: string, today: string): number | null {
  return ageInCompletedYears(dateOfBirth, today);
}

/** Whole calendar months from one date-only value to another; 0 when `to` is before `from`. */
export function wholeMonthsBetween(from: string, to: string): number {
  const [fromYear, fromMonth, fromDay] = from.split("-").map(Number);
  const [toYear, toMonth, toDay] = to.split("-").map(Number);
  if (
    [fromYear, fromMonth, fromDay, toYear, toMonth, toDay].some((part) => !Number.isInteger(part))
  ) {
    return 0;
  }
  let months = (toYear! - fromYear!) * 12 + (toMonth! - fromMonth!);
  if (toDay! < fromDay!) months -= 1;
  return Math.max(0, months);
}

/** The short-name choices the DETAILS select offers, most common first, each at most 64 chars. */
export function deriveShortNameVariants(fullName: string): readonly string[] {
  const tokens = fullName
    .trim()
    .split(/\s+/u)
    .filter((token) => token.length > 0);
  const [first] = tokens;
  if (first === undefined) return Object.freeze([]);
  const last = tokens.at(-1);
  const variants =
    tokens.length === 1 || last === undefined
      ? [first]
      : [
          first,
          `${first} ${last}`,
          `${first} ${last.charAt(0)}.`,
          ...(tokens.length >= 3 ? [`${first} ${tokens[1]}`] : []),
        ];
  return Object.freeze([...new Set(variants)].filter((variant) => variant.length <= 64));
}

/**
 * The number the DETAILS form proposes for a member without one: the highest purely numeric member
 * number plus one. Non-numeric numbers are ignored.
 * ponytail: numbers above 9 digits are ignored too; the academy issues sequential small numbers.
 */
export function nextFreeMemberNumber(existing: readonly (string | undefined)[]): string {
  let highest = 0;
  for (const value of existing) {
    if (value === undefined || !/^\d{1,9}$/u.test(value)) continue;
    highest = Math.max(highest, Number(value));
  }
  return String(highest + 1);
}
