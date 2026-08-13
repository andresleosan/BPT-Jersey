import { err, ok } from "../result";
import type { ValidationIssue } from "../errors";
import type { Result } from "../result";

export const membershipStatuses = Object.freeze(["active", "inactive", "suspended"] as const);
export type MembershipStatus = (typeof membershipStatuses)[number];

export const paymentStatuses = Object.freeze(["regularized", "notRegularized", "unknown"] as const);
export type PaymentStatus = (typeof paymentStatuses)[number];

export const memberGenders = Object.freeze(["male", "female", "unknown"] as const);
export type MemberGender = (typeof memberGenders)[number];

export const memberOrderByValues = Object.freeze([
  "membershipNumber",
  "name",
  "idCardNumber",
  "gender",
  "email",
  "birthDate",
  "loginTimes",
  "registrationDate",
  "inactiveAt",
] as const);
export type MemberOrderBy = (typeof memberOrderByValues)[number];

export type MemberAuditMetadata = Readonly<{
  academyId: string;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
  schemaVersion: "1";
}>;

export type MemberRecord = Readonly<{
  memberId: string;
  academyId: string;
  membershipNumber?: string;
  fullName: string;
  email?: string;
  idCardNumber?: string;
  vatNumber?: string;
  birthDate?: string;
  mobileNumber?: string;
  frequency?: string;
  paymentStatus: PaymentStatus;
  gender: MemberGender;
  trainingCenter?: string;
  membershipStatus: MembershipStatus;
  inactiveAt?: string;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
  source: string;
  importRunId?: string;
  schemaVersion: "1";
}>;

export type MemberSearchFilters = Readonly<{
  membershipNumber?: string;
  name?: string;
  email?: string;
  idCardNumber?: string;
  vatNumber?: string;
  mobileNumber?: string;
  frequency?: string;
  paymentOrStatus?: PaymentStatus | MembershipStatus;
  gender?: MemberGender;
  trainingCenter?: string;
  orderBy?: MemberOrderBy;
}>;

export const memberReportKeys = Object.freeze([
  "total",
  "active",
  "withNumber",
  "noNumber",
  "inactive",
  "regularized",
  "activeRegularized",
  "suspended",
] as const);
export type MemberReportKey = (typeof memberReportKeys)[number];

export type MemberImportSourceReport = Readonly<{
  source: string;
  report: MemberReportKey;
  rowCount: number;
}>;

export type MemberImportChange = Readonly<{
  stableKey: string;
  rowNumbers: readonly number[];
  fieldNames: readonly string[];
}>;

export type MemberImportPreview = Readonly<{
  previewId: string;
  expiresAt: string;
  sourceReports: readonly MemberImportSourceReport[];
  additions: readonly MemberImportChange[];
  updates: readonly MemberImportChange[];
  duplicates: readonly MemberImportChange[];
  conflicts: readonly MemberImportChange[];
}>;

type RecordValue = Record<string, unknown>;
type Path = readonly (string | number)[];

function isRecord(value: unknown): value is RecordValue {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function addIssue(issues: ValidationIssue[], path: Path, code: string): void {
  issues.push({ path, code });
}

function validateKnownProperties(
  value: RecordValue,
  allowed: readonly string[],
  path: Path,
  issues: ValidationIssue[],
): void {
  for (const property of Object.keys(value)) {
    if (!allowed.includes(property)) {
      addIssue(issues, [...path, property], "unexpected_property");
    }
  }
}

function validateText(value: unknown, path: Path, issues: ValidationIssue[]): string | undefined {
  if (typeof value !== "string") {
    addIssue(issues, path, "invalid_type");
    return undefined;
  }
  if (value.trim().length === 0) {
    addIssue(issues, path, "empty_value");
    return undefined;
  }
  return value;
}

function validateOptionalText(
  value: RecordValue,
  key: string,
  path: Path,
  issues: ValidationIssue[],
): string | undefined {
  if (!Object.prototype.hasOwnProperty.call(value, key)) {
    return undefined;
  }
  return validateText(value[key], [...path, key], issues);
}

function validateOptionalBoundedText(
  value: RecordValue,
  key: string,
  maxLength: number,
  path: Path,
  issues: ValidationIssue[],
): string | undefined {
  const parsed = validateOptionalText(value, key, path, issues);
  if (parsed !== undefined && parsed.length > maxLength)
    addIssue(issues, [...path, key], "max_length");
  return parsed;
}

function validateEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  path: Path,
  issues: ValidationIssue[],
): T | undefined {
  if (typeof value !== "string") {
    addIssue(issues, path, "invalid_type");
    return undefined;
  }
  if (!allowed.includes(value as T)) {
    addIssue(issues, path, "unknown_enum");
    return undefined;
  }
  return value as T;
}

