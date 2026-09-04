import { timingSafeEqual } from "node:crypto";

import type { RestrictedMemberReadAuditEventDraft } from "@bpt-jersey/domain/audit";
import { appendAuditEventInTransaction } from "../audit/audit-writer.js";
import {
  canonicalizeMemberDirectoryValue,
  createMemberDirectoryIntegrityMac,
  decodeMemberDirectorySecret,
  deriveStudentIdentityKeyId,
  studentIdentityKeySchema,
} from "./member-directory-crypto.js";
import { selectAdminDirectoryReader } from "./member-directory-state.js";
import type { CanonicalMemberDirectoryActor } from "./canonical-member-directory-service.js";
import {
  memberDirectoryStateSchema,
  studentAdminProfileSchema,
  toAdminDirectoryRow,
  toMemberRecordMaintenanceDetail,
  type AdminDirectoryRow,
  type MemberRecordMaintenanceDetail,
  type PublicAdminIdentifierLookupKind,
  type StudentAdminProfile,
} from "@bpt-jersey/domain/members/directory";
import { parseStudentProfileAt, type StudentProfile } from "@bpt-jersey/domain/profiles";
import { z } from "zod";
import { matchesProvisionedMemberDirectoryActor } from "./member-directory-actor-authorization.js";

export type DirectoryReadData = Readonly<Record<string, unknown>>;
export type DirectoryReadDocument = Readonly<{
  id: string;
  exists: boolean;
  data: DirectoryReadData | undefined;
}>;

export type CanonicalDirectoryReadTransaction = Readonly<{
  get: (path: string) => Promise<DirectoryReadDocument>;
  listStudents: (
    input: Readonly<{
      academyId: string;
      afterDocumentId?: string;
      limit: number;
    }>,
  ) => Promise<readonly DirectoryReadDocument[]>;
  create: (path: string, data: DirectoryReadData) => void;
  set: (path: string, data: DirectoryReadData) => void;
}>;

export type CanonicalDirectoryReadStore = Readonly<{
  runTransaction: <T>(
    callback: (transaction: CanonicalDirectoryReadTransaction) => Promise<T>,
  ) => Promise<T>;
}>;

export type AdminDirectoryPage = Readonly<{
  rows: readonly AdminDirectoryRow[];
  nextCursor?: string;
}>;

export type ExactMemberLookupResult =
  Readonly<{ matched: false }> | Readonly<{ matched: true; row: AdminDirectoryRow }>;

type DirectoryReadCommand = Readonly<{
  actor: CanonicalMemberDirectoryActor;
  value: unknown;
  now: string;
}>;

export type CanonicalMemberDirectoryReadService = Readonly<{
  list: (command: DirectoryReadCommand) => Promise<AdminDirectoryPage>;
  detail: (command: DirectoryReadCommand) => Promise<MemberRecordMaintenanceDetail>;
  lookup: (command: DirectoryReadCommand) => Promise<ExactMemberLookupResult>;
}>;

export type CanonicalMemberDirectoryReadDependencies = Readonly<{
  store: CanonicalDirectoryReadStore;
  identitySecretMaterial: string;
  identitySecretVersion: string;
  cursorSecretMaterial: string;
  cursorSecretVersion: string;
  generateAuditId: () => string;
}>;

export class CanonicalMemberDirectoryReadError extends Error {
  public readonly code: "unauthorized" | "invalid" | "unavailable" | "not-found" | "rate-limited";

  public constructor(
    code: "unauthorized" | "invalid" | "unavailable" | "not-found" | "rate-limited",
    message: string,
  ) {
    super(message);
    this.name = "CanonicalMemberDirectoryReadError";
    this.code = code;
  }
}

const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const utcMillisecondPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const cursorSegmentPattern = /^[A-Za-z0-9_-]+$/u;
const cursorLifetimeMs = 5 * 60 * 1_000;
const restrictedWindowSeconds = 5 * 60;
const restrictedAttemptLimit = 20;

