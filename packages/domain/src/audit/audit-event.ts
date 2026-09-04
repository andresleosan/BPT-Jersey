import type { ValidationIssue } from "../errors";
import type { AcademyId, CorrelationId, SystemActorId, UserId } from "../identifiers";
import { memberReportKeys, type MemberReportKey } from "../members/member-contracts";
import { err, ok, type Result } from "../result";

export const auditActions = Object.freeze([
  "admin.role.granted",
  "admin.role.revoked",
  "member.created",
  "member.updated",
  "guardian.profile.created",
  "guardian.profile.updated",
  "family.created",
  "family.student.added",
  "level.catalog.published",
  "level.catalog.rolled_back",
  "level.assessment.recorded",
  "level.medical-leave.recorded",
  "level.promotion.approved",
  "level.promotion.rejected",
  "member.import.confirmed",
  "member.detail.read",
  "member.identity.lookup",
  "regyfit.access.imported",
  "retention.alerts.generated",
  "report.export.prepared",
  "family.achievements.generated",
  "lesson.plan.approved",
  "membership.created",
  "membership.status.changed",
  "invoice.created",
  "invoice.voided",
  "payment.recorded",
  "invoice.status.changed",
  "staff.created",
  "staff.updated",
  "staff.status.changed",
  "staff.availability.replaced",
  "staff.assignments.replaced",
  "waiver.version.published",
  "waiver.version.withdrawn",
  "consent.accepted",
  "consent.revoked",
  "consent.evidence.downloaded",
  "waitlist.offer.issued",
  "waitlist.offer.accepted",
  "waitlist.offer.declined",
  "waitlist.offer.expired",
  "attendance.checked_in",
  "attendance.corrected",
  "student.checked_out",
  "notification.preference.updated",
] as const);

export type AuditAction = (typeof auditActions)[number];

type CommonAuditEventDraft = Readonly<{
  academyId: AcademyId;
  actorId: UserId | SystemActorId;
  targetRef: string;
  purpose: string;
  correlationId: CorrelationId;
}>;

export const memberDetailReadAuditResults = Object.freeze([
  "completed",
  "not-found",
  "unavailable",
  "rate-limited",
] as const);
export const memberIdentityLookupAuditResults = Object.freeze([
  "completed",
  "no-match",
  "unavailable",
  "rate-limited",
] as const);

export type MemberDetailReadAuditResult = (typeof memberDetailReadAuditResults)[number];
export type MemberIdentityLookupAuditResult = (typeof memberIdentityLookupAuditResults)[number];

type RestrictedMemberReadAuditVariant =
  | Readonly<{
      action: "member.detail.read";
      result: MemberDetailReadAuditResult;
    }>
  | Readonly<{
      action: "member.identity.lookup";
      result: MemberIdentityLookupAuditResult;
    }>;

export type RestrictedMemberReadAuditEventDraft = CommonAuditEventDraft &
  RestrictedMemberReadAuditVariant;

