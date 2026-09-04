import {
  FieldPath,
  getFirestore,
  type DocumentData,
  type DocumentSnapshot,
  type Firestore,
  type Transaction,
} from "firebase-admin/firestore";
import {
  deriveParticipantType,
  parseStudentProfileAt,
  trainingCenters,
  trainingTimePreferences,
  type TrainingCenter,
  type TrainingTimePreference,
} from "@bpt-jersey/domain/profiles";
import {
  maskMembershipReference,
  normalizeAdministrativeIdentifier,
  studentAdminProfileSchema,
} from "@bpt-jersey/domain/members/directory";
import { z } from "zod";

import type {
  CanonicalMemberDirectoryActor,
  MemberDirectoryDocumentData,
  MemberDirectoryDocumentSnapshot,
  MemberDirectoryFirestore,
  MemberDirectoryTransaction,
} from "./canonical-member-directory-service.js";
import {
  MAX_CANONICAL_MEMBER_IMPORT_ROWS,
  parseCanonicalMemberImportPreview,
  parseCanonicalMemberImportResult,
  type CanonicalMemberImportExistingStudent,
  type CanonicalMemberImportPreview,
  type CanonicalMemberImportResult,
} from "./canonical-member-import-service.js";
import {
  canonicalizeMemberDirectoryValue,
  constantTimeMacEquals,
  createMemberDirectoryIntegrityMac,
  deriveStudentIdentityKeyId,
  studentIdentityKeySchema,
  type StudentIdentityKeyKind,
} from "./member-directory-crypto.js";
import type { ParsedMemberRow } from "./member-pdf-import.js";

const MAX_EXISTING_STUDENTS = 400;
const SESSION_SCHEMA_VERSION = "1" as const;
const sessionIdPattern = /^import-session-[a-f0-9]{64}$/u;
const operationIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const safeIdentifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const macPattern = /^[a-f0-9]{64}$/u;
const timestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const objectKeyPattern =
  /^academies\/[A-Za-z0-9][A-Za-z0-9._:-]{0,127}\/member-imports\/import-session-[a-f0-9]{64}\/[0-4]\.pdf$/u;

const timestamp = z
  .string()
  .regex(timestampPattern)
  .refine((value) => {
    const parsed = Date.parse(value);
    return !Number.isNaN(parsed) && new Date(parsed).toISOString() === value;
  });
const safeIdentifier = z.string().regex(safeIdentifierPattern);
const uploadSchema = z.strictObject({
  objectKey: z.string().regex(objectKeyPattern),
  sizeBytes: z
    .number()
    .int()
    .positive()
    .max(10 * 1024 * 1024)
    .safe(),
});
const baseSessionShape = {
  sessionId: z.string().regex(sessionIdPattern),
  operationId: z.string().regex(operationIdPattern),
  academyId: safeIdentifier,
  actorId: safeIdentifier,
  actorRole: z.enum(["owner", "administrator"]),
  projectId: safeIdentifier,
  targetProjectClassification: safeIdentifier,
  uploadManifestMac: z.string().regex(macPattern),
  sessionMac: z.string().regex(macPattern),
  uploads: z.array(uploadSchema).min(1).max(5).readonly(),
  trainingCenter: z.enum(trainingCenters),
  trainingTimePreferences: z
    .array(z.enum(trainingTimePreferences))
    .min(1)
    .max(trainingTimePreferences.length)
    .refine((values) => new Set(values).size === values.length)
    .readonly(),
  operationWriteTime: timestamp,
  expiresAt: timestamp,
  createdAt: timestamp,
  updatedAt: timestamp,
  schemaVersion: z.literal(SESSION_SCHEMA_VERSION),
} as const;
const uploadingSessionSchema = z.strictObject({
  ...baseSessionShape,
  status: z.literal("uploading"),
});
const previewedSessionSchema = z.strictObject({
  ...baseSessionShape,
  sourceUploadMac: z.string().regex(macPattern),
  privateManifest: z.unknown(),
  preview: z.unknown(),
  previewMac: z.string().regex(macPattern),
  status: z.literal("previewed"),
});
const confirmedSessionSchema = z.strictObject({
  ...baseSessionShape,
  sourceUploadMac: z.string().regex(macPattern),
  privateManifest: z.unknown(),
  preview: z.unknown(),
  previewMac: z.string().regex(macPattern),
  result: z.unknown(),
  completedAt: timestamp,
  status: z.literal("confirmed"),
});

export type CanonicalMemberImportSessionUpload = Readonly<{
  objectKey: string;
  sizeBytes: number;
}>;

export type CanonicalMemberImportUploadingSession = Readonly<{
  sessionId: string;
  operationId: string;
  academyId: string;
  actorId: string;
  actorRole: "owner" | "administrator";
  projectId: string;
  targetProjectClassification: string;
  uploadManifestMac: string;
  sessionMac: string;
  uploads: readonly CanonicalMemberImportSessionUpload[];
  trainingCenter: TrainingCenter;
  trainingTimePreferences: readonly TrainingTimePreference[];
  operationWriteTime: string;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
  status: "uploading";
  schemaVersion: typeof SESSION_SCHEMA_VERSION;
}>;