const listInputSchema = z.strictObject({
  pageSize: z.number().int().min(1).max(50),
  cursor: z.string().min(1).max(2_048).optional(),
});

const detailInputSchema = z.strictObject({
  studentId: z.string().regex(identifierPattern),
  purpose: z.literal("member-record-maintenance"),
});

const lookupInputSchema = z.strictObject({
  lookupKind: z.enum(["membership-number", "id-card-number", "vat-number"]),
  value: z.string().min(1).max(64),
  purpose: z.literal("member-identity-lookup"),
});

const cursorPayloadSchema = z.strictObject({
  academyId: z.string().regex(identifierPattern),
  actorId: z.string().regex(identifierPattern),
  role: z.enum(["owner", "administrator"]),
  projectionVersion: z.literal("admin-directory-v1"),
  order: z.literal("__name__:asc"),
  afterDocumentId: z.string().regex(identifierPattern),
  issuedAt: z.string().regex(utcMillisecondPattern),
  expiresAt: z.string().regex(utcMillisecondPattern),
  cursorSecretVersion: z.string().regex(identifierPattern),
});

const restrictedReadLimitSchema = z.strictObject({
  actorId: z.string().regex(identifierPattern),
  academyId: z.string().regex(identifierPattern),
  windowStartedAt: z.string().regex(utcMillisecondPattern),
  attemptCount: z.number().int().min(0).max(restrictedAttemptLimit),
  overLimitObserved: z.boolean(),
  schemaVersion: z.literal("1"),
  updatedAt: z.string().regex(utcMillisecondPattern),
});

type CursorPayload = Readonly<z.infer<typeof cursorPayloadSchema>>;
type RestrictedReadLimit = Readonly<z.infer<typeof restrictedReadLimitSchema>>;
type RestrictedAction = "member.detail.read" | "member.identity.lookup";
type RestrictedPurpose = "member-record-maintenance" | "member-identity-lookup";
type RestrictedOperationOutcome<T> =
  | Readonly<{ kind: "success"; value: T; auditResult: "completed" | "no-match" }>
  | Readonly<{
      kind: "failure";
      code: "not-found" | "unavailable";
      auditResult: "not-found" | "unavailable";
    }>;
type RestrictedTransactionResult<T> =
  | Readonly<{ kind: "completed"; outcome: RestrictedOperationOutcome<T> }>
  | Readonly<{ kind: "rate-limited" }>;

class DirectoryDataIssue extends Error {}

function requiredIdentifier(value: string, label: string): string {
  if (!identifierPattern.test(value)) {
    throw new CanonicalMemberDirectoryReadError("invalid", `Invalid ${label}`);
  }
  return value;
}

function requiredTimestamp(value: string): string {
  const parsed = Date.parse(value);
  if (
    !utcMillisecondPattern.test(value) ||
    Number.isNaN(parsed) ||
    new Date(parsed).toISOString() !== value
  ) {
    throw new CanonicalMemberDirectoryReadError("invalid", "Invalid server timestamp");
  }
  return value;
}

function isPlainData(value: unknown, depth = 0): boolean {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return true;
  }
  if (depth > 8 || typeof value !== "object") return false;
  if (Array.isArray(value)) {
    if (Reflect.ownKeys(value).length !== value.length + 1) return false;
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.hasOwn(value, index) || !isPlainData(value[index], depth + 1)) return false;
    }
    return true;
  }
  if (Object.getPrototypeOf(value) !== Object.prototype) return false;
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") return false;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      descriptor === undefined ||
      descriptor.enumerable !== true ||
      descriptor.get !== undefined ||
      descriptor.set !== undefined ||
      !Object.hasOwn(descriptor, "value") ||
      !isPlainData(descriptor.value, depth + 1)
    ) {
      return false;
    }
  }
  return true;
}

