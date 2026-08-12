import { createHash } from "node:crypto";
import { createRequire } from "node:module";

import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { HttpsError, onCall, type CallableRequest } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { z } from "zod";

import {
  memberGenders,
  memberReportKeys,
  parseMemberImportPreview,
  parseMemberSearchFilters,
  type MemberImportPreview,
  type MemberReportKey,
} from "@bpt-jersey/domain";
import { requireAdminActor } from "../auth/admin-authorization.js";
import {
  createR2ClientFromEnvironment,
  type R2Client,
  validatePdfUpload,
} from "../storage/r2-client.js";
import { createMemberReportPdf, type MemberReportPdfGenerator } from "./member-report-pdf.js";
import {
  createFirestoreMemberStore,
  createMemberService,
  attachMemberImportPreviewSource,
  MAX_MEMBER_REPORT_ROWS,
  type MemberCreationInput,
  type MemberService,
} from "./member-service.js";
import {
  normalizeImportValue,
  resolveMemberImportMatch,
  type MemberImportMatch,
} from "./member-service.js";
import {
  createFirestoreMemberImportPreviewStore,
  type MemberImportPreviewRecord,
  type MemberImportPreviewStore,
} from "./member-import-storage.js";
import {
  deduplicateMemberRows,
  getParsedMemberStableKey,
  MemberPdfImportLimitError,
  parseMemberReport,
  type ParsedMemberRow,
  type ParsedMemberReport,
} from "./member-pdf-import.js";

export { MAX_MEMBER_REPORT_ROWS, MAX_MEMBER_SEARCH_ROWS } from "./member-service.js";

const text = z.string().trim().min(1);
const createMemberSchema = z.strictObject({
  membershipNumber: text.optional(),
  fullName: text,
  email: z.string().email().optional(),
  idCardNumber: text.optional(),
  vatNumber: text.optional(),
  birthDate: text.optional(),
  mobileNumber: text.optional(),
  frequency: text.optional(),
  gender: z.enum(memberGenders).optional(),
  trainingCenter: text.optional(),
});
const searchSchema = z.strictObject({
  filters: z.unknown().optional(),
  pageToken: text.optional(),
});
const reportSchema = z.strictObject({ report: z.enum(memberReportKeys) });
const importSessionSchema = z.strictObject({
  files: z
    .array(z.strictObject({ fileName: text, contentType: z.string(), sizeBytes: z.number() }))
    .min(1)
    .max(5),
});
const sessionIdSchema = z.strictObject({ sessionId: text });
const confirmImportSchema = z.strictObject({
  sessionId: text,
  previewId: text,
  confirm: z.literal(true),
});

const MAX_CLEANUP_ATTEMPTS = 5;
const MAX_MEMBER_IMPORT_FILES = 5;
const MAX_MEMBER_IMPORT_ROWS = MAX_MEMBER_REPORT_ROWS;
const MAX_EXPIRED_PREVIEWS_PER_CLEANUP = 100;
const CLEANUP_BACKOFF_BASE_MS = 60_000;
const CLEANUP_BACKOFF_MAX_MS = 15 * 60_000;
const CLEANUP_LEASE_MS = 5 * 60_000;
const CLEANUP_JOURNAL_UNAVAILABLE = "Member import cleanup journal unavailable";
const CLEANUP_JOURNAL_INVALID = "Member import cleanup journal invalid or missing";
const MEMBER_IMPORT_PREVIEW_ID_PATTERN =
  /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
export const MAX_MEMBER_REPORT_PDF_BYTES = 10 * 1024 * 1024;
const REPORT_RATE_LIMIT_MAX_REQUESTS = 5;
const REPORT_RATE_LIMIT_WINDOW_MS = 5 * 60 * 1000;
const REPORT_EXPORT_PREFIX = "member-report-export:";

export function createMemberReportRateLimitKey(academyId: string, actorId: string): string {
  return createHash("sha256")
    .update(`${academyId.length}:${academyId}${actorId.length}:${actorId}`, "utf8")
    .digest("hex");
}

export type MemberImportCleanupStatus = "pending" | "failed";
export type CleanupJournalStatus = "pending" | "running" | "failed" | "completed";

export type CleanupJournalEntry = Readonly<{
  sessionId: string;
  objectKeys: readonly string[];
  attempts: number;
  nextCleanupAt: string;
  lastError: string;
  status: CleanupJournalStatus;
  kind?: "import" | "report-export";
  leaseId?: string;
  leaseUntil?: string;
}>;

export type MemberReportExportSession = Readonly<{
  sessionId: string;
  academyId: string;
  report: MemberReportKey;
  objectKey: string;
  createdAt: string;
  expiresAt: string;
  status: "pending" | "uploaded" | "failed" | "completed";
  lastError?: string;
}>;

export type MemberReportExportStore = Readonly<{
  save: (session: MemberReportExportSession) => Promise<void>;
  get: (sessionId: string) => Promise<MemberReportExportSession | undefined>;
  remove: (sessionId: string) => Promise<void>;
}>;

export type MemberReportRateLimiter = Readonly<{
  consume: (
    input: Readonly<{
      academyId: string;
      actorId: string;
      scope: string;
      now: Date;
    }>,
  ) => Promise<void>;
}>;

export type MemberReportRateLimiterOptions = Readonly<{
  maxRequests?: number;
  windowMs?: number;
}>;

export type ImportSession = Readonly<{
  sessionId: string;
  academyId: string;
  objectKeys: readonly string[];
  expiresAt: string;
  cleanupAttempts: number;
  nextCleanupAt: string;
  cleanupStatus: MemberImportCleanupStatus;
  lastCleanupError?: string;
  preview?: MemberImportPreview;
  previewState?: "pending" | "invalidated";
}>;

export type MemberImportSessionStore = Readonly<{
  save: (session: ImportSession) => Promise<void>;
  get: (sessionId: string) => Promise<ImportSession | undefined>;
  remove: (sessionId: string) => Promise<void>;
  listExpired: (now: string) => Promise<readonly ImportSession[]>;
}>;

export type MemberImportCleanupJournal = Readonly<{
  save: (entry: CleanupJournalEntry) => Promise<void>;
  get: (sessionId: string) => Promise<CleanupJournalEntry | undefined>;
  listDue: (now: string) => Promise<readonly CleanupJournalEntry[]>;
  claim: (
    candidate: CleanupJournalEntry,
    now: string,
    leaseId: string,
    leaseDurationMs: number,
  ) => Promise<CleanupJournalEntry | undefined>;
  recordFailure: (sessionId: string, leaseId: string, now: Date) => Promise<void>;
  complete: (sessionId: string, leaseId: string) => Promise<void>;
}>;

export function createMemoryMemberImportSessionStore(): MemberImportSessionStore {
  const sessions = new Map<string, ImportSession>();
  return {
    save: async (session) => {
      const persisted = {
        ...session,
        ...(session.previewState === undefined ? { previewState: "pending" as const } : {}),
      };
      sessions.set(session.sessionId, persisted);
    },
    get: async (sessionId) => sessions.get(sessionId),
    remove: async (sessionId) => {
      sessions.delete(sessionId);
    },
    listExpired: async (now) =>
      [...sessions.values()].filter(
        (session) =>
          session.expiresAt <= now &&
          session.nextCleanupAt <= now &&
          session.cleanupAttempts < MAX_CLEANUP_ATTEMPTS &&
          session.cleanupStatus !== "failed",
      ),
  };
}

