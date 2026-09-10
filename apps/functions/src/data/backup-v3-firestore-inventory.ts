import { Buffer } from "node:buffer";

import { canonicalizeMemberDirectoryValue } from "../members/member-directory-crypto.js";
import {
  TENANT_BACKUP_V3_DIRECT_COLLECTIONS,
  TENANT_BACKUP_V3_NESTED_COLLECTIONS,
} from "./backup-v3-contracts.js";
import { encodeBackupV3FirestoreDocument } from "./backup-v3-firestore-value-codec.js";
import type { BackupV3Inventory, BackupV3InventoryEntry } from "./backup-v3-rehearsal.js";

const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const pathControlCharacterPattern = /[\u0000-\u001f\u007f]/u;
const pageSize = 200 as const;
const sourceRootCollections = new Set([
  "academies",
  "memberDirectoryRestoreGuards",
  "memberDirectoryRestoreAttestations",
  "memberDirectoryRestoreAttestationConsumptions",
]);
const targetRootCollections = new Set(["academies", "memberDirectoryRestoreGuards"]);
const academyCollections = new Set([
  ...TENANT_BACKUP_V3_DIRECT_COLLECTIONS,
  "memberDirectoryStates",
  "memberDirectoryCursorStates",
  "memberDirectoryImportSessions",
]);
const studentCollections = new Set<string>(TENANT_BACKUP_V3_NESTED_COLLECTIONS);

export type BackupV3FirestoreInventoryErrorCode =
  | "duplicate-path"
  | "invalid-anchor"
  | "invalid-depth"
  | "invalid-read-time"
  | "limit-exceeded"
  | "malformed-response"
  | "orphan"
  | "out-of-scope-path"
  | "pagination-cycle"
  | "snapshot-not-supported"
  | "unlisted-collection";

export class BackupV3FirestoreInventoryError extends Error {
  readonly code: BackupV3FirestoreInventoryErrorCode;

  constructor(code: BackupV3FirestoreInventoryErrorCode, message: string) {
    super(message);
    this.name = "BackupV3FirestoreInventoryError";
    this.code = code;
  }
}

export type BackupV3FirestoreV1Timestamp = Readonly<{
  seconds?: string | number | bigint | Readonly<{ toString: () => string }> | null;
  nanos?: number | null;
}>;

export type BackupV3FirestoreV1Document = Readonly<{
  name?: string | null;
  fields?: Readonly<Record<string, unknown>> | null;
  createTime?: BackupV3FirestoreV1Timestamp | null;
  updateTime?: BackupV3FirestoreV1Timestamp | null;
}>;

export type BackupV3FirestoreInventoryLimits = Readonly<{
  maxRealDocumentCount: number;
  maxDecodedBytes: number;
  maxVisitedPathCount: number;
}>;

export type BackupV3FirestoreBatchGetRequest = Readonly<{
  database: string;
  documents: readonly string[];
  readTime?: BackupV3FirestoreV1Timestamp;
}>;

export type BackupV3FirestoreListCollectionIdsRequest = Readonly<{
  parent: string;
  pageSize: typeof pageSize;
  pageToken?: string;
  readTime: BackupV3FirestoreV1Timestamp;
}>;

export type BackupV3FirestoreListDocumentsRequest = Readonly<{
  parent: string;
  collectionId: string;
  pageSize: typeof pageSize;
  pageToken?: string;
  readTime: BackupV3FirestoreV1Timestamp;
  showMissing: true;
}>;

export type BackupV3FirestoreInventoryClient = Readonly<{
  batchGetDocuments: (
    request: BackupV3FirestoreBatchGetRequest,
  ) => Promise<readonly Readonly<Record<string, unknown>>[]>;
  listCollectionIds: (
    request: BackupV3FirestoreListCollectionIdsRequest,
  ) => Promise<Readonly<{ collectionIds: readonly string[]; nextPageToken?: string }>>;
  listDocuments: (
    request: BackupV3FirestoreListDocumentsRequest,
  ) => Promise<
    Readonly<{ documents: readonly BackupV3FirestoreV1Document[]; nextPageToken?: string }>
  >;
}>;

type InventoryRole = "source" | "target";

function inventoryError(code: BackupV3FirestoreInventoryErrorCode, message: string): never {
  throw new BackupV3FirestoreInventoryError(code, message);
}

function plainRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function timestamp(value: unknown): Readonly<{
  wire: BackupV3FirestoreV1Timestamp;
  key: string;
  iso: string;
}> {
  if (!plainRecord(value)) {
    return inventoryError("invalid-read-time", "Inventory readTime is missing or invalid");
  }
  const secondsText = String(value["seconds"] ?? "");
  const nanos = value["nanos"];
  if (
    !/^-?\d+$/u.test(secondsText) ||
    typeof nanos !== "number" ||
    !Number.isInteger(nanos) ||
    nanos < 0 ||
    nanos > 999_999_999
  ) {
    return inventoryError("invalid-read-time", "Inventory readTime is missing or invalid");
  }
  const seconds = Number(secondsText);
  if (!Number.isSafeInteger(seconds)) {
    return inventoryError("invalid-read-time", "Inventory readTime is outside the supported range");
  }
  const date = new Date(seconds * 1_000 + Math.floor((nanos as number) / 1_000_000));
  if (Number.isNaN(date.getTime())) {
    return inventoryError("invalid-read-time", "Inventory readTime is outside the supported range");
  }
  return Object.freeze({
    wire: Object.freeze({ seconds: secondsText, nanos }),
    key: `${secondsText}:${String(nanos)}`,
    iso: date.toISOString(),
  });
}

function encodedDocumentData(fields: unknown, database: string) {
  try {
    return encodeBackupV3FirestoreDocument(fields, { database });
  } catch {
    return inventoryError(
      "malformed-response",
      "Inventory document contains an unsupported Firestore value",
    );
  }
}

function canonicalRelativePath(database: string, name: unknown): readonly string[] {
  if (typeof name !== "string" || !name.startsWith(`${database}/`)) {
    return inventoryError("out-of-scope-path", "Inventory returned an out-of-project resource");
  }
  const relative = name.slice(database.length + 1);
  if (
    relative.length === 0 ||
    relative.length > 6_144 ||
    relative !== relative.trim() ||
    pathControlCharacterPattern.test(relative)
  ) {
    return inventoryError("out-of-scope-path", "Inventory returned a malformed resource path");
  }
  const segments = relative.split("/");
  if (
    segments.length % 2 !== 0 ||
    segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")
  ) {
    return inventoryError("out-of-scope-path", "Inventory returned a malformed document path");
  }
  return segments;
}

function relativeParent(database: string, parent: string): readonly string[] {
  if (parent === database) return [];
  return canonicalRelativePath(database, parent);
}

function assertAcademyScope(segments: readonly string[], academyId: string): void {
  if (
    (segments[0] === "academies" || segments[0] === "memberDirectoryRestoreGuards") &&
    segments[1] !== academyId
  ) {
    inventoryError("out-of-scope-path", "Inventory crossed the bound academy scope");
  }
}

function allowedCollections(
  role: InventoryRole,
  parentSegments: readonly string[],
  academyId: string,
): ReadonlySet<string> {
  if (parentSegments.length === 0) {
    return role === "source" ? sourceRootCollections : targetRootCollections;
  }
  assertAcademyScope(parentSegments, academyId);
  if (
    parentSegments.length === 2 &&
    parentSegments[0] === "academies" &&
    parentSegments[1] === academyId
  ) {
    return academyCollections;
  }
  if (
    parentSegments.length === 4 &&
    parentSegments[0] === "academies" &&
    parentSegments[1] === academyId &&
    parentSegments[2] === "students"
  ) {
    return studentCollections;
  }
  if (
    parentSegments.length === 2 &&
    parentSegments[0] === "memberDirectoryRestoreGuards" &&
    parentSegments[1] === academyId
  ) {
    return new Set(["events"]);
  }
  return new Set();
}