export type CanonicalMemberImportPreviewedSession = Omit<
  CanonicalMemberImportUploadingSession,
  "status"
> &
  Readonly<{
    sourceUploadMac: string;
    privateManifest: unknown;
    preview: CanonicalMemberImportPreview;
    previewMac: string;
    status: "previewed";
  }>;

export type CanonicalMemberImportConfirmedSession = Omit<
  CanonicalMemberImportPreviewedSession,
  "status"
> &
  Readonly<{
    result: CanonicalMemberImportResult;
    completedAt: string;
    status: "confirmed";
  }>;

export type CanonicalMemberImportPrivateSession =
  | CanonicalMemberImportUploadingSession
  | CanonicalMemberImportPreviewedSession
  | CanonicalMemberImportConfirmedSession;

export type CanonicalMemberImportSessionStore = Readonly<{
  createOrGet: (
    candidate: CanonicalMemberImportUploadingSession,
    now: string,
  ) => Promise<CanonicalMemberImportUploadingSession>;
  read: (
    academyId: string,
    sessionId: string,
  ) => Promise<CanonicalMemberImportPrivateSession | undefined>;
  persistPreview: (
    input: Readonly<{
      academyId: string;
      sessionId: string;
      operationId: string;
      sourceUploadMac: string;
      privateManifest: unknown;
      preview: CanonicalMemberImportPreview;
      now: string;
    }>,
  ) => Promise<CanonicalMemberImportPreviewedSession>;
  persistReview: (
    input: Readonly<{
      academyId: string;
      sessionId: string;
      operationId: string;
      sourceUploadMac: string;
      previousPreview: CanonicalMemberImportPreview;
      privateManifest: unknown;
      preview: CanonicalMemberImportPreview;
      now: string;
    }>,
  ) => Promise<CanonicalMemberImportPreviewedSession>;
  persistResult: (
    input: Readonly<{
      academyId: string;
      sessionId: string;
      operationId: string;
      sourceUploadMac: string;
      preview: CanonicalMemberImportPreview;
      result: CanonicalMemberImportResult;
      now: string;
    }>,
  ) => Promise<CanonicalMemberImportConfirmedSession>;
  listExpired: (
    now: string,
    limit: number,
  ) => Promise<readonly CanonicalMemberImportPrivateSession[]>;
  deleteExpired: (
    input: Readonly<{
      academyId: string;
      sessionId: string;
      sessionMac: string;
      now: string;
    }>,
  ) => Promise<void>;
}>;

export type BuildCanonicalMemberImportManifestInput = Readonly<{
  actor: CanonicalMemberDirectoryActor;
  operationId: string;
  rows: readonly ParsedMemberRow[];
  operationWriteTime: string;
  expiresAt: string;
  trainingCenter: TrainingCenter;
  trainingTimePreferences: readonly TrainingTimePreference[];
  reviews?: readonly CanonicalMemberImportInternalReview[];
}>;

export type CanonicalMemberImportInternalReview = Readonly<{
  rowIndex: number;
  decision: "accept" | "reject";
  existingStudentId: string;
}>;

export type CanonicalMemberImportReviewCandidate = Readonly<{
  rowIndex: number;
  sourceName: string;
  candidate: Readonly<{
    studentId: string;
    fullName: string;
    trainingCenter: TrainingCenter;
    membershipReference?: string;
  }>;
}>;

export type BuildCanonicalMemberImportManifestResult = Readonly<{
  manifest: unknown;
  reviewCandidates: readonly CanonicalMemberImportReviewCandidate[];
}>;

export type CanonicalMemberImportFirestoreAdapter = Readonly<{
  firestore: MemberDirectoryFirestore;
  scanExistingStudents: (
    transaction: MemberDirectoryTransaction,
    academyId: string,
    limit: number,
  ) => Promise<readonly CanonicalMemberImportExistingStudent[]>;
  sessions: CanonicalMemberImportSessionStore;
  buildPrivateManifest: (
    input: BuildCanonicalMemberImportManifestInput,
  ) => Promise<BuildCanonicalMemberImportManifestResult>;
}>;

type AdapterOptions = Readonly<{
  identitySecretMaterial: string;
  identitySecretVersion: string;
  integritySecretMaterial: string;
}>;

export type CanonicalMemberImportSessionMacInput = Readonly<{
  sessionId: string;
  operationId: string;
  academyId: string;
  actorId: string;
  actorRole: "owner" | "administrator";
  projectId: string;
  targetProjectClassification: string;
  uploadManifestMac: string;
  uploads: readonly CanonicalMemberImportSessionUpload[];
  trainingCenter: TrainingCenter;
  trainingTimePreferences: readonly TrainingTimePreference[];
  operationWriteTime: string;
  expiresAt: string;
  createdAt: string;
  schemaVersion: typeof SESSION_SCHEMA_VERSION;
}>;

