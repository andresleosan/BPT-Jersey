import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { isAbsolute, join, relative, resolve } from "node:path";

import type { Firestore } from "firebase-admin/firestore";
import {
  assertUniqueSourceIds,
  mapRegyfitAccessRow,
  normalizeRegyfitAccessEnvelope,
} from "@bpt-jersey/domain/migration/regyfit-access";
import type { RegyfitAccessRecord, UtcDateTime } from "@bpt-jersey/domain";

export type ImportConfig = Readonly<{
  privateStagingRoot: string;
  runId: string;
  moduleKey: "alunos-acessos";
  sourceRoute: string;
  academyId: string;
  target: "emulator" | "staging";
}>;

export type ImportReceipt = Readonly<{
  runId: string;
  moduleKey: string;
  importedCount: number;
  skippedCount: number;
  contentSha256: string;
  auditEventPath: string;
}>;

const approvedRunIds = new Set([
  "regyfit-20260808-acessos-01",
  "synthetic-run-1",
  "synthetic-qa-run-1",
]);
const expectedModuleKey = "alunos-acessos";
const expectedSourceRoute = "/admin2/modulos/alunos/acessos_alunos.php";
const expectedRowCount = 10;
const privateMarker = ".regyfit-private-staging";
const stagingConfirmation = "real-data-private-staging-v1";
const repositoryRoot = fileURLToPath(new URL("../../../../", import.meta.url));

class ImportError extends Error {}

function fail(message: string): never {
  throw new ImportError(message);
}

function isLoopbackHost(value: string | undefined): boolean {
  if (!value) return false;
  const match = /^(localhost|127\.0\.0\.1|\[::1\]|::1)(?::([0-9]{1,5}))?$/.exec(value);
  if (!match) return false;
  return match[2] === undefined || (Number(match[2]) >= 1 && Number(match[2]) <= 65_535);
}

function isKnownProductionProject(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return (
    normalized === "production" ||
    normalized === "prod" ||
    normalized.includes("production") ||
    /(?:^|-)prod(?:-|$)/.test(normalized)
  );
}

function firebaseConfigProjectId(): string | undefined {
  const value = process.env.FIREBASE_CONFIG;
  if (!value) return undefined;
  try {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed === "object" && parsed !== null && "projectId" in parsed) {
      const projectId = (parsed as { projectId?: unknown }).projectId;
      return typeof projectId === "string" ? projectId : undefined;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

export function getImportProjectId(): string {
  const fromEnvironment = process.env.GCLOUD_PROJECT?.trim();
  if (fromEnvironment) return fromEnvironment;
  return firebaseConfigProjectId() ?? "demo-bpt-jersey";
}

export function assertCanonicalUtcDateTime(value: string): UtcDateTime {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) {
    fail("Import timestamp is invalid");
  }
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp) || new Date(timestamp).toISOString() !== value) {
    fail("Import timestamp is invalid");
  }
  return value as UtcDateTime;
}

export function assertImportTargetIsSafe(config: ImportConfig, projectId: string): void {
  if (config.target !== "emulator" && config.target !== "staging") {
    fail("Import target is not safe");
  }
  if (
    isKnownProductionProject(projectId) ||
    isKnownProductionProject(process.env.GCLOUD_PROJECT) ||
    isKnownProductionProject(firebaseConfigProjectId())
  ) {
    fail("Import target is not safe");
  }
  if (config.target === "emulator" && !isLoopbackHost(process.env.FIRESTORE_EMULATOR_HOST)) {
    fail("Import target is not safe");
  }
  if (
    config.target === "staging" &&
    process.env.REGYFIT_OPERATOR_CONFIRMATION !== stagingConfirmation
  ) {
    fail("Import target is not safe");
  }
}

function assertConfig(config: ImportConfig): void {
  if (
    !approvedRunIds.has(config.runId) ||
    config.moduleKey !== expectedModuleKey ||
    config.sourceRoute !== expectedSourceRoute ||
    !/^[A-Za-z0-9_-]+$/.test(config.runId) ||
    !/^[A-Za-z0-9_-]+$/.test(config.academyId)
  ) {
    fail("Import configuration is not approved");
  }
}

