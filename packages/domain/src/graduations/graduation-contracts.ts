import { z } from "zod";

import type { LevelDefinitionRecord } from "../levels/level-contracts";
import {
  countClassesAtLevel,
  daysAtLevel,
  jerseyDateOf,
  minimumDaysOf,
  type ImportedBaseline,
} from "../levels/level-progress";
import { isComparablePreClassSession, preClassMinAttendances } from "../schedule/pre-class-contracts";
import type { SessionRecord } from "../schedule/schedule-contracts";

/**
 * Graduations (spec 2026-10-03). One rule for the owner's board and the member's notices:
 * classes + minimum time of the NEXT level (`sequence + 1`), counted exactly like the progress bars.
 */
export const graduationStages = ["approval", "today", "next", "twoLeft", "none"] as const;
export type GraduationStage = (typeof graduationStages)[number];

export type CountedClassInstant = Readonly<{ occurredAt: string; sessionId: string | null }>;
export type GraduationReview = Readonly<{
  sessionId: string;
  definitionKey: string;
  decidedAt: string;
  note: string | null;
}>;

export type GraduationInput = Readonly<{
  target: LevelDefinitionRecord | null;
  currentLevelStartedAt: string;
  importedBaseline: ImportedBaseline | null;
  /** `countedClassInstants` output, oldest first. */
  counted: readonly CountedClassInstant[];
  /** Sessions from `now - 56 days` to `now + 21 days`, any status. */
  sessions: readonly SessionRecord[];
  bookedSessionIds: ReadonlySet<string>;
  reviews: readonly GraduationReview[];
  now: string;
}>;

export type LikelyClass = Readonly<{ sessionId: string; startAt: string; title: string }>;

export type GraduationAssessment = Readonly<{
  stage: GraduationStage;
  classesDone: number;
  minClasses: number | null;
  daysDone: number;
  minDays: number | null;
  /** UTC day (`YYYY-MM-DD`) from which the minimum time is met; null without a target. */
  periodEndsOn: string | null;
  graduationClass: CountedClassInstant | null;
  likelyNext: LikelyClass | null;
  /** In `next`/`today`, a habitual class in the last 7 days was missed (spec D14). */
  missedLikely: boolean;
  lastNotYetNote: string | null;
}>;

const dayMs = 86_400_000;
const nearPeriodDays = 7;

