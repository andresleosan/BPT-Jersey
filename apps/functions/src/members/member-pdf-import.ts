import { createHash } from "node:crypto";

import type { MemberReportKey } from "@bpt-jersey/domain";

export type ParsedMemberRow = Readonly<{
  sourceReport: MemberReportKey;
  sourceRowNumber: number;
  membershipNumber?: string;
  fullName: string;
  email?: string;
  idCardNumber?: string;
  birthDate?: string;
  vatNumber?: string;
  mobileNumber?: string;
  inactiveAt?: string;
  membershipStatus?: "active" | "inactive" | "suspended";
  paymentStatus?: "regularized";
}>;

export type ParsedMemberReport = Readonly<{
  report: MemberReportKey;
  declaredCount: number;
  rows: readonly ParsedMemberRow[];
  sourceHash: string;
}>;

export type ImportDuplicate = Readonly<{
  kind: "duplicate" | "conflict";
  stableKey: string;
  sourceRows: readonly string[];
  fields?: readonly string[];
}>;

export class MemberPdfImportLimitError extends Error {
  constructor() {
    super("Member PDF import row limit exceeded");
    this.name = "MemberPdfImportLimitError";
  }
}

type ReportDefinition = Readonly<{
  report: MemberReportKey;
  titlePatterns: readonly RegExp[];
  status?: "active" | "inactive" | "suspended";
  regularized: boolean;
}>;

const exportedEnglishHeaderTitles = new Set([
  "atletas ativos regularizados",
  "atletas ativos com numero de socio",
  "atletas ativos sem numero de socio",
  "atletas regularizados",
  "suspensos",
  "total de atletas na base de dados",
]);

const reportDefinitions: readonly ReportDefinition[] = [
  {
    report: "activeRegularized",
    titlePatterns: [
      /^active regularized members? in database \((\d+)\)$/,
      /^atletas ativos com pagamentos regularizados na base de dados \((\d+)\)$/,
      /^atletas ativos regularizados \((\d+)\)$/,
    ],
    status: "active",
    regularized: true,
  },
  {
    report: "regularized",
    titlePatterns: [
      /^regularized members? in database \((\d+)\)$/,
      /^atletas com pagamentos regularizados na base de dados \((\d+)\)$/,
      /^atletas regularizados \((\d+)\)$/,
    ],
    regularized: true,
  },
  {
    report: "withNumber",
    titlePatterns: [
      /^members? with member number in database \((\d+)\)$/,
      /^atletas com numero de socio na base de dados \((\d+)\)$/,
      /^atletas ativos com numero de socio \((\d+)\)$/,
    ],
    regularized: false,
  },
  {
    report: "noNumber",
    titlePatterns: [
      /^members? without member number in database \((\d+)\)$/,
      /^atletas sem numero de socio na base de dados \((\d+)\)$/,
      /^atletas ativos sem numero de socio \((\d+)\)$/,
    ],
    regularized: false,
  },
  {
    report: "inactive",
    titlePatterns: [
      /^inactive members? in database \((\d+)\)$/,
      /^atletas inativos na base de dados \((\d+)\)$/,
      /^inactive members? \((\d+)\)$/,
    ],
    status: "inactive",
    regularized: false,
  },
  {
    report: "suspended",
    titlePatterns: [
      /^suspended members? in database \((\d+)\)$/,
      /^atletas suspensos na base de dados \((\d+)\)$/,
      /^suspensos \((\d+)\)$/,
    ],
    status: "suspended",
    regularized: false,
  },
  {
    report: "active",
    titlePatterns: [
      /^active members? in database \((\d+)\)$/,
      /^atletas ativos na base de dados \((\d+)\)$/,
      /^active members? \((\d+)\)$/,
    ],
    status: "active",
    regularized: false,
  },
  {
    report: "total",
    titlePatterns: [
      /^total members? in database \((\d+)\)$/,
      /^total de atletas na base de dados \((\d+)\)$/,
    ],
    regularized: false,
  },
];

const monthNumbers: Readonly<Record<string, string>> = Object.freeze({
  jan: "01",
  feb: "02",
  mar: "03",
  apr: "04",
  may: "05",
  jun: "06",
  jul: "07",
  aug: "08",
  sep: "09",
  oct: "10",
  nov: "11",
  dec: "12",
});
const namedEntities: Readonly<Record<string, string>> = Object.freeze({
  amp: "&",
  apos: "'",
  eacute: "é",
  Eacute: "É",
  gt: ">",
  lt: "<",
  nbsp: " ",
  quot: '"',
});
const footerPattern =
  /^document produced by www\.regyfit\.com on \d{2}-\d{2}-\d{4} at \d{2}:\d{2} page \d+\/\d+$/i;