function parseInput<T>(schema: z.ZodType<T>, value: unknown): T {
  if (!isPlainData(value)) {
    throw new CanonicalMemberDirectoryReadError("invalid", "Invalid request data");
  }
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new CanonicalMemberDirectoryReadError("invalid", "Invalid request data");
  }
  return parsed.data;
}

function requireAuthorizedActor(actor: CanonicalMemberDirectoryActor): void {
  if (!actor.appCheckVerified) {
    throw new CanonicalMemberDirectoryReadError("unauthorized", "Verified App Check is required");
  }
  if (!actor.active || (actor.role !== "owner" && actor.role !== "administrator")) {
    throw new CanonicalMemberDirectoryReadError(
      "unauthorized",
      "Authorized active admin is required",
    );
  }
  requiredIdentifier(actor.actorId, "actor ID");
  requiredIdentifier(actor.academyId, "academy ID");
}

function documentData(document: DirectoryReadDocument, label: string): DirectoryReadData {
  if (!document.exists || document.data === undefined) {
    throw new DirectoryDataIssue(`${label} is missing`);
  }
  return document.data;
}

function statePath(academyId: string): string {
  return `academies/${academyId}/memberDirectoryStates/current`;
}

function actorPath(academyId: string, actorId: string): string {
  return "academies/" + academyId + "/users/" + actorId;
}

function actorRoleLockPath(academyId: string, actorId: string): string {
  return "academies/" + academyId + "/adminRoleLocks/" + actorId;
}

function studentPath(academyId: string, studentId: string): string {
  return `academies/${academyId}/students/${studentId}`;
}

function profilePath(academyId: string, studentId: string): string {
  return `academies/${academyId}/studentAdminProfiles/${studentId}`;
}

function keyPath(academyId: string, keyId: string): string {
  return `academies/${academyId}/studentIdentityKeys/${keyId}`;
}

function ratePath(academyId: string, actorId: string): string {
  return `academies/${academyId}/studentRestrictedReadLimits/${actorId}`;
}

function auditPath(academyId: string, auditEventId: string): string {
  return `academies/${academyId}/auditEvents/${auditEventId}`;
}

async function assertCanonicalReader(
  transaction: CanonicalDirectoryReadTransaction,
  academyId: string,
  identitySecretVersion: string,
): Promise<void> {
  const stateDocument = await transaction.get(statePath(academyId));
  let stateValue: DirectoryReadData;
  try {
    stateValue = documentData(stateDocument, "Member directory state");
  } catch {
    throw new CanonicalMemberDirectoryReadError(
      "unavailable",
      "Member directory reader is unavailable",
    );
  }
  const parsed = memberDirectoryStateSchema.safeParse(stateValue);
  if (!parsed.success) {
    throw new CanonicalMemberDirectoryReadError(
      "unavailable",
      "Member directory reader is unavailable",
    );
  }
  try {
    if (selectAdminDirectoryReader(stateValue) !== "canonical") {
      throw new Error("Unsupported rollback reader");
    }
  } catch {
    throw new CanonicalMemberDirectoryReadError(
      "unavailable",
      "Member directory reader is unavailable",
    );
  }
  if (
    parsed.data.digestVersion !== "hmac-sha256-v1" ||
    parsed.data.secretVersion !== identitySecretVersion
  ) {
    throw new CanonicalMemberDirectoryReadError(
      "unavailable",
      "Member directory reader is unavailable",
    );
  }
}

async function assertProvisionedActor(
  transaction: CanonicalDirectoryReadTransaction,
  actor: CanonicalMemberDirectoryActor,
): Promise<void> {
  const [actorDocument, roleLockDocument] = await Promise.all([
    transaction.get(actorPath(actor.academyId, actor.actorId)),
    transaction.get(actorRoleLockPath(actor.academyId, actor.actorId)),
  ]);
  const actorIsCurrent =
    actorDocument.id === actor.actorId &&
    actorDocument.exists &&
    actorDocument.data !== undefined &&
    matchesProvisionedMemberDirectoryActor(actorDocument.data, actor);
  const roleLockIsAbsent =
    roleLockDocument.id === actor.actorId &&
    !roleLockDocument.exists &&
    roleLockDocument.data === undefined;
  if (!actorIsCurrent || !roleLockIsAbsent) {
    throw new CanonicalMemberDirectoryReadError(
      "unauthorized",
      "Authorized active admin is required",
    );
  }
}