function validateIsoDate(
  value: unknown,
  path: Path,
  issues: ValidationIssue[],
): string | undefined {
  if (typeof value !== "string") {
    addIssue(issues, path, "invalid_type");
    return undefined;
  }

  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const dateTime =
    /^(\d{4})-(\d{2})-(\d{2})T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:?\d{2})$/.exec(value);
  const timestamp = Date.parse(value);
  if ((!dateOnly && !dateTime) || Number.isNaN(timestamp)) {
    addIssue(issues, path, "invalid_iso_date");
    return undefined;
  }
  const dateParts = dateOnly ?? dateTime!;
  const year = Number(dateParts[1]);
  const month = Number(dateParts[2]);
  const day = Number(dateParts[3]);
  const calendarDate = new Date(0);
  calendarDate.setUTCFullYear(year, month - 1, day);
  calendarDate.setUTCHours(0, 0, 0, 0);
  if (
    calendarDate.getUTCFullYear() !== year ||
    calendarDate.getUTCMonth() !== month - 1 ||
    calendarDate.getUTCDate() !== day
  ) {
    addIssue(issues, path, "invalid_iso_date");
    return undefined;
  }
  return value;
}

function parseMemberRecordValue(
  value: unknown,
  issues: ValidationIssue[],
): MemberRecord | undefined {
  if (!isRecord(value)) {
    addIssue(issues, [], "invalid_type");
    return undefined;
  }
  validateKnownProperties(
    value,
    [
      "memberId",
      "academyId",
      "membershipNumber",
      "fullName",
      "email",
      "idCardNumber",
      "vatNumber",
      "birthDate",
      "mobileNumber",
      "frequency",
      "paymentStatus",
      "gender",
      "trainingCenter",
      "membershipStatus",
      "inactiveAt",
      "createdAt",
      "createdBy",
      "updatedAt",
      "updatedBy",
      "source",
      "importRunId",
      "schemaVersion",
    ],
    [],
    issues,
  );

  const memberId = validateText(value.memberId, ["memberId"], issues);
  const academyId = validateText(value.academyId, ["academyId"], issues);
  const fullName = validateText(value.fullName, ["fullName"], issues);
  const email = validateOptionalText(value, "email", [], issues);
  const membershipNumber = validateOptionalText(value, "membershipNumber", [], issues);
  const idCardNumber = validateOptionalText(value, "idCardNumber", [], issues);
  const vatNumber = validateOptionalText(value, "vatNumber", [], issues);
  const mobileNumber = validateOptionalText(value, "mobileNumber", [], issues);
  const frequency = validateOptionalText(value, "frequency", [], issues);
  const trainingCenter = validateOptionalText(value, "trainingCenter", [], issues);
  const birthDate = Object.prototype.hasOwnProperty.call(value, "birthDate")
    ? validateIsoDate(value.birthDate, ["birthDate"], issues)
    : undefined;
  const inactiveAt = Object.prototype.hasOwnProperty.call(value, "inactiveAt")
    ? validateIsoDate(value.inactiveAt, ["inactiveAt"], issues)
    : undefined;
  const paymentStatus = validateEnum(
    value.paymentStatus,
    paymentStatuses,
    ["paymentStatus"],
    issues,
  );
  const gender = validateEnum(value.gender, memberGenders, ["gender"], issues);
  const membershipStatus = validateEnum(
    value.membershipStatus,
    membershipStatuses,
    ["membershipStatus"],
    issues,
  );
  const createdAt = validateIsoDate(value.createdAt, ["createdAt"], issues);
  const createdBy = validateText(value.createdBy, ["createdBy"], issues);
  const updatedAt = validateIsoDate(value.updatedAt, ["updatedAt"], issues);
  const updatedBy = validateText(value.updatedBy, ["updatedBy"], issues);
  const source = validateText(value.source, ["source"], issues);
  const importRunId = validateOptionalBoundedText(value, "importRunId", 128, [], issues);
  const schemaVersion = validateEnum(
    value.schemaVersion,
    ["1"] as const,
    ["schemaVersion"],
    issues,
  );

  if (
    memberId === undefined ||
    academyId === undefined ||
    fullName === undefined ||
    paymentStatus === undefined ||
    gender === undefined ||
    membershipStatus === undefined ||
    createdAt === undefined ||
    createdBy === undefined ||
    updatedAt === undefined ||
    updatedBy === undefined ||
    source === undefined ||
    schemaVersion === undefined
  ) {
    return undefined;
  }

  const parsed: Record<string, unknown> = {
    memberId,
    academyId,
    fullName,
    paymentStatus,
    gender,
    membershipStatus,
    createdAt,
    createdBy,
    updatedAt,
    updatedBy,
    source,
    schemaVersion,
  };
  const optionalFields = {
    membershipNumber,
    email,
    idCardNumber,
    vatNumber,
    birthDate,
    mobileNumber,
    frequency,
    trainingCenter,
    inactiveAt,
    importRunId,
  };
  for (const [key, optionalValue] of Object.entries(optionalFields)) {
    if (optionalValue !== undefined) parsed[key] = optionalValue;
  }
  return Object.freeze(parsed) as MemberRecord;
}

