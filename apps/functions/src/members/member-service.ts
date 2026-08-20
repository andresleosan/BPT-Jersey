import { createHmac, timingSafeEqual } from "node:crypto";

import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";

import type {
  MemberGender,
  MemberImportPreview,
  MemberRecord,
  MemberReportKey,
  MemberSearchFilters,
  MembershipStatus,
  PaymentStatus,
} from "@bpt-jersey/domain/members";
import { matchesMemberReport, parseMemberRecord } from "@bpt-jersey/domain/members";
import type { AuditEventDraft } from "@bpt-jersey/domain/audit";

import {
  appendAuditEventInTransaction,
  type AuditCreateTransaction,
} from "../audit/audit-writer.js";
import type { ParsedMemberRow } from "./member-pdf-import.js";

export const MEMBER_PAGE_SIZE = 50;
// Search is intentionally bounded because filtering and ordering are performed in memory.
export const MAX_MEMBER_SEARCH_ROWS = 10_000;
export const MAX_MEMBER_REPORT_ROWS = 2_000;
export const MAX_MEMBER_REPORT_SUMMARY_ROWS = 10_000;
export const MAX_MEMBER_IMPORT_MATCH_ROWS = 10_000;
export const MAX_MEMBER_IMPORT_WRITE_ROWS = 400;
const MAX_IMPORT_RUN_ID_LENGTH = 128;
const SAFE_IMPORT_RUN_ID_PATTERN = /^[A-Za-z0-9._:-]+$/u;

export type MemberCreationInput = Readonly<{
  membershipNumber?: string;
  fullName: string;
  email?: string;
  idCardNumber?: string;
  vatNumber?: string;
  birthDate?: string;
  mobileNumber?: string;
  frequency?: string;
  gender?: MemberGender;
  trainingCenter?: string;
}>;

export type MemberProjection = Pick<
  MemberRecord,
  | "memberId"
  | "membershipNumber"
  | "fullName"
  | "email"
  | "idCardNumber"
  | "vatNumber"
  | "birthDate"
  | "mobileNumber"
  | "frequency"
  | "paymentStatus"
  | "gender"
  | "trainingCenter"
  | "membershipStatus"
  | "inactiveAt"
  | "createdAt"
  | "updatedAt"
  | "source"
  | "schemaVersion"
>;

export type MemberImportMatch = Readonly<{
  memberId: string;
  academyId?: string;
  membershipNumber?: string;
  fullName: string;
  email?: string;
  idCardNumber?: string;
  vatNumber?: string;
  birthDate?: string;
  mobileNumber?: string;
  membershipStatus: MembershipStatus;
  paymentStatus: PaymentStatus;
  inactiveAt?: string;
  importRunId?: string;
}>;

export type MemberImportWriteResult = Readonly<{
  imported: number;
  updated: number;
  conflicts: number;
}>;

type MemberImportMutation = Readonly<{
  kind: "create" | "update";
  memberId: string;
  record?: MemberRecord;
  updates?: Readonly<Record<string, unknown>>;
  expectedUpdatedAt?: string;
}>;

export type MemberImportApplyInput = Readonly<{
  academyId: string;
  actorId: string;
  now: string;
  operationId: string;
  sourceHash: string;
  reportKeys: readonly MemberReportKey[];
  mutations: readonly MemberImportMutation[];
  result: MemberImportWriteResult;
}>;

export type MemberImportPreviewSource = Readonly<{
  rows: readonly ParsedMemberRow[];
  sourceHash: string;
}>;

const memberImportPreviewSource = Symbol("memberImportPreviewSource");
type ServerMemberImportPreview = MemberImportPreview &
  Readonly<{ [memberImportPreviewSource]: MemberImportPreviewSource }>;

export type MemberPageTokenContext = Readonly<{
  academyId: string;
  filters: MemberSearchFilters;
}>;

export type MemberPageTokenCodec = Readonly<{
  encode: (context: MemberPageTokenContext, offset: number) => string;
  decode: (context: MemberPageTokenContext, token: string) => number;
}>;

export type MemberServiceOptions = Readonly<{
  pageTokenSecret?: string;
  pageTokenCodec?: MemberPageTokenCodec;
}>;