function parseStudent(
  document: DirectoryReadDocument,
  academyId: string,
  expectedStudentId: string,
  effectiveDate: string,
): StudentProfile {
  if (document.id !== expectedStudentId) {
    throw new DirectoryDataIssue("Student binding mismatch");
  }
  const parsed = parseStudentProfileAt(documentData(document, "Student"), effectiveDate);
  if (
    !parsed.ok ||
    parsed.value.studentId !== expectedStudentId ||
    parsed.value.academyId !== academyId
  ) {
    throw new DirectoryDataIssue("Student binding mismatch");
  }
  return parsed.value;
}

function parseAdminProfile(
  document: DirectoryReadDocument,
  academyId: string,
  expectedStudentId: string,
): StudentAdminProfile {
  if (document.id !== expectedStudentId) {
    throw new DirectoryDataIssue("Admin profile binding mismatch");
  }
  const parsed = studentAdminProfileSchema.safeParse(
    documentData(document, "Student admin profile"),
  );
  if (
    !parsed.success ||
    parsed.data.studentId !== expectedStudentId ||
    parsed.data.academyId !== academyId
  ) {
    throw new DirectoryDataIssue("Admin profile binding mismatch");
  }
  return parsed.data;
}

function parseOptionalAdminProfile(
  document: DirectoryReadDocument,
  academyId: string,
  expectedStudentId: string,
): StudentAdminProfile | undefined {
  if (!document.exists) {
    if (document.data !== undefined) {
      throw new DirectoryDataIssue("Invalid missing profile");
    }
    return undefined;
  }
  return parseAdminProfile(document, academyId, expectedStudentId);
}

function cursorMac(payloadSegment: string, secretMaterial: string): string {
  return createMemberDirectoryIntegrityMac({
    domain: "bpt-member-directory-cursor-v1",
    values: [payloadSegment],
    secretMaterial,
  });
}

function createCursor(
  actor: CanonicalMemberDirectoryActor,
  afterDocumentId: string,
  now: string,
  dependencies: CanonicalMemberDirectoryReadDependencies,
): string {
  const issuedAtMs = Date.parse(now);
  const payload: CursorPayload = cursorPayloadSchema.parse({
    academyId: actor.academyId,
    actorId: actor.actorId,
    role: actor.role,
    projectionVersion: "admin-directory-v1",
    order: "__name__:asc",
    afterDocumentId,
    issuedAt: now,
    expiresAt: new Date(issuedAtMs + cursorLifetimeMs).toISOString(),
    cursorSecretVersion: dependencies.cursorSecretVersion,
  });
  const segment = Buffer.from(canonicalizeMemberDirectoryValue(payload), "utf8").toString(
    "base64url",
  );
  return `${segment}.${cursorMac(segment, dependencies.cursorSecretMaterial)}`;
}

function invalidCursor(message = "Invalid directory cursor"): never {
  throw new CanonicalMemberDirectoryReadError("invalid", message);
}