export { createMemoryMemberImportPreviewStore } from "./member-import-storage.js";

export function createMemoryMemberImportCleanupJournal(): MemberImportCleanupJournal {
  const entries = new Map<string, CleanupJournalEntry>();
  return {
    save: async (entry) => {
      entries.set(entry.sessionId, entry);
    },
    get: async (sessionId) => entries.get(sessionId),
    listDue: async (now) =>
      [...entries.values()].filter(
        (entry) =>
          (entry.status === "pending" || entry.status === "running") &&
          entry.attempts < MAX_CLEANUP_ATTEMPTS &&
          entry.nextCleanupAt <= now &&
          (entry.leaseUntil === undefined || entry.leaseUntil <= now),
      ),
    claim: async (candidate, now, leaseId, leaseDurationMs) => {
      const current = entries.get(candidate.sessionId);
      const source = current ?? candidate;
      const claimed = claimCleanupEntry(source, now, leaseId, leaseDurationMs);
      if (!claimed) return undefined;
      entries.set(candidate.sessionId, claimed);
      return claimed;
    },
    recordFailure: async (sessionId, leaseId) => {
      const current = entries.get(sessionId);
      if (!current || current.leaseId !== leaseId) {
        throw new Error("Cleanup claim is no longer owned");
      }
      entries.set(sessionId, nextCleanupFailure(current));
    },
    complete: async (sessionId, leaseId) => {
      const current = entries.get(sessionId);
      if (!current || current.leaseId !== leaseId) {
        throw new Error("Cleanup claim is no longer owned");
      }
      entries.set(
        sessionId,
        clearCleanupLease({ ...current, status: "completed", lastError: "Cleanup completed" }),
      );
    },
  };
}

export function createMemoryMemberReportExportStore(): MemberReportExportStore {
  const sessions = new Map<string, MemberReportExportSession>();
  return {
    save: async (session) => {
      sessions.set(session.sessionId, session);
    },
    get: async (sessionId) => sessions.get(sessionId),
    remove: async (sessionId) => {
      sessions.delete(sessionId);
    },
  };
}

export function createMemoryMemberReportRateLimiter(
  options: MemberReportRateLimiterOptions = {},
): MemberReportRateLimiter {
  const maxRequests = options.maxRequests ?? REPORT_RATE_LIMIT_MAX_REQUESTS;
  const windowMs = options.windowMs ?? REPORT_RATE_LIMIT_WINDOW_MS;
  const windows = new Map<string, { startedAt: number; count: number }>();
  return {
    consume: async ({ academyId, actorId, scope, now }) => {
      const key = createMemberReportRateLimitKey(academyId, `${actorId}:${scope}`);
      const current = windows.get(key);
      const timestamp = now.getTime();
      if (current && timestamp - current.startedAt < windowMs) {
        if (current.count >= maxRequests) {
          throw new HttpsError("resource-exhausted", "Report export is temporarily unavailable");
        }
        current.count += 1;
        return;
      }
      windows.set(key, { startedAt: timestamp, count: 1 });
    },
  };
}

export function createFirestoreMemberReportExportStore(
  firestore: Firestore = getFirestore(),
): MemberReportExportStore {
  const collection = firestore.collection("memberReportExports");
  return {
    save: async (session) => {
      await collection.doc(session.sessionId).set(session);
    },
    get: async (sessionId) => {
      const snapshot = await collection.doc(sessionId).get();
      if (!snapshot.exists) return undefined;
      const value = snapshot.data() ?? {};
      if (
        value.sessionId !== sessionId ||
        typeof value.sessionId !== "string" ||
        typeof value.academyId !== "string" ||
        typeof value.report !== "string" ||
        !memberReportKeys.includes(value.report as MemberReportKey) ||
        typeof value.objectKey !== "string" ||
        typeof value.createdAt !== "string" ||
        typeof value.expiresAt !== "string" ||
        !["pending", "uploaded", "failed", "completed"].includes(value.status as string)
      ) {
        throw new Error("Member report export journal is invalid");
      }
      return value as MemberReportExportSession;
    },
    remove: async (sessionId) => {
      await collection.doc(sessionId).delete();
    },
  };
}

export function createFirestoreMemberReportRateLimiter(
  firestore: Firestore = getFirestore(),
  options: MemberReportRateLimiterOptions = {},
): MemberReportRateLimiter {
  const maxRequests = options.maxRequests ?? REPORT_RATE_LIMIT_MAX_REQUESTS;
  const windowMs = options.windowMs ?? REPORT_RATE_LIMIT_WINDOW_MS;
  const collection = firestore.collection("memberReportRateLimits");
  return {
    consume: async ({ academyId, actorId, scope, now }) => {
      const reference = collection.doc(
        createMemberReportRateLimitKey(academyId, `${actorId}:${scope}`),
      );
      const nowMs = now.getTime();
      await firestore.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(reference);
        const value = snapshot.exists ? snapshot.data() : undefined;
        const startedAt = typeof value?.startedAt === "number" ? value.startedAt : nowMs;
        const count = typeof value?.count === "number" ? value.count : 0;
        if (nowMs - startedAt < windowMs && count >= maxRequests) {
          throw new HttpsError("resource-exhausted", "Report export is temporarily unavailable");
        }
        transaction.set(
          reference,
          nowMs - startedAt < windowMs
            ? { startedAt, count: count + 1 }
            : { startedAt: nowMs, count: 1 },
        );
      });
    },
  };
}

export function parseMemberImportSession(value: unknown): ImportSession | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const data = value as Record<string, unknown>;
  if (
    typeof data.sessionId !== "string" ||
    typeof data.academyId !== "string" ||
    typeof data.expiresAt !== "string" ||
    typeof data.nextCleanupAt !== "string" ||
    (data.previewState !== "pending" && data.previewState !== "invalidated") ||
    !Array.isArray(data.objectKeys) ||
    data.objectKeys.length === 0 ||
    data.objectKeys.length > MAX_MEMBER_IMPORT_FILES ||
    !data.objectKeys.every((key) => typeof key === "string")
  ) {
    return undefined;
  }
  const objectPrefix = `academies/${data.academyId}/member-imports/${data.sessionId}/`;
  if (
    data.objectKeys.some(
      (key) =>
        key.length > 512 ||
        !key.startsWith(objectPrefix) ||
        key.includes("..") ||
        key.includes("//") ||
        key.includes("\\") ||
        key.slice(objectPrefix.length).length === 0,
    )
  ) {
    return undefined;
  }
  const cleanupAttempts = data.cleanupAttempts === undefined ? 0 : data.cleanupAttempts;
  const nextCleanupAt = data.nextCleanupAt;
  const cleanupStatus = data.cleanupStatus === undefined ? "pending" : data.cleanupStatus;
  if (
    typeof cleanupAttempts !== "number" ||
    !Number.isSafeInteger(cleanupAttempts) ||
    cleanupAttempts < 0 ||
    typeof nextCleanupAt !== "string" ||
    (cleanupStatus !== "pending" && cleanupStatus !== "failed") ||
    (data.lastCleanupError !== undefined && typeof data.lastCleanupError !== "string")
  ) {
    return undefined;
  }
  if (!isCanonicalIsoDate(data.expiresAt) || !isCanonicalIsoDate(nextCleanupAt)) return undefined;
  const parsedCleanupStatus: MemberImportCleanupStatus =
    cleanupStatus === "failed" ? "failed" : "pending";
  const previewResult =
    data.preview === undefined ? undefined : parseMemberImportPreview(data.preview);
  if (
    previewResult !== undefined &&
    (!previewResult.ok || previewResult.value.expiresAt !== data.expiresAt)
  ) {
    return undefined;
  }
  return Object.freeze({
    sessionId: data.sessionId,
    academyId: data.academyId,
    objectKeys: Object.freeze(data.objectKeys as string[]),
    expiresAt: data.expiresAt,
    cleanupAttempts,
    nextCleanupAt,
    cleanupStatus: parsedCleanupStatus,
    ...(data.lastCleanupError === undefined ? {} : { lastCleanupError: data.lastCleanupError }),
    ...(previewResult ? { preview: previewResult.value } : {}),
    previewState: data.previewState,
  });
}