export type MemberStore = Readonly<{
  create: (record: MemberRecord) => Promise<void>;
  list: (academyId: string, limit: number) => Promise<readonly unknown[]>;
  countByReport: (academyId: string, report: MemberReportKey) => Promise<number>;
  applyImport: (input: MemberImportApplyInput) => Promise<MemberImportWriteResult>;
}>;

export type MemoryMemberStore = MemberStore &
  Readonly<{ setFailureAfterWrites: (count: number | undefined) => void }>;

export type MemberService = Readonly<{
  create: (
    input: Readonly<{
      academyId: string;
      actorId: string;
      memberId: string;
      now: string;
      data: MemberCreationInput;
    }>,
  ) => Promise<string>;
  list: (academyId: string) => Promise<readonly MemberRecord[]>;
  listForImport: (academyId: string) => Promise<readonly MemberImportMatch[]>;
  search: (
    academyId: string,
    filters: MemberSearchFilters,
    pageToken?: string,
  ) => Promise<Readonly<{ members: readonly MemberProjection[]; nextPageToken?: string }>>;
  report: (academyId: string, report: MemberReportKey) => Promise<readonly MemberProjection[]>;
  reportSummary: (
    academyId: string,
    report: MemberReportKey,
  ) => Promise<Readonly<{ report: MemberReportKey; count: number }>>;
  applyImportPreview: (
    input: Readonly<{
      academyId: string;
      actorId: string;
      preview: MemberImportPreview;
      now: string;
      createId: () => string;
      operationId?: string;
      importRunId?: string;
    }>,
  ) => Promise<MemberImportWriteResult>;
}>;

export function attachMemberImportPreviewSource(
  preview: MemberImportPreview,
  source: MemberImportPreviewSource,
): MemberImportPreview {
  return Object.assign({}, preview, {
    [memberImportPreviewSource]: Object.freeze({
      rows: Object.freeze([...source.rows]),
      sourceHash: source.sourceHash,
    }),
  }) as ServerMemberImportPreview;
}

export function createMemoryMemberStore(initial: readonly MemberRecord[] = []): MemoryMemberStore {
  const records = new Map(initial.map((record) => [record.memberId, { ...record }]));
  const operations = new Map<
    string,
    Readonly<{
      academyId: string;
      actorId: string;
      sourceHash: string;
      result: MemberImportWriteResult;
    }>
  >();
  let failureAfterWrites: number | undefined;
  return {
    create: async (record) => {
      if (records.has(record.memberId))
        throw new HttpsError("already-exists", "Member already exists");
      validateMemberRecordForImport(record);
      records.set(record.memberId, { ...record });
    },
    list: async (academyId, limit) =>
      [...records.values()].filter((record) => record.academyId === academyId).slice(0, limit),
    countByReport: async (academyId, report) =>
      [...records.values()].filter(
        (record) => record.academyId === academyId && matchesMemberReport(record, report),
      ).length,
    applyImport: async ({ academyId, actorId, operationId, sourceHash, mutations, result }) => {
      validateImportOperationId(operationId);
      const existing = operations.get(operationId);
      if (existing) {
        if (
          existing.academyId !== academyId ||
          existing.actorId !== actorId ||
          existing.sourceHash !== sourceHash
        )
          throw new HttpsError("failed-precondition", "Member import operation is inconsistent");
        return existing.result;
      }
      const snapshot = new Map([...records.entries()].map(([id, record]) => [id, { ...record }]));
      try {
        let writes = 0;
        for (const mutation of mutations) {
          if (failureAfterWrites !== undefined && writes >= failureAfterWrites) {
            throw new Error("Synthetic member import failure");
          }
          if (mutation.kind === "create") {
            if (!mutation.record || mutation.record.academyId !== academyId)
              throw new HttpsError("failed-precondition", "Member import mutation is out of scope");
            validateMemberRecordForImport(mutation.record);
            records.set(mutation.memberId, { ...mutation.record });
          } else {
            const current = records.get(mutation.memberId);
            if (
              !current ||
              current.academyId !== academyId ||
              current.updatedAt !== mutation.expectedUpdatedAt
            )
              throw new HttpsError("aborted", "Member changed during import");
            const updatedRecord = {
              ...current,
              ...mutation.updates,
              updatedAt: current.updatedAt,
              updatedBy: actorId,
            } as MemberRecord;
            validateMemberRecordForImport(updatedRecord);
            records.set(mutation.memberId, updatedRecord);
          }
          writes += 1;
        }
        operations.set(operationId, { academyId, actorId, sourceHash, result });
        return result;
      } catch (error) {
        records.clear();
        for (const [id, record] of snapshot) records.set(id, record);
        throw error;
      }
    },
    setFailureAfterWrites: (count) => {
      if (count !== undefined && (!Number.isSafeInteger(count) || count < 0)) {
        throw new Error("Failure count is invalid");
      }
      failureAfterWrites = count;
    },
  };
}

