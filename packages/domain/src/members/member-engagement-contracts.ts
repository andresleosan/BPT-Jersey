/**
 * Member engagement: the numbers the member-facing streak panel, the competitor tables and the
 * account settings share. Pure functions over attendance dates; nothing here knows Firestore.
 *
 * Owned by the phase-0 spec (`docs/superpowers/specs/2026-09-16-member-engagement-phase-0-design.md`).
 * T042V2 (streak), T043V2 (competitors) and T044V2 (settings) may add to this file; they must not
 * change the meaning of what is already exported, because two of them render the same number.
 */

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

/** What another member may see of a student. Nothing private: no age, contact or family data. */
export type MemberPublicCard = Readonly<{
  studentId: string;
  displayName: string;
  photoUrl: string | null;
  belt: Readonly<{ name: string; color: string }> | null;
  stripes: number;
  streakCount: number;
  skillKeys: readonly string[];
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
  return Object.freeze({
    streakCount: sessionStreak(
      input.attendances.map((attendance) => attendance.occurredAt),
      input.now,
    ),
    seasonStart,
    attendancesSinceSeasonStart: thisSeason.length,
    hoursSinceSeasonStart: Math.round((minutes / 60) * 10) / 10,
    goal: progressBar(input.goal ?? defaultGoal, thisSeason.length),
    reward: progressBar(input.reward ?? defaultReward, thisSeason.length),
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

/**
 * Leaderboard cohort (spec decision 5, operator 2026-09-16): under-16s only see and are seen by
 * under-16s; from 16 a member counts as an adult in the tables, and only there. Age on the Jersey
 * calendar for the day of `nowIso`. An unreadable date of birth falls into `under16`, the narrower
 * cohort.
 */
export type LeaderboardCohort = "under16" | "adult";

export function leaderboardCohort(dateOfBirth: string, nowIso: string): LeaderboardCohort {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(dateOfBirth)) return "under16";
  const [birthYear, birthMonth, birthDay] = dateOfBirth.split("-").map(Number) as [
    number,
    number,
    number,
  ];
  const [year, month, day] = jerseyDate.format(new Date(nowIso)).split("-").map(Number) as [
    number,
    number,
    number,
  ];
  const hadBirthday = month > birthMonth || (month === birthMonth && day >= birthDay);
  const age = year - birthYear - (hadBirthday ? 0 : 1);
  return age >= 16 ? "adult" : "under16";
}
