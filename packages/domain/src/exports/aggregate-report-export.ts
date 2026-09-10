import type { ValidationIssue } from "../errors";
import type { ProgressReport } from "../levels/level-contracts";
import {
  parseOperationalReportQuery,
  type OperationalReport,
  type OperationalReportQuery,
} from "../reports/operational-report";
import { err, ok, type Result } from "../result";

export const aggregateReportExportPurposes = Object.freeze([
  "pilot_operations_review",
  "internal_finance_reconciliation",
  "pilot_progress_review",
] as const);
export type AggregateReportExportPurpose = (typeof aggregateReportExportPurposes)[number];

export const aggregateReportExportScope = "operational_and_progress_aggregates" as const;
export const aggregateReportExportClassification = "Confidential" as const;
export const aggregateReportExportContentType = "text/csv;charset=utf-8" as const;
export const MAX_AGGREGATE_REPORT_EXPORT_BYTES = 64 * 1024;

export type AggregateReportExportRequest = OperationalReportQuery &
  Readonly<{ purpose: AggregateReportExportPurpose }>;

export type AggregateReportExportResponse = Readonly<{
  exportId: string;
  fileName: string;
  contentType: typeof aggregateReportExportContentType;
  content: string;
  byteLength: number;
  contentSha256: string;
  expiresAt: string;
  purpose: AggregateReportExportPurpose;
  scope: typeof aggregateReportExportScope;
  classification: typeof aggregateReportExportClassification;
  query: OperationalReportQuery;
}>;

type CsvCell = string | number;

const safeIdentifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const safeFileNamePattern = /^bpt-aggregate-report-\d{4}-\d{2}-\d{2}-to-\d{4}-\d{2}-\d{2}\.csv$/u;
const sha256Pattern = /^[a-f0-9]{64}$/u;
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

function isIsoDateTime(value: unknown): value is string {
  return (
    typeof value === "string" && dateTimePattern.test(value) && !Number.isNaN(Date.parse(value))
  );
}

export function parseAggregateReportExportRequest(
  value: unknown,
): Result<AggregateReportExportRequest, readonly ValidationIssue[]> {
  if (!isPlainRecord(value)) {
    return err(Object.freeze([issue([], "EXPORT_REQUEST_MUST_BE_PLAIN_OBJECT")]));
  }
  if (!hasExactFields(value, ["from", "to", "purpose"])) {
    return err(Object.freeze([issue([], "EXPORT_REQUEST_FIELDS_INVALID")]));
  }
  const reportQuery = parseOperationalReportQuery({ from: value.from, to: value.to });
  const issues: ValidationIssue[] = reportQuery.ok ? [] : [issue(["query"], reportQuery.error)];
  if (!aggregateReportExportPurposes.includes(value.purpose as AggregateReportExportPurpose)) {
    issues.push(issue(["purpose"], "EXPORT_PURPOSE_INVALID"));
  }
  if (issues.length > 0 || !reportQuery.ok) return err(Object.freeze(issues));
  return ok(
    Object.freeze({
      ...reportQuery.value,
      purpose: value.purpose as AggregateReportExportPurpose,
    }),
  );
}

function spreadsheetSafe(value: CsvCell): string {
  const raw = String(value);
  return /^[\t\r\n ]*[=+\-@]/u.test(raw) ? "'" + raw : raw;
}