export function createCanonicalMemberImportSessionMac(
  input: CanonicalMemberImportSessionMacInput,
  integritySecretMaterial: string,
): string {
  return createMemberDirectoryIntegrityMac({
    domain: "bpt-canonical-member-import-session-v1",
    values: [
      canonicalizeMemberDirectoryValue({
        sessionId: input.sessionId,
        operationId: input.operationId,
        academyId: input.academyId,
        actorId: input.actorId,
        actorRole: input.actorRole,
        projectId: input.projectId,
        targetProjectClassification: input.targetProjectClassification,
        uploadManifestMac: input.uploadManifestMac,
        uploads: input.uploads,
        trainingCenter: input.trainingCenter,
        trainingTimePreferences: input.trainingTimePreferences,
        operationWriteTime: input.operationWriteTime,
        expiresAt: input.expiresAt,
        createdAt: input.createdAt,
        schemaVersion: input.schemaVersion,
      }),
    ],
    secretMaterial: integritySecretMaterial,
  });
}

function copyData(value: DocumentData | undefined): MemberDirectoryDocumentData | undefined {
  return value === undefined ? undefined : Object.freeze({ ...value });
}

function writerSnapshot(snapshot: DocumentSnapshot): MemberDirectoryDocumentSnapshot {
  const data = copyData(snapshot.data());
  return Object.freeze({ id: snapshot.id, exists: snapshot.exists, data: () => data });
}

function mutable(value: MemberDirectoryDocumentData): DocumentData {
  return { ...value };
}

function requiredIdentifier(value: string, label: string): string {
  if (!safeIdentifierPattern.test(value)) throw new Error(`Invalid ${label}`);
  return value;
}

function sessionPath(academyId: string, sessionId: string): string {
  requiredIdentifier(academyId, "academy ID");
  if (!sessionIdPattern.test(sessionId))
    throw new Error("Invalid canonical member import session ID");
  return `academies/${academyId}/memberDirectoryImportSessions/${sessionId}`;
}

function exactSessionObjectKeys(session: CanonicalMemberImportUploadingSession): boolean {
  const prefix = `academies/${session.academyId}/member-imports/${session.sessionId}/`;
  return session.uploads.every((upload, index) => upload.objectKey === `${prefix}${index}.pdf`);
}

function previewIsBound(
  session: Omit<CanonicalMemberImportUploadingSession, "status">,
  preview: CanonicalMemberImportPreview,
): boolean {
  const receipt = preview.receipt;
  return (
    receipt.operationId === session.operationId &&
    receipt.academyId === session.academyId &&
    receipt.actorId === session.actorId &&
    receipt.projectId === session.projectId &&
    receipt.targetProjectClassification === session.targetProjectClassification &&
    receipt.operationWriteTime === session.operationWriteTime &&
    receipt.expiresAt === session.expiresAt
  );
}

function previewMac(
  session: Omit<CanonicalMemberImportUploadingSession, "status">,
  sourceUploadMac: string,
  privateManifest: unknown,
  preview: CanonicalMemberImportPreview,
  integritySecretMaterial: string,
): string {
  return createMemberDirectoryIntegrityMac({
    domain: "bpt-canonical-member-import-session-preview-v1",
    values: [
      session.sessionMac,
      sourceUploadMac,
      canonicalizeMemberDirectoryValue(privateManifest),
      canonicalizeMemberDirectoryValue(preview),
    ],
    secretMaterial: integritySecretMaterial,
  });
}

function parseSession(
  value: unknown,
  expectedAcademyId: string,
  expectedSessionId: string,
  integritySecretMaterial: string,
): CanonicalMemberImportPrivateSession {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Canonical member import session is invalid");
  }
  const status = (value as { status?: unknown }).status;
  const parsed =
    status === "uploading"
      ? uploadingSessionSchema.safeParse(value)
      : status === "previewed"
        ? previewedSessionSchema.safeParse(value)
        : status === "confirmed"
          ? confirmedSessionSchema.safeParse(value)
          : undefined;
  if (
    parsed === undefined ||
    !parsed.success ||
    parsed.data.academyId !== expectedAcademyId ||
    parsed.data.sessionId !== expectedSessionId ||
    !exactSessionObjectKeys(parsed.data as CanonicalMemberImportUploadingSession) ||
    !constantTimeMacEquals(
      parsed.data.sessionMac,
      createCanonicalMemberImportSessionMac(
        parsed.data as CanonicalMemberImportUploadingSession,
        integritySecretMaterial,
      ),
    ) ||
    Date.parse(parsed.data.expiresAt) - Date.parse(parsed.data.operationWriteTime) >
      10 * 60 * 1000 ||
    Date.parse(parsed.data.expiresAt) <= Date.parse(parsed.data.operationWriteTime)
  ) {
    throw new Error("Canonical member import session is invalid");
  }
  if (status === "uploading")
    return Object.freeze(parsed.data as CanonicalMemberImportUploadingSession);
  const preview = parseCanonicalMemberImportPreview((parsed.data as { preview: unknown }).preview);
  if (
    preview === undefined ||
    !previewIsBound(parsed.data as never, preview) ||
    !constantTimeMacEquals(
      (parsed.data as { previewMac: string }).previewMac,
      previewMac(
        parsed.data as CanonicalMemberImportUploadingSession,
        (parsed.data as { sourceUploadMac: string }).sourceUploadMac,
        (parsed.data as { privateManifest: unknown }).privateManifest,
        preview,
        integritySecretMaterial,
      ),
    )
  ) {
    throw new Error("Canonical member import session is invalid");
  }
  if (status === "previewed") {
    return Object.freeze({ ...parsed.data, preview }) as CanonicalMemberImportPreviewedSession;
  }
  const result = parseCanonicalMemberImportResult((parsed.data as { result: unknown }).result);
  if (result === undefined || result.receiptId !== preview.receipt.receiptId) {
    throw new Error("Canonical member import session is invalid");
  }
  return Object.freeze({
    ...parsed.data,
    preview,
    result,
  }) as CanonicalMemberImportConfirmedSession;
}