function isCanonicalIsoDate(value: string): boolean {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}

export function createFirestoreMemberImportSessionStore(
  firestore: Firestore = getFirestore(),
): MemberImportSessionStore {
  const collection = firestore.collection("memberImportSessions");
  return {
    save: async (session) => {
      await collection.doc(session.sessionId).set(session);
    },
    get: async (sessionId) => {
      const snapshot = await collection.doc(sessionId).get();
      return snapshot.exists ? parseMemberImportSession(snapshot.data()) : undefined;
    },
    remove: async (sessionId) => {
      await collection.doc(sessionId).delete();
    },
    listExpired: async (now) => {
      const snapshot = await collection.get();
      return snapshot.docs
        .map((document) => parseMemberImportSession(document.data()))
        .filter(
          (session): session is ImportSession =>
            session !== undefined &&
            session.expiresAt <= now &&
            session.nextCleanupAt <= now &&
            session.cleanupAttempts < MAX_CLEANUP_ATTEMPTS &&
            session.cleanupStatus !== "failed",
        );
    },
  };
}

function parseCleanupJournalEntry(value: unknown): CleanupJournalEntry | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const data = value as Record<string, unknown>;
  if (
    typeof data.sessionId !== "string" ||
    !Array.isArray(data.objectKeys) ||
    !data.objectKeys.every((key) => typeof key === "string") ||
    typeof data.attempts !== "number" ||
    !Number.isSafeInteger(data.attempts) ||
    data.attempts < 0 ||
    !isIsoDate(data.nextCleanupAt) ||
    typeof data.lastError !== "string" ||
    (data.status !== "pending" &&
      data.status !== "running" &&
      data.status !== "failed" &&
      data.status !== "completed") ||
    (data.leaseId !== undefined && typeof data.leaseId !== "string") ||
    (data.leaseUntil !== undefined && !isIsoDate(data.leaseUntil)) ||
    (data.leaseId === undefined) !== (data.leaseUntil === undefined) ||
    (data.status === "running" && (data.leaseId === undefined || data.leaseUntil === undefined)) ||
    (data.status !== "running" && data.leaseId !== undefined) ||
    (data.kind !== undefined && data.kind !== "import" && data.kind !== "report-export")
  ) {
    return undefined;
  }
  return Object.freeze({
    sessionId: data.sessionId,
    objectKeys: Object.freeze(data.objectKeys as string[]),
    attempts: data.attempts,
    nextCleanupAt: data.nextCleanupAt,
    lastError: data.lastError,
    status: data.status,
    ...(data.kind === undefined ? {} : { kind: data.kind }),
    ...(data.leaseId === undefined ? {} : { leaseId: data.leaseId }),
    ...(data.leaseUntil === undefined ? {} : { leaseUntil: data.leaseUntil }),
  });
}

function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}

function clearCleanupLease(entry: CleanupJournalEntry): CleanupJournalEntry {
  const withoutLease = { ...entry };
  delete withoutLease.leaseId;
  delete withoutLease.leaseUntil;
  return Object.freeze(withoutLease);
}

function nextCleanupFailure(entry: CleanupJournalEntry): CleanupJournalEntry {
  return clearCleanupLease({
    ...entry,
    status: entry.attempts >= MAX_CLEANUP_ATTEMPTS ? "failed" : "pending",
    lastError: "R2 cleanup failed",
  });
}

function claimCleanupEntry(
  source: CleanupJournalEntry,
  now: string,
  leaseId: string,
  leaseDurationMs: number,
): CleanupJournalEntry | undefined {
  if (
    source.status === "failed" ||
    source.status === "completed" ||
    source.attempts >= MAX_CLEANUP_ATTEMPTS ||
    source.nextCleanupAt > now ||
    (source.leaseUntil !== undefined && source.leaseUntil > now)
  ) {
    return undefined;
  }
  const attempts = source.attempts + 1;
  const backoffMs = Math.min(
    CLEANUP_BACKOFF_BASE_MS * 2 ** Math.max(0, attempts - 1),
    CLEANUP_BACKOFF_MAX_MS,
  );
  return Object.freeze({
    ...source,
    attempts,
    nextCleanupAt: new Date(Date.parse(now) + backoffMs).toISOString(),
    status: "running",
    leaseId,
    leaseUntil: new Date(Date.parse(now) + leaseDurationMs).toISOString(),
  });
}

export function createFirestoreMemberImportCleanupJournal(
  firestore: Firestore = getFirestore(),
): MemberImportCleanupJournal {
  const collection = firestore.collection("memberImportCleanupJournal");
  return {
    save: async (entry) => {
      await collection.doc(entry.sessionId).set(entry);
    },
    get: async (sessionId) => {
      const snapshot = await collection.doc(sessionId).get();
      return snapshot.exists ? parseCleanupJournalEntry(snapshot.data()) : undefined;
    },
    listDue: async (now) => {
      const snapshot = await collection.get();
      const entries = snapshot.docs.map((document) => parseCleanupJournalEntry(document.data()));
      if (entries.some((entry) => entry === undefined)) throw new Error(CLEANUP_JOURNAL_INVALID);
      return entries.filter(
        (entry): entry is CleanupJournalEntry =>
          entry !== undefined &&
          (entry.status === "pending" || entry.status === "running") &&
          entry.attempts < MAX_CLEANUP_ATTEMPTS &&
          entry.nextCleanupAt <= now &&
          (entry.leaseUntil === undefined || entry.leaseUntil <= now),
      );
    },
    claim: async (candidate, now, leaseId, leaseDurationMs) => {
      const reference = collection.doc(candidate.sessionId);
      let claimed: CleanupJournalEntry | undefined;
      await firestore.runTransaction(async (transaction) => {
        claimed = undefined;
        const snapshot = await transaction.get(reference);
        const current = snapshot.exists ? parseCleanupJournalEntry(snapshot.data()) : undefined;
        if (snapshot.exists && current === undefined) {
          throw new Error(CLEANUP_JOURNAL_INVALID);
        }
        const source = current ?? candidate;
        claimed = claimCleanupEntry(source, now, leaseId, leaseDurationMs);
        if (claimed) transaction.set(reference, claimed);
      });
      return claimed;
    },
    recordFailure: async (sessionId, leaseId) => {
      const reference = collection.doc(sessionId);
      await firestore.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(reference);
        const current = snapshot.exists ? parseCleanupJournalEntry(snapshot.data()) : undefined;
        if (!current || current.leaseId !== leaseId) {
          throw new Error("Cleanup claim is no longer owned");
        }
        transaction.set(reference, nextCleanupFailure(current));
      });
    },
    complete: async (sessionId, leaseId) => {
      const reference = collection.doc(sessionId);
      await firestore.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(reference);
        const current = snapshot.exists ? parseCleanupJournalEntry(snapshot.data()) : undefined;
        if (!current || current.leaseId !== leaseId) {
          throw new Error("Cleanup claim is no longer owned");
        }
        transaction.set(
          reference,
          clearCleanupLease({ ...current, status: "completed", lastError: "Cleanup completed" }),
        );
      });
    },
  };
}

