import type {
  LevelCriteria,
  LevelDefinitionRecord,
  LevelRequirementRecord,
} from "./level-contracts";

const dayMs = 86_400_000;

export type ImportedBaseline = Readonly<{
  classes: number;
  cutoff: string;
  source: "regyfit-import";
}>;
export type ClassesAtLevel = Readonly<{ imported: number; bpt: number; total: number }>;

/**
 * Spec §6.2: the mean of the capped class ratio, the capped day ratio and, when the level defines
 * skill minimums, Σmin(score, required) / Σrequired. A criterion without a minimum is left out of
 * the mean. The card and Manage call this one function, so they can never disagree.
 *
 * The caller owns the validity of the minimums: a `min` that is not a positive number (0, negative,
 * NaN) is treated as "no minimum" and excluded from the mean. No catalogue definition can produce
 * one, so this is documented rather than asserted.
 */
export function computeLevelProgress(
  input: Readonly<{
    classes: Readonly<{ done: number; min: number | null }>;
    days: Readonly<{ done: number; min: number | null }>;
    skills: readonly Readonly<{ score: number; required: number }>[];
  }>,
): number {
  const ratios: number[] = [];
  for (const { done, min } of [input.classes, input.days]) {
    if (min !== null && min > 0) ratios.push(Math.min(Math.max(done, 0) / min, 1));
  }
  const required = input.skills.reduce((total, skill) => total + skill.required, 0);
  if (required > 0) {
    const achieved = input.skills.reduce(
      (total, skill) => total + Math.min(Math.max(skill.score, 0), skill.required),
      0,
    );
    ratios.push(achieved / required);
  }
  if (ratios.length === 0) return 100;
  const mean = ratios.reduce((total, ratio) => total + ratio, 0) / ratios.length;
  // A non-finite input (NaN done or min) would otherwise return NaN and break the documented
  // "integer 0-100" return; it degrades to 0 instead.
  if (!Number.isFinite(mean)) return 0;
  // The epsilon keeps binary rounding (0.29 * 100 = 28.999…) from dropping a whole point.
  // `Math.min(100, …)` is unreachable while every ratio is capped at 1 — it is the written promise
  // of the return type (an integer 0-100), kept so a future criterion cannot break it silently.
  return Math.min(100, Math.floor(mean * 100 + 1e-9));
}

/**
 * Grill G10 / spec §6.2: classes = imported Regyfit baseline + BPT attended/late attendance whose
 * DATE is on or after both the level start and, when there is one, the baseline cutoff.
 *
 * Both halves compare whole UTC days, never instants. A promotion is stored as an instant, so an
 * instant comparison would drop a class trained the morning of a promotion made at midday: it would
 * count toward neither the old level (the head has already moved) nor the new one. The day
 * comparison makes the promotion day belong to the NEW level.
 *
 * `cutoff` is the FIRST day counted from BPT attendance — the day after the last day included in
 * `importedBaseline.classes` — so the invariant is that every class is counted exactly once:
 * before the cutoff it is already inside the baseline, on or after it, it comes from BPT.
 */
export function countClassesAtLevel(
  input: Readonly<{
    attendedAt: readonly string[];
    currentLevelStartedAt: string | null;
    importedBaseline: ImportedBaseline | null;
    until?: string;
  }>,
): ClassesAtLevel {
  const startDay =
    input.currentLevelStartedAt === null ? null : input.currentLevelStartedAt.slice(0, 10);
  const bpt = input.attendedAt.filter((attendedAt) => {
    if (Number.isNaN(Date.parse(attendedAt))) return false;
    // Plan D contract: days are compared as UTC prefixes, not Jersey days.
    const day = attendedAt.slice(0, 10);
    if (startDay !== null && day < startDay) return false;
    if (input.importedBaseline !== null && day < input.importedBaseline.cutoff) return false;
    return input.until === undefined || day <= input.until;
  }).length;
  const imported = input.importedBaseline?.classes ?? 0;
  return Object.freeze({ imported, bpt, total: imported + bpt });
}