function verifyCursor(
  token: string,
  actor: CanonicalMemberDirectoryActor,
  now: string,
  dependencies: CanonicalMemberDirectoryReadDependencies,
): string {
  const parts = token.split(".");
  const segment = parts[0];
  const suppliedMac = parts[1];
  if (
    parts.length !== 2 ||
    segment === undefined ||
    suppliedMac === undefined ||
    segment.length > 2_048 ||
    !cursorSegmentPattern.test(segment) ||
    !/^[a-f0-9]{64}$/u.test(suppliedMac)
  ) {
    return invalidCursor();
  }
  const expectedMac = cursorMac(segment, dependencies.cursorSecretMaterial);
  const supplied = Buffer.from(suppliedMac, "hex");
  const expected = Buffer.from(expectedMac, "hex");
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    return invalidCursor();
  }

  let decoded: string;
  try {
    const bytes = Buffer.from(segment, "base64url");
    if (bytes.toString("base64url") !== segment) throw new Error("Non-canonical cursor");
    decoded = bytes.toString("utf8");
  } catch {
    return invalidCursor();
  }
  let value: unknown;
  try {
    value = JSON.parse(decoded) as unknown;
  } catch {
    return invalidCursor();
  }
  const parsed = cursorPayloadSchema.safeParse(value);
  if (
    !parsed.success ||
    canonicalizeMemberDirectoryValue(parsed.data) !== decoded ||
    parsed.data.academyId !== actor.academyId ||
    parsed.data.actorId !== actor.actorId ||
    parsed.data.role !== actor.role ||
    parsed.data.cursorSecretVersion !== dependencies.cursorSecretVersion
  ) {
    return invalidCursor();
  }
  const issuedAt = Date.parse(parsed.data.issuedAt);
  const expiresAt = Date.parse(parsed.data.expiresAt);
  const requestAt = Date.parse(now);
  if (
    Number.isNaN(issuedAt) ||
    Number.isNaN(expiresAt) ||
    expiresAt - issuedAt !== cursorLifetimeMs ||
    issuedAt > requestAt ||
    expiresAt <= requestAt
  ) {
    return invalidCursor("Expired directory cursor");
  }
  return parsed.data.afterDocumentId;
}

function currentWindow(now: string): Readonly<{ epoch: number; startedAt: string }> {
  const epoch =
    Math.floor(Date.parse(now) / 1_000 / restrictedWindowSeconds) * restrictedWindowSeconds;
  return Object.freeze({
    epoch,
    startedAt: new Date(epoch * 1_000).toISOString(),
  });
}

function emptyRateLimit(actor: CanonicalMemberDirectoryActor, now: string): RestrictedReadLimit {
  return Object.freeze({
    actorId: actor.actorId,
    academyId: actor.academyId,
    windowStartedAt: currentWindow(now).startedAt,
    attemptCount: 0,
    overLimitObserved: false,
    schemaVersion: "1",
    updatedAt: now,
  });
}

function readRateLimit(
  document: DirectoryReadDocument,
  actor: CanonicalMemberDirectoryActor,
  now: string,
): RestrictedReadLimit {
  if (!document.exists) {
    if (document.data !== undefined) {
      throw new CanonicalMemberDirectoryReadError(
        "unavailable",
        "Restricted read state is invalid",
      );
    }
    return emptyRateLimit(actor, now);
  }
  const parsed = restrictedReadLimitSchema.safeParse(document.data);
  if (
    !parsed.success ||
    parsed.data.actorId !== actor.actorId ||
    parsed.data.academyId !== actor.academyId
  ) {
    throw new CanonicalMemberDirectoryReadError("unavailable", "Restricted read state is invalid");
  }
  requiredTimestamp(parsed.data.windowStartedAt);
  requiredTimestamp(parsed.data.updatedAt);
  if (parsed.data.windowStartedAt !== currentWindow(now).startedAt) {
    return emptyRateLimit(actor, now);
  }
  return parsed.data;
}

function appendRestrictedAuditEvent(
  input: Readonly<{
    transaction: CanonicalDirectoryReadTransaction;
    auditEventId: string;
    actor: CanonicalMemberDirectoryActor;
    action: RestrictedAction;
    purpose: RestrictedPurpose;
    result: "completed" | "no-match" | "not-found" | "unavailable" | "rate-limited";
  }>,
): void {
  const draft = Object.freeze({
    academyId: input.actor.academyId,
    actorId: input.actor.actorId,
    action: input.action,
    targetRef: ratePath(input.actor.academyId, input.actor.actorId),
    purpose: input.purpose,
    correlationId: input.auditEventId,
    result: input.result,
  } as unknown as RestrictedMemberReadAuditEventDraft);
  const path = auditPath(input.actor.academyId, input.auditEventId);
  appendAuditEventInTransaction(
    {
      create: (_reference, data) => input.transaction.create(path, data),
    },
    { id: input.auditEventId },
    draft,
  );
}