export type MemberCallableServices = Readonly<{
  memberService: MemberService;
  r2: R2Client;
  sessions: MemberImportSessionStore;
  cleanupJournal: MemberImportCleanupJournal;
  reportExports: MemberReportExportStore;
  reportRateLimiter: MemberReportRateLimiter;
  previewStore?: MemberImportPreviewStore;
  pdfTextExtractor?: (bytes: Uint8Array) => Promise<string>;
  reportPdf?: MemberReportPdfGenerator;
  now?: () => Date;
  createId?: () => string;
}>;

function nowOf(services: MemberCallableServices): Date {
  return services.now?.() ?? new Date();
}

function idOf(services: MemberCallableServices): string {
  return services.createId?.() ?? crypto.randomUUID();
}

function parseRequest<T>(request: CallableRequest, schema: z.ZodType<T>): T {
  const result = schema.safeParse(request.data === undefined ? {} : request.data);
  if (!result.success) throw new HttpsError("invalid-argument", "Request payload is invalid");
  return result.data;
}

function assertSessionScope(session: ImportSession, academyId: string, now: string): void {
  const expiresAt = Date.parse(session.expiresAt);
  const nowTimestamp = Date.parse(now);
  if (
    !Number.isFinite(expiresAt) ||
    !Number.isFinite(nowTimestamp) ||
    session.academyId !== academyId ||
    expiresAt <= nowTimestamp
  ) {
    throw new HttpsError("permission-denied", "Import session is unavailable");
  }
}

function assertSessionPreviewRelation(
  session: ImportSession,
  record: MemberImportPreviewRecord,
  actorId: string,
  academyId: string,
  now: string,
  options: Readonly<{ allowExpired?: boolean; allowConfirmed?: boolean }> = {},
): void {
  const expiresAt = Date.parse(session.expiresAt);
  const nowTimestamp = Date.parse(now);
  if (
    session.previewState === "invalidated" ||
    !session.preview ||
    session.preview.previewId !== record.previewId ||
    session.preview.previewId !== record.preview.previewId ||
    session.preview.expiresAt !== session.expiresAt ||
    record.expiresAt !== session.expiresAt ||
    record.sessionId !== session.sessionId ||
    record.academyId !== session.academyId ||
    record.academyId !== academyId ||
    record.actorId !== actorId ||
    (record.status !== "pending" && !(options.allowConfirmed && record.status === "confirmed")) ||
    !Number.isFinite(expiresAt) ||
    !Number.isFinite(nowTimestamp) ||
    (!options.allowExpired && expiresAt <= nowTimestamp)
  ) {
    throw new HttpsError("permission-denied", "Import preview is unavailable");
  }
}

function withoutSessionPreview(session: ImportSession): ImportSession {
  const cleared = { ...session };
  delete cleared.preview;
  return cleared;
}

function assertImportSessionShape(session: ImportSession): void {
  if (parseMemberImportSession(session) === undefined) {
    throw new HttpsError("permission-denied", "Import session is unavailable");
  }
}

function importFieldNames(row: ParsedMemberRow, member?: MemberImportMatch): readonly string[] {
  const fields = [
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
  ] as const;
  return Object.freeze(
    fields.filter((field) => {
      const incoming = row[field];
      if (incoming === undefined || incoming === "") return false;
      if (member === undefined) return true;
      const current = member[field];
      return field === "membershipNumber"
        ? normalizeImportValue(incoming) !== normalizeImportValue(current)
        : incoming !== current;
    }),
  );
}

function changeFromRow(row: ParsedMemberRow, fieldNames: readonly string[]) {
  return {
    stableKey: getParsedMemberStableKey(row),
    rowNumbers: [row.sourceRowNumber],
    fieldNames,
  };
}

function changeFromDuplicate(
  duplicate: Readonly<{
    stableKey: string;
    sourceRows: readonly string[];
    fields?: readonly string[];
  }>,
) {
  return {
    stableKey: duplicate.stableKey,
    rowNumbers: duplicate.sourceRows.map((sourceRow) => {
      const rowNumber = Number(sourceRow.slice(sourceRow.lastIndexOf(":") + 1));
      return Number.isSafeInteger(rowNumber) && rowNumber > 0 ? rowNumber : 1;
    }),
    fieldNames: duplicate.fields ?? [],
  };
}

async function parseImportReports(
  services: MemberCallableServices,
  session: ImportSession,
): Promise<Readonly<{ reports: readonly ParsedMemberReport[]; sourceHash: string }>> {
  const reports: ParsedMemberReport[] = [];
  const sourceHashes: string[] = [];
  let totalRows = 0;
  for (const objectKey of session.objectKeys) {
    const bytes = await services.r2.readObject(objectKey);
    if (bytes[0] !== 37 || bytes[1] !== 80 || bytes[2] !== 68 || bytes[3] !== 70) {
      throw new HttpsError("invalid-argument", "Uploaded file is not a PDF");
    }
    const text = await (services.pdfTextExtractor?.(bytes) ?? extractPdfText(bytes));
    try {
      const report = parseMemberReport(text, { maxRows: MAX_MEMBER_IMPORT_ROWS });
      totalRows += report.rows.length;
      if (totalRows > MAX_MEMBER_IMPORT_ROWS) {
        throw new MemberPdfImportLimitError();
      }
      reports.push(report);
      sourceHashes.push(report.sourceHash);
    } catch (error) {
      if (error instanceof MemberPdfImportLimitError) {
        throw new HttpsError("resource-exhausted", "Member import is too large");
      }
      throw new HttpsError("invalid-argument", "Uploaded member report is invalid");
    }
  }
  return {
    reports: Object.freeze(reports),
    sourceHash: createHash("sha256").update(sourceHashes.join(":"), "utf8").digest("hex"),
  };
}