export function daysAtLevel(currentLevelStartedAt: string | null, onIso: string): number {
  if (currentLevelStartedAt === null) return 0;
  const elapsed = Date.parse(onIso) - Date.parse(currentLevelStartedAt);
  return Number.isFinite(elapsed) && elapsed > 0 ? Math.floor(elapsed / dayMs) : 0;
}

/** Same conversion buildStudentProgressSummary has always used. */
export function minimumDaysOf(time: LevelCriteria["minimumTime"]): number | null {
  return time === null ? null : time.years * 365 + time.months * 30 + time.days;
}

export function skillCategory(displayLabel: string): string {
  if (/^Warm Up \d+ - /u.test(displayLabel)) return "Warm Up";
  const prefix = /^(.+?) - /u.exec(displayLabel);
  return prefix?.[1] ?? "Fundamentals";
}

// ponytail: the same Intl formatter as `academyDateOf` in members/member-profile-contracts.ts,
// duplicated rather than imported because that module imports `./level-contracts`, which re-exports
// this one — importing it back would close a module cycle. One formatter, no new date maths.
const jerseyDay = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Jersey",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function jerseyDateOf(iso: string): string {
  return jerseyDay.format(new Date(iso));
}

export function isLevelCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const [year, month, day] = value.split("-").map((part) => Number.parseInt(part, 10)) as [
    number,
    number,
    number,
  ];
  const candidate = new Date(Date.UTC(year, month - 1, day));
  return (
    candidate.getUTCFullYear() === year &&
    candidate.getUTCMonth() === month - 1 &&
    candidate.getUTCDate() === day
  );
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/** Grill G7: every reason an assignment is below criteria, in the words the dialog shows. */
export function listPromotionGaps(
  input: Readonly<{
    definitions: readonly LevelDefinitionRecord[];
    requirements: readonly LevelRequirementRecord[];
    fromDefinitionKey: string;
    toDefinitionKey: string;
    classesDone: number;
    daysDone: number;
    skillScores: Readonly<Record<string, number>>;
    ageYears: number | null;
  }>,
): readonly string[] {
  const from = input.definitions.find(
    (definition) => definition.definitionKey === input.fromDefinitionKey,
  );
  const to = input.definitions.find(
    (definition) => definition.definitionKey === input.toDefinitionKey,
  );
  if (from === undefined || to === undefined) throw new Error("Level definition is not available");

  const gaps: string[] = [];
  const skipped = input.definitions.filter(
    (definition) => definition.sequence > from.sequence && definition.sequence < to.sequence,
  );
  const skippedStripes = skipped.filter((definition) => definition.kind === "stripe").length;
  const skippedBelts = skipped.length - skippedStripes;
  if (skippedBelts > 0) gaps.push(`Skips ${plural(skippedBelts, "belt")}`);
  if (skippedStripes > 0) gaps.push(`Skips ${plural(skippedStripes, "stripe")}`);

  const minClasses = to.criteria.minClasses;
  if (minClasses !== null && input.classesDone < minClasses) {
    gaps.push(`Classes ${input.classesDone}/${minClasses} not met`);
  }
  const minDays = minimumDaysOf(to.criteria.minimumTime);
  if (minDays !== null && input.daysDone < minDays)
    gaps.push(`Days ${input.daysDone}/${minDays} not met`);

  const requirements = input.requirements.filter(
    (requirement) => requirement.definitionKey === to.definitionKey,
  );
  const met = requirements.filter(
    (requirement) => (input.skillScores[requirement.skillKey] ?? 0) >= requirement.minimumRating,
  ).length;
  if (met < requirements.length)
    gaps.push(`Skills ${met}/${requirements.length} at minimum not met`);

  const { minAge, maxAge } = to.criteria;
  if (
    (minAge !== null || maxAge !== null) &&
    (input.ageYears === null ||
      (minAge !== null && input.ageYears < minAge) ||
      (maxAge !== null && input.ageYears > maxAge))
  ) {
    gaps.push("Age band not met");
  }
  return Object.freeze(gaps);
}