export function parseMemberRecord(
  value: unknown,
): Result<MemberRecord, readonly ValidationIssue[]> {
  const issues: ValidationIssue[] = [];
  const parsed = parseMemberRecordValue(value, issues);
  return issues.length > 0 || parsed === undefined ? err(Object.freeze(issues)) : ok(parsed);
}

export function matchesMemberReport(member: MemberRecord, report: MemberReportKey): boolean {
  switch (report) {
    case "total":
      return true;
    case "active":
      return member.membershipStatus === "active";
    case "withNumber":
      return member.membershipNumber !== undefined;
    case "noNumber":
      return member.membershipNumber === undefined;
    case "inactive":
      return member.membershipStatus === "inactive";
    case "regularized":
      return member.paymentStatus === "regularized";
    case "activeRegularized":
      return member.membershipStatus === "active" && member.paymentStatus === "regularized";
    case "suspended":
      return member.membershipStatus === "suspended";
  }
}

export function parseMemberSearchFilters(
  value: unknown,
): Result<MemberSearchFilters, readonly ValidationIssue[]> {
  const issues: ValidationIssue[] = [];
  if (!isRecord(value)) {
    return err(Object.freeze([{ path: [], code: "invalid_type" }]));
  }
  const fields = [
    "membershipNumber",
    "name",
    "email",
    "idCardNumber",
    "vatNumber",
    "mobileNumber",
    "frequency",
    "paymentOrStatus",
    "gender",
    "trainingCenter",
    "orderBy",
  ] as const;
  validateKnownProperties(value, fields, [], issues);

  const parsed: Record<string, unknown> = {};
  for (const field of [
    "membershipNumber",
    "name",
    "email",
    "idCardNumber",
    "vatNumber",
    "mobileNumber",
    "frequency",
    "trainingCenter",
  ] as const) {
    const fieldValue = validateOptionalText(value, field, [], issues);
    if (fieldValue !== undefined) parsed[field] = fieldValue;
  }
  const paymentOrStatus = Object.prototype.hasOwnProperty.call(value, "paymentOrStatus")
    ? validateEnum(
        value.paymentOrStatus,
        [...paymentStatuses, ...membershipStatuses],
        ["paymentOrStatus"],
        issues,
      )
    : undefined;
  const gender = Object.prototype.hasOwnProperty.call(value, "gender")
    ? validateEnum(value.gender, memberGenders, ["gender"], issues)
    : undefined;
  const orderBy = Object.prototype.hasOwnProperty.call(value, "orderBy")
    ? validateEnum(value.orderBy, memberOrderByValues, ["orderBy"], issues)
    : undefined;
  if (paymentOrStatus !== undefined) parsed.paymentOrStatus = paymentOrStatus;
  if (gender !== undefined) parsed.gender = gender;
  if (orderBy !== undefined) parsed.orderBy = orderBy;

  return issues.length > 0
    ? err(Object.freeze(issues))
    : ok(Object.freeze(parsed) as MemberSearchFilters);
}