async function buildImportPreview(
  services: MemberCallableServices,
  session: ImportSession,
  actorId: string,
  previewId: string,
): Promise<MemberImportPreviewRecord> {
  const { reports, sourceHash } = await parseImportReports(services, session);
  const deduplicated = deduplicateMemberRows(reports);
  const canonical = await services.memberService.listForImport(session.academyId);
  const additions = [] as ReturnType<typeof changeFromRow>[];
  const updates = [] as ReturnType<typeof changeFromRow>[];
  const canonicalConflicts = [] as ReturnType<typeof changeFromRow>[];
  for (const row of deduplicated.rows) {
    if (!row.membershipNumber && !row.email) {
      additions.push(changeFromRow(row, importFieldNames(row)));
      continue;
    }
    const resolved = resolveMemberImportMatch(row, canonical, session.academyId);
    if (resolved.ambiguous) {
      canonicalConflicts.push(changeFromRow(row, ["membershipNumber"]));
      continue;
    }
    const current = resolved.member;
    if (current === undefined) {
      additions.push(changeFromRow(row, importFieldNames(row)));
      continue;
    }
    if (
      row.fullName !== undefined &&
      normalizeImportValue(row.fullName) !== normalizeImportValue(current.fullName)
    ) {
      canonicalConflicts.push(changeFromRow(row, ["fullName"]));
      continue;
    }
    const fields = importFieldNames(row, current);
    if (fields.length > 0) updates.push(changeFromRow(row, fields));
  }
  const previewResult = parseMemberImportPreview({
    previewId,
    expiresAt: session.expiresAt,
    sourceReports: reports.map((report, index) => ({
      source: `pdf-${index + 1}`,
      report: report.report,
      rowCount: report.rows.length,
    })),
    additions,
    updates,
    duplicates: deduplicated.duplicates
      .filter((duplicate) => duplicate.kind === "duplicate")
      .map(changeFromDuplicate),
    conflicts: [
      ...deduplicated.duplicates
        .filter((duplicate) => duplicate.kind === "conflict")
        .map(changeFromDuplicate),
      ...canonicalConflicts,
    ],
  });
  if (!previewResult.ok) throw new Error("Import preview could not be created");
  return {
    previewId,
    sessionId: session.sessionId,
    academyId: session.academyId,
    actorId,
    expiresAt: session.expiresAt,
    sourceHash,
    reportKeys: Object.freeze(reports.map((report) => report.report)),
    preview: previewResult.value,
    status: "pending",
  };
}

function defaultServices(): MemberCallableServices {
  return {
    memberService: createMemberService(createFirestoreMemberStore(getFirestore())),
    r2: createR2ClientFromEnvironment(),
    sessions: createFirestoreMemberImportSessionStore(getFirestore()),
    cleanupJournal: createFirestoreMemberImportCleanupJournal(getFirestore()),
    reportExports: createFirestoreMemberReportExportStore(getFirestore()),
    reportRateLimiter: createFirestoreMemberReportRateLimiter(getFirestore()),
    previewStore: createFirestoreMemberImportPreviewStore(getFirestore()),
    reportPdf: createMemberReportPdf,
  };
}

type PdfParseResult = Readonly<{ text: string }>;

async function extractPdfText(bytes: Uint8Array): Promise<string> {
  const pdfParse = createRequire(import.meta.url)("pdf-parse") as
    | ((input: Uint8Array) => Promise<PdfParseResult>)
    | { default?: (input: Uint8Array) => Promise<PdfParseResult> };
  const parser = typeof pdfParse === "function" ? pdfParse : pdfParse.default;
  if (parser === undefined) throw new Error("PDF parser unavailable");
  const result = await parser(bytes);
  if (typeof result.text !== "string") throw new Error("PDF text is invalid");
  return result.text;
}

async function authorizedDefault<T>(
  request: CallableRequest,
  handler: (services: MemberCallableServices) => Promise<T>,
): Promise<T> {
  requireAdminActor(request);
  return handler(defaultServices());
}

export async function createMemberHandler(
  request: CallableRequest,
  services: MemberCallableServices,
) {
  const actor = requireAdminActor(request);
  const data = parseRequest(request, createMemberSchema) as MemberCreationInput;
  return {
    memberId: await services.memberService.create({
      academyId: actor.academyId,
      actorId: actor.uid,
      memberId: idOf(services),
      now: nowOf(services).toISOString(),
      data,
    }),
  };
}

export async function searchMembersHandler(
  request: CallableRequest,
  services: MemberCallableServices,
) {
  const actor = requireAdminActor(request);
  const data = parseRequest(request, searchSchema);
  const filtersResult = parseMemberSearchFilters(data.filters ?? {});
  if (!filtersResult.ok) throw new HttpsError("invalid-argument", "Search filters are invalid");
  await services.reportRateLimiter.consume({
    academyId: actor.academyId,
    actorId: actor.uid,
    scope: "search",
    now: nowOf(services),
  });
  return services.memberService.search(actor.academyId, filtersResult.value, data.pageToken);
}

export async function getMemberReportHandler(
  request: CallableRequest,
  services: MemberCallableServices,
) {
  const actor = requireAdminActor(request);
  const data = parseRequest(request, reportSchema);
  await services.reportRateLimiter.consume({
    academyId: actor.academyId,
    actorId: actor.uid,
    scope: "report",
    now: nowOf(services),
  });
  const members = await services.memberService.report(actor.academyId, data.report);
  return { report: data.report, members, generatedAt: nowOf(services).toISOString() };
}

export async function getMemberReportSummaryHandler(
  request: CallableRequest,
  services: MemberCallableServices,
) {
  const actor = requireAdminActor(request);
  const data = parseRequest(request, reportSchema);
  await services.reportRateLimiter.consume({
    academyId: actor.academyId,
    actorId: actor.uid,
    scope: `summary:${data.report}`,
    now: nowOf(services),
  });
  return services.memberService.reportSummary(actor.academyId, data.report);
}

function reportExportCleanupEntry(
  sessionId: string,
  objectKey: string,
  cleanupAt: string,
): CleanupJournalEntry {
  return {
    sessionId: `${REPORT_EXPORT_PREFIX}${sessionId}`,
    objectKeys: [objectKey],
    attempts: 0,
    nextCleanupAt: cleanupAt,
    lastError: "Report export cleanup pending",
    status: "pending",
    kind: "report-export",
  };
}

async function compensateReportExport(
  services: MemberCallableServices,
  session: MemberReportExportSession,
  cleanupEntry: CleanupJournalEntry,
): Promise<void> {
  try {
    await services.r2.deleteObject(session.objectKey);
    await services.reportExports.save({
      ...session,
      status: "failed",
      lastError: "Report export compensation completed",
    });
    await services.cleanupJournal.save({
      ...cleanupEntry,
      sessionId: cleanupEntry.sessionId,
      status: "completed",
      lastError: "Report export compensation completed",
    });
  } catch {
    await services.reportExports.save({
      ...session,
      status: "failed",
      lastError: "Report export compensation pending",
    });
  }
}

