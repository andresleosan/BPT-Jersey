/**
 * Member engagement: the numbers the member-facing streak panel, the competitor tables and the
 * account settings share. Pure functions over attendance dates; nothing here knows Firestore.
 *
 * Owned by the phase-0 spec (`docs/superpowers/specs/2026-09-16-member-engagement-phase-0-design.md`).
 * T042V2 (streak), T043V2 (competitors) and T044V2 (settings) may add to this file; they must not
 * change the meaning of what is already exported, because two of them render the same number.
 */

import { z } from "zod";

import { participantBandAt } from "../memberships/participant-band";
import { enrolmentTrainingFields } from "./enrolment-request-contracts";

export type AttendedSession = Readonly<{
  occurredAt: string;
  durationMinutes: number;
}>;

export type ProgressTarget = Readonly<{
  label: string;
  target: number;
}>;

export type ProgressBar = Readonly<{
  label: string;
  target: number;
  progress: number;
  remaining: number;
  /** Exactly one attendance short: the bar deepens its tone and prints the "Just x1 missing" line. */
  almost: boolean;
  complete: boolean;
}>;

export type MemberStreakSummary = Readonly<{
  /** Consecutive attendances, each within `streakGapMs` of the previous one. The "x3" by the flame. */
  streakCount: number;
  /** Most recent 1 September on the Jersey calendar, `YYYY-MM-DD`. */
  seasonStart: string;
  attendancesSinceSeasonStart: number;
  hoursSinceSeasonStart: number;
  goal: ProgressBar;
  reward: ProgressBar;
}>;

export const defaultGoal: ProgressTarget = Object.freeze({ label: "Next goal", target: 10 });
export const defaultReward: ProgressTarget = Object.freeze({ label: "Next reward", target: 25 });

/** A run survives a gap of up to seven days between two attendances. */
export const streakGapMs = 7 * 86_400_000;

const jerseyDate = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Jersey",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function seasonStartFor(nowIso: string): string {
  const [year, month] = jerseyDate.format(new Date(nowIso)).split("-");
  const seasonYear = Number(month) >= 9 ? Number(year) : Number(year) - 1;
  return `${seasonYear}-09-01`;
}

export function sessionStreak(attendedAt: readonly string[], nowIso: string): number {
  const nowMs = new Date(nowIso).getTime();
  const times = attendedAt
    .map((value) => new Date(value).getTime())
    .filter((ms) => !Number.isNaN(ms) && ms <= nowMs)
    .sort((a, b) => b - a);
  let count = 0;
  let previous = nowMs;
  for (const ms of times) {
    if (previous - ms > streakGapMs) break;
    count += 1;
    previous = ms;
  }
  return count;
}

export function progressBar(target: ProgressTarget, progress: number): ProgressBar {
  const clamped = Math.max(0, Math.min(target.target, progress));
  const remaining = target.target - clamped;
  return Object.freeze({
    label: target.label,
    target: target.target,
    progress: clamped,
    remaining,
    almost: remaining === 1,
    complete: remaining === 0,
  });
}

export function buildMemberStreakSummary(input: {
  attendances: readonly AttendedSession[];
  now: string;
  goal?: ProgressTarget;
  reward?: ProgressTarget;
}): MemberStreakSummary {
  const seasonStart = seasonStartFor(input.now);
  const seasonStartMs = new Date(`${seasonStart}T00:00:00.000Z`).getTime() - 3_600_000; // 1 Sept 00:00 BST
  const nowMs = new Date(input.now).getTime();
  const thisSeason = input.attendances.filter((attendance) => {
    const ms = new Date(attendance.occurredAt).getTime();
    return !Number.isNaN(ms) && ms >= seasonStartMs && ms <= nowMs;
  });
  const minutes = thisSeason.reduce((total, attendance) => total + attendance.durationMinutes, 0);
  const goalBase = input.goal ?? defaultGoal;
  const rewardBase = input.reward ?? defaultReward;
  return Object.freeze({
    streakCount: sessionStreak(
      input.attendances.map((attendance) => attendance.occurredAt),
      input.now,
    ),
    seasonStart,
    attendancesSinceSeasonStart: thisSeason.length,
    hoursSinceSeasonStart: Math.round((minutes / 60) * 10) / 10,
    goal: progressBar(
      { ...goalBase, target: nextProgressTarget(thisSeason.length, goalBase.target) },
      thisSeason.length,
    ),
    reward: progressBar(
      { ...rewardBase, target: nextProgressTarget(thisSeason.length, rewardBase.target) },
      thisSeason.length,
    ),
  });
}