async function runRestricted<T>(
  input: Readonly<{
    command: DirectoryReadCommand;
    action: RestrictedAction;
    purpose: RestrictedPurpose;
    dependencies: CanonicalMemberDirectoryReadDependencies;
    operation: (
      transaction: CanonicalDirectoryReadTransaction,
    ) => Promise<RestrictedOperationOutcome<T>>;
  }>,
): Promise<T> {
  const { actor, now } = input.command;
  const generatedAuditId = requiredIdentifier(
    input.dependencies.generateAuditId(),
    "generated audit ID",
  );
  const transactionResult = await input.dependencies.store.runTransaction(
    async (transaction): Promise<RestrictedTransactionResult<T>> => {
      await assertProvisionedActor(transaction, actor);
      await assertCanonicalReader(
        transaction,
        actor.academyId,
        input.dependencies.identitySecretVersion,
      );
      const limitDocument = await transaction.get(ratePath(actor.academyId, actor.actorId));
      const limit = readRateLimit(limitDocument, actor, now);
      if (limit.attemptCount >= restrictedAttemptLimit) {
        if (!limit.overLimitObserved) {
          const window = currentWindow(now);
          const overLimitAuditId =
            `restricted-read-limit-v1:${actor.actorId.length}:` +
            `${actor.actorId}:${window.epoch}`;
          transaction.set(
            ratePath(actor.academyId, actor.actorId),
            Object.freeze({
              ...limit,
              overLimitObserved: true,
              updatedAt: now,
            }),
          );
          appendRestrictedAuditEvent({
            transaction,
            auditEventId: overLimitAuditId,
            actor,
            action: input.action,
            purpose: input.purpose,
            result: "rate-limited",
          });
        }
        return Object.freeze({ kind: "rate-limited" });
      }

      let outcome: RestrictedOperationOutcome<T>;
      try {
        outcome = await input.operation(transaction);
      } catch (error) {
        if (!(error instanceof DirectoryDataIssue)) throw error;
        outcome = Object.freeze({
          kind: "failure",
          code: "unavailable",
          auditResult: "unavailable",
        });
      }
      transaction.set(
        ratePath(actor.academyId, actor.actorId),
        Object.freeze({
          ...limit,
          attemptCount: limit.attemptCount + 1,
          updatedAt: now,
        }),
      );
      appendRestrictedAuditEvent({
        transaction,
        auditEventId: generatedAuditId,
        actor,
        action: input.action,
        purpose: input.purpose,
        result: outcome.auditResult,
      });
      return Object.freeze({ kind: "completed", outcome });
    },
  );

  if (transactionResult.kind === "rate-limited") {
    throw new CanonicalMemberDirectoryReadError(
      "rate-limited",
      "Restricted read rate limit exceeded",
    );
  }
  if (transactionResult.outcome.kind === "failure") {
    throw new CanonicalMemberDirectoryReadError(
      transactionResult.outcome.code,
      transactionResult.outcome.code === "not-found"
        ? "Member record was not found"
        : "Member record is unavailable",
    );
  }
  return transactionResult.outcome.value;
}

function identifierFromProfile(
  profile: StudentAdminProfile,
  kind: PublicAdminIdentifierLookupKind,
): string | undefined {
  switch (kind) {
    case "membership-number":
      return profile.membershipNumber;
    case "id-card-number":
      return profile.idCardNumber;
    case "vat-number":
      return profile.vatNumber;
  }
}