export async function getMemberReportPdfHandler(
  request: CallableRequest,
  services: MemberCallableServices,
) {
  const actor = requireAdminActor(request);
  const data = parseRequest(request, reportSchema);
  await services.reportRateLimiter.consume({
    academyId: actor.academyId,
    actorId: actor.uid,
    scope: "report-pdf",
    now: nowOf(services),
  });
  const members = await services.memberService.report(actor.academyId, data.report);
  const estimatedBytes = 64 * 1024 + members.length * 4_096;
  if (members.length > MAX_MEMBER_REPORT_ROWS || estimatedBytes > MAX_MEMBER_REPORT_PDF_BYTES) {
    throw new HttpsError("resource-exhausted", "Member report export is too large");
  }
  const pdfBytes = await (services.reportPdf ?? createMemberReportPdf)(data.report, members);
  if (pdfBytes.byteLength > MAX_MEMBER_REPORT_PDF_BYTES) {
    throw new HttpsError("resource-exhausted", "Member report export is too large");
  }
  const sessionId = idOf(services);
  const now = nowOf(services);
  const expiresAt = new Date(now.getTime() + 5 * 60 * 1000).toISOString();
  const cleanupAt = new Date(now.getTime() + 10 * 60 * 1000).toISOString();
  const objectKey = `academies/${actor.academyId}/member-reports/${sessionId}/${data.report}.pdf`;

  const exportSession: MemberReportExportSession = {
    sessionId,
    academyId: actor.academyId,
    report: data.report,
    objectKey,
    createdAt: now.toISOString(),
    expiresAt: cleanupAt,
    status: "pending",
  };
  const cleanupEntry = reportExportCleanupEntry(sessionId, objectKey, cleanupAt);
  await services.reportExports.save(exportSession);
  try {
    await services.cleanupJournal.save(cleanupEntry);
  } catch (error) {
    await services.reportExports.remove(sessionId);
    throw error;
  }

  try {
    await services.r2.putObject(objectKey, pdfBytes, "application/pdf");
    await services.reportExports.save({ ...exportSession, status: "uploaded" });
  } catch {
    await compensateReportExport(services, exportSession, cleanupEntry);
    throw new HttpsError("internal", "Unable to create member report export");
  }

  try {
    return {
      downloadUrl: await services.r2.createPdfDownloadUrl({
        objectKey,
        expiresInSeconds: 300,
      }),
      expiresAt,
    };
  } catch {
    await compensateReportExport(services, { ...exportSession, status: "uploaded" }, cleanupEntry);
    throw new HttpsError("internal", "Unable to create member report export");
  }
}

export async function createMemberPdfImportSessionHandler(
  request: CallableRequest,
  services: MemberCallableServices,
) {
  const actor = requireAdminActor(request);
  const data = parseRequest(request, importSessionSchema);
  const sessionId = idOf(services);
  const expiresAt = new Date(nowOf(services).getTime() + 10 * 60 * 1000).toISOString();
  const preparedFiles = data.files.map((file, index) => {
    let metadata;
    try {
      metadata = validatePdfUpload(file);
    } catch {
      throw new HttpsError("invalid-argument", "PDF metadata is invalid");
    }
    return {
      metadata,
      objectKey: `academies/${actor.academyId}/member-imports/${sessionId}/${index}-${metadata.fileName}`,
    };
  });
  if (preparedFiles.length > MAX_MEMBER_IMPORT_FILES) {
    throw new HttpsError("resource-exhausted", "Member import has too many files");
  }
  const durableSession: ImportSession = {
    sessionId,
    academyId: actor.academyId,
    objectKeys: preparedFiles.map((file) => file.objectKey),
    expiresAt,
    cleanupAttempts: 0,
    nextCleanupAt: expiresAt,
    cleanupStatus: "pending",
    previewState: "pending",
  };
  await services.sessions.save(durableSession);
  const uploads = await Promise.all(
    preparedFiles.map(async ({ metadata, objectKey }) => ({
      objectKey,
      uploadUrl: await services.r2.createPdfUploadUrl({
        ...metadata,
        objectKey,
        expiresInSeconds: 600,
      }),
    })),
  );
  await services.sessions.save(durableSession);
  return { sessionId, uploads, expiresAt };
}

export async function previewMemberPdfImportHandler(
  request: CallableRequest,
  services: MemberCallableServices,
) {
  const actor = requireAdminActor(request);
  const data = parseRequest(request, sessionIdSchema);
  let session: ImportSession | undefined;
  try {
    session = await services.sessions.get(data.sessionId);
  } catch {
    throw new HttpsError("internal", "Unable to load member import session");
  }
  if (!session) throw new HttpsError("permission-denied", "Import session is unavailable");
  assertImportSessionShape(session);
  assertSessionScope(session, actor.academyId, nowOf(services).toISOString());
  const previewId = crypto.randomUUID();
  if (!services.previewStore) throw new HttpsError("internal", "Import preview unavailable");
  try {
    if (session.preview) {
      const oldRecord = await services.previewStore.get(session.preview.previewId);
      if (!oldRecord) throw new Error("Member import preview record is missing");
      assertSessionPreviewRelation(
        session,
        oldRecord,
        actor.uid,
        actor.academyId,
        nowOf(services).toISOString(),
      );
      await services.sessions.save({ ...session, previewState: "invalidated" });
      await services.previewStore.invalidate(session.preview.previewId);
      await services.previewStore.remove(session.preview.previewId);
    }
    await services.sessions.save(withoutSessionPreview(session));
  } catch {
    try {
      await services.sessions.save({ ...session, previewState: "invalidated" });
    } catch {
      // The outer sanitized error remains the only response; confirmation still fails closed.
    }
    throw new HttpsError("internal", "Unable to clear member import preview");
  }
  try {
    const record = await buildImportPreview(services, session, actor.uid, previewId);
    await services.previewStore.save(record);
    await services.sessions.save({ ...session, preview: record.preview });
    return record.preview;
  } catch (error) {
    try {
      await services.previewStore.invalidate(previewId);
      await services.previewStore.remove(previewId);
      if (session.preview) await services.previewStore.remove(session.preview.previewId);
      await services.sessions.save(
        withoutSessionPreview({ ...session, previewState: "invalidated" }),
      );
    } catch {
      throw new HttpsError("internal", "Unable to clear member import preview");
    }
    if (error instanceof HttpsError) throw error;
    throw new HttpsError("internal", "Import preview could not be created");
  }
}

export async function confirmMemberPdfImportHandler(
  request: CallableRequest,
  services: MemberCallableServices,
) {
  const actor = requireAdminActor(request);
  const data = parseRequest(request, confirmImportSchema);
  let session: ImportSession | undefined;
  try {
    session = await services.sessions.get(data.sessionId);
  } catch {
    throw new HttpsError("internal", "Unable to load member import session");
  }
  if (!session) throw new HttpsError("permission-denied", "Import session is unavailable");
  assertImportSessionShape(session);
  if (!services.previewStore) throw new HttpsError("internal", "Import preview unavailable");
  let record: MemberImportPreviewRecord | undefined;
  try {
    record = await services.previewStore.get(data.previewId);
  } catch {
    throw new HttpsError("internal", "Unable to load member import preview");
  }
  if (
    !record ||
    record.sessionId !== session.sessionId ||
    record.academyId !== actor.academyId ||
    record.actorId !== actor.uid ||
    (record.status !== "pending" && record.status !== "confirmed")
  ) {
    throw new HttpsError("permission-denied", "Import preview is unavailable");
  }
  const currentNow = nowOf(services).toISOString();
  if (record.status !== "confirmed") {
    assertSessionScope(session, actor.academyId, currentNow);
  }
  assertSessionPreviewRelation(session, record, actor.uid, actor.academyId, currentNow, {
    allowConfirmed: true,
    allowExpired: record.status === "confirmed",
  });
  const preview = record.preview;
  if (record.status !== "confirmed" && preview.conflicts.length > 0) {
    throw new HttpsError("failed-precondition", "Import preview contains conflicts");
  }
  if (record.status === "confirmed" && record.result === undefined) {
    throw new HttpsError("failed-precondition", "Import preview result is unavailable");
  }
  if (record.status === "confirmed") return record.result!;
  const { reports, sourceHash } = await parseImportReports(services, session);
  if (
    sourceHash !== record.sourceHash ||
    reports.length !== record.reportKeys.length ||
    reports.some((report, index) => report.report !== record.reportKeys[index])
  ) {
    throw new HttpsError("failed-precondition", "Import preview source has changed");
  }
  const deduplicated = deduplicateMemberRows(reports);
  if (deduplicated.duplicates.some((duplicate) => duplicate.kind === "conflict")) {
    throw new HttpsError("failed-precondition", "Import preview contains conflicts");
  }
  const serverPreview = attachMemberImportPreviewSource(preview, {
    rows: deduplicated.rows,
    sourceHash,
  });
  const result = await services.memberService.applyImportPreview({
    academyId: actor.academyId,
    actorId: actor.uid,
    preview: serverPreview,
    now: nowOf(services).toISOString(),
    createId: () => idOf(services),
  });
  let confirmed: Awaited<ReturnType<MemberImportPreviewStore["confirmIfPending"]>>;
  try {
    confirmed = await services.previewStore.confirmIfPending({
      previewId: record.previewId,
      operationId: record.previewId,
      sessionId: record.sessionId,
      academyId: record.academyId,
      actorId: record.actorId,
      sourceHash: record.sourceHash,
      result,
    });
  } catch {
    throw new HttpsError("failed-precondition", "Import preview confirmation is inconsistent");
  }
  if (confirmed === undefined)
    throw new HttpsError("aborted", "Import preview confirmation was lost");
  return confirmed;
}