export type AuditEventDraft = CommonAuditEventDraft &
  (
    | RestrictedMemberReadAuditVariant
    | Readonly<{
        action:
          | "admin.role.granted"
          | "admin.role.revoked"
          | "member.created"
          | "member.updated"
          | "guardian.profile.created"
          | "guardian.profile.updated"
          | "family.created"
          | "family.student.added"
          | "level.catalog.published"
          | "level.catalog.rolled_back"
          | "level.assessment.recorded"
          | "level.medical-leave.recorded"
          | "level.promotion.approved"
          | "level.promotion.rejected"
          | "membership.created"
          | "membership.status.changed"
          | "staff.created"
          | "staff.updated"
          | "staff.status.changed"
          | "staff.availability.replaced"
          | "staff.assignments.replaced"
          | "waiver.version.published"
          | "waiver.version.withdrawn"
          | "consent.accepted"
          | "consent.revoked"
          | "consent.evidence.downloaded"
          | "waitlist.offer.issued"
          | "waitlist.offer.accepted"
          | "waitlist.offer.declined"
          | "waitlist.offer.expired"
          | "attendance.checked_in"
          | "attendance.corrected"
          | "student.checked_out"
          | "notification.preference.updated";
      }>
    | Readonly<{
        action: "invoice.created" | "invoice.voided" | "invoice.status.changed";
        amountMinor: number;
        currency: "GBP";
      }>
    | Readonly<{
        action: "payment.recorded";
        amountMinor: number;
        currency: "GBP";
        method: "cash" | "bank_transfer" | "other";
      }>
    | Readonly<{
        action: "member.import.confirmed";
        imported: number;
        updated: number;
        conflicts: number;
        sourceHash: string;
        reportKeys: readonly MemberReportKey[];
      }>
    | Readonly<{
        action: "regyfit.access.imported";
        importRunId: string;
        moduleKey: string;
        sourceRoute: string;
        recordCount: number;
        contentSha256: string;
      }>
    | Readonly<{
        action: "retention.alerts.generated";
        runDate: string;
        policyVersion: "1";
        evaluatedStudents: number;
        alertCount: number;
        inactivityDays: number;
        lookbackDays: number;
        noShowThreshold: number;
        membershipExpiryDays: number;
        sourceHash: string;
      }>
    | Readonly<{
        action: "report.export.prepared";
        scope: "operational_and_progress_aggregates";
        classification: "Confidential";
        recipient: string;
        expiresAt: string;
        contentSha256: string;
        byteLength: number;
      }>
    | Readonly<{
        action: "family.achievements.generated";
        familyId: string;
        snapshotId: string;
        memberCount: number;
        candidateCount: number;
        generatedAt: string;
      }>
    | Readonly<{
        action: "lesson.plan.approved";
        planId: string;
        libraryId: string;
        libraryVersion: number;
        approvedAt: string;
      }>
  );

const commonFields = Object.freeze([
  "academyId",
  "actorId",
  "action",
  "targetRef",
  "purpose",
  "correlationId",
] as const);
const restrictedMemberReadFields = Object.freeze([...commonFields, "result"]);
const fieldsByAction: Readonly<Record<AuditAction, readonly string[]>> = Object.freeze({
  "admin.role.granted": commonFields,
  "admin.role.revoked": commonFields,
  "member.created": commonFields,
  "member.updated": commonFields,
  "guardian.profile.created": commonFields,
  "guardian.profile.updated": commonFields,
  "family.created": commonFields,
  "family.student.added": commonFields,
  "level.catalog.published": commonFields,
  "level.catalog.rolled_back": commonFields,
  "level.assessment.recorded": commonFields,
  "level.medical-leave.recorded": commonFields,
  "level.promotion.approved": commonFields,
  "level.promotion.rejected": commonFields,
  "member.detail.read": restrictedMemberReadFields,
  "member.identity.lookup": restrictedMemberReadFields,
  "membership.created": commonFields,
  "membership.status.changed": commonFields,
  "invoice.created": Object.freeze([...commonFields, "amountMinor", "currency"]),
  "invoice.voided": Object.freeze([...commonFields, "amountMinor", "currency"]),
  "invoice.status.changed": Object.freeze([...commonFields, "amountMinor", "currency"]),
  "payment.recorded": Object.freeze([...commonFields, "amountMinor", "currency", "method"]),
  "staff.created": commonFields,
  "staff.updated": commonFields,
  "staff.status.changed": commonFields,
  "staff.availability.replaced": commonFields,
  "staff.assignments.replaced": commonFields,
  "waiver.version.published": commonFields,
  "waiver.version.withdrawn": commonFields,
  "consent.accepted": commonFields,
  "consent.revoked": commonFields,
  "consent.evidence.downloaded": commonFields,
  "waitlist.offer.issued": commonFields,
  "waitlist.offer.accepted": commonFields,
  "waitlist.offer.declined": commonFields,
  "waitlist.offer.expired": commonFields,
  "attendance.checked_in": commonFields,
  "attendance.corrected": commonFields,
  "student.checked_out": commonFields,
  "notification.preference.updated": commonFields,
  "member.import.confirmed": Object.freeze([
    ...commonFields,
    "imported",
    "updated",
    "conflicts",
    "sourceHash",
    "reportKeys",
  ]),
  "regyfit.access.imported": Object.freeze([
    ...commonFields,
    "importRunId",
    "moduleKey",
    "sourceRoute",
    "recordCount",
    "contentSha256",
  ]),
  "retention.alerts.generated": Object.freeze([
    ...commonFields,
    "runDate",
    "policyVersion",
    "evaluatedStudents",
    "alertCount",
    "inactivityDays",
    "lookbackDays",
    "noShowThreshold",
    "membershipExpiryDays",
    "sourceHash",
  ]),
  "report.export.prepared": Object.freeze([
    ...commonFields,
    "scope",
    "classification",
    "recipient",
    "expiresAt",
    "contentSha256",
    "byteLength",
  ]),
  "family.achievements.generated": Object.freeze([
    ...commonFields,
    "familyId",
    "snapshotId",
    "memberCount",
    "candidateCount",
    "generatedAt",
  ]),

  "lesson.plan.approved": Object.freeze([
    ...commonFields,
    "planId",
    "libraryId",
    "libraryVersion",
    "approvedAt",
  ]),
});
const sha256Pattern = /^[a-f0-9]{64}$/u;
const moduleKeyPattern = /^[A-Za-z0-9._-]+$/u;
const importRunIdPattern = /^[A-Za-z0-9._-]+$/u;
const safeAuditIdentifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const safeLevelRecordIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,383}$/u;
const safeAuditCorrelationPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u;
const sourceRoutePattern = /^\/[A-Za-z0-9._/-]+$/u;
const controlCharacterPattern = /[\u0000-\u001f\u007f]/u;
const dateTimePattern =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:?\d{2})$/u;

