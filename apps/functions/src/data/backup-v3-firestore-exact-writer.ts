import { Buffer } from "node:buffer";

import { canonicalizeMemberDirectoryValue } from "../members/member-directory-crypto.js";
import { BACKUP_V3_LIMITS, classifyBackupV3SourcePath } from "./backup-v3-contracts.js";
import {
  decodeBackupV3FirestoreDocument,
  parseBackupV3FirestoreDocument,
  type BackupV3CanonicalFirestoreDocument,
} from "./backup-v3-firestore-value-codec.js";

const sourceProjectId = "demo-bpt-jersey" as const;
const targetProjectId = "demo-bpt-jersey-restore" as const;
const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const canonicalIntegerPattern = /^(?:0|-[1-9]\d*|[1-9]\d*)$/u;
const maxDocumentsPerChunk = 40;
const maxBytesPerChunk = 8 * 1_024 * 1_024;
const maxWritesPerChunk = 100;
const commitTimeoutMs = 15_000;

export type BackupV3FirestoreExactWriterErrorCode =
  | "commit-failed"
  | "invalid-commit-response"
  | "invalid-plan"
  | "limit-exceeded"
  | "unsafe-environment";

export class BackupV3FirestoreExactWriterError extends Error {
  readonly code: BackupV3FirestoreExactWriterErrorCode;

  constructor(code: BackupV3FirestoreExactWriterErrorCode, message: string) {
    super(message);
    this.name = "BackupV3FirestoreExactWriterError";
    this.code = code;
  }
}

export type BackupV3FirestoreCommitRequest = Readonly<{
  database: string;
  writes: readonly Readonly<Record<string, unknown>>[];
}>;

export type BackupV3FirestoreCommitClient = Readonly<{
  commit: (
    request: BackupV3FirestoreCommitRequest,
    options: Readonly<{ timeoutMs: typeof commitTimeoutMs }>,
  ) => Promise<unknown>;
}>;

export type BackupV3ExactPayloadDocument = Readonly<{
  path: string;
  data: BackupV3CanonicalFirestoreDocument;
}>;

export type BackupV3ExactPayloadPlan = Readonly<{
  client: BackupV3FirestoreCommitClient;
  sourceProjectId: typeof sourceProjectId;
  targetProjectId: typeof targetProjectId;
  academyId: string;
  plannedPaths: readonly string[];
  documents: readonly BackupV3ExactPayloadDocument[];
}>;

type PreparedDocument = Readonly<{
  path: string;
  bytes: number;
  write: Readonly<Record<string, unknown>>;
}>;

function writerError(code: BackupV3FirestoreExactWriterErrorCode, message: string): never {
  throw new BackupV3FirestoreExactWriterError(code, message);
}

function isDenseArray(value: unknown): value is readonly unknown[] {
  if (!Array.isArray(value)) return false;
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== "string") || keys.length !== value.length + 1) {
    return false;
  }
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) return false;
  }
  return keys.includes("length");
}

function assertEnvironment(input: BackupV3ExactPayloadPlan): void {
  if (
    input.sourceProjectId !== sourceProjectId ||
    input.targetProjectId !== targetProjectId ||
    !identifierPattern.test(input.academyId)
  ) {
    writerError("unsafe-environment", "Exact writer project or academy binding is invalid");
  }
}

function timestampKey(value: unknown): string {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return writerError("invalid-commit-response", "Commit timestamp is missing");
  }
  const source = value as Record<string, unknown>;
  const seconds = String(source["seconds"] ?? "");
  const nanos = source["nanos"];
  if (
    !canonicalIntegerPattern.test(seconds) ||
    typeof nanos !== "number" ||
    !Number.isInteger(nanos) ||
    nanos < 0 ||
    nanos > 999_999_999
  ) {
    return writerError("invalid-commit-response", "Commit timestamp is invalid");
  }
  const secondValue = BigInt(seconds);
  if (secondValue < -62_135_596_800n || secondValue > 253_402_300_799n) {
    return writerError("invalid-commit-response", "Commit timestamp is out of range");
  }
  return `${seconds}:${String(nanos)}`;
}

function assertCommitResponse(response: unknown, expectedWriteCount: number): void {
  if (typeof response !== "object" || response === null || Array.isArray(response)) {
    writerError("invalid-commit-response", "Commit response is invalid");
  }
  const record = response as Record<string, unknown>;
  const writeResults = record["writeResults"];
  if (!isDenseArray(writeResults) || writeResults.length !== expectedWriteCount) {
    writerError("invalid-commit-response", "Commit did not prove every write result");
  }
  timestampKey(record["commitTime"]);
  for (const result of writeResults) {
    if (typeof result !== "object" || result === null || Array.isArray(result)) {
      writerError("invalid-commit-response", "Commit write result is invalid");
    }
    timestampKey((result as Record<string, unknown>)["updateTime"]);
  }
}

function uniqueCanonicalPaths(paths: unknown, label: string): readonly string[] {
  if (!isDenseArray(paths)) return writerError("invalid-plan", `${label} is not a dense array`);
  const result: string[] = [];
  const seen = new Set<string>();
  for (const path of paths) {
    if (typeof path !== "string" || path.length === 0 || seen.has(path)) {
      return writerError("invalid-plan", `${label} contains an invalid or duplicate path`);
    }
    seen.add(path);
    result.push(path);
  }
  const sorted = [...result].sort((left, right) => left.localeCompare(right));
  if (sorted.some((path, index) => path !== result[index])) {
    return writerError("invalid-plan", `${label} is not in canonical path order`);
  }
  return Object.freeze(result);
}