function assertRegisteredDocument(
  role: InventoryRole,
  academyId: string,
  segments: readonly string[],
): void {
  assertAcademyScope(segments, academyId);
  if (
    segments.length === 2 &&
    ((segments[0] === "academies" && segments[1] === academyId) ||
      (segments[0] === "memberDirectoryRestoreGuards" && segments[1] === academyId) ||
      (role === "source" &&
        (segments[0] === "memberDirectoryRestoreAttestations" ||
          segments[0] === "memberDirectoryRestoreAttestationConsumptions")))
  ) {
    return;
  }
  if (
    segments.length === 4 &&
    segments[0] === "academies" &&
    segments[1] === academyId &&
    academyCollections.has(segments[2]!) &&
    (segments[2] !== "memberDirectoryStates" || segments[3] === "current")
  ) {
    return;
  }
  if (
    segments.length === 4 &&
    segments[0] === "memberDirectoryRestoreGuards" &&
    segments[1] === academyId &&
    segments[2] === "events" &&
    /^\d+$/u.test(segments[3]!)
  ) {
    return;
  }
  if (
    segments.length === 6 &&
    segments[0] === "academies" &&
    segments[1] === academyId &&
    segments[2] === "students" &&
    studentCollections.has(segments[4]!)
  ) {
    return;
  }
  inventoryError(
    segments.length > 6 ? "invalid-depth" : "out-of-scope-path",
    "Inventory returned a document outside the versioned registry",
  );
}

function nextToken(value: unknown, seen: Set<string>): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || value.length > 8_192 || seen.has(value)) {
    return inventoryError("pagination-cycle", "Inventory pagination token is invalid or repeated");
  }
  seen.add(value);
  return value;
}

function anchorNames(database: string, academyId: string, role: InventoryRole): readonly string[] {
  return role === "source"
    ? [
        `${database}/academies/${academyId}/memberDirectoryStates/current`,
        `${database}/memberDirectoryRestoreGuards/${academyId}`,
      ]
    : [`${database}/backupV3InventorySentinels/${projectSentinelId(database)}`];
}

function projectSentinelId(database: string): string {
  const match = /^projects\/([^/]+)\/databases\/\(default\)\/documents$/u.exec(database);
  if (match?.[1] === undefined) {
    return inventoryError("invalid-anchor", "Inventory database binding is invalid");
  }
  return match[1];
}

async function boundReadTime(
  input: Readonly<{
    client: BackupV3FirestoreInventoryClient;
    database: string;
    academyId: string;
    role: InventoryRole;
    expected?: Readonly<{ wire: BackupV3FirestoreV1Timestamp; key: string }>;
  }>,
): Promise<Readonly<{ wire: BackupV3FirestoreV1Timestamp; key: string; iso: string }>> {
  const names = anchorNames(input.database, input.academyId, input.role);
  let responses: readonly Readonly<Record<string, unknown>>[];
  try {
    responses = await input.client.batchGetDocuments({
      database: input.database.replace(/\/documents$/u, ""),
      documents: names,
      ...(input.expected === undefined ? {} : { readTime: input.expected.wire }),
    });
  } catch {
    return inventoryError("snapshot-not-supported", "Inventory snapshot batch-get is unsupported");
  }
  const seen = new Set<string>();
  let result:
    Readonly<{ wire: BackupV3FirestoreV1Timestamp; key: string; iso: string }> | undefined;
  for (const response of responses) {
    const parsedTime = timestamp(response["readTime"]);
    if (
      (result !== undefined && parsedTime.key !== result.key) ||
      (input.expected !== undefined && parsedTime.key !== input.expected.key)
    ) {
      return inventoryError("invalid-read-time", "Inventory readTime changed within one snapshot");
    }
    result ??= parsedTime;
    const found = response["found"];
    const missing = response["missing"];
    const hasFound = plainRecord(found);
    const hasMissing = typeof missing === "string";
    if (hasFound === hasMissing) {
      return inventoryError("invalid-anchor", "Inventory snapshot anchor result is ambiguous");
    }
    const foundName = hasFound ? found["name"] : undefined;
    const name = typeof foundName === "string" ? foundName : missing;
    if (typeof name !== "string" || seen.has(name) || !names.includes(name)) {
      return inventoryError("invalid-anchor", "Inventory snapshot anchor response is invalid");
    }
    if ((input.role === "source" && !hasFound) || (input.role === "target" && !hasMissing)) {
      return inventoryError("invalid-anchor", "Inventory snapshot anchor state is invalid");
    }
    seen.add(name);
  }
  if (result === undefined) {
    return inventoryError("invalid-read-time", "Inventory readTime is missing");
  }
  if (seen.size !== names.length) {
    return inventoryError("invalid-anchor", "Inventory snapshot anchor set is incomplete");
  }
  return result;
}

