import type { ValidationIssue } from "../errors";
import { err, ok, type Result } from "../result";

export const achievementMetrics = Object.freeze([
  "classes_attended",
  "current_streak_weeks",
  "longest_streak_weeks",
] as const);
export type AchievementMetric = (typeof achievementMetrics)[number];

export type FamilyGoalDefinition = Readonly<{
  goalId: string;
  label: string;
  metric: AchievementMetric;
  target: number;
}>;

export type FamilyAchievementDefinition = Readonly<{
  achievementId: string;
  label: string;
  metric: AchievementMetric;
  target: number;
}>;

export type FamilyMemberProgressInput = Readonly<{
  familyId: string;
  studentId: string;
  displayName: string;
  participantType: "adult" | "minor";
  active: boolean;
  classesAttended: number;
  currentStreakWeeks: number;
  longestStreakWeeks: number;
  adultComparisonOptIn: boolean;
}>;

export type BuildFamilyAchievementSummaryInput = Readonly<{
  familyId: string;
  now: string;
  goals: readonly FamilyGoalDefinition[];
  achievements: readonly FamilyAchievementDefinition[];
  members: readonly FamilyMemberProgressInput[];
}>;

export type FamilyGoalProgress = Readonly<{
  goalId: string;
  label: string;
  metric: AchievementMetric;
  target: number;
  progress: number;
  status: "in_progress" | "complete";
}>;

export type FamilyAchievementCandidate = Readonly<{
  achievementId: string;
  label: string;
  metric: AchievementMetric;
  target: number;
  achievedValue: number;
  status: "candidate";
}>;

export type FamilyMemberAchievementSummary = Readonly<{
  studentId: string;
  displayName: string;
  participantType: "adult" | "minor";
  goals: readonly FamilyGoalProgress[];
  achievementCandidates: readonly FamilyAchievementCandidate[];
}>;

export type AdultComparisonEntry = Readonly<{
  studentId: string;
  classesAttended: number;
  currentStreakWeeks: number;
  longestStreakWeeks: number;
}>;

export type FamilyAchievementSummary = Readonly<{
  familyId: string;
  generatedAt: string;
  members: readonly FamilyMemberAchievementSummary[];
  adultComparison: readonly AdultComparisonEntry[];
}>;

const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const dateTimePattern =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:?\d{2})$/u;
const controlCharacterPattern = /[\u0000-\u001f\u007f]/u;

function issue(path: readonly (string | number)[], code: string): ValidationIssue {
  return Object.freeze({ path: Object.freeze([...path]), code });
}

function isIdentifier(value: unknown): value is string {
  return typeof value === "string" && identifierPattern.test(value);
}

function isDateTime(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    !dateTimePattern.test(value) ||
    Number.isNaN(Date.parse(value))
  ) {
    return false;
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})/u.exec(value);
  if (match === null) return false;
  const date = new Date(0);
  date.setUTCFullYear(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  date.setUTCHours(0, 0, 0, 0);
  return (
    date.getUTCFullYear() === Number(match[1]) &&
    date.getUTCMonth() === Number(match[2]) - 1 &&
    date.getUTCDate() === Number(match[3])
  );
}

function isLabel(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 160 &&
    value === value.trim() &&
    !controlCharacterPattern.test(value)
  );
}

function isMetric(value: unknown): value is AchievementMetric {
  return achievementMetrics.includes(value as AchievementMetric);
}

