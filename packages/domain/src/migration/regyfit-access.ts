import { err, ok } from "../result";
import type { Result } from "../result";
import type { ValidationIssue } from "../errors";
import type { UtcDateTime } from "../time";

export type RegyfitAccessSourceRow = Readonly<{
  sourceId: string;
  member: string;
  memberNumber: string | null;
  loginCount: number;
  lastLogin: string | null;
  ip: string;
}>;

export type RegyfitAccessRecord = Readonly<{
  academyId: string;
  sourceSystem: "regyfit";
  sourceId: string;
  memberDisplayName: string;
  memberNumber: string | null;
  loginCount: number;
  lastLoginAt: UtcDateTime | null;
  ip: string;
  importRunId: string;
  capturedAt: UtcDateTime;
  schemaVersion: "1";
}>;

type AccessContext = Readonly<{
  academyId: string;
  importRunId: string;
  capturedAt: UtcDateTime;
}>;

type Path = readonly (string | number)[];
type RecordValue = Record<string, unknown>;

const sourceFields = ["sourceId", "member", "memberNumber", "loginCount", "lastLogin", "ip"];
const contextFields = ["academyId", "importRunId", "capturedAt"];
const envelopeFields = [
  "runId",
  "sourceSystem",
  "sourceId",
  "moduleKey",
  "capturedAtUtc",
  "record",
];
const envelopeRecordFields = ["member", "memberNumber", "logins", "lastLogin", "ip"];
const unsafeValuePattern =
  /(?:password|passwd|token|secret|api[_-]?key|credential|private[_-]?key)\s*[:=]/i;
const localDatePattern =
  /^(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),\s+(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{4})\s+-\s+(\d{2}):(\d{2})$/;
const monthNumbers = new Map([
  ["Jan", 0],
  ["Feb", 1],
  ["Mar", 2],
  ["Apr", 3],
  ["May", 4],
  ["Jun", 5],
  ["Jul", 6],
  ["Aug", 7],
  ["Sep", 8],
  ["Oct", 9],
  ["Nov", 10],
  ["Dec", 11],
]);

function isRecord(value: unknown): value is RecordValue {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPlainRecord(value: unknown): value is RecordValue {
  return isRecord(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function issue(path: Path, code: string): ValidationIssue {
  return { path, code };
}

function hasOnlyKnownProperties(
  value: RecordValue,
  allowed: readonly string[],
  issues: ValidationIssue[],
) {
  for (const property of Reflect.ownKeys(value)) {
    if (typeof property !== "string" || !allowed.includes(property)) {
      issues.push(
        issue([typeof property === "string" ? property : "unknown"], "unexpected_property"),
      );
    }
  }
}

function nonEmptyText(value: unknown, path: Path, issues: ValidationIssue[]): string | undefined {
  if (typeof value !== "string") {
    issues.push(issue(path, "invalid_type"));
    return undefined;
  }
  const text = value.trim();
  if (text.length === 0) {
    issues.push(issue(path, "empty_value"));
    return undefined;
  }
  if (unsafeValuePattern.test(text)) {
    issues.push(issue(path, "unsafe_value"));
    return undefined;
  }
  return text;
}

function optionalText(
  value: unknown,
  path: Path,
  issues: ValidationIssue[],
): string | null | undefined {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") {
    issues.push(issue(path, "invalid_type"));
    return undefined;
  }
  const text = value.trim();
  if (text.length === 0) return null;
  if (unsafeValuePattern.test(text)) {
    issues.push(issue(path, "unsafe_value"));
    return undefined;
  }
  return text;
}

function opaqueNonEmptyText(
  value: unknown,
  path: Path,
  issues: ValidationIssue[],
): string | undefined {
  if (typeof value !== "string") {
    issues.push(issue(path, "invalid_type"));
    return undefined;
  }
  if (value.trim().length === 0) {
    issues.push(issue(path, "empty_value"));
    return undefined;
  }
  if (unsafeValuePattern.test(value)) {
    issues.push(issue(path, "unsafe_value"));
    return undefined;
  }
  return value;
}

function normalizeUtcDateTime(
  value: unknown,
  path: Path,
  issues: ValidationIssue[],
): UtcDateTime | undefined {
  if (typeof value !== "string") {
    issues.push(issue(path, "invalid_type"));
    return undefined;
  }

  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?Z$/.exec(value);
  const timestamp = Date.parse(value);
  if (!match || Number.isNaN(timestamp)) {
    issues.push(issue(path, "invalid_utc_datetime"));
    return undefined;
  }

  const milliseconds = Number(`${match[7] ?? ""}000`.slice(0, 3));
  const parsed = new Date(timestamp);
  const matchesUtcComponents =
    parsed.getUTCFullYear() === Number(match[1]) &&
    parsed.getUTCMonth() === Number(match[2]) - 1 &&
    parsed.getUTCDate() === Number(match[3]) &&
    parsed.getUTCHours() === Number(match[4]) &&
    parsed.getUTCMinutes() === Number(match[5]) &&
    parsed.getUTCSeconds() === Number(match[6]) &&
    parsed.getUTCMilliseconds() === milliseconds;
  if (!matchesUtcComponents) {
    issues.push(issue(path, "invalid_utc_datetime"));
    return undefined;
  }
  return parsed.toISOString() as UtcDateTime;
}

function jerseyDateParts(timestamp: number): Record<string, number> {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Jersey",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZoneName: "shortOffset",
  })
    .formatToParts(new Date(timestamp))
    .filter((part) => part.type !== "literal" && part.type !== "timeZoneName")
    .reduce<Record<string, number>>((parts, part) => {
      parts[part.type] = Number(part.value);
      return parts;
    }, {});
}