async function collectionIdsForParent(
  input: Readonly<{
    client: BackupV3FirestoreInventoryClient;
    parent: string;
    readTime: BackupV3FirestoreV1Timestamp;
  }>,
): Promise<readonly string[]> {
  const ids: string[] = [];
  const seenIds = new Set<string>();
  const seenTokens = new Set<string>();
  let pageToken: string | undefined;
  do {
    let page: Readonly<{ collectionIds: readonly string[]; nextPageToken?: string }>;
    try {
      page = await input.client.listCollectionIds({
        parent: input.parent,
        pageSize,
        readTime: input.readTime,
        ...(pageToken === undefined ? {} : { pageToken }),
      });
    } catch {
      return inventoryError(
        "snapshot-not-supported",
        "Inventory collection snapshot is unsupported",
      );
    }
    if (
      !plainRecord(page) ||
      !Array.isArray(page.collectionIds) ||
      page.collectionIds.length > pageSize
    ) {
      return inventoryError("malformed-response", "Inventory collection page is invalid");
    }
    for (const id of page.collectionIds) {
      if (
        typeof id !== "string" ||
        id.length === 0 ||
        id.length > 1_500 ||
        id.includes("/") ||
        pathControlCharacterPattern.test(id) ||
        seenIds.has(id)
      ) {
        return inventoryError("duplicate-path", "Inventory collection ID is invalid or duplicated");
      }
      seenIds.add(id);
      ids.push(id);
    }
    pageToken = nextToken(page.nextPageToken, seenTokens);
  } while (pageToken !== undefined);
  ids.sort((left, right) => left.localeCompare(right));
  return Object.freeze(ids);
}

async function documentsForCollection(
  input: Readonly<{
    client: BackupV3FirestoreInventoryClient;
    parent: string;
    collectionId: string;
    readTime: BackupV3FirestoreV1Timestamp;
  }>,
): Promise<readonly BackupV3FirestoreV1Document[]> {
  const documents: BackupV3FirestoreV1Document[] = [];
  const seenTokens = new Set<string>();
  let pageToken: string | undefined;
  do {
    let page: Readonly<{
      documents: readonly BackupV3FirestoreV1Document[];
      nextPageToken?: string;
    }>;
    try {
      page = await input.client.listDocuments({
        parent: input.parent,
        collectionId: input.collectionId,
        pageSize,
        readTime: input.readTime,
        showMissing: true,
        ...(pageToken === undefined ? {} : { pageToken }),
      });
    } catch {
      return inventoryError(
        "snapshot-not-supported",
        "Inventory showMissing snapshot is unsupported",
      );
    }
    if (!plainRecord(page) || !Array.isArray(page.documents) || page.documents.length > pageSize) {
      return inventoryError("malformed-response", "Inventory document page is invalid");
    }
    documents.push(...page.documents);
    pageToken = nextToken(page.nextPageToken, seenTokens);
  } while (pageToken !== undefined);
  return Object.freeze(documents);
}

async function assertShowMissingCapability(
  input: Readonly<{
    client: BackupV3FirestoreInventoryClient;
    database: string;
    readTime: BackupV3FirestoreV1Timestamp;
  }>,
): Promise<void> {
  const probe = await documentsForCollection({
    client: input.client,
    parent: input.database,
    collectionId: "backupV3InventorySentinels",
    readTime: input.readTime,
  });
  if (probe.length !== 0) {
    inventoryError("out-of-scope-path", "Inventory sentinel collection is not empty");
  }
}

function productionBudget(limits: BackupV3FirestoreInventoryLimits): void {
  for (const value of [
    limits.maxRealDocumentCount,
    limits.maxDecodedBytes,
    limits.maxVisitedPathCount,
  ]) {
    if (!Number.isSafeInteger(value) || value < 0) {
      inventoryError("limit-exceeded", "Inventory budget is invalid");
    }
  }
}