type CleanupServices = Pick<MemberCallableServices, "r2" | "sessions" | "cleanupJournal"> &
  Readonly<{ reportExports?: MemberReportExportStore; previewStore?: MemberImportPreviewStore }>;

function sessionToJournalEntry(session: ImportSession): CleanupJournalEntry {
  return {
    sessionId: session.sessionId,
    objectKeys: session.objectKeys,
    attempts: session.cleanupAttempts,
    nextCleanupAt: session.nextCleanupAt,
    lastError: session.lastCleanupError ?? "R2 cleanup failed",
    status: session.cleanupStatus,
    kind: "import",
  };
}

function importJournalMatchesSession(entry: CleanupJournalEntry, session: ImportSession): boolean {
  const prefix = `academies/${session.academyId}/member-imports/${session.sessionId}/`;
  return (
    entry.sessionId === session.sessionId &&
    entry.objectKeys.length === session.objectKeys.length &&
    entry.objectKeys.every(
      (objectKey, index) => objectKey === session.objectKeys[index] && objectKey.startsWith(prefix),
    )
  );
}

function reportExportJournalMatchesSession(
  entry: CleanupJournalEntry,
  session: MemberReportExportSession,
  expectedExpiresAt = entry.nextCleanupAt,
): boolean {
  if (!entry.sessionId.startsWith(REPORT_EXPORT_PREFIX)) return false;
  const exportSessionId = entry.sessionId.slice(REPORT_EXPORT_PREFIX.length);
  if (exportSessionId.length === 0) return false;
  const prefix = `academies/${session.academyId}/member-reports/${exportSessionId}/`;
  return (
    entry.sessionId === `${REPORT_EXPORT_PREFIX}${session.sessionId}` &&
    entry.objectKeys.length === 1 &&
    entry.objectKeys[0] === session.objectKey &&
    session.objectKey.startsWith(prefix) &&
    expectedExpiresAt === session.expiresAt
  );
}

function isSafeExpiredPreview(preview: MemberImportPreviewRecord, now: string): boolean {
  return (
    preview.status === "pending" &&
    preview.previewId === preview.preview.previewId &&
    MEMBER_IMPORT_PREVIEW_ID_PATTERN.test(preview.previewId) &&
    isIsoDate(preview.expiresAt) &&
    preview.expiresAt <= now &&
    preview.preview.expiresAt === preview.expiresAt
  );
}

function importJournalMatchesPreview(
  entry: CleanupJournalEntry,
  preview: MemberImportPreviewRecord,
): boolean {
  const prefix = `academies/${preview.academyId}/member-imports/${preview.sessionId}/`;
  return (
    entry.sessionId === preview.sessionId &&
    entry.objectKeys.length > 0 &&
    entry.objectKeys.every((objectKey) => objectKey.startsWith(prefix))
  );
}