function replayInvariant(session: CanonicalMemberImportPrivateSession): string {
  return canonicalizeMemberDirectoryValue({
    sessionId: session.sessionId,
    operationId: session.operationId,
    academyId: session.academyId,
    actorId: session.actorId,
    actorRole: session.actorRole,
    projectId: session.projectId,
    targetProjectClassification: session.targetProjectClassification,
    uploadManifestMac: session.uploadManifestMac,
    uploads: session.uploads,
    trainingCenter: session.trainingCenter,
    trainingTimePreferences: session.trainingTimePreferences,
    schemaVersion: session.schemaVersion,
  });
}

function assertCurrentSession(
  session: CanonicalMemberImportPrivateSession,
  operationId: string,
  now: string,
): void {
  if (session.operationId !== operationId || Date.parse(now) > Date.parse(session.expiresAt)) {
    throw new Error("Canonical member import session is closed");
  }
}

function createSessionStore(
  firestore: Firestore,
  integritySecretMaterial: string,
): CanonicalMemberImportSessionStore {
  return Object.freeze({
    async createOrGet(candidate, now) {
      const candidateParsed = uploadingSessionSchema.safeParse(candidate);
      if (
        !candidateParsed.success ||
        !exactSessionObjectKeys(candidate) ||
        !constantTimeMacEquals(
          candidate.sessionMac,
          createCanonicalMemberImportSessionMac(candidate, integritySecretMaterial),
        )
      ) {
        throw new Error("Canonical member import session is invalid");
      }
      const path = sessionPath(candidate.academyId, candidate.sessionId);
      return firestore.runTransaction(async (transaction) => {
        const reference = firestore.doc(path);
        const snapshot = await transaction.get(reference);
        if (!snapshot.exists) {
          if (snapshot.data() !== undefined || Date.parse(now) > Date.parse(candidate.expiresAt)) {
            throw new Error("Canonical member import session is invalid");
          }
          transaction.create(reference, mutable(candidate as MemberDirectoryDocumentData));
          return Object.freeze(candidate);
        }
        const existing = parseSession(
          snapshot.data(),
          candidate.academyId,
          candidate.sessionId,
          integritySecretMaterial,
        );
        if (
          existing.status !== "uploading" ||
          replayInvariant(existing) !== replayInvariant(candidate) ||
          Date.parse(now) > Date.parse(existing.expiresAt)
        ) {
          throw new Error("Canonical member import session replay is invalid");
        }
        return existing;
      });
    },
    async read(academyId, sessionId) {
      const reference = firestore.doc(sessionPath(academyId, sessionId));
      return firestore.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(reference);
        if (!snapshot.exists) {
          if (snapshot.data() !== undefined)
            throw new Error("Canonical member import session is invalid");
          return undefined;
        }
        if (snapshot.id !== sessionId)
          throw new Error("Canonical member import session is invalid");
        return parseSession(snapshot.data(), academyId, sessionId, integritySecretMaterial);
      });
    },
    async persistPreview(input) {
      const path = sessionPath(input.academyId, input.sessionId);
      return firestore.runTransaction(async (transaction) => {
        const reference = firestore.doc(path);
        const snapshot = await transaction.get(reference);
        if (!snapshot.exists || snapshot.id !== input.sessionId)
          throw new Error("Canonical member import session is unavailable");
        const session = parseSession(
          snapshot.data(),
          input.academyId,
          input.sessionId,
          integritySecretMaterial,
        );
        assertCurrentSession(session, input.operationId, input.now);
        if (!previewIsBound(session, input.preview))
          throw new Error("Canonical member import preview is invalid");
        if (session.status === "confirmed")
          throw new Error("Canonical member import session is closed");
        if (session.status === "previewed") {
          if (
            session.sourceUploadMac !== input.sourceUploadMac ||
            canonicalizeMemberDirectoryValue(session.privateManifest) !==
              canonicalizeMemberDirectoryValue(input.privateManifest) ||
            canonicalizeMemberDirectoryValue(session.preview) !==
              canonicalizeMemberDirectoryValue(input.preview)
          )
            throw new Error("Canonical member import preview replay is invalid");
          return session;
        }
        const next: CanonicalMemberImportPreviewedSession = Object.freeze({
          ...session,
          sourceUploadMac: input.sourceUploadMac,
          privateManifest: input.privateManifest,
          preview: input.preview,
          previewMac: previewMac(
            session,
            input.sourceUploadMac,
            input.privateManifest,
            input.preview,
            integritySecretMaterial,
          ),
          updatedAt: input.now,
          status: "previewed",
        });
        transaction.set(reference, mutable(next as MemberDirectoryDocumentData));
        return next;
      });
    },
    async persistReview(input) {
      const path = sessionPath(input.academyId, input.sessionId);
      return firestore.runTransaction(async (transaction) => {
        const reference = firestore.doc(path);
        const snapshot = await transaction.get(reference);
        if (!snapshot.exists || snapshot.id !== input.sessionId)
          throw new Error("Canonical member import session is unavailable");
        const session = parseSession(
          snapshot.data(),
          input.academyId,
          input.sessionId,
          integritySecretMaterial,
        );
        assertCurrentSession(session, input.operationId, input.now);
        if (session.status !== "previewed")
          throw new Error("Canonical member import session is closed");
        if (session.sourceUploadMac !== input.sourceUploadMac)
          throw new Error("Canonical member import source changed");
        const alreadyReviewed = session.preview.reviewMatches.every(
          (match) => match.decision !== "pending",
        );
        if (alreadyReviewed) {
          if (
            canonicalizeMemberDirectoryValue(session.privateManifest) !==
              canonicalizeMemberDirectoryValue(input.privateManifest) ||
            canonicalizeMemberDirectoryValue(session.preview) !==
              canonicalizeMemberDirectoryValue(input.preview)
          )
            throw new Error("Canonical member import review replay is invalid");
          return session;
        }
        if (
          canonicalizeMemberDirectoryValue(session.preview) !==
            canonicalizeMemberDirectoryValue(input.previousPreview) ||
          !previewIsBound(session, input.preview)
        )
          throw new Error("Canonical member import review is invalid");
        const next: CanonicalMemberImportPreviewedSession = Object.freeze({
          ...session,
          privateManifest: input.privateManifest,
          preview: input.preview,
          previewMac: previewMac(
            session,
            input.sourceUploadMac,
            input.privateManifest,
            input.preview,
            integritySecretMaterial,
          ),
          updatedAt: input.now,
        });
        transaction.set(reference, mutable(next as MemberDirectoryDocumentData));
        return next;
      });
    },
    async persistResult(input) {
      const path = sessionPath(input.academyId, input.sessionId);
      return firestore.runTransaction(async (transaction) => {
        const reference = firestore.doc(path);
        const snapshot = await transaction.get(reference);
        if (!snapshot.exists || snapshot.id !== input.sessionId)
          throw new Error("Canonical member import session is unavailable");
        const session = parseSession(
          snapshot.data(),
          input.academyId,
          input.sessionId,
          integritySecretMaterial,
        );
        assertCurrentSession(session, input.operationId, input.now);
        if (session.status === "uploading")
          throw new Error("Canonical member import preview is required");
        if (
          session.sourceUploadMac !== input.sourceUploadMac ||
          canonicalizeMemberDirectoryValue(session.preview) !==
            canonicalizeMemberDirectoryValue(input.preview) ||
          input.result.receiptId !== input.preview.receipt.receiptId
        )
          throw new Error("Canonical member import result is invalid");
        if (session.status === "confirmed") {
          if (
            canonicalizeMemberDirectoryValue(session.result) !==
            canonicalizeMemberDirectoryValue(input.result)
          )
            throw new Error("Canonical member import result replay is invalid");
          return session;
        }
        const next: CanonicalMemberImportConfirmedSession = Object.freeze({
          ...session,
          result: input.result,
          completedAt: input.now,
          updatedAt: input.now,
          status: "confirmed",
        });
        transaction.set(reference, mutable(next as MemberDirectoryDocumentData));
        return next;
      });
    },
    async listExpired(now, limit) {
      if (
        !timestamp.safeParse(now).success ||
        !Number.isSafeInteger(limit) ||
        limit < 1 ||
        limit > 50
      ) {
        throw new Error("Canonical member import cleanup request is invalid");
      }
      return firestore.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(
          firestore
            .collectionGroup("memberDirectoryImportSessions")
            .where("expiresAt", "<=", now)
            .orderBy("expiresAt")
            .limit(limit),
        );
        return Object.freeze(
          snapshot.docs.map((document) => {
            const segments = document.ref.path.split("/");
            if (
              segments.length !== 4 ||
              segments[0] !== "academies" ||
              segments[2] !== "memberDirectoryImportSessions"
            ) {
              throw new Error("Canonical member import session is invalid");
            }
            const academyId = segments[1];
            const sessionId = segments[3];
            if (academyId === undefined || sessionId === undefined || document.id !== sessionId) {
              throw new Error("Canonical member import session is invalid");
            }
            const session = parseSession(
              document.data(),
              academyId,
              sessionId,
              integritySecretMaterial,
            );
            if (Date.parse(session.expiresAt) > Date.parse(now)) {
              throw new Error("Canonical member import cleanup query is invalid");
            }
            return session;
          }),
        );
      });
    },
    async deleteExpired(input) {
      const reference = firestore.doc(sessionPath(input.academyId, input.sessionId));
      await firestore.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(reference);
        if (!snapshot.exists || snapshot.id !== input.sessionId) {
          if (snapshot.data() !== undefined) {
            throw new Error("Canonical member import session is invalid");
          }
          return;
        }
        const session = parseSession(
          snapshot.data(),
          input.academyId,
          input.sessionId,
          integritySecretMaterial,
        );
        if (
          Date.parse(session.expiresAt) > Date.parse(input.now) ||
          !constantTimeMacEquals(session.sessionMac, input.sessionMac)
        ) {
          throw new Error("Canonical member import cleanup request is invalid");
        }
        transaction.delete(reference);
      });
    },
  });
}