function assertMaterializablePath(path: string, academyId: string): void {
  try {
    const classified = classifyBackupV3SourcePath({ academyId, sourcePath: path });
    if (classified.disposition !== "materialize-exact" || classified.targetPath !== path) {
      writerError("invalid-plan", "Exact writer path is not materializable");
    }
  } catch {
    writerError("invalid-plan", "Exact writer path is outside the closed registry");
  }
}

function prepareDocuments(input: BackupV3ExactPayloadPlan): readonly PreparedDocument[] {
  const plannedPaths = uniqueCanonicalPaths(input.plannedPaths, "Exact writer plan");
  if (!isDenseArray(input.documents)) {
    return writerError("invalid-plan", "Exact writer documents are not a dense array");
  }
  if (
    plannedPaths.length !== input.documents.length ||
    plannedPaths.length > BACKUP_V3_LIMITS.payload.maxDocumentCount
  ) {
    return writerError("invalid-plan", "Exact writer plan and document count diverged");
  }
  const sourceDatabase = `projects/${input.sourceProjectId}/databases/(default)/documents`;
  const targetDatabase = `projects/${input.targetProjectId}/databases/(default)`;
  const seen = new Set<string>();
  const prepared: PreparedDocument[] = [];
  let totalBytes = 0;
  for (let index = 0; index < input.documents.length; index += 1) {
    const document = input.documents[index];
    if (
      typeof document !== "object" ||
      document === null ||
      typeof document.path !== "string" ||
      document.path !== plannedPaths[index] ||
      seen.has(document.path)
    ) {
      return writerError("invalid-plan", "Exact writer document does not match its plan");
    }
    seen.add(document.path);
    assertMaterializablePath(document.path, input.academyId);
    let canonical: BackupV3CanonicalFirestoreDocument;
    let fields: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
    try {
      canonical = parseBackupV3FirestoreDocument(document.data, { database: sourceDatabase });
      fields = decodeBackupV3FirestoreDocument(canonical, { database: sourceDatabase });
    } catch {
      return writerError("invalid-plan", "Exact writer document encoding is invalid");
    }
    const targetName = `${targetDatabase}/documents/${document.path}`;
    const bytes =
      Buffer.byteLength(
        canonicalizeMemberDirectoryValue({ path: document.path, data: canonical }),
        "utf8",
      ) +
      Buffer.byteLength(targetName, "utf8") +
      256;
    if (bytes > maxBytesPerChunk) {
      return writerError("limit-exceeded", "Exact writer document exceeds the chunk byte limit");
    }
    totalBytes += bytes;
    if (totalBytes > BACKUP_V3_LIMITS.payload.maxDecodedBytes) {
      return writerError("limit-exceeded", "Exact writer payload exceeds the total byte limit");
    }
    prepared.push(
      Object.freeze({
        path: document.path,
        bytes,
        write: Object.freeze({
          update: Object.freeze({
            name: targetName,
            fields,
          }),
          currentDocument: Object.freeze({ exists: false }),
        }),
      }),
    );
  }
  return Object.freeze(prepared);
}

function chunks(documents: readonly PreparedDocument[]): readonly (readonly PreparedDocument[])[] {
  const result: PreparedDocument[][] = [];
  let current: PreparedDocument[] = [];
  let currentBytes = 0;
  for (const document of documents) {
    if (
      current.length > 0 &&
      (current.length >= maxDocumentsPerChunk ||
        current.length >= maxWritesPerChunk ||
        currentBytes + document.bytes > maxBytesPerChunk)
    ) {
      result.push(current);
      current = [];
      currentBytes = 0;
    }
    current.push(document);
    currentBytes += document.bytes;
  }
  if (current.length > 0) result.push(current);
  return Object.freeze(result.map((chunk) => Object.freeze(chunk)));
}

async function commitChunk(
  client: BackupV3FirestoreCommitClient,
  request: BackupV3FirestoreCommitRequest,
): Promise<unknown> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      client.commit(request, { timeoutMs: commitTimeoutMs }),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error("Exact Firestore Commit exceeded its deadline")),
          commitTimeoutMs,
        );
      }),
    ]);
  } catch {
    return writerError("commit-failed", "Exact Firestore Commit failed");
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

export async function writeBackupV3FirestorePayloadExact(
  input: BackupV3ExactPayloadPlan,
): Promise<Readonly<{ documentCount: number; chunkCount: number }>> {
  assertEnvironment(input);
  const prepared = prepareDocuments(input);
  const plannedChunks = chunks(prepared);
  const database = `projects/${input.targetProjectId}/databases/(default)`;
  for (const chunk of plannedChunks) {
    if (
      chunk.length > maxDocumentsPerChunk ||
      chunk.length > maxWritesPerChunk ||
      chunk.reduce((total, document) => total + document.bytes, 0) > maxBytesPerChunk
    ) {
      return writerError("limit-exceeded", "Exact writer chunk exceeds a hard limit");
    }
    const response = await commitChunk(input.client, {
      database,
      writes: Object.freeze(chunk.map(({ write }) => write)),
    });
    assertCommitResponse(response, chunk.length);
  }
  return Object.freeze({ documentCount: prepared.length, chunkCount: plannedChunks.length });
}