export async function cleanupExpiredMemberImportSessions(
  services: CleanupServices,
  now = new Date(),
): Promise<void> {
  const nowIso = now.toISOString();
  let sessions: readonly ImportSession[] = [];
  let journalEntries: readonly CleanupJournalEntry[] = [];
  let expiredPreviews: readonly MemberImportPreviewRecord[] = [];
  let failClosedError: Error | undefined;
  const attemptedPreviewIds = new Set<string>();
  try {
    sessions = await services.sessions.listExpired(nowIso);
  } catch {
    // The journal remains usable when the normal session scan is unavailable.
  }
  try {
    journalEntries = await services.cleanupJournal.listDue(nowIso);
  } catch (error) {
    if (error instanceof Error && error.message === CLEANUP_JOURNAL_INVALID) {
      throw new Error(CLEANUP_JOURNAL_INVALID);
    }
    throw new Error(CLEANUP_JOURNAL_UNAVAILABLE);
  }
  try {
    const previewStore = services.previewStore;
    if (previewStore) {
      expiredPreviews = await previewStore.listExpired(nowIso, MAX_EXPIRED_PREVIEWS_PER_CLEANUP);
    }
  } catch {
    throw new Error(CLEANUP_JOURNAL_UNAVAILABLE);
  }
  const validatedJournalEntries = journalEntries.map((entry) => parseCleanupJournalEntry(entry));
  if (validatedJournalEntries.some((entry) => entry === undefined)) {
    throw new Error(CLEANUP_JOURNAL_INVALID);
  }
  journalEntries = validatedJournalEntries as CleanupJournalEntry[];

  const journalBySessionId = new Map(journalEntries.map((entry) => [entry.sessionId, entry]));
  const work = new Map<string, CleanupJournalEntry>();
  for (const session of sessions) {
    const journalEntry = journalBySessionId.get(session.sessionId);
    if (journalEntry?.status === "failed") continue;
    work.set(session.sessionId, journalEntry ?? sessionToJournalEntry(session));
  }
  for (const entry of journalEntries) {
    work.set(entry.sessionId, entry);
  }
  for (const initialEntry of work.values()) {
    const leaseId = crypto.randomUUID();
    let claimed: CleanupJournalEntry | undefined;
    try {
      claimed = await services.cleanupJournal.claim(
        initialEntry,
        nowIso,
        leaseId,
        CLEANUP_LEASE_MS,
      );
    } catch {
      failClosedError ??= new Error(CLEANUP_JOURNAL_UNAVAILABLE);
      continue;
    }
    if (!claimed) continue;

    try {
      const validatedClaim = parseCleanupJournalEntry(claimed);
      if (!validatedClaim) {
        failClosedError ??= new Error(CLEANUP_JOURNAL_INVALID);
        continue;
      }
      let revalidated: CleanupJournalEntry | undefined;
      try {
        const journalValue = await services.cleanupJournal.get(initialEntry.sessionId);
        revalidated = parseCleanupJournalEntry(journalValue);
      } catch {
        failClosedError ??= new Error(CLEANUP_JOURNAL_UNAVAILABLE);
        continue;
      }
      if (!revalidated) {
        failClosedError ??= new Error(CLEANUP_JOURNAL_INVALID);
        continue;
      }
      if (
        revalidated.status !== "running" ||
        revalidated.attempts > MAX_CLEANUP_ATTEMPTS ||
        revalidated.attempts !== validatedClaim.attempts ||
        revalidated.nextCleanupAt !== validatedClaim.nextCleanupAt ||
        revalidated.leaseId !== leaseId ||
        revalidated.leaseUntil === undefined ||
        revalidated.leaseUntil <= nowIso
      ) {
        continue;
      }

      let importSession: ImportSession | undefined;
      let importSessionPreview: MemberImportPreviewRecord | undefined;
      let reportExportSession: MemberReportExportSession | undefined;
      let importSessionMissing = false;
      if (revalidated.kind === "report-export") {
        if (!revalidated.sessionId.startsWith(REPORT_EXPORT_PREFIX)) {
          failClosedError ??= new Error(CLEANUP_JOURNAL_INVALID);
          continue;
        }
        try {
          const exportSessionId = revalidated.sessionId.slice(REPORT_EXPORT_PREFIX.length);
          if (!services.reportExports) throw new Error("Report export store unavailable");
          reportExportSession = await services.reportExports.get(exportSessionId);
          if (
            !reportExportSession ||
            !reportExportJournalMatchesSession(
              revalidated,
              reportExportSession,
              initialEntry.nextCleanupAt,
            )
          ) {
            failClosedError ??= new Error(CLEANUP_JOURNAL_INVALID);
            continue;
          }
        } catch {
          failClosedError ??= new Error(CLEANUP_JOURNAL_UNAVAILABLE);
          continue;
        }
      } else {
        try {
          importSession = sessions.find(
            (candidate) => candidate.sessionId === revalidated.sessionId,
          );
          if (!importSession) {
            importSessionPreview = expiredPreviews.find(
              (preview) =>
                isSafeExpiredPreview(preview, nowIso) &&
                importJournalMatchesPreview(revalidated, preview),
            );
            if (!importSessionPreview) {
              failClosedError ??= new Error(CLEANUP_JOURNAL_INVALID);
              continue;
            }
            importSessionMissing = true;
          } else if (!importJournalMatchesSession(revalidated, importSession)) {
            failClosedError ??= new Error(CLEANUP_JOURNAL_INVALID);
            continue;
          }
          if (importSession?.preview) {
            if (!services.previewStore) throw new Error("Import preview store unavailable");
            importSessionPreview = await services.previewStore.get(importSession.preview.previewId);
            if (importSessionPreview) {
              assertSessionPreviewRelation(
                importSession,
                importSessionPreview,
                importSessionPreview.actorId,
                importSession.academyId,
                nowIso,
                { allowExpired: true },
              );
            }
          }
        } catch {
          failClosedError ??= new Error(CLEANUP_JOURNAL_UNAVAILABLE);
          continue;
        }
      }

      let cleanupFailed = false;
      if (!importSessionMissing) {
        for (const objectKey of revalidated.objectKeys) {
          try {
            await services.r2.deleteObject(objectKey);
          } catch {
            cleanupFailed = true;
          }
        }
      }
      if (cleanupFailed) {
        try {
          await services.cleanupJournal.recordFailure(revalidated.sessionId, leaseId, now);
        } catch {
          failClosedError ??= new Error(CLEANUP_JOURNAL_UNAVAILABLE);
        }
        continue;
      }
      try {
        if (revalidated.kind === "report-export") {
          if (!reportExportSession || !services.reportExports) {
            throw new Error("Report export store unavailable");
          }
          await services.reportExports.remove(reportExportSession.sessionId);
        } else if (!importSessionMissing) {
          await services.sessions.remove(revalidated.sessionId);
        }
      } catch {
        try {
          await services.cleanupJournal.recordFailure(revalidated.sessionId, leaseId, now);
        } catch {
          failClosedError ??= new Error(CLEANUP_JOURNAL_UNAVAILABLE);
        }
        continue;
      }
      if (revalidated.kind === "import") {
        try {
          if (importSessionPreview && services.previewStore) {
            attemptedPreviewIds.add(importSessionPreview.previewId);
            await services.previewStore.remove(importSessionPreview.previewId);
          }
        } catch {
          failClosedError ??= new Error(CLEANUP_JOURNAL_UNAVAILABLE);
          continue;
        }
      }
      try {
        await services.cleanupJournal.complete(revalidated.sessionId, leaseId);
      } catch {
        try {
          await services.cleanupJournal.recordFailure(revalidated.sessionId, leaseId, now);
        } catch {
          failClosedError ??= new Error(CLEANUP_JOURNAL_UNAVAILABLE);
        }
      }
    } catch {
      // A single session or journal failure must not abort the remaining batch.
      failClosedError ??= new Error(CLEANUP_JOURNAL_UNAVAILABLE);
    }
  }
  if (services.previewStore) {
    for (const preview of expiredPreviews) {
      if (attemptedPreviewIds.has(preview.previewId) || !isSafeExpiredPreview(preview, nowIso)) {
        continue;
      }
      const session = sessions.find((candidate) => candidate.sessionId === preview.sessionId);
      const relatedJournal = journalEntries.find(
        (entry) => entry.kind !== "report-export" && importJournalMatchesPreview(entry, preview),
      );
      if (!session && !relatedJournal) continue;
      try {
        if (session) {
          assertSessionPreviewRelation(
            session,
            preview,
            preview.actorId,
            preview.academyId,
            nowIso,
            { allowExpired: true },
          );
        }
        await services.previewStore.remove(preview.previewId);
      } catch {
        failClosedError ??= new Error(CLEANUP_JOURNAL_UNAVAILABLE);
      }
    }
  }
  if (failClosedError !== undefined) throw failClosedError;
}

export const cleanupExpiredMemberImportSessionsSchedule = onSchedule(
  { schedule: "every 15 minutes", timeZone: "UTC" },
  async () => cleanupExpiredMemberImportSessions(defaultServices()),
);

export const createMember = onCall(async (request) =>
  authorizedDefault(request, (services) => createMemberHandler(request, services)),
);
export const searchMembers = onCall(async (request) =>
  authorizedDefault(request, (services) => searchMembersHandler(request, services)),
);
export const getMemberReport = onCall(async (request) =>
  authorizedDefault(request, (services) => getMemberReportHandler(request, services)),
);
export const getMemberReportSummary = onCall(async (request) =>
  authorizedDefault(request, (services) => getMemberReportSummaryHandler(request, services)),
);
export const getMemberReportPdf = onCall(async (request) =>
  authorizedDefault(request, (services) => getMemberReportPdfHandler(request, services)),
);
export const createMemberPdfImportSession = onCall(async (request) =>
  authorizedDefault(request, (services) => createMemberPdfImportSessionHandler(request, services)),
);
export const previewMemberPdfImport = onCall(async (request) =>
  authorizedDefault(request, (services) => previewMemberPdfImportHandler(request, services)),
);
export const confirmMemberPdfImport = onCall(async (request) =>
  authorizedDefault(request, (services) => confirmMemberPdfImportHandler(request, services)),
);