function nativeWriterTransaction(
  firestore: Firestore,
  transaction: Transaction,
): MemberDirectoryTransaction {
  const adapter: MemberDirectoryTransaction = Object.freeze({
    async get(reference) {
      return writerSnapshot(await transaction.get(firestore.doc(reference.path)));
    },
    create(reference, data) {
      transaction.create(firestore.doc(reference.path), mutable(data));
      return adapter;
    },
    set(reference, data) {
      transaction.set(firestore.doc(reference.path), mutable(data));
      return adapter;
    },
  });
  return adapter;
}

async function scanNative(
  firestore: Firestore,
  transaction: Transaction,
  academyId: string,
  limit: number,
): Promise<readonly CanonicalMemberImportExistingStudent[]> {
  requiredIdentifier(academyId, "academy ID");
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_EXISTING_STUDENTS + 1)
    throw new Error("Invalid canonical student scan limit");
  const studentsSnapshot = await transaction.get(
    firestore
      .collection(`academies/${academyId}/students`)
      .orderBy(FieldPath.documentId())
      .limit(limit),
  );
  const profilesSnapshot = await transaction.get(
    firestore
      .collection(`academies/${academyId}/studentAdminProfiles`)
      .orderBy(FieldPath.documentId())
      .limit(limit),
  );
  if (studentsSnapshot.docs.length > MAX_EXISTING_STUDENTS) {
    throw new Error("Existing student scan limit exceeded");
  }
  if (profilesSnapshot.docs.length > MAX_EXISTING_STUDENTS) {
    throw new Error("Existing admin profile scan limit exceeded");
  }
  const studentIds = new Set(studentsSnapshot.docs.map((document) => document.id));
  if (profilesSnapshot.docs.some((document) => !studentIds.has(document.id))) {
    throw new Error("Orphan student administrative profile");
  }
  const profiles = new Map(profilesSnapshot.docs.map((document) => [document.id, document]));
  return Object.freeze(
    studentsSnapshot.docs.map((document) => {
      const profile = profiles.get(document.id);
      return Object.freeze({
        studentId: document.id,
        student: copyData(document.data()) ?? {},
        ...(profile === undefined
          ? {}
          : { profileId: profile.id, adminProfile: copyData(profile.data()) ?? {} }),
      });
    }),
  );
}