function jerseyOffsetMinutes(timestamp: number): number | undefined {
  const offset = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Jersey",
    timeZoneName: "shortOffset",
  })
    .formatToParts(new Date(timestamp))
    .find((part) => part.type === "timeZoneName")?.value;
  if (offset === "GMT") return 0;
  const match = /^GMT([+-])(\d{1,2})(?::?(\d{2}))?$/.exec(offset ?? "");
  if (!match) return undefined;
  const minutes = Number(match[2]) * 60 + Number(match[3] ?? 0);
  return match[1] === "+" ? minutes : -minutes;
}

function normalizeObservedDate(
  value: unknown,
  path: Path,
  issues: ValidationIssue[],
): string | null | undefined {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") {
    issues.push(issue(path, "invalid_type"));
    return undefined;
  }
  const text = value.trim();
  if (text.length === 0) return null;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(text)) {
    return normalizeUtcDateTime(text, path, issues);
  }
  const match = localDatePattern.exec(text);
  const month = match ? monthNumbers.get(match[2] as string) : undefined;
  if (!match || month === undefined) {
    issues.push(issue(path, "invalid_utc_datetime"));
    return undefined;
  }
  const day = Number(match[1]);
  const year = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const localAsUtc = Date.UTC(year, month, day, hour, minute);
  const offsetMinutes = jerseyOffsetMinutes(localAsUtc);
  if (offsetMinutes === undefined) {
    issues.push(issue(path, "invalid_utc_datetime"));
    return undefined;
  }
  const timestamp = localAsUtc - offsetMinutes * 60_000;
  const parts = jerseyDateParts(timestamp);
  if (
    parts.year !== year ||
    parts.month !== month + 1 ||
    parts.day !== day ||
    parts.hour !== hour ||
    parts.minute !== minute
  ) {
    issues.push(issue(path, "invalid_utc_datetime"));
    return undefined;
  }
  return new Date(timestamp).toISOString();
}

function normalizeLoginCount(
  value: unknown,
  path: Path,
  issues: ValidationIssue[],
): number | undefined {
  const text = typeof value === "string" ? value.trim() : value;
  if (
    (typeof text === "number" && Number.isSafeInteger(text) && text >= 0) ||
    (typeof text === "string" && /^\d+$/.test(text) && Number.isSafeInteger(Number(text)))
  ) {
    return Number(text);
  }
  issues.push(issue(path, "invalid_type"));
  return undefined;
}

function isValidIpv4(value: string): boolean {
  const octets = value.split(".");
  return (
    octets.length === 4 &&
    octets.every((octet) => /^(?:0|[1-9]\d{0,2})$/.test(octet) && Number(octet) <= 255)
  );
}

function isValidIp(value: unknown, path: Path, issues: ValidationIssue[]): string | undefined {
  if (typeof value !== "string") {
    issues.push(issue(path, "invalid_type"));
    return undefined;
  }
  if (!isValidIpv4(value)) {
    issues.push(issue(path, "invalid_ip"));
    return undefined;
  }
  return value;
}

