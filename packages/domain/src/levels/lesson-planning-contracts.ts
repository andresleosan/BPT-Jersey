import type { ValidationIssue } from "../errors";
import { err, ok, type Result } from "../result";

export const lessonPlanStatuses = Object.freeze([
  "draft",
  "submitted",
  "approved",
  "archived",
] as const);
export type LessonPlanStatus = (typeof lessonPlanStatuses)[number];

export const lessonActivityKinds = Object.freeze([
  "technique",
  "drill",
  "sparring",
  "review",
] as const);
export type LessonActivityKind = (typeof lessonActivityKinds)[number];

export type TechniqueDefinition = Readonly<{
  techniqueId: string;
  label: string;
  skillKey: string;
  sequence: number;
  active: boolean;
}>;

export type TechniqueLibraryVersion = Readonly<{
  libraryId: string;
  version: number;
  status: "draft" | "published" | "archived";
  publishedAt: string | null;
  techniques: readonly TechniqueDefinition[];
}>;

export type LessonPlanActivity = Readonly<{
  activityId: string;
  kind: LessonActivityKind;
  techniqueId: string | null;
  durationMinutes: number;
  sequence: number;
}>;

export type LessonPlanRecord = Readonly<{
  planId: string;
  academyId: string;
  title: string;
  libraryId: string;
  libraryVersion: number;
  status: LessonPlanStatus;
  activities: readonly LessonPlanActivity[];
  approvedByStaffId: string | null;
  approvedAt: string | null;
}>;

export type ApproveLessonPlanInput = Readonly<{
  staffId: string;
  staffRole: "head_coach" | "coach" | "administrator";
  approvedAt: string;
}>;

const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const dateTimePattern =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:?\d{2})$/u;
const controlCharacterPattern = /[\u0000-\u001f\u007f]/u;