function cleanText(value: string): string {
  return decodeHtmlEntities(value)
    .replace(/[\u0000-\u001f\u007f]/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
}

function normalizeForMatching(value: string): string {
  return cleanText(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLocaleLowerCase("en-US");
}

function decodeHtmlEntities(value: string): string {
  return value.replace(
    /&(?:#(\d+)|#x([\da-f]+)|([a-z]+));/giu,
    (entity, decimal, hexadecimal, named) => {
      if (decimal !== undefined) return codePointToString(Number(decimal));
      if (hexadecimal !== undefined) return codePointToString(Number.parseInt(hexadecimal, 16));
      return namedEntities[named.toLocaleLowerCase("en-US")] ?? entity;
    },
  );
}

function codePointToString(value: number): string {
  return Number.isInteger(value) && value >= 0 && value <= 0x10ffff
    ? String.fromCodePoint(value)
    : "";
}

function definitionForReport(report: MemberReportKey): ReportDefinition {
  const definition = reportDefinitions.find((candidate) => candidate.report === report);
  if (definition === undefined) throw new Error(`Unsupported member report: ${report}`);
  return definition;
}

function titleMatch(text: string):
  | Readonly<{
      definition: ReportDefinition;
      count: number;
      language: "english" | "portuguese";
      exportedEnglishHeader: boolean;
    }>
  | undefined {
  const normalized = normalizeForMatching(text);
  for (const definition of reportDefinitions) {
    for (const pattern of definition.titlePatterns) {
      const match = pattern.exec(normalized);
      if (match !== null) {
        return {
          definition,
          count: Number(match[1]),
          language:
            normalized.includes("atletas") || normalized.includes("suspensos")
              ? "portuguese"
              : "english",
          exportedEnglishHeader: exportedEnglishHeaderTitles.has(
            normalized.replace(/ \(\d+\)$/u, ""),
          ),
        };
      }
    }
  }
  return undefined;
}

export function identifyMemberReport(text: string): MemberReportKey {
  const firstLine =
    text
      .split(/\r?\n/u)
      .map(cleanText)
      .find((line) => line.length > 0) ?? "";
  const match = titleMatch(firstLine);
  if (match === undefined) throw new Error("Unknown or unsupported member report title");
  return match.definition.report;
}

function headerLanguage(line: string): "english" | "portuguese" | undefined {
  const normalized = normalizeForMatching(line);
  if (
    normalized === "member no | name | id card no | birthdate | vat number | mobile no" ||
    normalized ===
      "member no | name | id card no | birthdate | vat number | mobile no | data inativo"
  )
    return "english";
  if (
    normalized ===
      "numero de socio | nome | id card no | data de nascimento | numero de contribuinte | telemovel" ||
    normalized ===
      "numero de socio | nome | id card no | data de nascimento | numero de contribuinte | telemovel | data inativo"
  )
    return "portuguese";
  return undefined;
}

function isInactiveHeader(line: string): boolean {
  return (
    headerLanguage(line) !== undefined && normalizeForMatching(line).endsWith("| data inativo")
  );
}

function splitRow(line: string): string[] {
  return line.split("|").map(cleanText);
}

function parseDate(value: string, field: string): string | undefined {
  const cleaned = cleanText(value);
  if (cleaned.length === 0) return undefined;
  const match = /^(\d{2}) ([a-z]{3}) (\d{4})$/iu.exec(cleaned);
  if (match === null) throw new Error(`Invalid ${field} date`);
  const [, dayText, monthText, yearText] = match;
  if (dayText === undefined || monthText === undefined || yearText === undefined) {
    throw new Error(`Invalid ${field} date`);
  }
  const month = monthNumbers[monthText.toLocaleLowerCase("en-US")];
  if (month === undefined) throw new Error(`Invalid ${field} date`);
  const day = Number(dayText);
  const year = Number(yearText);
  const candidate = `${year}-${month}-${dayText}`;
  const date = new Date(`${candidate}T00:00:00.000Z`);
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() + 1 !== Number(month) ||
    date.getUTCDate() !== day
  ) {
    throw new Error(`Invalid ${field} date`);
  }
  return candidate;
}

function rowFromColumns(
  report: MemberReportKey,
  rowNumber: number,
  values: readonly string[],
  hasInactiveDate: boolean,
): ParsedMemberRow {
  const expectedLength = hasInactiveDate ? 7 : 6;
  if (values.length !== expectedLength) throw new Error("Invalid member row column count");
  const [membershipNumber, fullName, idCardNumber, birthDate, vatNumber, mobileNumber, inactiveAt] =
    values;
  if (fullName === undefined || fullName.length === 0) throw new Error("Invalid member row name");
  if (
    membershipNumber !== undefined &&
    membershipNumber.length > 0 &&
    !/^[a-z\d][a-z\d ./-]*$/iu.test(membershipNumber)
  ) {
    throw new Error("Invalid membership number");
  }
  const definition = definitionForReport(report);
  const row: Record<string, unknown> = {
    sourceReport: report,
    sourceRowNumber: rowNumber,
    fullName,
  };
  if (definition.status !== undefined) row.membershipStatus = definition.status;
  const optionalValues = {
    membershipNumber,
    idCardNumber,
    birthDate: parseDate(birthDate ?? "", "birth"),
    vatNumber,
    mobileNumber,
    inactiveAt: parseDate(inactiveAt ?? "", "inactive"),
  };
  for (const [key, value] of Object.entries(optionalValues)) {
    if (value !== undefined && value !== "undefined" && value.length > 0) row[key] = value;
  }
  if (definition.regularized) row.paymentStatus = "regularized";
  return Object.freeze(row) as ParsedMemberRow;
}

function extractRows(
  lines: readonly string[],
  report: MemberReportKey,
  hasInactiveDate: boolean,
  maxRows = Number.POSITIVE_INFINITY,
): ParsedMemberRow[] {
  const rows: ParsedMemberRow[] = [];
  let pending: string[] | undefined;
  let sourceRowNumber = 0;
  for (const rawLine of lines) {
    const line = cleanText(rawLine);
    if (
      line.length === 0 ||
      headerLanguage(line) !== undefined ||
      footerPattern.test(line) ||
      titleMatch(line) !== undefined
    )
      continue;
    if (!line.includes("|")) throw new Error("Invalid member row layout");
    const values = splitRow(line);
    if (pending !== undefined) {
      const remainingColumns = (hasInactiveDate ? 7 : 6) - pending.length;
      if (values.length > remainingColumns) throw new Error("Invalid continued member row columns");
      const merged = pending.concat(values);
      if (merged.length <= (hasInactiveDate ? 7 : 6)) {
        pending = merged;
        if (merged.length < (hasInactiveDate ? 7 : 6)) continue;
        sourceRowNumber += 1;
        if (rows.length >= maxRows) throw new MemberPdfImportLimitError();
        rows.push(rowFromColumns(report, sourceRowNumber, merged, hasInactiveDate));
        pending = undefined;
        continue;
      }
      throw new Error("Invalid continued member row");
    }
    if (values.length < (hasInactiveDate ? 7 : 6)) {
      pending = values;
      continue;
    }
    if (values.length > (hasInactiveDate ? 7 : 6))
      throw new Error("Invalid member row column count");
    sourceRowNumber += 1;
    if (rows.length >= maxRows) throw new MemberPdfImportLimitError();
    rows.push(rowFromColumns(report, sourceRowNumber, values, hasInactiveDate));
  }
  if (pending !== undefined) throw new Error("Incomplete member row");
  return rows;
}

export function parseMemberReport(
  text: string,
  options: Readonly<{ maxRows?: number }> = {},
): ParsedMemberReport {
  if (typeof text !== "string" || text.trim().length === 0) throw new Error("Empty member report");
  const lines = text.split(/\r?\n/u);
  const firstLine = lines.map(cleanText).find((line) => line.length > 0) ?? "";
  const title = titleMatch(firstLine);
  if (title === undefined) throw new Error("Unknown or unsupported member report title");
  const maxRows = options.maxRows ?? Number.POSITIVE_INFINITY;
  if (options.maxRows !== undefined && (!Number.isSafeInteger(maxRows) || maxRows < 0)) {
    throw new Error("Invalid member row limit");
  }
  if (title.count > maxRows) throw new MemberPdfImportLimitError();
  const header = lines.map(cleanText).find((line) => headerLanguage(line) !== undefined);
  if (
    header === undefined ||
    (headerLanguage(header) !== title.language &&
      !(title.exportedEnglishHeader && headerLanguage(header) === "english"))
  ) {
    throw new Error("Missing or incompatible member report header language");
  }
  const inactiveHeader = isInactiveHeader(header);
  if ((title.definition.report === "inactive") !== inactiveHeader) {
    throw new Error("Inactive report column layout is incompatible");
  }
  const footerCount = lines.filter((line) => footerPattern.test(cleanText(line))).length;
  if (footerCount === 0) throw new Error("Missing member report footer");
  const rows = extractRows(lines, title.definition.report, inactiveHeader, maxRows);
  if (rows.length > maxRows) throw new MemberPdfImportLimitError();
  if (rows.length !== title.count) throw new Error("Declared count does not match parsed rows");
  return Object.freeze({
    report: title.definition.report,
    declaredCount: title.count,
    rows: Object.freeze(rows),
    sourceHash: createHash("sha256").update(text, "utf8").digest("hex"),
  });
}

function normalizeStableValue(value: string): string {
  return normalizeForMatching(value).replace(/[^a-z0-9]+/gu, "");
}

function stableKey(row: ParsedMemberRow): string {
  if (row.membershipNumber !== undefined)
    return `membership:${normalizeStableValue(row.membershipNumber)}`;
  if (row.email !== undefined) return `email:${normalizeStableValue(row.email)}`;
  return `fingerprint:${createHash("sha256")
    .update(
      [
        row.fullName,
        row.email ?? "",
        row.idCardNumber ?? "",
        row.birthDate ?? "",
        row.vatNumber ?? "",
        row.mobileNumber ?? "",
      ]
        .map(normalizeStableValue)
        .join("|"),
    )
    .digest("hex")}`;
}

export function getParsedMemberStableKey(row: ParsedMemberRow): string {
  return stableKey(row);
}

type ComparableField =
  | "membershipNumber"
  | "fullName"
  | "email"
  | "idCardNumber"
  | "birthDate"
  | "vatNumber"
  | "mobileNumber"
  | "inactiveAt"
  | "membershipStatus"
  | "paymentStatus";

type ComparableValue = string | undefined;

function resolvedMembershipStatus(
  current: ParsedMemberRow["membershipStatus"],
  incoming: ParsedMemberRow["membershipStatus"],
): ParsedMemberRow["membershipStatus"] {
  if (current === undefined) return incoming;
  if (incoming === undefined) return current;
  return current === "active" && incoming === "suspended"
    ? "suspended"
    : current === "suspended" && incoming === "active"
      ? "suspended"
      : current;
}

function isResolvableStatusDifference(
  current: ParsedMemberRow["membershipStatus"],
  incoming: ParsedMemberRow["membershipStatus"],
): boolean {
  return (
    (current === "active" && incoming === "suspended") ||
    (current === "suspended" && incoming === "active")
  );
}

function comparableFields(): readonly ComparableField[] {
  return [
    "membershipNumber",
    "fullName",
    "email",
    "idCardNumber",
    "birthDate",
    "vatNumber",
    "mobileNumber",
    "inactiveAt",
    "membershipStatus",
    "paymentStatus",
  ];
}

function mergeRows(current: ParsedMemberRow, incoming: ParsedMemberRow): ParsedMemberRow {
  const merged: Record<string, unknown> = { ...current };
  merged.membershipStatus = resolvedMembershipStatus(
    current.membershipStatus,
    incoming.membershipStatus,
  );
  for (const field of comparableFields()) {
    if (field === "membershipStatus") continue;
    const value: ComparableValue = incoming[field];
    if (
      (merged[field] === undefined || merged[field] === "") &&
      value !== undefined &&
      value !== ""
    )
      merged[field] = value;
  }
  return Object.freeze(merged) as ParsedMemberRow;
}

export function deduplicateMemberRows(
  reports: readonly ParsedMemberReport[],
): Readonly<{ rows: readonly ParsedMemberRow[]; duplicates: readonly ImportDuplicate[] }> {
  const rows: ParsedMemberRow[] = [];
  const duplicates: ImportDuplicate[] = [];
  const byKey = new Map<string, number>();
  for (const report of reports) {
    for (const row of report.rows) {
      const key = stableKey(row);
      const existingIndex = byKey.get(key);
      if (existingIndex === undefined) {
        byKey.set(key, rows.length);
        rows.push(row);
        continue;
      }
      const existing = rows[existingIndex];
      if (existing === undefined) throw new Error("Invalid deduplication index");
      const conflictingFields = comparableFields().filter((field) => {
        const left: ComparableValue = existing[field];
        const right: ComparableValue = row[field];
        if (left === undefined || right === undefined) return false;
        if (
          field === "membershipStatus" &&
          isResolvableStatusDifference(existing.membershipStatus, row.membershipStatus)
        )
          return false;
        return field === "membershipNumber"
          ? normalizeStableValue(left) !== normalizeStableValue(right)
          : left !== right;
      });
      duplicates.push(
        Object.freeze({
          kind: conflictingFields.length > 0 ? "conflict" : "duplicate",
          stableKey: key,
          sourceRows: Object.freeze([
            `${existing.sourceReport}:${existing.sourceRowNumber}`,
            `${row.sourceReport}:${row.sourceRowNumber}`,
          ]),
          ...(conflictingFields.length > 0 ? { fields: Object.freeze(conflictingFields) } : {}),
        }),
      );
      rows[existingIndex] = mergeRows(existing, row);
    }
  }
  return Object.freeze({ rows: Object.freeze(rows), duplicates: Object.freeze(duplicates) });
}