function issue(path: readonly (string | number)[], code: string): ValidationIssue {
  return { path, code };
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function isBoundedString(value: unknown, maxLength: number): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maxLength &&
    value === value.trim() &&
    !controlCharacterPattern.test(value)
  );
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
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

function readDataFields(value: Record<string, unknown>): {
  snapshot: Record<string, unknown>;
  issues: ValidationIssue[];
} {
  const snapshot = Object.create(null) as Record<string, unknown>;
  const issues: ValidationIssue[] = [];
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      typeof key !== "string" ||
      descriptor?.enumerable !== true ||
      descriptor?.get !== undefined ||
      descriptor?.set !== undefined ||
      descriptor === undefined ||
      !Object.hasOwn(descriptor, "value")
    ) {
      issues.push(issue(typeof key === "string" ? [key] : [], "AUDIT_EVENT_PROPERTY_INVALID"));
    } else {
      snapshot[key] = descriptor.value;
    }
  }
  return { snapshot, issues };
}

function validReportKeys(value: unknown): value is readonly MemberReportKey[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > memberReportKeys.length) {
    return false;
  }
  const keys = value as unknown[];
  return (
    keys.every(
      (key): key is MemberReportKey =>
        typeof key === "string" && memberReportKeys.includes(key as MemberReportKey),
    ) && new Set(keys).size === keys.length
  );
}

function validSourceRoute(value: unknown): value is string {
  if (!isBoundedString(value, 256) || !sourceRoutePattern.test(value)) {
    return false;
  }
  const segments = value.split("/");
  return !value.includes("//") && !segments.includes(".") && !segments.includes("..");
}

function validCalendarDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const timestamp = Date.parse(value + "T00:00:00.000Z");
  return !Number.isNaN(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value;
}