function csvCell(value: CsvCell): string {
  const safe = spreadsheetSafe(value);
  return /[",\r\n]/u.test(safe) ? '"' + safe.replaceAll('"', '""') + '"' : safe;
}

function csvRow(...cells: readonly CsvCell[]): string {
  return cells.map(csvCell).join(",");
}

export function buildAggregateReportCsv(options: {
  operational: OperationalReport;
  progress: ProgressReport;
}): string {
  const { operational, progress } = options;
  const rows: string[] = [csvRow("section", "metric", "segment", "value", "unit")];
  const add = (section: string, metric: string, segment: string, value: CsvCell, unit: string) => {
    rows.push(csvRow(section, metric, segment, value, unit));
  };

  add("metadata", "range_from", "all", operational.query.from, "iso_datetime");
  add("metadata", "range_to", "all", operational.query.to, "iso_datetime");
  add("metadata", "operational_calculated_at", "all", operational.calculatedAt, "iso_datetime");
  add("metadata", "progress_calculated_at", "all", progress.calculatedAt, "iso_datetime");

  for (const [metric, value] of Object.entries(operational.students)) {
    add("students", metric, "all", value, "count");
  }
  for (const [metric, value] of Object.entries(operational.attendance)) {
    add(
      "attendance",
      metric,
      "selected_period",
      value,
      metric === "attendanceRatePercentage" ? "percentage" : "count",
    );
  }
  for (const [metric, value] of Object.entries(operational.memberships)) {
    add("memberships", metric, "current", value, "count");
  }
  for (const [metric, value] of Object.entries(operational.revenue)) {
    if (metric === "paymentsByMethod" || metric === "currency") continue;
    add(
      "revenue",
      metric,
      "selected_period",
      value as number,
      metric.endsWith("Minor") ? "GBP_minor" : "count",
    );
  }
  for (const [method, count] of Object.entries(operational.revenue.paymentsByMethod)) {
    add("revenue", "paymentsByMethod", method, count, "count");
  }

  for (const metric of [
    "activeStudentCount",
    "assessedStudentCount",
    "unassessedStudentCount",
    "totalEvaluationCount",
    "assessmentCoveragePercentage",
    "recognitionCandidateCount",
    "eligibleForPromotionCount",
  ] as const) {
    add(
      "progress",
      metric,
      "current",
      progress[metric],
      metric === "assessmentCoveragePercentage" ? "percentage" : "count",
    );
  }
  for (const level of progress.levelBreakdown) {
    add("progress_level", "studentCount", level.definitionName, level.studentCount, "count");
    add(
      "progress_level",
      "assessedStudentCount",
      level.definitionName,
      level.assessedStudentCount,
      "count",
    );
    add(
      "progress_level",
      "eligibleForPromotionCount",
      level.definitionName,
      level.eligibleForPromotionCount,
      "count",
    );
  }
  for (const skill of progress.skillCoverage) {
    add(
      "progress_skill",
      "assessedStudentCount",
      skill.displayLabel,
      skill.assessedStudentCount,
      "count",
    );
    add(
      "progress_skill",
      "coveragePercentage",
      skill.displayLabel,
      skill.coveragePercentage,
      "percentage",
    );
  }

  return rows.join("\r\n") + "\r\n";
}

export function aggregateReportExportFileName(query: OperationalReportQuery): string {
  return (
    "bpt-aggregate-report-" + query.from.slice(0, 10) + "-to-" + query.to.slice(0, 10) + ".csv"
  );
}

export function isAggregateReportExportResponse(
  value: unknown,
): value is AggregateReportExportResponse {
  if (!isPlainRecord(value)) return false;
  if (
    !hasExactFields(value, [
      "exportId",
      "fileName",
      "contentType",
      "content",
      "byteLength",
      "contentSha256",
      "expiresAt",
      "purpose",
      "scope",
      "classification",
      "query",
    ])
  ) {
    return false;
  }
  if (
    typeof value.exportId !== "string" ||
    !safeIdentifierPattern.test(value.exportId) ||
    typeof value.fileName !== "string" ||
    !safeFileNamePattern.test(value.fileName) ||
    value.contentType !== aggregateReportExportContentType ||
    typeof value.content !== "string" ||
    !value.content.startsWith("section,metric,segment,value,unit\r\n") ||
    typeof value.byteLength !== "number" ||
    !Number.isSafeInteger(value.byteLength) ||
    value.byteLength <= 0 ||
    value.byteLength > MAX_AGGREGATE_REPORT_EXPORT_BYTES ||
    new TextEncoder().encode(value.content).byteLength !== value.byteLength ||
    typeof value.contentSha256 !== "string" ||
    !sha256Pattern.test(value.contentSha256) ||
    !isIsoDateTime(value.expiresAt) ||
    !aggregateReportExportPurposes.includes(value.purpose as AggregateReportExportPurpose) ||
    value.scope !== aggregateReportExportScope ||
    value.classification !== aggregateReportExportClassification
  ) {
    return false;
  }
  const parsedQuery = parseOperationalReportQuery(value.query);
  return parsedQuery.ok && value.fileName === aggregateReportExportFileName(parsedQuery.value);
}