export function mapRegyfitAccessRow(
  row: unknown,
  context: AccessContext,
): Result<RegyfitAccessRecord, ValidationIssue[]> {
  const issues: ValidationIssue[] = [];
  if (!isPlainRecord(row)) {
    return err([issue([], "invalid_type")]);
  }
  hasOnlyKnownProperties(row, sourceFields, issues);

  const sourceId = opaqueNonEmptyText(row.sourceId, ["sourceId"], issues);
  const member = nonEmptyText(row.member, ["member"], issues);
  const memberNumber = optionalText(row.memberNumber, ["memberNumber"], issues);
  const loginCount =
    typeof row.loginCount === "number" &&
    Number.isSafeInteger(row.loginCount) &&
    row.loginCount >= 0
      ? row.loginCount
      : undefined;
  if (loginCount === undefined) {
    issues.push(issue(["loginCount"], "invalid_type"));
  }
  const lastLoginAt =
    row.lastLogin === null ? null : normalizeUtcDateTime(row.lastLogin, ["lastLogin"], issues);
  const ip = isValidIp(row.ip, ["ip"], issues);

  if (!isRecord(context)) {
    return err([...issues, issue(["context"], "invalid_type")]);
  }
  hasOnlyKnownProperties(context, contextFields, issues);
  const academyId = nonEmptyText(context.academyId, ["context", "academyId"], issues);
  const importRunId = nonEmptyText(context.importRunId, ["context", "importRunId"], issues);
  const capturedAt = normalizeUtcDateTime(context.capturedAt, ["context", "capturedAt"], issues);

  if (
    issues.length > 0 ||
    sourceId === undefined ||
    member === undefined ||
    memberNumber === undefined ||
    loginCount === undefined ||
    lastLoginAt === undefined ||
    ip === undefined ||
    academyId === undefined ||
    importRunId === undefined ||
    capturedAt === undefined
  ) {
    return err(issues);
  }

  return ok(
    Object.freeze({
      academyId,
      sourceSystem: "regyfit" as const,
      sourceId,
      memberDisplayName: member,
      memberNumber,
      loginCount,
      lastLoginAt,
      ip,
      importRunId,
      capturedAt,
      schemaVersion: "1" as const,
    }),
  );
}

export function normalizeRegyfitAccessEnvelope(
  value: unknown,
  expected: Readonly<{ runId: string; moduleKey: string }>,
): Result<RegyfitAccessSourceRow, ValidationIssue[]> {
  const issues: ValidationIssue[] = [];
  if (!isPlainRecord(value)) return err([issue([], "invalid_type")]);
  hasOnlyKnownProperties(value, envelopeFields, issues);
  const runId = nonEmptyText(value.runId, ["runId"], issues);
  const sourceSystem = value.sourceSystem;
  if (sourceSystem !== "regyfit") issues.push(issue(["sourceSystem"], "invalid_value"));
  const sourceId = opaqueNonEmptyText(value.sourceId, ["sourceId"], issues);
  const moduleKey = nonEmptyText(value.moduleKey, ["moduleKey"], issues);
  if (runId !== expected.runId) issues.push(issue(["runId"], "unexpected_value"));
  if (moduleKey !== expected.moduleKey) issues.push(issue(["moduleKey"], "unexpected_value"));
  normalizeUtcDateTime(value.capturedAtUtc, ["capturedAtUtc"], issues);

  const record = value.record;
  if (!isPlainRecord(record)) {
    issues.push(issue(["record"], "invalid_type"));
  } else {
    hasOnlyKnownProperties(record, envelopeRecordFields, issues);
  }
  const member =
    record && isPlainRecord(record)
      ? nonEmptyText(record.member, ["record", "member"], issues)
      : undefined;
  const memberNumber =
    record && isPlainRecord(record)
      ? optionalText(record.memberNumber, ["record", "memberNumber"], issues)
      : undefined;
  const loginCount =
    record && isPlainRecord(record)
      ? normalizeLoginCount(record.logins, ["record", "logins"], issues)
      : undefined;
  const lastLogin =
    record && isPlainRecord(record)
      ? normalizeObservedDate(record.lastLogin, ["record", "lastLogin"], issues)
      : undefined;
  const ip =
    record && isPlainRecord(record) ? isValidIp(record.ip, ["record", "ip"], issues) : undefined;

  if (
    issues.length > 0 ||
    sourceId === undefined ||
    member === undefined ||
    memberNumber === undefined ||
    loginCount === undefined ||
    lastLogin === undefined ||
    ip === undefined
  ) {
    return err(issues);
  }
  return ok({ sourceId, member, memberNumber, loginCount, lastLogin, ip });
}

export function toSafeRegyfitAccessProjection(
  record: RegyfitAccessRecord,
): Omit<RegyfitAccessRecord, "ip"> {
  return Object.freeze({
    academyId: record.academyId,
    sourceSystem: record.sourceSystem,
    sourceId: record.sourceId,
    memberDisplayName: record.memberDisplayName,
    memberNumber: record.memberNumber,
    loginCount: record.loginCount,
    lastLoginAt: record.lastLoginAt,
    importRunId: record.importRunId,
    capturedAt: record.capturedAt,
    schemaVersion: record.schemaVersion,
  });
}

export function toRestrictedRegyfitAccessProjection(
  record: RegyfitAccessRecord,
): RegyfitAccessRecord {
  return record;
}

export function assertUniqueSourceIds(records: readonly RegyfitAccessRecord[]): void {
  const sourceIds = new Set<string>();
  for (const record of records) {
    if (sourceIds.has(record.sourceId)) {
      throw new Error("Duplicate Regyfit source ID");
    }
    sourceIds.add(record.sourceId);
  }
}