function parseJsonObjects(chunk: string): readonly unknown[] {
  const objects: unknown[] = [];
  let start = -1;
  let depth = 0;
  let quoted = false;
  let escaped = false;

  for (let index = 0; index < chunk.length; index += 1) {
    const character = chunk[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') quoted = false;
      continue;
    }
    if (character === '"') {
      quoted = true;
      continue;
    }
    if (character === "{") {
      if (depth === 0) start = index;
      depth += 1;
      continue;
    }
    if (character === "}") {
      depth -= 1;
      if (depth < 0) fail("Import chunk is invalid");
      if (depth === 0 && start >= 0) {
        try {
          objects.push(JSON.parse(chunk.slice(start, index + 1)));
        } catch {
          fail("Import chunk is invalid");
        }
        start = -1;
      }
      continue;
    }
    if (depth === 0 && character?.trim().length !== 0) fail("Import chunk is invalid");
  }
  if (depth !== 0 || quoted || start !== -1 || objects.length === 0) {
    fail("Import chunk is invalid");
  }
  return objects;
}

async function readStagingRows(config: ImportConfig): Promise<readonly unknown[]> {
  if (!isAbsolute(config.privateStagingRoot)) {
    fail("Private staging is not approved");
  }

  try {
    const root = resolve(config.privateStagingRoot);
    const rootRelativeToRepository = relative(repositoryRoot, root);
    if (
      rootRelativeToRepository === "" ||
      (!rootRelativeToRepository.startsWith("..") && !isAbsolute(rootRelativeToRepository))
    ) {
      fail("Private staging is not approved");
    }
    const resolvedRoot = await realpath(root);
    if (resolvedRoot !== root) {
      fail("Private staging is not approved");
    }
    const marker = await lstat(resolve(root, privateMarker));
    if (!marker.isFile() || marker.isSymbolicLink()) {
      fail("Private staging is not approved");
    }
    const markerContents = await readFile(resolve(root, privateMarker), "utf8");
    let markerValue: unknown;
    try {
      markerValue = JSON.parse(markerContents);
    } catch {
      fail("Private staging is not approved");
    }
    if (
      typeof markerValue !== "object" ||
      markerValue === null ||
      Array.isArray(markerValue) ||
      Object.getPrototypeOf(markerValue) !== Object.prototype ||
      Object.keys(markerValue).length !== 1 ||
      !Object.prototype.hasOwnProperty.call(markerValue, "encryptionConfirmed") ||
      (markerValue as { encryptionConfirmed?: unknown }).encryptionConfirmed !== true
    ) {
      fail("Private staging is not approved");
    }

    const chunkPath = resolve(root, config.runId, config.moduleKey, "chunk-000000.jsonl");
    const resolvedChunkPath = await realpath(chunkPath);
    if (
      resolvedChunkPath !== chunkPath ||
      relative(root, resolvedChunkPath) !==
        join(config.runId, config.moduleKey, "chunk-000000.jsonl")
    ) {
      fail("Private staging is not approved");
    }
    const chunk = await readFile(chunkPath, "utf8");
    const objects = parseJsonObjects(chunk);
    if (objects.length !== expectedRowCount) {
      fail("Import requires exactly ten rows");
    }

    return objects.map((value) => {
      if (
        typeof value !== "object" ||
        value === null ||
        Array.isArray(value) ||
        Object.getPrototypeOf(value) !== Object.prototype
      ) {
        fail("Import chunk is invalid");
      }
      if (Object.prototype.hasOwnProperty.call(value, "record")) {
        const normalized = normalizeRegyfitAccessEnvelope(value, {
          runId: config.runId,
          moduleKey: config.moduleKey,
        });
        if (!normalized.ok) fail("Import chunk is invalid");
        return normalized.value;
      }
      return value;
    });
  } catch (error) {
    if (error instanceof ImportError) throw error;
    fail("Private staging is not approved");
  }
}