export function parseAuditEventDraft(value: unknown): Result<AuditEventDraft, ValidationIssue[]> {
  try {
    if (!isPlainRecord(value)) {
      return err([issue([], "AUDIT_EVENT_MUST_BE_PLAIN_OBJECT")]);
    }

    const { snapshot, issues } = readDataFields(value);
    const action = snapshot.action;
    if (!auditActions.includes(action as AuditAction)) {
      return err([issue(["action"], "AUDIT_ACTION_INVALID")]);
    }
    const parsedAction = action as AuditAction;

    if (!hasExactFields(snapshot, fieldsByAction[parsedAction])) {
      issues.push(issue([], "AUDIT_EVENT_FIELDS_INVALID"));
    }
    if (!isBoundedString(snapshot.academyId, 128)) {
      issues.push(issue(["academyId"], "AUDIT_ACADEMY_ID_INVALID"));
    }
    if (!isBoundedString(snapshot.actorId, 128)) {
      issues.push(issue(["actorId"], "AUDIT_ACTOR_ID_INVALID"));
    }
    if (!isBoundedString(snapshot.targetRef, 512)) {
      issues.push(issue(["targetRef"], "AUDIT_TARGET_REF_INVALID"));
    } else if (
      typeof snapshot.academyId === "string" &&
      !snapshot.targetRef.startsWith(`academies/${snapshot.academyId}/`)
    ) {
      issues.push(issue(["targetRef"], "AUDIT_TARGET_TENANT_MISMATCH"));
    }
    if (!isBoundedString(snapshot.purpose, 256)) {
      issues.push(issue(["purpose"], "AUDIT_PURPOSE_INVALID"));
    }
    if (!isBoundedString(snapshot.correlationId, 256)) {
      issues.push(issue(["correlationId"], "AUDIT_CORRELATION_ID_INVALID"));
    }

    if (parsedAction === "member.detail.read" || parsedAction === "member.identity.lookup") {
      const expectedPurpose =
        parsedAction === "member.detail.read"
          ? "member-record-maintenance"
          : "member-identity-lookup";
      const allowedResults: readonly string[] =
        parsedAction === "member.detail.read"
          ? memberDetailReadAuditResults
          : memberIdentityLookupAuditResults;
      const expectedTarget =
        `academies/${snapshot.academyId as string}/studentRestrictedReadLimits/` +
        (snapshot.actorId as string);
      if (
        typeof snapshot.academyId !== "string" ||
        !safeAuditIdentifierPattern.test(snapshot.academyId) ||
        typeof snapshot.actorId !== "string" ||
        !safeAuditIdentifierPattern.test(snapshot.actorId) ||
        snapshot.targetRef !== expectedTarget ||
        snapshot.purpose !== expectedPurpose ||
        typeof snapshot.correlationId !== "string" ||
        !safeAuditCorrelationPattern.test(snapshot.correlationId)
      ) {
        issues.push(issue([], "AUDIT_MEMBER_READ_SCOPE_INVALID"));
      }
      if (!allowedResults.some((result) => result === snapshot.result)) {
        issues.push(issue(["result"], "AUDIT_MEMBER_READ_RESULT_INVALID"));
      }
    }

    if (parsedAction === "member.created" || parsedAction === "member.updated") {
      const expectedStudentPrefix = `academies/${snapshot.academyId as string}/students/`;
      const studentId =
        typeof snapshot.targetRef === "string" &&
        snapshot.targetRef.startsWith(expectedStudentPrefix)
          ? snapshot.targetRef.slice(expectedStudentPrefix.length)
          : "";
      if (
        !safeAuditIdentifierPattern.test(studentId) ||
        snapshot.purpose !== "member-record-maintenance" ||
        typeof snapshot.correlationId !== "string" ||
        !/^write-[a-f0-9]{64}$/u.test(snapshot.correlationId)
      ) {
        issues.push(issue([], "AUDIT_MEMBER_CREATE_SCOPE_INVALID"));
      }
    }

    if (
      parsedAction === "guardian.profile.created" ||
      parsedAction === "guardian.profile.updated"
    ) {
      const expectedTarget = `academies/${snapshot.academyId as string}/users/${snapshot.actorId as string}`;
      if (
        typeof snapshot.academyId !== "string" ||
        !safeAuditIdentifierPattern.test(snapshot.academyId) ||
        typeof snapshot.actorId !== "string" ||
        !safeAuditIdentifierPattern.test(snapshot.actorId) ||
        snapshot.targetRef !== expectedTarget ||
        snapshot.purpose !== "guardian-profile-maintenance" ||
        typeof snapshot.correlationId !== "string" ||
        !/^guardian-write-[a-f0-9]{64}$/u.test(snapshot.correlationId)
      ) {
        issues.push(issue([], "AUDIT_GUARDIAN_PROFILE_SCOPE_INVALID"));
      }
    }

    if (parsedAction === "family.created" || parsedAction === "family.student.added") {
      const targetCollection = parsedAction === "family.created" ? "families" : "students";
      const expectedTargetPrefix = `academies/${snapshot.academyId as string}/${targetCollection}/`;
      const targetId =
        typeof snapshot.targetRef === "string" &&
        snapshot.targetRef.startsWith(expectedTargetPrefix)
          ? snapshot.targetRef.slice(expectedTargetPrefix.length)
          : "";
      if (
        !safeAuditIdentifierPattern.test(targetId) ||
        snapshot.purpose !== "family-record-maintenance" ||
        typeof snapshot.correlationId !== "string" ||
        !/^family-write-[a-f0-9]{64}$/u.test(snapshot.correlationId)
      ) {
        issues.push(issue([], "AUDIT_FAMILY_WRITE_SCOPE_INVALID"));
      }
    }

    if (
      parsedAction === "level.catalog.published" ||
      parsedAction === "level.catalog.rolled_back"
    ) {
      const expectedTargetPrefix = `academies/${snapshot.academyId as string}/levelSystems/`;
      const systemId =
        typeof snapshot.targetRef === "string" &&
        snapshot.targetRef.startsWith(expectedTargetPrefix)
          ? snapshot.targetRef.slice(expectedTargetPrefix.length)
          : "";
      if (
        !safeAuditIdentifierPattern.test(systemId) ||
        snapshot.purpose !== "level-catalog-maintenance" ||
        typeof snapshot.correlationId !== "string" ||
        !safeAuditCorrelationPattern.test(snapshot.correlationId)
      ) {
        issues.push(issue([], "AUDIT_LEVEL_CATALOG_SCOPE_INVALID"));
      }
    }

    if (
      parsedAction === "level.assessment.recorded" ||
      parsedAction === "level.medical-leave.recorded" ||
      parsedAction === "level.promotion.approved" ||
      parsedAction === "level.promotion.rejected"
    ) {
      const targetCollection =
        parsedAction === "level.assessment.recorded"
          ? "assessments"
          : parsedAction === "level.medical-leave.recorded"
            ? "medicalLeaves"
            : "levelPromotions";
      const expectedPurpose =
        parsedAction === "level.assessment.recorded"
          ? "student-development-assessment"
          : parsedAction === "level.medical-leave.recorded"
            ? "student-medical-leave"
            : "student-level-promotion";
      const expectedTargetPrefix = `academies/${snapshot.academyId as string}/${targetCollection}/`;
      const targetId =
        typeof snapshot.targetRef === "string" &&
        snapshot.targetRef.startsWith(expectedTargetPrefix)
          ? snapshot.targetRef.slice(expectedTargetPrefix.length)
          : "";
      if (
        !safeLevelRecordIdPattern.test(targetId) ||
        snapshot.purpose !== expectedPurpose ||
        typeof snapshot.correlationId !== "string" ||
        !/^level-write-[a-f0-9]{64}$/u.test(snapshot.correlationId)
      ) {
        issues.push(issue([], "AUDIT_LEVEL_WRITE_SCOPE_INVALID"));
      }
    }

    if (parsedAction === "member.import.confirmed") {
      if (!isNonNegativeInteger(snapshot.imported)) {
        issues.push(issue(["imported"], "AUDIT_COUNT_INVALID"));
      }
      if (!isNonNegativeInteger(snapshot.updated)) {
        issues.push(issue(["updated"], "AUDIT_COUNT_INVALID"));
      }
      if (!isNonNegativeInteger(snapshot.conflicts)) {
        issues.push(issue(["conflicts"], "AUDIT_COUNT_INVALID"));
      }
      if (typeof snapshot.sourceHash !== "string" || !sha256Pattern.test(snapshot.sourceHash)) {
        issues.push(issue(["sourceHash"], "AUDIT_HASH_INVALID"));
      }
      if (!validReportKeys(snapshot.reportKeys)) {
        issues.push(issue(["reportKeys"], "AUDIT_REPORT_KEYS_INVALID"));
      }
    }

    if (parsedAction === "regyfit.access.imported") {
      if (
        !isBoundedString(snapshot.importRunId, 128) ||
        !importRunIdPattern.test(snapshot.importRunId)
      ) {
        issues.push(issue(["importRunId"], "AUDIT_IMPORT_RUN_ID_INVALID"));
      }
      if (!isBoundedString(snapshot.moduleKey, 128) || !moduleKeyPattern.test(snapshot.moduleKey)) {
        issues.push(issue(["moduleKey"], "AUDIT_MODULE_KEY_INVALID"));
      }
      if (!validSourceRoute(snapshot.sourceRoute)) {
        issues.push(issue(["sourceRoute"], "AUDIT_SOURCE_ROUTE_INVALID"));
      }
      if (!isNonNegativeInteger(snapshot.recordCount)) {
        issues.push(issue(["recordCount"], "AUDIT_COUNT_INVALID"));
      }
      if (
        typeof snapshot.contentSha256 !== "string" ||
        !sha256Pattern.test(snapshot.contentSha256)
      ) {
        issues.push(issue(["contentSha256"], "AUDIT_HASH_INVALID"));
      }
    }

    if (parsedAction === "retention.alerts.generated") {
      if (
        snapshot.actorId !== "system-retention-producer" ||
        snapshot.purpose !== "daily retention alert production" ||
        !validCalendarDate(snapshot.runDate) ||
        snapshot.targetRef !== `academies/${snapshot.academyId as string}/retentionAlerts` ||
        snapshot.correlationId !==
          `retention-alerts:${snapshot.academyId as string}:${snapshot.runDate as string}`
      ) {
        issues.push(issue([], "AUDIT_RETENTION_SCOPE_INVALID"));
      }
      if (snapshot.policyVersion !== "1") {
        issues.push(issue(["policyVersion"], "AUDIT_RETENTION_POLICY_VERSION_INVALID"));
      }
      if (
        !isNonNegativeInteger(snapshot.evaluatedStudents) ||
        (snapshot.evaluatedStudents as number) > 200 ||
        !isNonNegativeInteger(snapshot.alertCount) ||
        (snapshot.alertCount as number) > 200
      ) {
        issues.push(issue([], "AUDIT_COUNT_INVALID"));
      }
      if (
        !Number.isSafeInteger(snapshot.inactivityDays) ||
        (snapshot.inactivityDays as number) < 1 ||
        (snapshot.inactivityDays as number) > 365 ||
        !Number.isSafeInteger(snapshot.lookbackDays) ||
        (snapshot.lookbackDays as number) < 1 ||
        (snapshot.lookbackDays as number) > 365 ||
        (snapshot.inactivityDays as number) > (snapshot.lookbackDays as number) ||
        !Number.isSafeInteger(snapshot.noShowThreshold) ||
        (snapshot.noShowThreshold as number) < 1 ||
        (snapshot.noShowThreshold as number) > 20 ||
        !Number.isSafeInteger(snapshot.membershipExpiryDays) ||
        (snapshot.membershipExpiryDays as number) < 1 ||
        (snapshot.membershipExpiryDays as number) > 90
      ) {
        issues.push(issue([], "AUDIT_RETENTION_POLICY_INVALID"));
      }
      if (typeof snapshot.sourceHash !== "string" || !sha256Pattern.test(snapshot.sourceHash)) {
        issues.push(issue(["sourceHash"], "AUDIT_HASH_INVALID"));
      }
    }

    if (parsedAction === "family.achievements.generated") {
      const expectedTarget =
        "academies/" +
        (snapshot.academyId as string) +
        "/familyAchievementSnapshots/" +
        (snapshot.familyId as string);
      const expectedCorrelation =
        "family-achievements:" +
        (snapshot.academyId as string) +
        ":" +
        (snapshot.familyId as string) +
        ":" +
        (snapshot.generatedAt as string);
      if (
        !isBoundedString(snapshot.familyId, 128) ||
        !safeAuditIdentifierPattern.test(snapshot.familyId as string) ||
        !isBoundedString(snapshot.snapshotId, 512) ||
        (snapshot.snapshotId as string).includes("/") ||
        snapshot.targetRef !== expectedTarget ||
        snapshot.purpose !== "family achievement snapshot generation" ||
        snapshot.correlationId !== expectedCorrelation ||
        !isBoundedString(snapshot.generatedAt, 64) ||
        !dateTimePattern.test(snapshot.generatedAt as string) ||
        Number.isNaN(Date.parse(snapshot.generatedAt as string)) ||
        !isNonNegativeInteger(snapshot.memberCount) ||
        (snapshot.memberCount as number) > 200 ||
        !isNonNegativeInteger(snapshot.candidateCount) ||
        (snapshot.candidateCount as number) > 200
      ) {
        issues.push(issue([], "AUDIT_FAMILY_ACHIEVEMENT_SCOPE_INVALID"));
      }
    }
    if (parsedAction === "lesson.plan.approved") {
      const expectedTarget =
        "academies/" +
        (snapshot.academyId as string) +
        "/lessonPlans/" +
        (snapshot.planId as string);
      const expectedCorrelation =
        "lesson-plan:" +
        (snapshot.academyId as string) +
        ":" +
        (snapshot.planId as string) +
        ":" +
        (snapshot.approvedAt as string);
      if (
        !isBoundedString(snapshot.planId, 128) ||
        !safeAuditIdentifierPattern.test(snapshot.planId as string) ||
        !isBoundedString(snapshot.libraryId, 128) ||
        !safeAuditIdentifierPattern.test(snapshot.libraryId as string) ||
        !Number.isSafeInteger(snapshot.libraryVersion) ||
        (snapshot.libraryVersion as number) < 1 ||
        snapshot.targetRef !== expectedTarget ||
        snapshot.purpose !== "lesson plan approval" ||
        snapshot.correlationId !== expectedCorrelation ||
        !isBoundedString(snapshot.approvedAt, 64) ||
        !dateTimePattern.test(snapshot.approvedAt as string) ||
        Number.isNaN(Date.parse(snapshot.approvedAt as string))
      ) {
        issues.push(issue([], "AUDIT_LESSON_PLAN_SCOPE_INVALID"));
      }
    }
    if (parsedAction === "report.export.prepared") {
      if (snapshot.scope !== "operational_and_progress_aggregates") {
        issues.push(issue(["scope"], "AUDIT_EXPORT_SCOPE_INVALID"));
      }
      if (snapshot.classification !== "Confidential") {
        issues.push(issue(["classification"], "AUDIT_EXPORT_CLASSIFICATION_INVALID"));
      }
      if (
        !isBoundedString(snapshot.recipient, 134) ||
        !/^actor:[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(snapshot.recipient)
      ) {
        issues.push(issue(["recipient"], "AUDIT_EXPORT_RECIPIENT_INVALID"));
      }
      if (
        typeof snapshot.expiresAt !== "string" ||
        !dateTimePattern.test(snapshot.expiresAt) ||
        Number.isNaN(Date.parse(snapshot.expiresAt))
      ) {
        issues.push(issue(["expiresAt"], "AUDIT_EXPORT_EXPIRY_INVALID"));
      }
      if (
        typeof snapshot.contentSha256 !== "string" ||
        !sha256Pattern.test(snapshot.contentSha256)
      ) {
        issues.push(issue(["contentSha256"], "AUDIT_HASH_INVALID"));
      }
      if (!isPositiveInteger(snapshot.byteLength) || (snapshot.byteLength as number) > 64 * 1024) {
        issues.push(issue(["byteLength"], "AUDIT_EXPORT_SIZE_INVALID"));
      }
    }

    if (
      parsedAction === "invoice.created" ||
      parsedAction === "invoice.voided" ||
      parsedAction === "invoice.status.changed" ||
      parsedAction === "payment.recorded"
    ) {
      if (!isPositiveInteger(snapshot.amountMinor)) {
        issues.push(issue(["amountMinor"], "AUDIT_AMOUNT_INVALID"));
      }
      if (snapshot.currency !== "GBP") {
        issues.push(issue(["currency"], "AUDIT_CURRENCY_INVALID"));
      }
      if (
        parsedAction === "payment.recorded" &&
        !["cash", "bank_transfer", "other"].includes(snapshot.method as string)
      ) {
        issues.push(issue(["method"], "AUDIT_PAYMENT_METHOD_INVALID"));
      }
    }

    if (issues.length > 0) {
      return err(issues);
    }

    const base = {
      academyId: snapshot.academyId as AcademyId,
      actorId: snapshot.actorId as UserId | SystemActorId,
      targetRef: snapshot.targetRef as string,
      purpose: snapshot.purpose as string,
      correlationId: snapshot.correlationId as CorrelationId,
    };
    if (parsedAction === "member.detail.read") {
      return ok(
        Object.freeze({
          ...base,
          action: parsedAction,
          result: snapshot.result as MemberDetailReadAuditResult,
        }),
      );
    }
    if (parsedAction === "member.identity.lookup") {
      return ok(
        Object.freeze({
          ...base,
          action: parsedAction,
          result: snapshot.result as MemberIdentityLookupAuditResult,
        }),
      );
    }
    if (
      parsedAction === "invoice.created" ||
      parsedAction === "invoice.voided" ||
      parsedAction === "invoice.status.changed"
    ) {
      return ok(
        Object.freeze({
          ...base,
          action: parsedAction,
          amountMinor: snapshot.amountMinor as number,
          currency: "GBP" as const,
        }),
      );
    }
    if (parsedAction === "payment.recorded") {
      return ok(
        Object.freeze({
          ...base,
          action: parsedAction,
          amountMinor: snapshot.amountMinor as number,
          currency: "GBP" as const,
          method: snapshot.method as "cash" | "bank_transfer" | "other",
        }),
      );
    }
    if (parsedAction === "member.import.confirmed") {
      return ok(
        Object.freeze({
          ...base,
          action: parsedAction,
          imported: snapshot.imported as number,
          updated: snapshot.updated as number,
          conflicts: snapshot.conflicts as number,
          sourceHash: snapshot.sourceHash as string,
          reportKeys: Object.freeze([...(snapshot.reportKeys as readonly MemberReportKey[])]),
        }),
      );
    }
    if (parsedAction === "regyfit.access.imported") {
      return ok(
        Object.freeze({
          ...base,
          action: parsedAction,
          importRunId: snapshot.importRunId as string,
          moduleKey: snapshot.moduleKey as string,
          sourceRoute: snapshot.sourceRoute as string,
          recordCount: snapshot.recordCount as number,
          contentSha256: snapshot.contentSha256 as string,
        }),
      );
    }
    if (parsedAction === "retention.alerts.generated") {
      return ok(
        Object.freeze({
          ...base,
          action: parsedAction,
          runDate: snapshot.runDate as string,
          policyVersion: "1" as const,
          evaluatedStudents: snapshot.evaluatedStudents as number,
          alertCount: snapshot.alertCount as number,
          inactivityDays: snapshot.inactivityDays as number,
          lookbackDays: snapshot.lookbackDays as number,
          noShowThreshold: snapshot.noShowThreshold as number,
          membershipExpiryDays: snapshot.membershipExpiryDays as number,
          sourceHash: snapshot.sourceHash as string,
        }),
      );
    }
    if (parsedAction === "family.achievements.generated") {
      const expectedTarget =
        "academies/" +
        (snapshot.academyId as string) +
        "/familyAchievementSnapshots/" +
        (snapshot.familyId as string);
      const expectedCorrelation =
        "family-achievements:" +
        (snapshot.academyId as string) +
        ":" +
        (snapshot.familyId as string) +
        ":" +
        (snapshot.generatedAt as string);
      if (
        !isBoundedString(snapshot.familyId, 128) ||
        !safeAuditIdentifierPattern.test(snapshot.familyId as string) ||
        !isBoundedString(snapshot.snapshotId, 512) ||
        (snapshot.snapshotId as string).includes("/") ||
        snapshot.targetRef !== expectedTarget ||
        snapshot.purpose !== "family achievement snapshot generation" ||
        snapshot.correlationId !== expectedCorrelation ||
        !isBoundedString(snapshot.generatedAt, 64) ||
        !dateTimePattern.test(snapshot.generatedAt as string) ||
        Number.isNaN(Date.parse(snapshot.generatedAt as string)) ||
        !isNonNegativeInteger(snapshot.memberCount) ||
        (snapshot.memberCount as number) > 200 ||
        !isNonNegativeInteger(snapshot.candidateCount) ||
        (snapshot.candidateCount as number) > 200
      ) {
        issues.push(issue([], "AUDIT_FAMILY_ACHIEVEMENT_SCOPE_INVALID"));
      }
    }
    if (parsedAction === "family.achievements.generated") {
      return ok(
        Object.freeze({
          ...base,
          action: parsedAction,
          familyId: snapshot.familyId as string,
          snapshotId: snapshot.snapshotId as string,
          memberCount: snapshot.memberCount as number,
          candidateCount: snapshot.candidateCount as number,
          generatedAt: snapshot.generatedAt as string,
        }),
      );
    }
    if (parsedAction === "lesson.plan.approved") {
      return ok(
        Object.freeze({
          ...base,
          action: parsedAction,
          planId: snapshot.planId as string,
          libraryId: snapshot.libraryId as string,
          libraryVersion: snapshot.libraryVersion as number,
          approvedAt: snapshot.approvedAt as string,
        }),
      );
    }
    if (parsedAction === "report.export.prepared") {
      return ok(
        Object.freeze({
          ...base,
          action: parsedAction,
          scope: "operational_and_progress_aggregates" as const,
          classification: "Confidential" as const,
          recipient: snapshot.recipient as string,
          expiresAt: snapshot.expiresAt as string,
          contentSha256: snapshot.contentSha256 as string,
          byteLength: snapshot.byteLength as number,
        }),
      );
    }
    return ok(Object.freeze({ ...base, action: parsedAction }));
  } catch {
    return err([issue([], "AUDIT_EVENT_REFLECTION_FAILED")]);
  }
}
