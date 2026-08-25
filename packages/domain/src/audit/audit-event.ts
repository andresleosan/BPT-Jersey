import type { ValidationIssue } from "../errors";
import type { AcademyId, CorrelationId, SystemActorId, UserId } from "../identifiers";
import { memberReportKeys, type MemberReportKey } from "../members/member-contracts";
import { err, ok, type Result } from "../result";

export const auditActions = Object.freeze([
  "admin.role.granted",
  "admin.role.revoked",
  "member.import.confirmed",
  "regyfit.access.imported",
  "report.export.prepared",
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
] as const);

export type AuditAction = (typeof auditActions)[number];

type CommonAuditEventDraft = Readonly<{
  academyId: AcademyId;
  actorId: UserId | SystemActorId;
  targetRef: string;
  purpose: string;
  correlationId: CorrelationId;
}>;

export type AuditEventDraft = CommonAuditEventDraft &
  (
    | Readonly<{
        action:
          | "admin.role.granted"
          | "admin.role.revoked"
          | "membership.created"
          | "membership.status.changed"
          | "staff.created"
          | "staff.updated"
          | "staff.status.changed"
          | "staff.availability.replaced"
          | "staff.assignments.replaced";
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
        action: "report.export.prepared";
        scope: "operational_and_progress_aggregates";
        classification: "Confidential";
        recipient: string;
        expiresAt: string;
        contentSha256: string;
        byteLength: number;
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
const fieldsByAction: Readonly<Record<AuditAction, readonly string[]>> = Object.freeze({
  "admin.role.granted": commonFields,
  "admin.role.revoked": commonFields,
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
  "report.export.prepared": Object.freeze([
    ...commonFields,
    "scope",
    "classification",
    "recipient",
    "expiresAt",
    "contentSha256",
    "byteLength",
  ]),
});
const sha256Pattern = /^[a-f0-9]{64}$/u;
const moduleKeyPattern = /^[A-Za-z0-9._-]+$/u;
const importRunIdPattern = /^[A-Za-z0-9._-]+$/u;
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