function compareLexical(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => compareLexical(left, right))
        .map(([key, nested]) => [key, canonicalize(nested)]),
    );
  }
  return value;
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function recordPath(record: RegyfitAccessRecord): string {
  if (!/^[A-Za-z0-9_-]+$/.test(record.sourceId)) {
    fail("Import record path is not safe");
  }
  return `academies/${record.academyId}/regyfitAccessRecords/${record.sourceId}`;
}

function auditPath(config: ImportConfig): string {
  return `academies/${config.academyId}/auditEvents/regyfit-access-${config.runId}`;
}

function contentHash(records: readonly RegyfitAccessRecord[]): string {
  const canonicalRecords = [...records].sort((left, right) =>
    compareLexical(left.sourceId, right.sourceId),
  );
  return createHash("sha256").update(canonicalJson(canonicalRecords), "utf8").digest("hex");
}

export async function importRegyfitAccessRecords(
  config: ImportConfig,
  db: Firestore,
  now: UtcDateTime,
): Promise<ImportReceipt> {
  assertConfig(config);
  const capturedAt = assertCanonicalUtcDateTime(now);
  assertImportTargetIsSafe(config, getImportProjectId());
  const rows = await readStagingRows(config);
  const mapped = rows.map((row) =>
    mapRegyfitAccessRow(row, {
      academyId: config.academyId,
      importRunId: config.runId,
      capturedAt,
    }),
  );
  if (mapped.some((result) => !result.ok)) {
    fail("Import rows are invalid");
  }
  const records = mapped.map(
    (result) => (result as { ok: true; value: RegyfitAccessRecord }).value,
  );
  try {
    assertUniqueSourceIds(records);
  } catch {
    fail("Import rows are invalid");
  }
  if (records.length !== expectedRowCount) {
    fail("Import requires exactly ten rows");
  }
  const hash = contentHash(records);
  const paths = records.map(recordPath);
  const auditEventPath = auditPath(config);
  let importedCount = 0;
  let skippedCount = 0;

  try {
    await db.runTransaction(async (transaction) => {
      let transactionImportedCount = 0;
      let transactionSkippedCount = 0;
      const snapshots = await Promise.all(paths.map((path) => transaction.get(db.doc(path))));
      const existingAudit = await transaction.get(db.doc(auditEventPath));
      for (const [index, snapshot] of snapshots.entries()) {
        const record = records[index];
        if (!record) fail("Import could not be completed");
        if (!snapshot.exists) {
          transaction.set(
            db.doc(paths[index] as string),
            record as unknown as Record<string, unknown>,
          );
          transactionImportedCount += 1;
        } else if (canonicalJson(snapshot.data()) === canonicalJson(record)) {
          transactionSkippedCount += 1;
        } else {
          fail("Import conflicts with existing data");
        }
      }
      const audit = {
        academyId: config.academyId,
        actorId: "system-regyfit-importer",
        action: "regyfit.access.imported",
        targetRef: `academies/${config.academyId}/regyfitAccessRecords`,
        purpose: "approved Regyfit access import",
        correlationId: `regyfit-access:${config.runId}`,
        importRunId: config.runId,
        moduleKey: config.moduleKey,
        sourceRoute: config.sourceRoute,
        recordCount: records.length,
        contentSha256: hash,
        result: "completed",
        schemaVersion: 1,
      } satisfies Record<string, unknown>;
      if (!existingAudit.exists) {
        transaction.set(db.doc(auditEventPath), audit);
      } else if (canonicalJson(existingAudit.data()) !== canonicalJson(audit)) {
        fail("Import conflicts with existing audit data");
      }
      importedCount = transactionImportedCount;
      skippedCount = transactionSkippedCount;
    });
  } catch (error) {
    if (error instanceof ImportError) throw error;
    fail("Import could not be completed");
  }

  return Object.freeze({
    runId: config.runId,
    moduleKey: config.moduleKey,
    importedCount,
    skippedCount,
    contentSha256: hash,
    auditEventPath,
  });
}