function parseImportWriteResult(value: unknown): MemberImportWriteResult | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const result = value as Record<string, unknown>;
  if (
    !Number.isSafeInteger(result.imported) ||
    !Number.isSafeInteger(result.updated) ||
    !Number.isSafeInteger(result.conflicts) ||
    (result.imported as number) < 0 ||
    (result.updated as number) < 0 ||
    (result.conflicts as number) < 0
  ) {
    return undefined;
  }
  return Object.freeze({
    imported: result.imported as number,
    updated: result.updated as number,
    conflicts: result.conflicts as number,
  });
}

function validateImportOperationId(operationId: unknown): string {
  if (
    typeof operationId !== "string" ||
    operationId.trim().length === 0 ||
    operationId.length > MAX_IMPORT_RUN_ID_LENGTH ||
    !SAFE_IMPORT_RUN_ID_PATTERN.test(operationId)
  ) {
    throw new HttpsError("failed-precondition", "Member import operation ID is invalid");
  }
  return operationId;
}

function validateMemberRecordForImport(record: MemberRecord): void {
  const parsed = parseMemberRecord(record);
  if (!parsed.ok) throw new Error("Invalid member record in import mutation");
}

const memberRecordFields = [
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
] as const;

const memberProjectionFields = [
  "memberId",
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
  "updatedAt",
  "source",
  "schemaVersion",
] as const satisfies readonly (keyof MemberRecord)[];

function asStoredMember(value: unknown): MemberRecord {
  const knownFields: Record<string, unknown> = {};
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    const source = value as Record<string, unknown>;
    for (const field of memberRecordFields) {
      if (Object.prototype.hasOwnProperty.call(source, field)) knownFields[field] = source[field];
    }
  }
  const result = parseMemberRecord(knownFields);
  if (!result.ok) throw new HttpsError("internal", "A stored member record is invalid");
  return result.value;
}

function stableFilters(filters: MemberSearchFilters): string {
  return JSON.stringify(
    Object.keys(filters)
      .sort()
      .map((key) => [key, filters[key as keyof MemberSearchFilters]]),
  );
}

function invalidPageToken(): never {
  throw new HttpsError("invalid-argument", "Page token is invalid");
}

export function createSignedMemberPageTokenCodec(secret: string): MemberPageTokenCodec {
  if (secret.length < 32) throw new Error("Member page token secret is too short");

  const sign = (payload: string): string =>
    createHmac("sha256", secret).update(payload).digest("base64url");

  return {
    encode: ({ academyId, filters }, offset) => {
      const payload = Buffer.from(
        JSON.stringify({ version: 1, academyId, filters: stableFilters(filters), offset }),
      ).toString("base64url");
      return `${payload}.${sign(payload)}`;
    },
    decode: ({ academyId, filters }, token) => {
      const parts = token.split(".");
      if (parts.length !== 2 || parts[0] === undefined || parts[1] === undefined)
        return invalidPageToken();
      const expectedSignature = Buffer.from(sign(parts[0]), "base64url");
      const suppliedSignature = Buffer.from(parts[1], "base64url");
      if (
        expectedSignature.length !== suppliedSignature.length ||
        !timingSafeEqual(expectedSignature, suppliedSignature)
      ) {
        return invalidPageToken();
      }
      try {
        const decoded: unknown = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
        if (
          typeof decoded !== "object" ||
          decoded === null ||
          Array.isArray(decoded) ||
          (decoded as Record<string, unknown>).version !== 1 ||
          (decoded as Record<string, unknown>).academyId !== academyId ||
          (decoded as Record<string, unknown>).filters !== stableFilters(filters) ||
          !Number.isSafeInteger((decoded as Record<string, unknown>).offset) ||
          ((decoded as Record<string, unknown>).offset as number) < 0
        ) {
          return invalidPageToken();
        }
        return (decoded as Record<string, unknown>).offset as number;
      } catch {
        return invalidPageToken();
      }
    },
  };
}