export function createCanonicalMemberDirectoryReadService(
  dependencies: CanonicalMemberDirectoryReadDependencies,
): CanonicalMemberDirectoryReadService {
  requiredIdentifier(dependencies.identitySecretVersion, "identity secret version");
  requiredIdentifier(dependencies.cursorSecretVersion, "cursor secret version");
  const identitySecret = decodeMemberDirectorySecret(
    dependencies.identitySecretMaterial,
    "identity",
  );
  const cursorSecret = decodeMemberDirectorySecret(dependencies.cursorSecretMaterial, "cursor");
  if (
    identitySecret.length === cursorSecret.length &&
    timingSafeEqual(identitySecret, cursorSecret)
  ) {
    throw new CanonicalMemberDirectoryReadError(
      "invalid",
      "Member directory purpose secrets must be distinct",
    );
  }

  return Object.freeze({
    async list(command) {
      requireAuthorizedActor(command.actor);
      const now = requiredTimestamp(command.now);
      const value = parseInput(listInputSchema, command.value);
      const afterDocumentId =
        value.cursor === undefined
          ? undefined
          : verifyCursor(value.cursor, command.actor, now, dependencies);
      const transactionResult = await dependencies.store.runTransaction(async (transaction) => {
        await assertProvisionedActor(transaction, command.actor);
        await assertCanonicalReader(
          transaction,
          command.actor.academyId,
          dependencies.identitySecretVersion,
        );
        const query = {
          academyId: command.actor.academyId,
          ...(afterDocumentId === undefined ? {} : { afterDocumentId }),
          limit: value.pageSize + 1,
        };
        const documents = await transaction.listStudents(query);
        if (documents.length > query.limit) {
          throw new CanonicalMemberDirectoryReadError(
            "unavailable",
            "Member directory query is invalid",
          );
        }
        let previousId = afterDocumentId;
        for (const document of documents) {
          if (
            !document.exists ||
            document.data === undefined ||
            !identifierPattern.test(document.id) ||
            (previousId !== undefined && document.id <= previousId)
          ) {
            throw new CanonicalMemberDirectoryReadError(
              "unavailable",
              "Member directory query is invalid",
            );
          }
          previousId = document.id;
        }
        const pageDocuments = documents.slice(0, value.pageSize);
        const profileDocuments = await Promise.all(
          pageDocuments.map((document) =>
            transaction.get(profilePath(command.actor.academyId, document.id)),
          ),
        );
        const rows = pageDocuments.map((document, index) => {
          try {
            const student = parseStudent(
              document,
              command.actor.academyId,
              document.id,
              now.slice(0, 10),
            );
            const profileDocument = profileDocuments[index];
            if (profileDocument === undefined) {
              throw new DirectoryDataIssue("Missing read result");
            }
            const profile = parseOptionalAdminProfile(
              profileDocument,
              command.actor.academyId,
              document.id,
            );
            return toAdminDirectoryRow(student, profile);
          } catch {
            throw new CanonicalMemberDirectoryReadError(
              "unavailable",
              "Member directory record is invalid",
            );
          }
        });
        const last = pageDocuments.at(-1);
        return Object.freeze({
          rows: Object.freeze(rows),
          hasMore: documents.length > value.pageSize,
          ...(last === undefined ? {} : { lastDocumentId: last.id }),
        });
      });
      const nextCursor =
        transactionResult.hasMore && transactionResult.lastDocumentId !== undefined
          ? createCursor(command.actor, transactionResult.lastDocumentId, now, dependencies)
          : undefined;
      return Object.freeze({
        rows: transactionResult.rows,
        ...(nextCursor === undefined ? {} : { nextCursor }),
      });
    },

    async detail(command) {
      requireAuthorizedActor(command.actor);
      const now = requiredTimestamp(command.now);
      const value = parseInput(detailInputSchema, command.value);
      return runRestricted({
        command: Object.freeze({ ...command, now }),
        action: "member.detail.read",
        purpose: value.purpose,
        dependencies,
        operation: async (transaction) => {
          const [studentDocument, profileDocument] = await Promise.all([
            transaction.get(studentPath(command.actor.academyId, value.studentId)),
            transaction.get(profilePath(command.actor.academyId, value.studentId)),
          ]);
          if (!studentDocument.exists || !profileDocument.exists) {
            return Object.freeze({
              kind: "failure",
              code: "not-found",
              auditResult: "not-found",
            });
          }
          const student = parseStudent(
            studentDocument,
            command.actor.academyId,
            value.studentId,
            now.slice(0, 10),
          );
          const profile = parseAdminProfile(
            profileDocument,
            command.actor.academyId,
            value.studentId,
          );
          return Object.freeze({
            kind: "success",
            value: toMemberRecordMaintenanceDetail(student, profile),
            auditResult: "completed",
          });
        },
      });
    },

    async lookup(command) {
      requireAuthorizedActor(command.actor);
      const now = requiredTimestamp(command.now);
      const value = parseInput(lookupInputSchema, command.value);
      let requestedKeyId: string;
      try {
        requestedKeyId = deriveStudentIdentityKeyId({
          academyId: command.actor.academyId,
          kind: value.lookupKind,
          value: value.value,
          secretMaterial: dependencies.identitySecretMaterial,
        });
      } catch {
        throw new CanonicalMemberDirectoryReadError("invalid", "Invalid lookup request data");
      }
      return runRestricted<ExactMemberLookupResult>({
        command: Object.freeze({ ...command, now }),
        action: "member.identity.lookup",
        purpose: value.purpose,
        dependencies,
        operation: async (transaction) => {
          const identityDocument = await transaction.get(
            keyPath(command.actor.academyId, requestedKeyId),
          );
          if (!identityDocument.exists) {
            return Object.freeze({
              kind: "success",
              value: Object.freeze({ matched: false as const }),
              auditResult: "no-match",
            });
          }
          const parsedKey = studentIdentityKeySchema.safeParse(identityDocument.data);
          if (
            !parsedKey.success ||
            identityDocument.id !== requestedKeyId ||
            parsedKey.data.keyId !== requestedKeyId ||
            parsedKey.data.academyId !== command.actor.academyId ||
            parsedKey.data.kind !== value.lookupKind ||
            parsedKey.data.digestVersion !== "hmac-sha256-v1" ||
            parsedKey.data.secretVersion !== dependencies.identitySecretVersion
          ) {
            throw new DirectoryDataIssue("Identity key binding mismatch");
          }
          const studentId = parsedKey.data.ownerStudentId;
          const [studentDocument, profileDocument] = await Promise.all([
            transaction.get(studentPath(command.actor.academyId, studentId)),
            transaction.get(profilePath(command.actor.academyId, studentId)),
          ]);
          if (!studentDocument.exists || !profileDocument.exists) {
            return Object.freeze({
              kind: "success",
              value: Object.freeze({ matched: false as const }),
              auditResult: "no-match",
            });
          }
          const student = parseStudent(
            studentDocument,
            command.actor.academyId,
            studentId,
            now.slice(0, 10),
          );
          const profile = parseAdminProfile(profileDocument, command.actor.academyId, studentId);
          const currentIdentifier = identifierFromProfile(profile, value.lookupKind);
          const currentKeyId =
            currentIdentifier === undefined
              ? undefined
              : deriveStudentIdentityKeyId({
                  academyId: command.actor.academyId,
                  kind: value.lookupKind,
                  value: currentIdentifier,
                  secretMaterial: dependencies.identitySecretMaterial,
                });
          if (currentKeyId !== requestedKeyId) {
            return Object.freeze({
              kind: "success",
              value: Object.freeze({ matched: false as const }),
              auditResult: "no-match",
            });
          }
          return Object.freeze({
            kind: "success",
            value: Object.freeze({
              matched: true as const,
              row: toAdminDirectoryRow(student, profile),
            }),
            auditResult: "completed",
          });
        },
      });
    },
  });
}