function parseImportChange(
  value: unknown,
  path: Path,
  issues: ValidationIssue[],
): MemberImportChange | undefined {
  if (!isRecord(value)) {
    addIssue(issues, path, "invalid_type");
    return undefined;
  }
  validateKnownProperties(value, ["stableKey", "rowNumbers", "fieldNames"], path, issues);
  const stableKey = validateText(value.stableKey, [...path, "stableKey"], issues);
  const rowNumbers = value.rowNumbers;
  const fieldNames = value.fieldNames;
  if (!Array.isArray(rowNumbers)) addIssue(issues, [...path, "rowNumbers"], "invalid_type");
  if (!Array.isArray(fieldNames)) addIssue(issues, [...path, "fieldNames"], "invalid_type");
  const parsedRows: number[] = [];
  if (Array.isArray(rowNumbers)) {
    rowNumbers.forEach((rowNumber, index) => {
      if (!Number.isInteger(rowNumber) || rowNumber < 1) {
        addIssue(issues, [...path, "rowNumbers", index], "invalid_row_number");
      } else {
        parsedRows.push(rowNumber);
      }
    });
  }
  const parsedFields: string[] = [];
  if (Array.isArray(fieldNames)) {
    fieldNames.forEach((fieldName, index) => {
      const parsedField = validateText(fieldName, [...path, "fieldNames", index], issues);
      if (parsedField !== undefined) parsedFields.push(parsedField);
    });
  }
  if (stableKey === undefined || !Array.isArray(rowNumbers) || !Array.isArray(fieldNames))
    return undefined;
  return Object.freeze({
    stableKey,
    rowNumbers: Object.freeze(parsedRows),
    fieldNames: Object.freeze(parsedFields),
  });
}

function parseSourceReport(
  value: unknown,
  path: Path,
  issues: ValidationIssue[],
): MemberImportSourceReport | undefined {
  if (!isRecord(value)) {
    addIssue(issues, path, "invalid_type");
    return undefined;
  }
  validateKnownProperties(value, ["source", "report", "rowCount"], path, issues);
  const source = validateText(value.source, [...path, "source"], issues);
  const report = validateEnum(value.report, memberReportKeys, [...path, "report"], issues);
  if (!Number.isInteger(value.rowCount) || (value.rowCount as number) < 0) {
    addIssue(issues, [...path, "rowCount"], "invalid_row_count");
  }
  if (
    source === undefined ||
    report === undefined ||
    !Number.isInteger(value.rowCount) ||
    (value.rowCount as number) < 0
  ) {
    return undefined;
  }
  return Object.freeze({ source, report, rowCount: value.rowCount as number });
}

export function parseMemberImportPreview(
  value: unknown,
): Result<MemberImportPreview, readonly ValidationIssue[]> {
  const issues: ValidationIssue[] = [];
  if (!isRecord(value)) return err(Object.freeze([{ path: [], code: "invalid_type" }]));
  validateKnownProperties(
    value,
    ["previewId", "expiresAt", "sourceReports", "additions", "updates", "duplicates", "conflicts"],
    [],
    issues,
  );
  const previewId = validateText(value.previewId, ["previewId"], issues);
  const expiresAt = validateIsoDate(value.expiresAt, ["expiresAt"], issues);
  const sourceReports: MemberImportSourceReport[] = [];
  const changeGroups: Record<
    "additions" | "updates" | "duplicates" | "conflicts",
    MemberImportChange[]
  > = {
    additions: [],
    updates: [],
    duplicates: [],
    conflicts: [],
  };
  const sourceReportValues = value.sourceReports;
  if (!Array.isArray(sourceReportValues)) {
    addIssue(issues, ["sourceReports"], "invalid_type");
  } else {
    sourceReportValues.forEach((item, index) => {
      const parsed = parseSourceReport(item, ["sourceReports", index], issues);
      if (parsed) sourceReports.push(parsed);
    });
  }
  for (const group of Object.keys(changeGroups) as Array<keyof typeof changeGroups>) {
    const groupValues = value[group];
    if (!Array.isArray(groupValues)) {
      addIssue(issues, [group], "invalid_type");
      continue;
    }
    groupValues.forEach((item, index) => {
      const parsed = parseImportChange(item, [group, index], issues);
      if (parsed) changeGroups[group].push(parsed);
    });
  }
  if (
    previewId === undefined ||
    expiresAt === undefined ||
    !Array.isArray(sourceReportValues) ||
    issues.length > 0
  ) {
    return err(Object.freeze(issues));
  }
  return ok(
    Object.freeze({
      previewId,
      expiresAt,
      sourceReports: Object.freeze(sourceReports),
      additions: Object.freeze(changeGroups.additions),
      updates: Object.freeze(changeGroups.updates),
      duplicates: Object.freeze(changeGroups.duplicates),
      conflicts: Object.freeze(changeGroups.conflicts),
    }),
  );
}