function contains(value: string | undefined, query: string | undefined): boolean {
  return (
    query === undefined || (value?.toLocaleLowerCase().includes(query.toLocaleLowerCase()) ?? false)
  );
}

function matchesFilters(member: MemberRecord, filters: MemberSearchFilters): boolean {
  return (
    contains(member.membershipNumber, filters.membershipNumber) &&
    contains(member.fullName, filters.name) &&
    contains(member.email, filters.email) &&
    contains(member.idCardNumber, filters.idCardNumber) &&
    contains(member.vatNumber, filters.vatNumber) &&
    contains(member.mobileNumber, filters.mobileNumber) &&
    contains(member.frequency, filters.frequency) &&
    contains(member.trainingCenter, filters.trainingCenter) &&
    (filters.paymentOrStatus === undefined ||
      member.paymentStatus === filters.paymentOrStatus ||
      member.membershipStatus === filters.paymentOrStatus) &&
    (filters.gender === undefined || member.gender === filters.gender)
  );
}

function sortMembers(members: MemberRecord[], orderBy: MemberSearchFilters["orderBy"]): void {
  const requestedField = orderBy ?? "name";
  const field =
    requestedField === "name"
      ? "fullName"
      : requestedField === "registrationDate"
        ? "createdAt"
        : requestedField === "loginTimes"
          ? "updatedAt"
          : requestedField;
  members.sort((left, right) => {
    const leftValue = String(
      (field ? left[field as keyof MemberRecord] : "") ?? "",
    ).toLocaleLowerCase();
    const rightValue = String(
      (field ? right[field as keyof MemberRecord] : "") ?? "",
    ).toLocaleLowerCase();
    return leftValue.localeCompare(rightValue) || left.memberId.localeCompare(right.memberId);
  });
}

function projectMember(member: MemberRecord): MemberProjection {
  const projection: Record<string, unknown> = {};
  for (const field of memberProjectionFields) {
    if (Object.prototype.hasOwnProperty.call(member, field)) projection[field] = member[field];
  }
  return Object.freeze(projection) as MemberProjection;
}

export function normalizeImportValue(value: string | undefined): string {
  return (value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9]+/gu, "");
}