export function compareTechniques(
  mine: readonly string[],
  theirs: readonly string[],
): Readonly<{ theyHave: readonly string[]; iHave: readonly string[] }> {
  const mineSet = new Set(mine);
  const theirsSet = new Set(theirs);
  return Object.freeze({
    theyHave: Object.freeze([...theirsSet].filter((key) => !mineSet.has(key)).sort()),
    iHave: Object.freeze([...mineSet].filter((key) => !theirsSet.has(key)).sort()),
  });
}

/**
 * The two closest members above and below the current one in a table ordered by `score`
 * (descending). Ties keep the incoming order, so callers pass a stable list.
 */
export function rankNeighbours<T extends { studentId: string }>(input: {
  entries: readonly T[];
  currentStudentId: string;
  score: (entry: T) => number;
  span?: number;
}): Readonly<{ above: readonly T[]; current: T; below: readonly T[] }> | null {
  const span = input.span ?? 2;
  const ranked = [...input.entries].sort((a, b) => input.score(b) - input.score(a));
  const index = ranked.findIndex((entry) => entry.studentId === input.currentStudentId);
  if (index === -1) return null;
  const current = ranked[index] as T;
  return Object.freeze({
    above: Object.freeze(ranked.slice(Math.max(0, index - span), index)),
    current,
    below: Object.freeze(ranked.slice(index + 1, index + 1 + span)),
  });
}

export type LeaderboardCohort = "kids" | "teens" | "adults";
/** D6: the table is the band the member pays in. Callers drop students without a date first. */
export function leaderboardCohort(dateOfBirth: string | null, nowIso: string): LeaderboardCohort {
  const band = participantBandAt({ dateOfBirth, onIso: nowIso });
  return band === "adult" ? "adults" : band;
}
/** Review focus 2: a child with no date of birth must not land in the adult table. */
export function leaderboardEligible(dateOfBirth: string | null | undefined): boolean {
  return typeof dateOfBirth === "string" && z.iso.date().safeParse(dateOfBirth).success;
}
/** Once a target is reached the bar moves to the next multiple of its base (10 → 20 → 30…). */
export function nextProgressTarget(count: number, base: number): number {
  return (Math.floor(Math.max(0, count) / base) + 1) * base;
}

export function publicDisplayNames(
  people: readonly Readonly<{ studentId: string; fullName: string }>[],
): ReadonlyMap<string, string> {
  const parts = people.map((p) => {
    const [first = "", ...rest] = p.fullName.trim().split(/\s+/u);
    return { studentId: p.studentId, first, last: rest.at(-1) ?? "" };
  });
  const label = (p: (typeof parts)[number], n: number) =>
    p.last ? `${p.first} ${p.last.slice(0, n)}.` : p.first;
  const result = new Map<string, string>();
  for (const p of parts) {
    let n = 1;
    // ponytail: O(n²) over one cohort (hundreds of rows), fine for a nightly job.
    while (
      p.last.length > n &&
      parts.some((o) => o !== p && o.first === p.first && label(o, n) === label(p, n))
    )
      n += 1;
    result.set(p.studentId, label(p, n));
  }
  return result;
}
export function beltScore(sequence: number, promotionPercent: number | null): number {
  return sequence * 1000 + (promotionPercent ?? 0);
}
export function promotionMilestone(
  input: Readonly<{ percent: number | null; classesToGo: number | null }>,
): "75" | "90" | "oneLeft" | null {
  if (input.classesToGo === 1) return "oneLeft";
  if (input.percent === null) return null;
  if (input.percent >= 90) return "90";
  return input.percent >= 75 ? "75" : null;
}