type RowIdentityCandidate = Readonly<{
  keyId: string;
  kind: StudentIdentityKeyKind;
}>;

function identityCandidates(
  academyId: string,
  row: ParsedMemberRow,
  secretMaterial: string,
): readonly RowIdentityCandidate[] {
  const inputs: readonly Readonly<{ kind: StudentIdentityKeyKind; value: string }>[] = [
    ...(row.membershipNumber === undefined
      ? []
      : [{ kind: "membership-number" as const, value: row.membershipNumber }]),
    ...(row.idCardNumber === undefined
      ? []
      : [{ kind: "id-card-number" as const, value: row.idCardNumber }]),
    ...(row.vatNumber === undefined ? [] : [{ kind: "vat-number" as const, value: row.vatNumber }]),
  ];
  return Object.freeze(
    inputs.map(({ kind, value }) => ({
      kind,
      keyId: deriveStudentIdentityKeyId({ academyId, kind, value, secretMaterial }),
    })),
  );
}

function normalizedText(value: string): string {
  return value.normalize("NFKC").trim().toLocaleLowerCase("en-US");
}

function samePreferences(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === right.length &&
    [...left].sort().every((value, index) => value === [...right].sort()[index])
  );
}

function reviewCandidate(
  existing: CanonicalMemberImportExistingStudent | undefined,
  row: ParsedMemberRow,
  input: BuildCanonicalMemberImportManifestInput,
): CanonicalMemberImportReviewCandidate["candidate"] | undefined {
  if (existing === undefined || existing.profileId !== existing.studentId) return undefined;
  const student = parseStudentProfileAt(existing.student, input.operationWriteTime.slice(0, 10));
  const profile = studentAdminProfileSchema.safeParse(existing.adminProfile);
  if (
    !student.ok ||
    !profile.success ||
    student.value.studentId !== existing.studentId ||
    student.value.academyId !== input.actor.academyId ||
    profile.data.studentId !== existing.studentId ||
    profile.data.academyId !== input.actor.academyId ||
    normalizedText(student.value.fullName) !== normalizedText(row.fullName) ||
    student.value.dateOfBirth !== row.birthDate ||
    student.value.trainingCenter !== input.trainingCenter ||
    !samePreferences(student.value.trainingTimePreferences, input.trainingTimePreferences) ||
    (row.email !== undefined &&
      (student.value.email === undefined ||
        normalizedText(student.value.email) !== normalizedText(row.email))) ||
    (row.mobileNumber !== undefined && student.value.phoneNumber !== row.mobileNumber) ||
    !(
      [
        [row.membershipNumber, profile.data.membershipNumber],
        [row.idCardNumber, profile.data.idCardNumber],
        [row.vatNumber, profile.data.vatNumber],
      ] as const
    ).every(
      ([source, current]) =>
        source === undefined ||
        (current !== undefined &&
          normalizeAdministrativeIdentifier(source) === normalizeAdministrativeIdentifier(current)),
    )
  ) {
    return undefined;
  }
  const membershipReference = maskMembershipReference(profile.data.membershipNumber);
  return Object.freeze({
    studentId: existing.studentId,
    fullName: student.value.fullName,
    trainingCenter: student.value.trainingCenter,
    ...(membershipReference === undefined ? {} : { membershipReference }),
  });
}