const importWritableFields = [
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

function nonEmptyImportValue(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function importMatchKeys(
  member: Readonly<{ membershipNumber?: string; email?: string }>,
): readonly string[] {
  return [
    member.membershipNumber === undefined
      ? undefined
      : `membership:${normalizeImportValue(member.membershipNumber)}`,
    member.email === undefined ? undefined : `email:${normalizeImportValue(member.email)}`,
  ].filter((key): key is string => key !== undefined);
}

export function resolveMemberImportMatch<
  T extends Readonly<{
    academyId?: string;
    membershipNumber?: string;
    email?: string;
  }>,
>(
  row: ParsedMemberRow,
  members: readonly T[],
  academyId: string,
): Readonly<{ member?: T; ambiguous: boolean }> {
  const keys = [
    row.membershipNumber === undefined
      ? undefined
      : `membership:${normalizeImportValue(row.membershipNumber)}`,
    row.email === undefined ? undefined : `email:${normalizeImportValue(row.email)}`,
  ].filter((key): key is string => key !== undefined);
  const matches = members.filter((member) => {
    if (member.academyId !== undefined && member.academyId !== academyId) return false;
    const memberKeys = importMatchKeys(member);
    return keys.some((key) => memberKeys.includes(key));
  });
  return matches.length === 1
    ? { member: matches[0] as T, ambiguous: false }
    : { ambiguous: matches.length > 1 };
}

function buildImportMutations(
  rows: readonly ParsedMemberRow[],
  members: readonly MemberRecord[],
  academyId: string,
  actorId: string,
  now: string,
  createId: () => string,
  importRunId: string,
): Readonly<{ mutations: readonly MemberImportMutation[]; result: MemberImportWriteResult }> {
  if (rows.length > MAX_MEMBER_IMPORT_WRITE_ROWS) {
    throw new HttpsError("resource-exhausted", "Member import has too many writes");
  }
  const mutations: MemberImportMutation[] = [];
  const generatedIds = new Set<string>();
  for (const row of rows) {
    const resolved = resolveMemberImportMatch(row, members, academyId);
    if (resolved.ambiguous) {
      throw new HttpsError("failed-precondition", "Import preview contains conflicts");
    }
    const current = resolved.member;
    if (
      current !== undefined &&
      normalizeImportValue(row.fullName) !== normalizeImportValue(current.fullName)
    ) {
      throw new HttpsError("failed-precondition", "Import preview contains conflicts");
    }
    if (current === undefined) {
      const record: MemberRecord = Object.freeze({
        memberId: createId(),
        academyId,
        fullName: row.fullName,
        ...(row.membershipNumber === undefined ? {} : { membershipNumber: row.membershipNumber }),
        ...(row.email === undefined ? {} : { email: row.email }),
        ...(row.idCardNumber === undefined ? {} : { idCardNumber: row.idCardNumber }),
        ...(row.birthDate === undefined ? {} : { birthDate: row.birthDate }),
        ...(row.vatNumber === undefined ? {} : { vatNumber: row.vatNumber }),
        ...(row.mobileNumber === undefined ? {} : { mobileNumber: row.mobileNumber }),
        ...(row.inactiveAt === undefined ? {} : { inactiveAt: row.inactiveAt }),
        ...(row.paymentStatus === undefined
          ? { paymentStatus: "unknown" as const }
          : { paymentStatus: row.paymentStatus }),
        gender: "unknown",
        ...(row.membershipStatus === undefined
          ? { membershipStatus: "active" as const }
          : { membershipStatus: row.membershipStatus }),
        createdAt: now,
        createdBy: actorId,
        updatedAt: now,
        updatedBy: actorId,
        source: "member-pdf-import",
        importRunId,
        schemaVersion: "1",
      });
      if (generatedIds.has(record.memberId)) {
        throw new HttpsError("aborted", "Member import ID generation collision");
      }
      generatedIds.add(record.memberId);
      mutations.push({ kind: "create", memberId: record.memberId, record });
      continue;
    }
    const updates: Record<string, unknown> = {};
    for (const field of importWritableFields) {
      const value = row[field];
      if (!nonEmptyImportValue(value)) continue;
      if (field === "membershipNumber") {
        if (normalizeImportValue(value) !== normalizeImportValue(current.membershipNumber))
          updates[field] = value;
      } else if (value !== current[field]) {
        updates[field] = value;
      }
    }
    if (Object.keys(updates).length > 0) {
      mutations.push({
        kind: "update",
        memberId: current.memberId,
        updates,
        expectedUpdatedAt: current.updatedAt,
      });
    }
  }
  return {
    mutations: Object.freeze(mutations),
    result: Object.freeze({
      imported: mutations.filter((mutation) => mutation.kind === "create").length,
      updated: mutations.filter((mutation) => mutation.kind === "update").length,
      conflicts: 0,
    }),
  };
}

async function readAcademyMembers(
  store: MemberStore,
  academyId: string,
  maxRows: number,
): Promise<MemberRecord[]> {
  const stored = await store.list(academyId, maxRows + 1);
  if (stored.length > maxRows) {
    throw new HttpsError("resource-exhausted", "Member read is too large");
  }
  return stored.map(asStoredMember).filter((member) => member.academyId === academyId);
}

export function createMemberService(
  store: MemberStore,
  options: MemberServiceOptions = {},
): MemberService {
  const pageTokenCodec =
    options.pageTokenCodec ??
    createSignedMemberPageTokenCodec(
      options.pageTokenSecret ?? process.env.MEMBER_PAGE_TOKEN_SECRET ?? "",
    );
  return {
    create: async ({ academyId, actorId, memberId, now, data }) => {
      const record = Object.freeze({
        memberId,
        academyId,
        ...data,
        paymentStatus: "unknown" as PaymentStatus,
        gender: data.gender ?? ("unknown" as MemberGender),
        membershipStatus: "active" as MembershipStatus,
        createdAt: now,
        createdBy: actorId,
        updatedAt: now,
        updatedBy: actorId,
        source: "admin",
        schemaVersion: "1" as const,
      }) as MemberRecord;
      validateMemberRecordForImport(record);
      await store.create(record);
      return memberId;
    },
    list: async (academyId) => {
      return readAcademyMembers(store, academyId, MAX_MEMBER_SEARCH_ROWS);
    },
    listForImport: async (academyId) => {
      return (await readAcademyMembers(store, academyId, MAX_MEMBER_IMPORT_MATCH_ROWS)).map(
        ({
          memberId,
          membershipNumber,
          fullName,
          email,
          idCardNumber,
          vatNumber,
          birthDate,
          mobileNumber,
          membershipStatus,
          paymentStatus,
          inactiveAt,
          importRunId,
        }) => ({
          memberId,
          ...(membershipNumber === undefined ? {} : { membershipNumber }),
          fullName,
          ...(email === undefined ? {} : { email }),
          ...(idCardNumber === undefined ? {} : { idCardNumber }),
          ...(vatNumber === undefined ? {} : { vatNumber }),
          ...(birthDate === undefined ? {} : { birthDate }),
          ...(mobileNumber === undefined ? {} : { mobileNumber }),
          membershipStatus,
          paymentStatus,
          ...(inactiveAt === undefined ? {} : { inactiveAt }),
          ...(importRunId === undefined ? {} : { importRunId }),
        }),
      );
    },
    search: async (academyId, filters, pageToken) => {
      const members = (await readAcademyMembers(store, academyId, MAX_MEMBER_SEARCH_ROWS)).filter(
        (member) => matchesFilters(member, filters),
      );
      sortMembers(members, filters.orderBy);
      const pageTokenContext = { academyId, filters };
      const offset =
        pageToken === undefined ? 0 : pageTokenCodec.decode(pageTokenContext, pageToken);
      const page = members.slice(offset, offset + MEMBER_PAGE_SIZE);
      const nextOffset = offset + page.length;
      return Object.freeze({
        members: Object.freeze(page.map(projectMember)),
        ...(nextOffset < members.length
          ? { nextPageToken: pageTokenCodec.encode(pageTokenContext, nextOffset) }
          : {}),
      });
    },
    report: async (academyId, report) => {
      const members = await readAcademyMembers(store, academyId, MAX_MEMBER_REPORT_ROWS);
      return Object.freeze(
        members.filter((member) => matchesMemberReport(member, report)).map(projectMember),
      );
    },
    reportSummary: async (academyId, report) => {
      const count = await store.countByReport(academyId, report);
      if (count > MAX_MEMBER_REPORT_SUMMARY_ROWS) {
        throw new HttpsError("resource-exhausted", "Member report summary is too large");
      }
      return Object.freeze({ report, count });
    },
    applyImportPreview: async ({
      academyId,
      actorId,
      preview,
      now,
      createId,
      operationId,
      importRunId,
    }) => {
      if (preview.conflicts.length > 0) {
        throw new HttpsError("failed-precondition", "Import preview contains conflicts");
      }
      const source = (preview as Partial<ServerMemberImportPreview>)[memberImportPreviewSource];
      if (source === undefined)
        throw new HttpsError("failed-precondition", "Import preview is unavailable");
      const stableOperationId = validateImportOperationId(operationId ?? preview.previewId);
      const members = await readAcademyMembers(store, academyId, MAX_MEMBER_IMPORT_MATCH_ROWS);
      const plan = buildImportMutations(
        source.rows,
        members,
        academyId,
        actorId,
        now,
        createId,
        importRunId ?? stableOperationId,
      );
      return store.applyImport({
        academyId,
        actorId,
        now,
        operationId: stableOperationId,
        sourceHash: source.sourceHash,
        reportKeys: preview.sourceReports.map((source) => source.report),
        mutations: plan.mutations,
        result: plan.result,
      });
    },
  };
}

type FirestoreDocument = Readonly<{ exists: boolean; data: () => unknown }>;
type FirestoreTransaction = Readonly<{
  get: (reference: unknown) => Promise<FirestoreDocument>;
  create: (reference: unknown, data: Record<string, unknown>) => void;
  set: (reference: unknown, data: unknown, options?: unknown) => void;
}>;

export function createFirestoreMemberStore(firestore: Firestore = getFirestore()): MemberStore {
  return {
    create: async (record) => {
      validateMemberRecordForImport(record);
      const reference = firestore
        .collection(`academies/${record.academyId}/members`)
        .doc(record.memberId);
      await firestore.runTransaction(async (transaction) => {
        const existing = await (transaction as unknown as FirestoreTransaction).get(reference);
        if (existing.exists) throw new HttpsError("already-exists", "Member already exists");
        (transaction as unknown as FirestoreTransaction).create(reference, record);
      });
    },
    list: async (academyId, limit) => {
      const snapshot = await firestore
        .collection(`academies/${academyId}/members`)
        .limit(limit)
        .get();
      return snapshot.docs.map((document) => document.data());
    },
    countByReport: async (academyId, report) => {
      const snapshot = await firestore
        .collection(`academies/${academyId}/members`)
        .limit(MAX_MEMBER_REPORT_SUMMARY_ROWS + 1)
        .get();
      if (snapshot.size > MAX_MEMBER_REPORT_SUMMARY_ROWS) {
        throw new HttpsError("resource-exhausted", "Member report summary is too large");
      }
      return snapshot.docs.reduce(
        (count, document) =>
          count + (matchesMemberReport(asStoredMember(document.data()), report) ? 1 : 0),
        0,
      );
    },
    applyImport: async ({
      academyId,
      actorId,
      now,
      operationId,
      sourceHash,
      reportKeys,
      mutations,
      result,
    }) => {
      validateImportOperationId(operationId);
      if (mutations.length > MAX_MEMBER_IMPORT_WRITE_ROWS)
        throw new HttpsError("resource-exhausted", "Member import has too many writes");
      const operationReference = firestore
        .collection(`academies/${academyId}/memberImportOperations`)
        .doc(operationId);
      const auditReference = firestore.collection(`academies/${academyId}/auditEvents`).doc();
      let appliedResult: MemberImportWriteResult | undefined;
      await firestore.runTransaction(async (transaction) => {
        const operationSnapshot = await transaction.get(operationReference);
        if (operationSnapshot.exists) {
          const existing = operationSnapshot.data();
          if (
            existing?.academyId !== academyId ||
            existing?.actorId !== actorId ||
            existing?.sourceHash !== sourceHash
          ) {
            throw new HttpsError("failed-precondition", "Member import operation is inconsistent");
          }
          appliedResult = parseImportWriteResult(existing?.result);
          if (appliedResult === undefined) {
            throw new HttpsError("failed-precondition", "Member import operation is invalid");
          }
          return;
        }
        const references = mutations.map((mutation) =>
          firestore.doc(`academies/${academyId}/members/${mutation.memberId}`),
        );
        const snapshots = [];
        for (const reference of references) snapshots.push(await transaction.get(reference));
        for (const [index, mutation] of mutations.entries()) {
          const reference = references[index];
          const snapshot = snapshots[index];
          if (reference === undefined || snapshot === undefined)
            throw new Error("Invalid import mutation");
          if (mutation.kind === "create") {
            if (snapshot.exists)
              throw new HttpsError("aborted", "Member import identity collision");
            if (mutation.record === undefined) throw new Error("Invalid member import creation");
            validateMemberRecordForImport(mutation.record);
            transaction.create(reference, mutation.record);
          } else {
            if (!snapshot.exists) throw new HttpsError("aborted", "Member changed during import");
            const current = asStoredMember(snapshot.data());
            if (
              current.academyId !== academyId ||
              current.updatedAt !== mutation.expectedUpdatedAt
            ) {
              throw new HttpsError("aborted", "Member changed during import");
            }
            const updatedRecord = {
              ...current,
              ...mutation.updates,
              updatedAt: now,
              updatedBy: actorId,
            } as MemberRecord;
            validateMemberRecordForImport(updatedRecord);
            transaction.set(
              reference,
              {
                ...mutation.updates,
                academyId,
                memberId: current.memberId,
                updatedAt: now,
                updatedBy: actorId,
              },
              { merge: true },
            );
          }
        }
        const auditDraft = {
          academyId,
          actorId,
          action: "member.import.confirmed",
          targetRef: `academies/${academyId}/members`,
          purpose: "confirmed member PDF import",
          correlationId: operationId,
          imported: result.imported,
          updated: result.updated,
          conflicts: result.conflicts,
          sourceHash,
          reportKeys,
        } as unknown as AuditEventDraft;
        appendAuditEventInTransaction(
          transaction as unknown as AuditCreateTransaction<typeof auditReference>,
          auditReference,
          auditDraft,
        );
        transaction.create(operationReference, {
          operationId,
          academyId,
          actorId,
          sourceHash,
          result,
          confirmedAt: now,
          auditEventId: auditReference.id,
          schemaVersion: 1,
        });
      });
      return appliedResult ?? result;
    },
  };
}