function issue(path: readonly (string | number)[], code: string): ValidationIssue {
  return Object.freeze({ path: Object.freeze([...path]), code });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(record: Record<string, unknown>, keys: readonly string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(record).every((key) => allowed.has(key));
}

function isIdentifier(value: unknown): value is string {
  return typeof value === "string" && identifierPattern.test(value);
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

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isStatus(value: unknown): value is LessonPlanStatus {
  return lessonPlanStatuses.includes(value as LessonPlanStatus);
}

function isActivityKind(value: unknown): value is LessonActivityKind {
  return lessonActivityKinds.includes(value as LessonActivityKind);
}

export function parseTechniqueLibraryVersion(
  value: unknown,
): Result<TechniqueLibraryVersion, readonly ValidationIssue[]> {
  const issues: ValidationIssue[] = [];
  if (!isRecord(value)) return err(Object.freeze([issue([], "invalid_type")]));
  if (
    !hasOnlyKeys(value, ["libraryId", "version", "status", "publishedAt", "techniques"]) ||
    !isIdentifier(value.libraryId) ||
    !isPositiveSafeInteger(value.version) ||
    !["draft", "published", "archived"].includes(value.status as string) ||
    (value.publishedAt !== null && !isDateTime(value.publishedAt)) ||
    !Array.isArray(value.techniques) ||
    value.techniques.length === 0 ||
    value.techniques.length > 500
  ) {
    issues.push(issue([], "invalid_library"));
  }

  const seen = new Set<string>();
  const techniques: TechniqueDefinition[] = [];
  if (Array.isArray(value.techniques)) {
    value.techniques.forEach((rawTechnique, index) => {
      if (!isRecord(rawTechnique)) {
        issues.push(issue(["techniques", index], "invalid_technique"));
        return;
      }
      const valid =
        hasOnlyKeys(rawTechnique, ["techniqueId", "label", "skillKey", "sequence", "active"]) &&
        isIdentifier(rawTechnique.techniqueId) &&
        isLabel(rawTechnique.label) &&
        isIdentifier(rawTechnique.skillKey) &&
        isPositiveSafeInteger(rawTechnique.sequence) &&
        typeof rawTechnique.active === "boolean";
      if (!valid) {
        issues.push(issue(["techniques", index], "invalid_technique"));
        return;
      }
      if (seen.has(rawTechnique.techniqueId as string)) {
        issues.push(issue(["techniques", index, "techniqueId"], "duplicate_technique"));
        return;
      }
      seen.add(rawTechnique.techniqueId as string);
      techniques.push(
        Object.freeze({
          techniqueId: rawTechnique.techniqueId as string,
          label: rawTechnique.label as string,
          skillKey: rawTechnique.skillKey as string,
          sequence: rawTechnique.sequence as number,
          active: rawTechnique.active as boolean,
        }),
      );
    });
  }

  const status = value.status as TechniqueLibraryVersion["status"];
  if (status === "draft" && value.publishedAt !== null) {
    issues.push(issue(["publishedAt"], "draft_cannot_have_publication"));
  }
  if ((status === "published" || status === "archived") && !isDateTime(value.publishedAt)) {
    issues.push(issue(["publishedAt"], "published_library_requires_publication"));
  }
  if (issues.length > 0) return err(Object.freeze(issues));

  return ok(
    Object.freeze({
      libraryId: value.libraryId as string,
      version: value.version as number,
      status,
      publishedAt: value.publishedAt as string | null,
      techniques: Object.freeze(techniques),
    }),
  );
}

export function parseLessonPlanRecord(
  value: unknown,
  library: TechniqueLibraryVersion,
): Result<LessonPlanRecord, readonly ValidationIssue[]> {
  const issues: ValidationIssue[] = [];
  if (!isRecord(value)) return err(Object.freeze([issue([], "invalid_type")]));
  if (
    !hasOnlyKeys(value, [
      "planId",
      "academyId",
      "title",
      "libraryId",
      "libraryVersion",
      "status",
      "activities",
      "approvedByStaffId",
      "approvedAt",
    ]) ||
    !isIdentifier(value.planId) ||
    !isIdentifier(value.academyId) ||
    !isLabel(value.title) ||
    !isIdentifier(value.libraryId) ||
    !isPositiveSafeInteger(value.libraryVersion) ||
    !isStatus(value.status) ||
    !Array.isArray(value.activities) ||
    value.activities.length === 0 ||
    value.activities.length > 100 ||
    (value.approvedByStaffId !== null && !isIdentifier(value.approvedByStaffId)) ||
    (value.approvedAt !== null && !isDateTime(value.approvedAt))
  ) {
    issues.push(issue([], "invalid_plan"));
  }
  if (value.libraryId !== library.libraryId || value.libraryVersion !== library.version) {
    issues.push(issue(["libraryVersion"], "library_reference_mismatch"));
  }

  const techniqueIds = new Set(
    library.techniques.filter((item) => item.active).map((item) => item.techniqueId),
  );
  const activityIds = new Set<string>();
  const activities: LessonPlanActivity[] = [];
  if (Array.isArray(value.activities)) {
    value.activities.forEach((rawActivity, index) => {
      if (!isRecord(rawActivity)) {
        issues.push(issue(["activities", index], "invalid_activity"));
        return;
      }
      const valid =
        hasOnlyKeys(rawActivity, [
          "activityId",
          "kind",
          "techniqueId",
          "durationMinutes",
          "sequence",
        ]) &&
        isIdentifier(rawActivity.activityId) &&
        isActivityKind(rawActivity.kind) &&
        (rawActivity.techniqueId === null || isIdentifier(rawActivity.techniqueId)) &&
        isPositiveSafeInteger(rawActivity.durationMinutes) &&
        rawActivity.durationMinutes <= 180 &&
        isPositiveSafeInteger(rawActivity.sequence);
      if (!valid) {
        issues.push(issue(["activities", index], "invalid_activity"));
        return;
      }
      if (
        rawActivity.techniqueId !== null &&
        !techniqueIds.has(rawActivity.techniqueId as string)
      ) {
        issues.push(issue(["activities", index, "techniqueId"], "inactive_or_unknown_technique"));
        return;
      }
      if (activityIds.has(rawActivity.activityId as string)) {
        issues.push(issue(["activities", index, "activityId"], "duplicate_activity"));
        return;
      }
      activityIds.add(rawActivity.activityId as string);
      activities.push(
        Object.freeze({
          activityId: rawActivity.activityId as string,
          kind: rawActivity.kind as LessonActivityKind,
          techniqueId: rawActivity.techniqueId as string | null,
          durationMinutes: rawActivity.durationMinutes as number,
          sequence: rawActivity.sequence as number,
        }),
      );
    });
  }

  const status = value.status as LessonPlanStatus;
  const approvalPairValid =
    (status === "approved" &&
      isIdentifier(value.approvedByStaffId) &&
      isDateTime(value.approvedAt)) ||
    (status !== "approved" && value.approvedByStaffId === null && value.approvedAt === null);
  if (!approvalPairValid) issues.push(issue(["status"], "approval_state_mismatch"));
  if (issues.length > 0) return err(Object.freeze(issues));

  return ok(
    Object.freeze({
      planId: value.planId as string,
      academyId: value.academyId as string,
      title: value.title as string,
      libraryId: value.libraryId as string,
      libraryVersion: value.libraryVersion as number,
      status,
      activities: Object.freeze(activities),
      approvedByStaffId: value.approvedByStaffId as string | null,
      approvedAt: value.approvedAt as string | null,
    }),
  );
}

export function approveLessonPlan(
  plan: LessonPlanRecord,
  input: ApproveLessonPlanInput,
): Result<LessonPlanRecord, readonly ValidationIssue[]> {
  const issues: ValidationIssue[] = [];
  if (plan.status !== "submitted") issues.push(issue(["plan", "status"], "plan_must_be_submitted"));
  if (input.staffRole !== "head_coach") issues.push(issue(["staffRole"], "head_coach_required"));
  if (!isIdentifier(input.staffId)) issues.push(issue(["staffId"], "invalid_identifier"));
  if (!isDateTime(input.approvedAt)) issues.push(issue(["approvedAt"], "invalid_iso_datetime"));
  if (issues.length > 0) return err(Object.freeze(issues));

  return ok(
    Object.freeze({
      ...plan,
      status: "approved" as const,
      approvedByStaffId: input.staffId,
      approvedAt: input.approvedAt,
    }),
  );
}