export function createCanonicalMemberImportFirestoreAdapter(
  firestore: Firestore = getFirestore(),
  options: AdapterOptions,
): CanonicalMemberImportFirestoreAdapter {
  requiredIdentifier(options.identitySecretVersion, "identity secret version");
  const nativeByAdapter = new WeakMap<MemberDirectoryTransaction, Transaction>();
  const writer: MemberDirectoryFirestore = Object.freeze({
    doc(path) {
      const reference = firestore.doc(path);
      return Object.freeze({ id: reference.id, path: reference.path });
    },
    runTransaction<T>(callback: (transaction: MemberDirectoryTransaction) => Promise<T>) {
      return firestore.runTransaction(async (native) => {
        const adapter = nativeWriterTransaction(firestore, native);
        nativeByAdapter.set(adapter, native);
        return callback(adapter);
      });
    },
  });
  const scanExistingStudents = async (
    transaction: MemberDirectoryTransaction,
    academyId: string,
    limit: number,
  ) => {
    const native = nativeByAdapter.get(transaction);
    if (native === undefined) throw new Error("Canonical scan must use the adapter transaction");
    return scanNative(firestore, native, academyId, limit);
  };

  return Object.freeze({
    firestore: writer,
    scanExistingStudents,
    sessions: createSessionStore(firestore, options.integritySecretMaterial),
    async buildPrivateManifest(input) {
      if (input.rows.length === 0 || input.rows.length > MAX_CANONICAL_MEMBER_IMPORT_ROWS)
        throw new Error("Canonical member import row limit exceeded");
      const reviewsByRow = new Map<number, CanonicalMemberImportInternalReview>();
      for (const review of input.reviews ?? []) {
        if (
          !Number.isSafeInteger(review.rowIndex) ||
          review.rowIndex < 0 ||
          review.rowIndex >= input.rows.length ||
          (review.decision !== "accept" && review.decision !== "reject") ||
          !safeIdentifierPattern.test(review.existingStudentId) ||
          reviewsByRow.has(review.rowIndex)
        ) {
          throw new Error("Canonical member import review is invalid");
        }
        reviewsByRow.set(review.rowIndex, review);
      }
      const built = await writer.runTransaction(async (transaction) => {
        const existing = await scanExistingStudents(
          transaction,
          input.actor.academyId,
          MAX_EXISTING_STUDENTS + 1,
        );
        if (existing.length > MAX_EXISTING_STUDENTS)
          throw new Error("Existing student scan limit exceeded");
        const globalCrossTenant = existing.some((value) => {
          const student = value.student as { academyId?: unknown };
          const profile = value.adminProfile as { academyId?: unknown } | undefined;
          return (
            student.academyId !== input.actor.academyId ||
            (profile !== undefined && profile.academyId !== input.actor.academyId)
          );
        });
        const candidatesByRow = input.rows.map((row) => {
          try {
            return identityCandidates(input.actor.academyId, row, options.identitySecretMaterial);
          } catch {
            return undefined;
          }
        });
        const keyRows = new Map<string, number[]>();
        candidatesByRow.forEach((candidates, index) =>
          candidates?.forEach(({ keyId }) => {
            const values = keyRows.get(keyId) ?? [];
            values.push(index);
            keyRows.set(keyId, values);
          }),
        );
        const duplicateIdentityRows = new Set(
          [...keyRows.values()].filter((values) => values.length > 1).flat(),
        );
        const membershipRows = new Map<string, number[]>();
        input.rows.forEach((row, index) => {
          if (row.membershipNumber === undefined) return;
          const normalized = normalizeAdministrativeIdentifier(row.membershipNumber);
          const values = membershipRows.get(normalized) ?? [];
          values.push(index);
          membershipRows.set(normalized, values);
        });
        const duplicateMembershipRows = new Set(
          [...membershipRows.values()].filter((values) => values.length > 1).flat(),
        );
        const storedByKey = new Map<string, unknown>();
        for (const keyId of keyRows.keys()) {
          const snapshot = await transaction.get(
            writer.doc(`academies/${input.actor.academyId}/studentIdentityKeys/${keyId}`),
          );
          if (snapshot.exists) storedByKey.set(keyId, snapshot.data());
        }
        const ownerRows = new Map<string, number[]>();
        const rowOwners = candidatesByRow.map((candidates, index) => {
          const owners = new Set<string>();
          let invalid = candidates === undefined;
          let crossTenant = false;
          for (const candidate of candidates ?? []) {
            const stored = storedByKey.get(candidate.keyId);
            if (stored === undefined) continue;
            const parsed = studentIdentityKeySchema.safeParse(stored);
            if (
              !parsed.success ||
              parsed.data.keyId !== candidate.keyId ||
              parsed.data.kind !== candidate.kind ||
              parsed.data.secretVersion !== options.identitySecretVersion
            ) {
              invalid = true;
              continue;
            }
            if (parsed.data.academyId !== input.actor.academyId) {
              crossTenant = true;
              continue;
            }
            owners.add(parsed.data.ownerStudentId);
          }
          owners.forEach((owner) => {
            const values = ownerRows.get(owner) ?? [];
            values.push(index);
            ownerRows.set(owner, values);
          });
          return { owners, invalid, crossTenant };
        });
        const duplicateOwnerRows = new Set(
          [...ownerRows.values()].filter((values) => values.length > 1).flat(),
        );
        const existingById = new Map(existing.map((value) => [value.studentId, value]));
        const reviewCandidates: CanonicalMemberImportReviewCandidate[] = [];
        const entries = input.rows.map((row, index) => {
          const base = {
            sourceReport: row.sourceReport,
            sourceRowNumber: row.sourceRowNumber,
            targetAcademyId: input.actor.academyId,
            trainingCenter: input.trainingCenter,
            trainingTimePreferences: [...input.trainingTimePreferences],
          };
          const identity = rowOwners[index] ?? {
            owners: new Set<string>(),
            invalid: true,
            crossTenant: false,
          };
          let participantType: "adult" | "minor" | undefined;
          try {
            if (row.birthDate !== undefined)
              participantType = deriveParticipantType(
                row.birthDate,
                input.operationWriteTime.slice(0, 10),
              );
          } catch {
            participantType = undefined;
          }
          if (globalCrossTenant || identity.crossTenant)
            return { ...base, classification: "cross-tenant" as const };
          if (duplicateMembershipRows.has(index))
            return { ...base, classification: "duplicate-membership-number" as const };
          if (row.birthDate === undefined)
            return { ...base, classification: "missing-required-fields" as const };
          if (participantType === undefined)
            return { ...base, classification: "invalid-record" as const };
          if (
            identity.invalid ||
            duplicateIdentityRows.has(index) ||
            duplicateOwnerRows.has(index) ||
            identity.owners.size > 1
          )
            return { ...base, classification: "identity-conflict" as const };
          const owner = [...identity.owners][0];
          if (owner !== undefined) {
            const candidate = reviewCandidate(existingById.get(owner), row, input);
            const everyCandidateReserved =
              candidatesByRow[index]?.every((value) => {
                const parsed = studentIdentityKeySchema.safeParse(storedByKey.get(value.keyId));
                return parsed.success && parsed.data.ownerStudentId === owner;
              }) === true;
            if (candidate !== undefined && everyCandidateReserved) {
              reviewCandidates.push(
                Object.freeze({ rowIndex: index, sourceName: row.fullName, candidate }),
              );
              const review = reviewsByRow.get(index);
              if (review !== undefined) {
                if (review.existingStudentId !== owner)
                  throw new Error("Canonical member import candidate changed");
                if (review.decision === "accept") {
                  return {
                    ...base,
                    classification: "explicit-existing-student-match" as const,
                    existingStudentId: owner,
                    adminProfileDisposition: "existing-compatible" as const,
                    reviewedReason: "Explicit administrative review accepted",
                  };
                }
              }
            }
            return { ...base, classification: "identity-conflict" as const };
          }
          return {
            ...base,
            classification:
              participantType === "minor"
                ? ("minor-requires-family-match" as const)
                : ("createable-adult" as const),
          };
        });
        if (
          [...reviewsByRow.keys()].some(
            (index) => !reviewCandidates.some((item) => item.rowIndex === index),
          )
        )
          throw new Error("Canonical member import candidate changed");
        return { entries, reviewCandidates };
      });
      return Object.freeze({
        manifest: Object.freeze({
          operationId: input.operationId,
          academyId: input.actor.academyId,
          operationWriteTime: input.operationWriteTime,
          expiresAt: input.expiresAt,
          rows: Object.freeze(built.entries),
          schemaVersion: "1",
        }),
        reviewCandidates: Object.freeze(built.reviewCandidates),
      });
    },
  });
}
