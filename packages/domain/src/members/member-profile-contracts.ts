import { z } from "zod";

import { deriveUpcomingBirthdays } from "../birthdays/upcoming-birthday-contracts";
import { currentMembershipStatuses } from "../memberships/membership-contracts";
import { participantTypes, studentReviewFields } from "../profiles/profile-contracts";
import {
  canonicalMembershipNumberSchema,
  nextMonotonicMembershipNumber,
} from "./membership-number-contracts";
import {
  adminUpdateStudentInputSchema,
  memberRecordMaintenanceDetailSchema,
} from "./member-directory-contracts";

export { memberAgeOn } from "./member-access-contracts";

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
export function deriveBirthdayBadge(dateOfBirth: string | undefined, today: string): BirthdayBadge {
  if (dateOfBirth === undefined) return null;
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
 * The number the DETAILS form proposes for a member without one: one above the highest value that
 * can be canonicalised. Invalid historical values are ignored and the sequence never reuses gaps.
 */
export function nextFreeMemberNumber(existing: readonly (string | undefined)[]): string {
  return nextMonotonicMembershipNumber(existing);
}

export const memberRecordTabs = Object.freeze([
  "profile",
  "details",
  "plan",
  "documents",
  "payments",
  "classes",
  "communication",
  "notes",
] as const);
export type MemberRecordTab = (typeof memberRecordTabs)[number];

const opaqueIdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u);
const dateOnlySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u);
const displayText = (max: number) => z.string().min(1).max(max);

export const memberProfileRequestSchema = z.strictObject({ studentId: opaqueIdSchema }).readonly();
export type MemberProfileRequest = Readonly<z.infer<typeof memberProfileRequestSchema>>;

export const birthdayBadgeSchema = z.union([
  z.strictObject({ kind: z.literal("today") }),
  z.strictObject({ kind: z.literal("inDays"), days: z.number().int().min(1).max(7) }),
  z.null(),
]);

const headerShape = {
  studentId: opaqueIdSchema,
  fullName: displayText(160),
  age: z.number().int().min(0).max(130).nullable(),
  participantType: z.enum(participantTypes),
  status: z.enum(["active", "inactive", "suspended"]),
  birthdayBadge: birthdayBadgeSchema,
} as const;

/**
 * What headCoach and coach receive (grill G6): the `studentId` that links to the record and nothing
 * else that identifies the member - no member number, no masked member reference, no contact detail.
 */
export const coachMemberProfileHeaderSchema = z.strictObject(headerShape);

export const memberProfileHeaderSchema = z.strictObject({
  ...studentReviewFields,
  ...headerShape,
  maskedMemberReference: z
    .string()
    .regex(/^\*{4}.{4}$/u)
    .optional(),
});
export type MemberProfileHeader = Readonly<z.infer<typeof memberProfileHeaderSchema>>;

export const memberProfileCardsSchema = z.strictObject({
  memberSince: dateOnlySchema,
  monthsAsMember: z.number().int().min(0),
  profession: displayText(120).optional(),
  accountManagers: z
    .array(z.strictObject({ displayName: displayText(160), familyId: opaqueIdSchema }))
    .max(10),
  currentMembership: z
    .strictObject({
      membershipId: opaqueIdSchema,
      planName: displayText(160),
      status: z.enum(currentMembershipStatuses),
      validUntil: dateOnlySchema.nullable(),
    })
    .nullable(),
});
export type MemberProfileCards = Readonly<z.infer<typeof memberProfileCardsSchema>>;

/** One definition of every DETAILS field: the maintenance detail, extended in T051V2. */
export const memberDetailsSchema = memberRecordMaintenanceDetailSchema;
export type MemberDetails = Readonly<z.infer<typeof memberDetailsSchema>>;

/** DETAILS are saved through the existing `updateMember` callable (full replacement). */
export const updateMemberDetailsInputSchema = adminUpdateStudentInputSchema;
export type UpdateMemberDetailsInput = Readonly<z.infer<typeof updateMemberDetailsInputSchema>>;

const fullMemberProfileSchema = z.strictObject({
  view: z.literal("full"),
  header: memberProfileHeaderSchema,
  cards: memberProfileCardsSchema,
  details: memberDetailsSchema,
  nextFreeMemberNumber: canonicalMembershipNumberSchema.optional(),
});
const coachMemberProfileSchema = z.strictObject({
  view: z.literal("coach"),
  header: coachMemberProfileHeaderSchema,
});

export const memberProfileSchema = z.discriminatedUnion("view", [
  fullMemberProfileSchema,
  coachMemberProfileSchema,
]);
export type MemberProfile = Readonly<z.infer<typeof memberProfileSchema>>;
export type FullMemberProfile = Readonly<z.infer<typeof fullMemberProfileSchema>>;
export type CoachMemberProfile = Readonly<z.infer<typeof coachMemberProfileSchema>>;

export const memberNameSearchLimit = 20;

export const memberNameSearchRequestSchema = z
  .strictObject({ query: z.string().trim().min(2).max(80) })
  .readonly();

export const memberNameSearchResultSchema = z.strictObject({
  members: z
    .array(z.strictObject({ studentId: opaqueIdSchema, fullName: displayText(160) }))
    .max(memberNameSearchLimit),
});
export type MemberNameSearchResult = Readonly<z.infer<typeof memberNameSearchResultSchema>>;