function addDays(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00.000Z`) + days * dayMs).toISOString().slice(0, 10);
}

export function assessGraduation(input: GraduationInput): GraduationAssessment {
  const none = (extra: Partial<GraduationAssessment> = {}): GraduationAssessment =>
    Object.freeze({
      stage: "none",
      classesDone: 0,
      minClasses: null,
      daysDone: 0,
      minDays: null,
      periodEndsOn: null,
      graduationClass: null,
      likelyNext: null,
      missedLikely: false,
      lastNotYetNote: null,
      ...extra,
    });
  const { target, now } = input;
  if (target === null) return none();

  const minClasses = target.criteria.minClasses;
  const minDays = minimumDaysOf(target.criteria.minimumTime);
  const startDay = input.currentLevelStartedAt.slice(0, 10);
  const periodEndsOn = addDays(startDay, minDays ?? 0);
  const attendedAt = input.counted.map((entry) => entry.occurredAt);
  const classesUntil = (until?: string) =>
    countClassesAtLevel({
      attendedAt,
      currentLevelStartedAt: input.currentLevelStartedAt,
      importedBaseline: input.importedBaseline,
      ...(until === undefined ? {} : { until }),
    }).total;
  const classesDone = classesUntil();
  const daysDone = daysAtLevel(input.currentLevelStartedAt, now);
  const reviews = input.reviews
    .filter((review) => review.definitionKey === target.definitionKey)
    .sort((a, b) => a.decidedAt.localeCompare(b.decidedAt));
  const lastReview = reviews.at(-1) ?? null;
  const reviewedAt =
    lastReview === null
      ? null
      : (input.counted.find((entry) => entry.sessionId === lastReview.sessionId)?.occurredAt ??
        lastReview.decidedAt);
  const base = {
    classesDone,
    minClasses,
    daysDone,
    minDays,
    periodEndsOn,
    lastNotYetNote: lastReview?.note ?? null,
  };

  // 1. approval: the first real class at this level that completes both criteria, after any Not yet.
  for (const entry of input.counted) {
    const day = entry.occurredAt.slice(0, 10);
    if (entry.sessionId === null || day < startDay) continue;
    // The class a Graduations promotion was given at belongs to the previous level.
    if (Date.parse(entry.occurredAt) <= Date.parse(input.currentLevelStartedAt)) continue;
    if (reviewedAt !== null && entry.occurredAt <= reviewedAt) continue;
    if (day >= periodEndsOn && classesUntil(day) >= (minClasses ?? 0)) {
      return none({ ...base, stage: "approval", graduationClass: entry });
    }
  }

  // Habit: 2+ attended comparable sessions in the 56-day window (pre-class rule, spec D12).
  const attended = new Set(
    input.counted.flatMap((entry) => (entry.sessionId ? [entry.sessionId] : [])),
  );
  const habitual = (session: SessionRecord) =>
    input.sessions.filter(
      (candidate) =>
        attended.has(candidate.sessionId) &&
        isComparablePreClassSession(session, candidate, { now }),
    ).length >= preClassMinAttendances;
  const likely = (session: SessionRecord) =>
    input.bookedSessionIds.has(session.sessionId) || habitual(session);

  const today = jerseyDateOf(now);
  const fromDay = periodEndsOn > now.slice(0, 10) ? periodEndsOn : now.slice(0, 10);
  const upcoming = input.sessions
    .filter((s) => s.status === "scheduled" && s.startAt > now && s.startAt.slice(0, 10) >= fromDay)
    .sort((a, b) => a.startAt.localeCompare(b.startAt));
  const next = upcoming.find(likely) ?? null;
  const likelyNext: LikelyClass | null =
    next === null ? null : { sessionId: next.sessionId, startAt: next.startAt, title: next.title };

  const classesLeft = Math.max(0, (minClasses ?? 0) - classesDone);
  const daysToPeriod = Math.round(
    (Date.parse(`${periodEndsOn}T00:00:00.000Z`) - Date.parse(`${now.slice(0, 10)}T00:00:00.000Z`)) /
      dayMs,
  );
  const graduatesNext =
    (classesLeft === 1 && likelyNext !== null) || (classesLeft === 0 && daysToPeriod < nearPeriodDays);
  if (graduatesNext) {
    const lastClassAt = input.counted.at(-1)?.occurredAt ?? input.currentLevelStartedAt;
    const weekAgo = new Date(Date.parse(now) - nearPeriodDays * dayMs).toISOString();
    const missedLikely = input.sessions.some(
      (s) =>
        s.status !== "cancelled" &&
        s.endAt < now &&
        s.startAt > lastClassAt &&
        s.startAt > weekAgo &&
        !attended.has(s.sessionId) &&
        likely(s),
    );
    const stage =
      likelyNext !== null && jerseyDateOf(likelyNext.startAt) === today ? "today" : "next";
    return none({ ...base, stage, likelyNext, missedLikely });
  }
  if (classesLeft === 2 && daysToPeriod <= 0) return none({ ...base, stage: "twoLeft", likelyNext });
  return none({ ...base, likelyNext });
}

const id = z.string().min(1).max(384);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u);
const instant = z.string().datetime({ offset: true });
// Tab and newline allowed; every other C0 control and DEL refused (same rule as level notes).
export const graduationNoteSchema = z
  .string()
  .trim()
  .min(1)
  .max(280)
  .refine((value) => !/[\u0000-\u0008\u000b-\u001f\u007f]/u.test(value));

export const decideGraduationInputSchema = z.strictObject({
  studentId: z.string().min(1).max(128),
  sessionId: id,
  decision: z.enum(["promote", "not-yet"]),
  note: graduationNoteSchema.optional(),
});
export type DecideGraduationInput = z.infer<typeof decideGraduationInputSchema>;

// No belt colour: `LevelVisual` holds a `colors` array, not one primary colour, so the chip is the
// name only.
const levelChipSchema = z.strictObject({
  definitionKey: z.string().max(128),
  name: z.string().max(120),
});
const likelySchema = z
  .strictObject({ sessionId: id, startAt: instant, title: z.string().max(160) })
  .nullable();

export const graduationBoardRowSchema = z.strictObject({
  studentId: z.string().max(128),
  fullName: z.string().max(160),
  stage: z.enum(["approval", "today", "next"]),
  current: levelChipSchema,
  target: levelChipSchema,
  classesDone: z.number().int().min(0),
  minClasses: z.number().int().min(0).nullable(),
  daysDone: z.number().int().min(0),
  minDays: z.number().int().min(0).nullable(),
  likelyNext: likelySchema,
  graduationClass: z
    .strictObject({ sessionId: id, occurredAt: instant, title: z.string().max(160) })
    .nullable(),
  lastNotYetNote: z.string().max(280).nullable(),
});
export type GraduationBoardRow = z.infer<typeof graduationBoardRowSchema>;
export const graduationBoardSchema = z.strictObject({
  rows: z.array(graduationBoardRowSchema).max(1000),
  canDecide: z.boolean(),
  generatedAt: instant,
});
export type GraduationBoard = z.infer<typeof graduationBoardSchema>;

export const graduationNoticesSchema = z.strictObject({
  firstName: z.string().max(80),
  stage: z.enum(graduationStages),
  targetName: z.string().max(120).nullable(),
  likelyNext: likelySchema,
  missedLikely: z.boolean(),
  lastNotYetNote: z.string().max(280).nullable(),
  classesLeft: z.number().int().min(0).nullable(),
  latestPromotion: z
    .strictObject({
      promotionId: z.string().max(384),
      fromName: z.string().max(120),
      toName: z.string().max(120),
      promotedOn: day,
    })
    .nullable(),
});
export type GraduationNotices = z.infer<typeof graduationNoticesSchema>;
