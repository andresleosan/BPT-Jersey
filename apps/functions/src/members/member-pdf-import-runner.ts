import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { readdir, readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";

import type { MemberReportKey } from "@bpt-jersey/domain";

import {
  deduplicateMemberRows,
  parseMemberReport,
  type ParsedMemberReport,
  type ParsedMemberRow,
} from "./member-pdf-import.js";
import { MAX_MEMBER_REPORT_ROWS, type MemberImportWriteResult } from "./member-service.js";
import { formatMemberPdfTextItems } from "./member-pdf-text.js";

const approvedProjectId = "bptjersey-f5a25";
const approvedAcademyId = "demo-academy";
const maxRunIdLength = 128;
const maxReceiptAgeMs = 15 * 60 * 1000;
const approvedSourceRoot = "F:\\Proyectos\\BPT Jersey\\Varios";
const safeRunIdPattern = /^[A-Za-z0-9._:-]+$/u;
export const MAX_MEMBER_PDF_BYTES = 10 * 1024 * 1024;
export const approvedMemberPdfReportKeys: readonly MemberReportKey[] = Object.freeze([
  "total",
  "active",
  "withNumber",
  "noNumber",
  "inactive",
  "regularized",
  "activeRegularized",
  "suspended",
]);
const isoDatePattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/u;

export type MemberPdfImportTarget = Readonly<{
  target: string;
  projectId: string;
  academyId: string;
}>;

export type MemberPdfImportPlan = Readonly<{
  sourceRoot: string;
  target: "staging";
  projectId: typeof approvedProjectId;
  academyId: typeof approvedAcademyId;
  runId: string;
  capturedAt: string;
  reports: readonly ParsedMemberReport[];
  rows: readonly ParsedMemberRow[];
  sourceRows: number;
  canonicalRows: number;
  duplicates: number;
  conflicts: number;
  rowsWithoutMembershipNumber: number;
  statusCounts: Readonly<Record<"active" | "inactive" | "suspended", number>>;
  sourceHash: string;
  operationId: string;
}>;

export type MemberPdfImportReceipt = Readonly<{
  target: "staging";
  projectId: typeof approvedProjectId;
  academyId: typeof approvedAcademyId;
  runId: string;
  capturedAt: string;
  reports: number;
  reportKeys: readonly MemberReportKey[];
  sourceRows: number;
  canonicalRows: number;
  duplicates: number;
  conflicts: number;
  rowsWithoutMembershipNumber: number;
  statusCounts: Readonly<Record<"active" | "inactive" | "suspended", number>>;
  sourceHash: string;
  operationId: string;
  generatedAt: string;
}>;

export type MemberPdfImportExecutionInput = Readonly<{
  sourceRoot: string;
  target: string;
  projectId: string;
  academyId: string;
  runId: string;
  importRunId: string;
  capturedAt: string;
  mode: "dry-run" | "confirm";
  receipt?: MemberPdfImportReceipt;
  yesConfirmStaging?: boolean;
  now?: string;
}>;

export type MemberPdfImportExecutionServices = Readonly<{
  buildPlan: (
    input: Omit<
      MemberPdfImportExecutionInput,
      "mode" | "receipt" | "yesConfirmStaging" | "importRunId" | "now"
    >,
  ) => Promise<MemberPdfImportPlan>;
  apply: (plan: MemberPdfImportPlan, importRunId: string) => Promise<MemberImportWriteResult>;
}>;

export type MemberPdfImportExecutionResult = Readonly<{
  mode: "dry-run" | "confirm";
  receipt: MemberPdfImportReceipt;
  result?: MemberImportWriteResult;
}>;

export type MemberPdfImportRollbackInput = Readonly<{
  target: string;
  projectId: string;
  academyId: string;
  runId: string;
}>;

export type MemberPdfImportRollbackResult = Readonly<{
  target: "staging";
  projectId: typeof approvedProjectId;
  academyId: typeof approvedAcademyId;
  runId: string;
  selectedCount: number;
}>;

export type MemberPdfImportRollbackServices = Readonly<{
  listMembers: () => Promise<readonly unknown[]>;
}>;

export type MemberPdfImportCliArguments = Readonly<{
  mode: "dry-run" | "confirm";
  target: "staging";
  projectId: typeof approvedProjectId;
  academyId: typeof approvedAcademyId;
  sourceRoot: typeof approvedSourceRoot;
  runId: string;
  capturedAt: string;
  yesConfirmStaging: boolean;
  receiptPath?: string;
}>;

export type MemberPdfImportCliIo = Readonly<{
  readReceipt?: (path: string) => Promise<unknown>;
  writeReceipt?: (path: string, content: string) => Promise<void>;
  now?: string;
  initializeAdmin?: () => void;
}>;

export type MemberPdfImportCliResult = Readonly<{
  input: MemberPdfImportCliArguments;
  result: MemberPdfImportExecutionResult;
}>;

type PdfParseResult = Readonly<{ text: string }>;
type PdfTextPage = Readonly<{
  getTextContent: (
    options: Readonly<{
      normalizeWhitespace: boolean;
      disableCombineTextItems: boolean;
    }>,
  ) => Promise<{
    items: readonly Readonly<{ str: string; transform: readonly number[] }>[];
  }>;
}>;
type PdfParseOptions = Readonly<{ pagerender?: (page: PdfTextPage) => Promise<string> }>;

function requireText(value: unknown, name: string, maxLength = maxRunIdLength): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > maxLength) {
    throw new Error(`Invalid member PDF import ${name}`);
  }
  return value;
}