const id = z.string().min(1).max(128);
/** What another member may see of a student. Nothing private: no age, contact or family data. */
export const memberPublicCardSchema = z.strictObject({
  studentId: id,
  displayName: z.string().min(1).max(80),
  photoUrl: z.url().nullable(),
  belt: z.strictObject({ name: z.string().max(80), color: z.string().max(32) }).nullable(),
  stripes: z.number().int().min(0).max(10),
  streakCount: z.number().int().min(0),
  attendancesSinceSeasonStart: z.number().int().min(0),
  promotionPercent: z.number().min(0).max(100).nullable(),
  skillKeys: z.array(z.string().max(128)).max(500),
});
export type MemberPublicCard = z.infer<typeof memberPublicCardSchema>;
const bar = z.strictObject({
  label: z.string(),
  target: z.number().int(),
  progress: z.number().int(),
  remaining: z.number().int(),
  almost: z.boolean(),
  complete: z.boolean(),
});
export const memberStreakSummarySchema = z.strictObject({
  streakCount: z.number().int().min(0),
  seasonStart: z.iso.date(),
  attendancesSinceSeasonStart: z.number().int().min(0),
  hoursSinceSeasonStart: z.number().min(0),
  goal: bar,
  reward: bar,
});
export const neighboursSchema = z.strictObject({
  above: z.array(memberPublicCardSchema).max(2),
  current: memberPublicCardSchema,
  below: z.array(memberPublicCardSchema).max(2),
});
export const competitorsResponseSchema = z.strictObject({
  cohort: z.enum(["kids", "teens", "adults"]),
  builtAt: z.iso.datetime().nullable(),
  attendance: neighboursSchema.nullable(),
  belt: neighboursSchema.nullable(),
});
export const leaderboardRowSchema = memberPublicCardSchema.omit({ photoUrl: true }).extend({
  photoObjectKey: z.string().max(200).nullable(),
  hidden: z.boolean(),
  beltScore: z.number(),
});
export type LeaderboardRow = z.infer<typeof leaderboardRowSchema>;
export const leaderboardSnapshotSchema = z.strictObject({
  cohort: z.enum(["kids", "teens", "adults"]),
  builtAt: z.iso.datetime(),
  seasonStart: z.iso.date(),
  rows: z.array(leaderboardRowSchema).max(1500),
});
export const sessionDetailResponseSchema = z.strictObject({
  curriculum: z
    .strictObject({ title: z.string(), techniques: z.array(z.string()), details: z.string() })
    .nullable(),
  roster: z.array(z.strictObject({ card: memberPublicCardSchema, isYou: z.boolean() })).max(200),
  hiddenCount: z.number().int().min(0),
});
export const promotionOutlookSchema = z
  .strictObject({
    nextName: z.string().max(80),
    percent: z.number().min(0).max(100),
    classesToGo: z.number().int().min(0).nullable(),
    milestone: z.enum(["75", "90", "oneLeft"]).nullable(),
    levelKey: z.string().max(128),
  })
  .nullable();
export const uploadProfilePhotoInputSchema = z.strictObject({
  studentId: id,
  base64: z
    .string()
    .min(4)
    .max(4 * Math.ceil((2 * 1024 * 1024) / 3)),
  mime: z.enum(["image/jpeg", "image/png", "image/webp"]),
  consent: z.literal(true),
});
export const teenAccessInputSchema = z.strictObject({
  studentId: id,
  email: z.email().max(254),
  password: z.string().min(10).max(128),
});
export const memberPlanRequestInputSchema = z.strictObject({
  kind: z.enum(["self", "child"]),
  fullName: z.string().trim().min(2).max(160),
  dateOfBirth: z.iso.date(),
  ...enrolmentTrainingFields, // same centre enum and time slots as /enrol
});