function isSafeMetricValue(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isDefinition(value: FamilyGoalDefinition | FamilyAchievementDefinition): boolean {
  const record = value as Record<string, unknown>;
  return (
    isIdentifier(record.goalId ?? record.achievementId) &&
    isLabel(record.label) &&
    isMetric(record.metric) &&
    Number.isSafeInteger(record.target) &&
    (record.target as number) >= 1 &&
    (record.target as number) <= 100000
  );
}

function metricValue(member: FamilyMemberProgressInput, metric: AchievementMetric): number {
  if (metric === "classes_attended") return member.classesAttended;
  if (metric === "current_streak_weeks") return member.currentStreakWeeks;
  return member.longestStreakWeeks;
}

function parseInput(
  input: BuildFamilyAchievementSummaryInput,
): Result<BuildFamilyAchievementSummaryInput, readonly ValidationIssue[]> {
  const issues: ValidationIssue[] = [];
  if (!isIdentifier(input.familyId)) issues.push(issue(["familyId"], "invalid_identifier"));
  if (!isDateTime(input.now)) issues.push(issue(["now"], "invalid_iso_datetime"));
  if (!Array.isArray(input.goals)) issues.push(issue(["goals"], "invalid_type"));
  if (!Array.isArray(input.achievements)) issues.push(issue(["achievements"], "invalid_type"));
  if (!Array.isArray(input.members)) issues.push(issue(["members"], "invalid_type"));

  const validateDefinitions = (
    values: readonly FamilyGoalDefinition[] | readonly FamilyAchievementDefinition[],
    path: "goals" | "achievements",
  ): void => {
    const seen = new Set<string>();
    values.forEach((definition, index) => {
      if (!isDefinition(definition)) issues.push(issue([path, index], "invalid_definition"));
      const definitionRecord = definition as Record<string, unknown>;
      const id = definitionRecord.goalId ?? definitionRecord.achievementId;
      if (typeof id === "string") {
        if (seen.has(id)) issues.push(issue([path, index, "id"], "duplicate_definition"));
        seen.add(id);
      }
    });
  };
  if (Array.isArray(input.goals)) validateDefinitions(input.goals, "goals");
  if (Array.isArray(input.achievements)) validateDefinitions(input.achievements, "achievements");

  if (Array.isArray(input.members)) {
    const seen = new Set<string>();
    input.members.forEach((member, index) => {
      if (
        member.familyId !== input.familyId ||
        !isIdentifier(member.studentId) ||
        !isLabel(member.displayName) ||
        (member.participantType !== "adult" && member.participantType !== "minor") ||
        typeof member.active !== "boolean" ||
        !isSafeMetricValue(member.classesAttended) ||
        !isSafeMetricValue(member.currentStreakWeeks) ||
        !isSafeMetricValue(member.longestStreakWeeks) ||
        typeof member.adultComparisonOptIn !== "boolean" ||
        (member.participantType === "minor" && member.adultComparisonOptIn)
      ) {
        issues.push(issue(["members", index], "invalid_member"));
      }
      if (seen.has(member.studentId))
        issues.push(issue(["members", index, "studentId"], "duplicate_member"));
      seen.add(member.studentId);
    });
  }
  return issues.length === 0 ? ok(input) : err(Object.freeze(issues));
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function hasExactFields(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Reflect.ownKeys(value);
  return (
    keys.length === expected.length &&
    keys.every((key) => {
      if (typeof key !== "string" || !expected.includes(key)) return false;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return (
        descriptor?.enumerable === true &&
        descriptor.get === undefined &&
        descriptor.set === undefined &&
        Object.hasOwn(descriptor, "value")
      );
    })
  );
}

function parseGoalProgress(value: unknown): FamilyGoalProgress | null {
  if (
    !isPlainRecord(value) ||
    !hasExactFields(value, ["goalId", "label", "metric", "target", "progress", "status"]) ||
    !isIdentifier(value.goalId) ||
    !isLabel(value.label) ||
    !isMetric(value.metric) ||
    typeof value.target !== "number" ||
    !Number.isSafeInteger(value.target) ||
    value.target < 1 ||
    value.target > 100000 ||
    !isSafeMetricValue(value.progress) ||
    (value.status !== "in_progress" && value.status !== "complete") ||
    (value.status === "complete") !== value.progress >= value.target
  ) {
    return null;
  }
  return Object.freeze({
    goalId: value.goalId,
    label: value.label,
    metric: value.metric,
    target: value.target as number,
    progress: value.progress,
    status: value.status,
  });
}

function parseAchievementCandidate(value: unknown): FamilyAchievementCandidate | null {
  if (
    !isPlainRecord(value) ||
    !hasExactFields(value, [
      "achievementId",
      "label",
      "metric",
      "target",
      "achievedValue",
      "status",
    ]) ||
    !isIdentifier(value.achievementId) ||
    !isLabel(value.label) ||
    !isMetric(value.metric) ||
    typeof value.target !== "number" ||
    !Number.isSafeInteger(value.target) ||
    value.target < 1 ||
    value.target > 100000 ||
    !isSafeMetricValue(value.achievedValue) ||
    value.achievedValue < value.target ||
    value.status !== "candidate"
  ) {
    return null;
  }
  return Object.freeze({
    achievementId: value.achievementId,
    label: value.label,
    metric: value.metric,
    target: value.target as number,
    achievedValue: value.achievedValue,
    status: "candidate" as const,
  });
}

export function parseFamilyAchievementSummary(
  value: unknown,
): Result<FamilyAchievementSummary, readonly ValidationIssue[]> {
  const issues: ValidationIssue[] = [];
  if (!isPlainRecord(value)) return err([issue([], "invalid_summary")]);
  if (
    !hasExactFields(value, ["familyId", "generatedAt", "members", "adultComparison"]) ||
    !isIdentifier(value.familyId) ||
    !isDateTime(value.generatedAt) ||
    !Array.isArray(value.members) ||
    value.members.length > 200 ||
    !Array.isArray(value.adultComparison) ||
    value.adultComparison.length > 200
  ) {
    return err([issue([], "invalid_summary")]);
  }

  const studentTypes = new Map<string, "adult" | "minor">();
  const members: FamilyMemberAchievementSummary[] = [];
  value.members.forEach((memberValue, memberIndex) => {
    if (
      !isPlainRecord(memberValue) ||
      !hasExactFields(memberValue, [
        "studentId",
        "displayName",
        "participantType",
        "goals",
        "achievementCandidates",
      ]) ||
      !isIdentifier(memberValue.studentId) ||
      !isLabel(memberValue.displayName) ||
      (memberValue.participantType !== "adult" && memberValue.participantType !== "minor") ||
      !Array.isArray(memberValue.goals) ||
      memberValue.goals.length > 200 ||
      !Array.isArray(memberValue.achievementCandidates) ||
      memberValue.achievementCandidates.length > 200 ||
      studentTypes.has(memberValue.studentId)
    ) {
      issues.push(issue(["members", memberIndex], "invalid_member"));
      return;
    }

    const goals: FamilyGoalProgress[] = [];
    const goalIds = new Set<string>();
    memberValue.goals.forEach((goal, goalIndex) => {
      const parsed = parseGoalProgress(goal);
      if (parsed === null || goalIds.has(parsed.goalId)) {
        issues.push(issue(["members", memberIndex, "goals", goalIndex], "invalid_goal"));
        return;
      }
      goalIds.add(parsed.goalId);
      goals.push(parsed);
    });

    const candidates: FamilyAchievementCandidate[] = [];
    const achievementIds = new Set<string>();
    memberValue.achievementCandidates.forEach((candidate, candidateIndex) => {
      const parsed = parseAchievementCandidate(candidate);
      if (parsed === null || achievementIds.has(parsed.achievementId)) {
        issues.push(
          issue(
            ["members", memberIndex, "achievementCandidates", candidateIndex],
            "invalid_candidate",
          ),
        );
        return;
      }
      achievementIds.add(parsed.achievementId);
      candidates.push(parsed);
    });

    studentTypes.set(memberValue.studentId, memberValue.participantType);
    members.push(
      Object.freeze({
        studentId: memberValue.studentId,
        displayName: memberValue.displayName,
        participantType: memberValue.participantType,
        goals: Object.freeze(goals),
        achievementCandidates: Object.freeze(candidates),
      }),
    );
  });

  const adultComparison: AdultComparisonEntry[] = [];
  const comparisonIds = new Set<string>();
  value.adultComparison.forEach((entry, entryIndex) => {
    if (
      !isPlainRecord(entry) ||
      !hasExactFields(entry, [
        "studentId",
        "classesAttended",
        "currentStreakWeeks",
        "longestStreakWeeks",
      ]) ||
      !isIdentifier(entry.studentId) ||
      !isSafeMetricValue(entry.classesAttended) ||
      !isSafeMetricValue(entry.currentStreakWeeks) ||
      !isSafeMetricValue(entry.longestStreakWeeks) ||
      comparisonIds.has(entry.studentId) ||
      studentTypes.get(entry.studentId) !== "adult"
    ) {
      issues.push(issue(["adultComparison", entryIndex], "invalid_comparison"));
      return;
    }
    comparisonIds.add(entry.studentId);
    adultComparison.push(
      Object.freeze({
        studentId: entry.studentId,
        classesAttended: entry.classesAttended,
        currentStreakWeeks: entry.currentStreakWeeks,
        longestStreakWeeks: entry.longestStreakWeeks,
      }),
    );
  });

  if (issues.length > 0) return err(Object.freeze(issues));
  return ok(
    Object.freeze({
      familyId: value.familyId,
      generatedAt: value.generatedAt,
      members: Object.freeze(members),
      adultComparison: Object.freeze(adultComparison),
    }),
  );
}
export function buildFamilyAchievementSummary(
  input: BuildFamilyAchievementSummaryInput,
): Result<FamilyAchievementSummary, readonly ValidationIssue[]> {
  const parsed = parseInput(input);
  if (!parsed.ok) return parsed;

  const members = input.members
    .filter((member) => member.active)
    .map((member) => {
      const goals = input.goals.map((goal) => {
        const progress = metricValue(member, goal.metric);
        return Object.freeze({
          goalId: goal.goalId,
          label: goal.label,
          metric: goal.metric,
          target: goal.target,
          progress,
          status: progress >= goal.target ? "complete" : "in_progress",
        });
      });
      const achievementCandidates = input.achievements
        .map((achievement) => {
          const achievedValue = metricValue(member, achievement.metric);
          return achievedValue >= achievement.target
            ? Object.freeze({
                achievementId: achievement.achievementId,
                label: achievement.label,
                metric: achievement.metric,
                target: achievement.target,
                achievedValue,
                status: "candidate" as const,
              })
            : null;
        })
        .filter((candidate): candidate is FamilyAchievementCandidate => candidate !== null);

      return Object.freeze({
        studentId: member.studentId,
        displayName: member.displayName,
        participantType: member.participantType,
        goals: Object.freeze(goals),
        achievementCandidates: Object.freeze(achievementCandidates),
      });
    });

  const adultComparison = input.members
    .filter(
      (member) =>
        member.active && member.participantType === "adult" && member.adultComparisonOptIn,
    )
    .map((member) =>
      Object.freeze({
        studentId: member.studentId,
        classesAttended: member.classesAttended,
        currentStreakWeeks: member.currentStreakWeeks,
        longestStreakWeeks: member.longestStreakWeeks,
      }),
    );

  return ok(
    Object.freeze({
      familyId: input.familyId,
      generatedAt: input.now,
      members: Object.freeze(members),
      adultComparison: Object.freeze(adultComparison),
    }),
  );
}