function requireRunId(value: unknown, name = "run ID"): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maxRunIdLength ||
    !safeRunIdPattern.test(value)
  ) {
    throw new Error(`Invalid member PDF import ${name}`);
  }
  return value;
}

function requireCapturedAt(value: unknown): string {
  const capturedAt = requireText(value, "capture timestamp");
  if (!isoDatePattern.test(capturedAt) || Number.isNaN(Date.parse(capturedAt))) {
    throw new Error("Invalid member PDF import capture timestamp");
  }
  return capturedAt;
}

function requireCanonicalUtcDateTime(value: unknown, name: string): string {
  const timestamp = requireCapturedAt(value);
  if (new Date(timestamp).toISOString() !== timestamp) {
    throw new Error(`Invalid member PDF import ${name}`);
  }
  return timestamp;
}

export function validateFirebaseAdminProjectId(projectId: string): void {
  if (projectId !== approvedProjectId) throw new Error("Firebase Admin project is not allowed");
}

export function validateMemberPdfImportCliEnvironment(emulatorHost: string | undefined): void {
  if (emulatorHost?.trim()) throw new Error("Firebase emulator target is not allowed");
}

export function parseMemberPdfImportCliArguments(
  argv: readonly string[],
): MemberPdfImportCliArguments {
  const valueFlags = new Set([
    "--target",
    "--project-id",
    "--academy-id",
    "--source-root",
    "--run-id",
    "--captured-at",
    "--receipt",
  ]);
  const booleanFlags = new Set(["--dry-run", "--confirm", "--yes-confirm-staging"]);
  const seen = new Set<string>();
  const values = new Map<string, string>();
  let mode: "dry-run" | "confirm" | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (!flag?.startsWith("--") || (!valueFlags.has(flag) && !booleanFlags.has(flag))) {
      throw new Error("Unknown member PDF import flag");
    }
    if (seen.has(flag)) throw new Error("Duplicate member PDF import flag");
    seen.add(flag);
    if (flag === "--dry-run" || flag === "--confirm") {
      if (mode !== undefined) throw new Error("Import mode is missing or ambiguous");
      mode = flag.slice(2) as "dry-run" | "confirm";
      continue;
    }
    if (flag === "--yes-confirm-staging") continue;
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${flag}`);
    values.set(flag, value);
    index += 1;
  }
  if (mode === undefined) throw new Error("Import mode is missing or ambiguous");
  for (const flag of [
    "--target",
    "--project-id",
    "--academy-id",
    "--source-root",
    "--run-id",
    "--captured-at",
  ]) {
    if (!values.has(flag)) throw new Error(`Missing required argument ${flag}`);
  }
  if (mode === "confirm" && !seen.has("--receipt")) {
    throw new Error("Confirm requires --receipt");
  }
  if (mode !== "confirm" && seen.has("--yes-confirm-staging")) {
    throw new Error("--yes-confirm-staging is only valid with --confirm");
  }
  const target = values.get("--target");
  const projectId = values.get("--project-id");
  const academyId = values.get("--academy-id");
  const sourceRoot = values.get("--source-root");
  const runId = values.get("--run-id");
  const capturedAt = values.get("--captured-at");
  if (
    target === undefined ||
    projectId === undefined ||
    academyId === undefined ||
    sourceRoot === undefined ||
    runId === undefined ||
    capturedAt === undefined
  )
    throw new Error("Member PDF import arguments are incomplete");
  validateMemberPdfImportTarget({ target, projectId, academyId });
  if (sourceRoot !== approvedSourceRoot)
    throw new Error("Member PDF import source root is not approved");
  requireCapturedAt(capturedAt);
  const receiptPath = values.get("--receipt");
  return Object.freeze({
    mode,
    target: "staging",
    projectId: approvedProjectId,
    academyId: approvedAcademyId,
    sourceRoot: approvedSourceRoot,
    runId: requireRunId(runId),
    capturedAt,
    yesConfirmStaging: seen.has("--yes-confirm-staging"),
    ...(receiptPath === undefined ? {} : { receiptPath }),
  });
}

export function compareMemberPdfFileNames(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

export async function discoverMemberPdfFiles(sourceRoot: string): Promise<readonly string[]> {
  const root = requireText(sourceRoot, "source root", 4_096);
  const rootStats = await stat(root);
  if (!rootStats.isDirectory()) throw new Error("Member PDF import source root is not a directory");
  const entries = await readdir(root, { withFileTypes: true });
  return Object.freeze(
    entries
      .filter((entry) => entry.isFile() && entry.name.toLocaleLowerCase().endsWith(".pdf"))
      .map((entry) => entry.name)
      .sort(compareMemberPdfFileNames)
      .map((name) => resolve(join(root, name))),
  );
}

export function validateMemberPdfImportFileSize(size: number): void {
  if (!Number.isSafeInteger(size) || size < 0 || size > MAX_MEMBER_PDF_BYTES) {
    throw new Error("Member PDF import PDF is too large");
  }
}

export function validateMemberPdfImportReportSet(reports: readonly ParsedMemberReport[]): void {
  const reportKeys = reports.map((report) => report.report);
  const expected = new Set(approvedMemberPdfReportKeys);
  const actual = new Set(reportKeys);
  if (
    reportKeys.length !== approvedMemberPdfReportKeys.length ||
    actual.size !== reportKeys.length ||
    actual.size !== expected.size ||
    [...expected].some((report) => !actual.has(report))
  ) {
    throw new Error("Member PDF import report set is not approved");
  }
}

export function parseMemberPdfImportReport(text: string, maxRows = MAX_MEMBER_REPORT_ROWS) {
  return parseMemberReport(text, { maxRows });
}

export function validateMemberPdfImportTarget(input: MemberPdfImportTarget): void {
  if (
    typeof input !== "object" ||
    input === null ||
    Array.isArray(input) ||
    Object.keys(input).some((key) => !["target", "projectId", "academyId"].includes(key)) ||
    input.target !== "staging" ||
    input.projectId !== approvedProjectId ||
    input.academyId !== approvedAcademyId
  ) {
    throw new Error("Member PDF import target is not allowed");
  }
}

function hashReports(reports: readonly ParsedMemberReport[]): string {
  const hash = createHash("sha256");
  for (const report of reports) hash.update(report.sourceHash, "utf8");
  return hash.digest("hex");
}

export function stableMemberPdfImportOperationId(runId: string, sourceHash: string): string {
  const stableRunId = requireRunId(runId);
  if (!/^[a-f0-9]{64}$/u.test(sourceHash)) throw new Error("Invalid member PDF import source hash");
  return `member-pdf-import-${createHash("sha256")
    .update(stableRunId, "utf8")
    .update("\0", "utf8")
    .update(sourceHash, "utf8")
    .digest("hex")}`;
}

async function extractPdfText(bytes: Uint8Array): Promise<string> {
  const pdfParse = createRequire(import.meta.url)("pdf-parse") as
    | ((input: Uint8Array, options?: PdfParseOptions) => Promise<PdfParseResult>)
    | { default?: (input: Uint8Array, options?: PdfParseOptions) => Promise<PdfParseResult> };
  const parser = typeof pdfParse === "function" ? pdfParse : pdfParse.default;
  if (parser === undefined) throw new Error("PDF parser unavailable");
  let pageNumber = 0;
  const result = await parser(bytes, {
    pagerender: async (page) => {
      pageNumber += 1;
      const content = await page.getTextContent({
        disableCombineTextItems: true,
        normalizeWhitespace: false,
      });
      return formatMemberPdfTextItems(
        content.items.flatMap((item) => {
          const x = item.transform[4];
          const y = item.transform[5];
          return typeof x === "number" &&
            typeof y === "number" &&
            Number.isFinite(x) &&
            Number.isFinite(y)
            ? [{ page: pageNumber, str: item.str, x, y }]
            : [];
        }),
      );
    },
  });
  if (typeof result.text !== "string") throw new Error("PDF text is invalid");
  return result.text;
}

export async function buildMemberPdfImportPlan(
  input: Readonly<{
    sourceRoot: string;
    target: string;
    projectId: string;
    academyId: string;
    runId: string;
    capturedAt: string;
  }>,
): Promise<MemberPdfImportPlan> {
  validateMemberPdfImportTarget({
    target: input.target,
    projectId: input.projectId,
    academyId: input.academyId,
  });
  const sourceRoot = requireText(input.sourceRoot, "source root", 4_096);
  const runId = requireRunId(input.runId);
  const capturedAt = requireCapturedAt(input.capturedAt);
  const files = await discoverMemberPdfFiles(sourceRoot);
  if (files.length !== 8) throw new Error("Member PDF import source set is not approved");
  const reports: ParsedMemberReport[] = [];
  for (const file of files) {
    const fileStats = await stat(file);
    validateMemberPdfImportFileSize(fileStats.size);
    const bytes = await readFile(file);
    validateMemberPdfImportFileSize(bytes.byteLength);
    const text = await extractPdfText(bytes);
    reports.push(parseMemberPdfImportReport(text));
  }
  validateMemberPdfImportReportSet(reports);
  const deduplicated = deduplicateMemberRows(reports);
  const sourceHash = hashReports(reports);
  const operationId = stableMemberPdfImportOperationId(runId, sourceHash);
  const statusCounts = { active: 0, inactive: 0, suspended: 0 };
  for (const row of deduplicated.rows) {
    const status = row.membershipStatus ?? "active";
    statusCounts[status] += 1;
  }
  const plan: MemberPdfImportPlan = {
    sourceRoot: resolve(sourceRoot),
    target: "staging" as const,
    projectId: approvedProjectId,
    academyId: approvedAcademyId,
    runId,
    capturedAt,
    reports: Object.freeze(reports),
    rows: deduplicated.rows,
    sourceRows: reports.reduce((count, report) => count + report.rows.length, 0),
    canonicalRows: deduplicated.rows.length,
    duplicates: deduplicated.duplicates.filter((duplicate) => duplicate.kind === "duplicate")
      .length,
    conflicts: deduplicated.duplicates.filter((duplicate) => duplicate.kind === "conflict").length,
    rowsWithoutMembershipNumber: deduplicated.rows.filter(
      (row) => row.membershipNumber === undefined,
    ).length,
    statusCounts: Object.freeze(statusCounts),
    sourceHash,
    operationId,
  };
  if (
    plan.sourceRows !== 797 ||
    plan.canonicalRows !== 243 ||
    plan.duplicates !== 554 ||
    plan.conflicts !== 0 ||
    plan.rowsWithoutMembershipNumber !== 96 ||
    plan.statusCounts.active !== 114 ||
    plan.statusCounts.inactive !== 128 ||
    plan.statusCounts.suspended !== 1
  ) {
    throw new Error("Member PDF import source result is not approved");
  }
  if (plan.conflicts !== 0) throw new Error("Member PDF import contains identity conflicts");
  return Object.freeze(plan);
}

export function sanitizeMemberPdfImportReceipt(
  plan: MemberPdfImportPlan,
  generatedAt = new Date().toISOString(),
): MemberPdfImportReceipt {
  const safeGeneratedAt = requireCanonicalUtcDateTime(generatedAt, "receipt generation timestamp");
  return Object.freeze({
    target: plan.target,
    projectId: plan.projectId,
    academyId: plan.academyId,
    runId: plan.runId,
    capturedAt: plan.capturedAt,
    reports: plan.reports.length,
    reportKeys: Object.freeze(plan.reports.map((report) => report.report)),
    sourceRows: plan.sourceRows,
    canonicalRows: plan.canonicalRows,
    duplicates: plan.duplicates,
    conflicts: plan.conflicts,
    rowsWithoutMembershipNumber: plan.rowsWithoutMembershipNumber,
    statusCounts: plan.statusCounts,
    sourceHash: plan.sourceHash,
    operationId: plan.operationId,
    generatedAt: safeGeneratedAt,
  });
}

function receiptsMatch(expected: MemberPdfImportReceipt, actual: MemberPdfImportReceipt): boolean {
  const expectedWithoutGeneration = { ...expected, generatedAt: undefined };
  const actualWithoutGeneration = { ...actual, generatedAt: undefined };
  return JSON.stringify(expectedWithoutGeneration) === JSON.stringify(actualWithoutGeneration);
}

export function validateMemberPdfImportReceipt(receipt: unknown): MemberPdfImportReceipt {
  const candidate = receipt as Partial<MemberPdfImportReceipt>;
  if (
    typeof receipt !== "object" ||
    receipt === null ||
    Array.isArray(receipt) ||
    candidate.target !== "staging" ||
    candidate.projectId !== approvedProjectId ||
    candidate.academyId !== approvedAcademyId ||
    typeof candidate.sourceHash !== "string" ||
    !/^[a-f0-9]{64}$/u.test(candidate.sourceHash) ||
    typeof candidate.operationId !== "string" ||
    !/^member-pdf-import-[a-f0-9]{64}$/u.test(candidate.operationId) ||
    !Array.isArray(candidate.reportKeys) ||
    candidate.reportKeys.length !== approvedMemberPdfReportKeys.length ||
    !Number.isSafeInteger(candidate.reports) ||
    candidate.reports !== candidate.reportKeys.length
  ) {
    throw new Error("Member PDF import dry-run receipt is invalid");
  }
  requireRunId(candidate.runId, "receipt run ID");
  requireCanonicalUtcDateTime(candidate.generatedAt, "receipt generation timestamp");
  return candidate as MemberPdfImportReceipt;
}

export function serializeMemberPdfImportReceipt(receipt: unknown): string {
  const safe = validateMemberPdfImportReceipt(receipt);
  return JSON.stringify({
    target: safe.target,
    projectId: safe.projectId,
    academyId: safe.academyId,
    runId: safe.runId,
    capturedAt: safe.capturedAt,
    reports: safe.reports,
    reportKeys: safe.reportKeys,
    sourceRows: safe.sourceRows,
    canonicalRows: safe.canonicalRows,
    duplicates: safe.duplicates,
    conflicts: safe.conflicts,
    rowsWithoutMembershipNumber: safe.rowsWithoutMembershipNumber,
    statusCounts: safe.statusCounts,
    sourceHash: safe.sourceHash,
    operationId: safe.operationId,
    generatedAt: safe.generatedAt,
  });
}

function validateFreshReceipt(receipt: MemberPdfImportReceipt, now: string): void {
  validateMemberPdfImportReceipt(receipt);
  const current = Date.parse(requireCanonicalUtcDateTime(now, "current timestamp"));
  const generated = Date.parse(
    requireCanonicalUtcDateTime(receipt.generatedAt, "receipt generation timestamp"),
  );
  if (generated > current || current - generated > maxReceiptAgeMs) {
    throw new Error("Member PDF import dry-run receipt is not fresh");
  }
}

export async function executeMemberPdfImport(
  input: MemberPdfImportExecutionInput,
  services: MemberPdfImportExecutionServices,
): Promise<MemberPdfImportExecutionResult> {
  requireRunId(input.runId);
  requireRunId(input.importRunId);
  validateMemberPdfImportTarget({
    target: input.target,
    projectId: input.projectId,
    academyId: input.academyId,
  });
  if (input.mode !== "dry-run" && input.mode !== "confirm") {
    throw new Error("Member PDF import mode is required and must be unambiguous");
  }
  if (input.mode === "confirm") {
    if (input.yesConfirmStaging !== true) {
      throw new Error("Explicit confirmation is required");
    }
    if (input.receipt === undefined) {
      throw new Error("A matching dry-run receipt is required");
    }
    validateFreshReceipt(input.receipt, input.now ?? new Date().toISOString());
  }

  const plan = await services.buildPlan({
    sourceRoot: input.sourceRoot,
    target: input.target,
    projectId: input.projectId,
    academyId: input.academyId,
    runId: input.runId,
    capturedAt: input.capturedAt,
  });
  const generatedAt = input.now ?? new Date().toISOString();
  const receipt = sanitizeMemberPdfImportReceipt(
    plan,
    input.mode === "confirm" ? input.receipt!.generatedAt : generatedAt,
  );
  if (receipt.runId !== input.runId || input.importRunId !== input.runId) {
    throw new Error("Member PDF import run ID does not match current execution");
  }
  if (input.mode === "dry-run") return Object.freeze({ mode: input.mode, receipt });
  if (!receiptsMatch(input.receipt!, receipt)) {
    throw new Error("Member PDF import dry-run receipt does not match current source");
  }
  const result = await services.apply(plan, input.importRunId);
  return Object.freeze({ mode: input.mode, receipt, result });
}

export async function runMemberPdfImportCli(
  argv: readonly string[],
  services: MemberPdfImportExecutionServices,
  io: MemberPdfImportCliIo = {},
): Promise<MemberPdfImportCliResult> {
  const input = parseMemberPdfImportCliArguments(argv);
  const receipt =
    input.mode === "confirm"
      ? validateMemberPdfImportReceipt(
          await (io.readReceipt?.(input.receiptPath!) ??
            Promise.reject(new Error("A matching dry-run receipt is required"))),
        )
      : undefined;
  const result = await executeMemberPdfImport(
    {
      sourceRoot: input.sourceRoot,
      target: input.target,
      projectId: input.projectId,
      academyId: input.academyId,
      runId: input.runId,
      importRunId: input.runId,
      capturedAt: input.capturedAt,
      mode: input.mode,
      ...(receipt === undefined ? {} : { receipt }),
      yesConfirmStaging: input.yesConfirmStaging,
      ...(io.now === undefined ? {} : { now: io.now }),
    },
    services,
  );
  if (input.mode === "dry-run" && input.receiptPath !== undefined) {
    if (io.writeReceipt === undefined) throw new Error("Receipt writer is unavailable");
    await io.writeReceipt(input.receiptPath, serializeMemberPdfImportReceipt(result.receipt));
  }
  return Object.freeze({ input, result });
}

export async function planMemberPdfImportRollback(
  input: MemberPdfImportRollbackInput,
  services: MemberPdfImportRollbackServices,
): Promise<MemberPdfImportRollbackResult> {
  requireRunId(input.runId);
  validateMemberPdfImportTarget({
    target: input.target,
    projectId: input.projectId,
    academyId: input.academyId,
  });
  const members = await services.listMembers();
  const selectedCount = members.filter((member) => {
    if (typeof member !== "object" || member === null || Array.isArray(member)) return false;
    const record = member as Record<string, unknown>;
    return (
      record.academyId === input.academyId &&
      record.source === "member-pdf-import" &&
      record.importRunId === input.runId
    );
  }).length;
  return Object.freeze({
    target: "staging",
    projectId: approvedProjectId,
    academyId: approvedAcademyId,
    runId: input.runId,
    selectedCount,
  });
}