export async function readBackupV3FirestoreNamespaceInventory(
  input: Readonly<{
    client: BackupV3FirestoreInventoryClient;
    projectId: string;
    academyId: string;
    role: InventoryRole;
    limits: BackupV3FirestoreInventoryLimits;
  }>,
): Promise<BackupV3Inventory> {
  if (!identifierPattern.test(input.projectId) || !identifierPattern.test(input.academyId)) {
    return inventoryError("out-of-scope-path", "Inventory binding is invalid");
  }
  productionBudget(input.limits);
  const database = `projects/${input.projectId}/databases/(default)/documents`;
  const snapshot = await boundReadTime({
    client: input.client,
    database,
    academyId: input.academyId,
    role: input.role,
  });
  await assertShowMissingCapability({
    client: input.client,
    database,
    readTime: snapshot.wire,
  });

  const entries: BackupV3InventoryEntry[] = [];
  const seenDocuments = new Set<string>();
  const queuedParents = new Set<string>([database]);
  const queue = [database];
  let realDocumentCount = 0;
  let decodedBytes = 0;
  while (queue.length > 0) {
    const parent = queue.shift()!;
    const parentSegments = relativeParent(database, parent);
    const allowed = allowedCollections(input.role, parentSegments, input.academyId);
    const collectionIds = await collectionIdsForParent({
      client: input.client,
      parent,
      readTime: snapshot.wire,
    });
    if (collectionIds.length > 0 && allowed.size === 0) {
      return inventoryError(
        "invalid-depth",
        "Inventory discovered a collection beyond the registry depth",
      );
    }
    for (const collectionId of collectionIds) {
      if (!allowed.has(collectionId)) {
        return inventoryError("unlisted-collection", "Inventory collection is not in the registry");
      }
      const documents = await documentsForCollection({
        client: input.client,
        parent,
        collectionId,
        readTime: snapshot.wire,
      });
      if (documents.length === 0) {
        return inventoryError(
          "snapshot-not-supported",
          "Inventory showMissing omitted a collection member",
        );
      }
      for (const document of documents) {
        const segments = canonicalRelativePath(database, document.name);
        const expectedLength = parentSegments.length + 2;
        if (
          segments.length !== expectedLength ||
          segments[expectedLength - 2] !== collectionId ||
          segments.slice(0, parentSegments.length).join("/") !== parentSegments.join("/")
        ) {
          return inventoryError(
            "out-of-scope-path",
            "Inventory document escaped its requested parent",
          );
        }
        assertRegisteredDocument(input.role, input.academyId, segments);
        const path = segments.join("/");
        if (seenDocuments.has(path)) {
          return inventoryError("duplicate-path", "Inventory document path is duplicated");
        }
        seenDocuments.add(path);
        if (seenDocuments.size > input.limits.maxVisitedPathCount) {
          return inventoryError("limit-exceeded", "Inventory visited-path budget was exceeded");
        }

        const hasFields = document.fields !== undefined && document.fields !== null;
        const hasCreateTime = document.createTime !== undefined && document.createTime !== null;
        const hasUpdateTime = document.updateTime !== undefined && document.updateTime !== null;
        if (!hasFields && !hasCreateTime && !hasUpdateTime) {
          if (path !== `academies/${input.academyId}`) {
            return inventoryError("orphan", "Inventory discovered a missing non-structural parent");
          }
          entries.push(Object.freeze({ path, exists: false as const }));
        } else {
          if (!hasFields || !hasCreateTime || !hasUpdateTime) {
            return inventoryError(
              "malformed-response",
              "Inventory document presence envelope is invalid",
            );
          }
          timestamp(document.createTime);
          timestamp(document.updateTime);
          const data = encodedDocumentData(document.fields, database);
          realDocumentCount += 1;
          decodedBytes += Buffer.byteLength(
            canonicalizeMemberDirectoryValue({ path, data }),
            "utf8",
          );
          if (
            realDocumentCount > input.limits.maxRealDocumentCount ||
            decodedBytes > input.limits.maxDecodedBytes
          ) {
            return inventoryError("limit-exceeded", "Inventory document budget was exceeded");
          }
          entries.push(Object.freeze({ path, exists: true as const, data }));
        }
        const childParent = `${database}/${path}`;
        if (queuedParents.has(childParent)) {
          return inventoryError("duplicate-path", "Inventory parent queue is duplicated");
        }
        queuedParents.add(childParent);
        queue.push(childParent);
      }
    }
    queue.sort((left, right) => left.localeCompare(right));
  }

  await boundReadTime({
    client: input.client,
    database,
    academyId: input.academyId,
    role: input.role,
    expected: snapshot,
  });
  entries.sort((left, right) => left.path.localeCompare(right.path));
  return Object.freeze({
    projectId: input.projectId,
    readTime: snapshot.iso,
    entries: Object.freeze(entries),
  });
}
