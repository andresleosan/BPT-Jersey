import { createHash } from "node:crypto";
import { createRequire } from "node:module";

import { getApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { defineSecret } from "firebase-functions/params";
import { HttpsError, onCall, type CallableRequest } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { trainingCenters, trainingTimePreferences } from "@bpt-jersey/domain/profiles";
import { z } from "zod";

import { requireAdminActor } from "../auth/admin-authorization.js";
import {
  createR2ClientFromEnvironment,
  validatePdfUpload,
  type PdfUploadMetadata,
  type R2Client,
} from "../storage/r2-client.js";
import {
  createCanonicalMemberImportFirestoreAdapter,
  createCanonicalMemberImportSessionMac,
  type BuildCanonicalMemberImportManifestInput,
  type BuildCanonicalMemberImportManifestResult,
  type CanonicalMemberImportInternalReview,
  type CanonicalMemberImportPrivateSession,
  type CanonicalMemberImportSessionStore,
  type CanonicalMemberImportUploadingSession,
} from "./canonical-member-import-firestore.js";
import {
  CanonicalMemberImportError,
  createCanonicalMemberImportService,
  type CanonicalMemberImportPreview,
  type CanonicalMemberImportService,
} from "./canonical-member-import-service.js";
import { matchesProvisionedMemberDirectoryActor } from "./member-directory-actor-authorization.js";
import {
  canonicalizeMemberDirectoryValue,
  createMemberDirectoryIntegrityMac,
} from "./member-directory-crypto.js";
import { assertMemberDirectoryOperationEnvironment } from "./member-directory-environment.js";
import { formatMemberPdfTextItems } from "./member-pdf-text.js";
import {
  MemberPdfImportLimitError,
  parseMemberReport,
  type ParsedMemberRow,
} from "./member-pdf-import.js";

const identityKeySecret = defineSecret("MEMBER_DIRECTORY_IDENTITY_KEY_SECRET");
const migrationIntegritySecret = defineSecret("MEMBER_DIRECTORY_MIGRATION_INTEGRITY_SECRET");
const r2AccessKeyIdSecret = defineSecret("R2_ACCESS_KEY_ID");
const r2SecretAccessKeySecret = defineSecret("R2_SECRET_ACCESS_KEY");
const identitySecretVersion = "identity-v1";
const integritySecretVersion = "integrity-v1";
const sessionDurationMs = 10 * 60 * 1000;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const sessionIdPattern = /^import-session-[a-f0-9]{64}$/u;
const macPattern = /^[a-f0-9]{64}$/u;

const fileSchema = z.strictObject({
  fileName: z.string().min(1).max(512),
  contentType: z.literal("application/pdf"),
  sizeBytes: z
    .number()
    .int()
    .positive()
    .max(10 * 1024 * 1024)
    .safe(),
});
const createRequestSchema = z.strictObject({
  operationId: z.string().regex(uuidPattern),
  trainingCenter: z.enum(trainingCenters),
  trainingTimePreferences: z
    .array(z.enum(trainingTimePreferences))
    .min(1)
    .max(trainingTimePreferences.length)
    .refine((values) => new Set(values).size === values.length)
    .readonly(),
  files: z.array(fileSchema).min(1).max(5).readonly(),
});
const previewRequestSchema = z.strictObject({
  sessionId: z.string().regex(sessionIdPattern),
  operationId: z.string().regex(uuidPattern),
});
const confirmRequestSchema = z.strictObject({
  sessionId: z.string().regex(sessionIdPattern),
  operationId: z.string().regex(uuidPattern),
  receipt: z.unknown(),
});
const reviewRequestSchema = z.strictObject({
  sessionId: z.string().regex(sessionIdPattern),
  operationId: z.string().regex(uuidPattern),
  decisions: z
    .array(
      z.strictObject({
        rowMac: z.string().regex(macPattern),
        decision: z.enum(["accept", "reject"]),
      }),
    )
    .min(1)
    .max(50)
    .refine((values) => new Set(values.map((value) => value.rowMac)).size === values.length)
    .readonly(),
});

type CanonicalMemberImportActorStatusInput = Readonly<{
  uid: string;
  academyId: string;
  role: "owner" | "administrator";
}>;

type ActivityAuthUser = Readonly<{
  uid: string;
  disabled: boolean;
  customClaims?: Readonly<Record<string, unknown>>;
}>;

type ActivityDocument = Readonly<{
  exists: boolean;
  data: () => unknown;
}>;

export type CanonicalMemberImportActorActivityDependencies = Readonly<{
  getAuthUser: (uid: string) => Promise<ActivityAuthUser>;
  getDocument: (path: string) => Promise<ActivityDocument>;
}>;

export type CanonicalMemberImportSourceReadResult = Readonly<{
  rows: readonly ParsedMemberRow[];
  sourceUploadMac: string;
}>;

export type CanonicalMemberImportSourceReader = Readonly<{
  read: (
    session: CanonicalMemberImportPrivateSession,
  ) => Promise<CanonicalMemberImportSourceReadResult>;
}>;

export type CanonicalMemberImportCallableServices = Readonly<{
  sessions: CanonicalMemberImportSessionStore;
  core: CanonicalMemberImportService;
  r2: R2Client;
  sources: CanonicalMemberImportSourceReader;
  buildPrivateManifest: (
    input: BuildCanonicalMemberImportManifestInput,
  ) => Promise<BuildCanonicalMemberImportManifestResult>;
  isActorActive: (input: CanonicalMemberImportActorStatusInput) => Promise<boolean>;
  sessionIdFor: (
    input: Readonly<{ academyId: string; actorId: string; operationId: string }>,
  ) => string;
  uploadManifestMacFor: (
    input: Readonly<{
      academyId: string;
      actorId: string;
      operationId: string;
      files: readonly PdfUploadMetadata[];
    }>,
  ) => string;
  sessionMacFor: (
    input: Omit<CanonicalMemberImportUploadingSession, "sessionMac" | "status" | "updatedAt">,
  ) => string;
  projectId: string;
  targetProjectClassification: string;
  now: () => string;
}>;

export class CanonicalMemberImportSourceError extends Error {
  public readonly code: "invalid" | "limit" | "unavailable";

  public constructor(code: "invalid" | "limit" | "unavailable") {
    super("Canonical member import source is unavailable");
    this.name = "CanonicalMemberImportSourceError";
    this.code = code;
  }
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function serverTimestamp(): string {
  return new Date().toISOString();
}

function parseRequest<T>(value: unknown, schema: z.ZodType<T>): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new HttpsError("invalid-argument", "Invalid member import request");
  return parsed.data;
}

export function createCanonicalMemberImportActorActivityCheck(
  dependencies: CanonicalMemberImportActorActivityDependencies,
): CanonicalMemberImportCallableServices["isActorActive"] {
  return async ({ uid, academyId, role }) => {
    try {
      const [authUser, actorDocument, roleLock] = await Promise.all([
        dependencies.getAuthUser(uid),
        dependencies.getDocument(`academies/${academyId}/users/${uid}`),
        dependencies.getDocument(`academies/${academyId}/adminRoleLocks/${uid}`),
      ]);
      const claims = authUser.customClaims;
      return (
        authUser.uid === uid &&
        !authUser.disabled &&
        actorDocument.exists &&
        !roleLock.exists &&
        roleLock.data() === undefined &&
        matchesProvisionedMemberDirectoryActor(actorDocument.data(), {
          actorId: uid,
          academyId,
          role,
        }) &&
        isRecord(claims) &&
        claims.academyId === academyId &&
        claims.role === role
      );
    } catch {
      return false;
    }
  };
}

async function canonicalActor(
  request: CallableRequest<unknown>,
  services: CanonicalMemberImportCallableServices,
) {
  const actor = requireAdminActor(request);
  if (request.app === undefined)
    throw new HttpsError("unauthenticated", "Verified App Check is required");
  if (actor.role !== "owner" && actor.role !== "administrator")
    throw new HttpsError("permission-denied", "Owner or administrator access is required");
  const active = await services.isActorActive({
    uid: actor.uid,
    academyId: actor.academyId,
    role: actor.role,
  });
  if (!active)
    throw new HttpsError("permission-denied", "An active administrative account is required");
  return Object.freeze({
    actorId: actor.uid,
    academyId: actor.academyId,
    role: actor.role,
    active: true as const,
    appCheckVerified: true as const,
  });
}

function assertSessionBinding(
  session: CanonicalMemberImportPrivateSession,
  actor: Readonly<{ actorId: string; academyId: string; role: "owner" | "administrator" }>,
  operationId: string,
  services: CanonicalMemberImportCallableServices,
  now: string,
): void {
  if (
    session.actorId !== actor.actorId ||
    session.academyId !== actor.academyId ||
    session.actorRole !== actor.role
  )
    throw new HttpsError("permission-denied", "Member import session access is denied");
  if (
    session.operationId !== operationId ||
    session.projectId !== services.projectId ||
    session.targetProjectClassification !== services.targetProjectClassification ||
    Date.parse(now) > Date.parse(session.expiresAt)
  )
    throw new HttpsError("failed-precondition", "Member import session is unavailable");
}

function sameMetadata(left: unknown, right: unknown): boolean {
  try {
    return canonicalizeMemberDirectoryValue(left) === canonicalizeMemberDirectoryValue(right);
  } catch {
    return false;
  }
}

function attachReviewMatches(
  preview: CanonicalMemberImportPreview,
  built: BuildCanonicalMemberImportManifestResult,
  decisions: ReadonlyMap<string, "accept" | "reject"> = new Map(),
): CanonicalMemberImportPreview {
  const reviewMatches = built.reviewCandidates.map((review) => {
    const classification = preview.classifications[review.rowIndex];
    if (classification === undefined)
      throw new HttpsError("failed-precondition", "Member import review is unavailable");
    const decision = decisions.get(classification.rowMac);
    const classificationMatchesDecision =
      decision === "accept"
        ? classification.classification === "same-id-compatible" ||
          classification.classification === "explicit-existing-student-match"
        : classification.classification === "identity-conflict";
    if (!classificationMatchesDecision)
      throw new HttpsError("failed-precondition", "Member import candidate changed");
    return Object.freeze({
      rowMac: classification.rowMac,
      sourceName: review.sourceName,
      candidate: review.candidate,
      decision:
        decision === "accept"
          ? ("accepted" as const)
          : decision === "reject"
            ? ("rejected" as const)
            : ("pending" as const),
    });
  });
  return Object.freeze({ ...preview, reviewMatches: Object.freeze(reviewMatches) });
}

function sameReviewCandidates(
  left: CanonicalMemberImportPreview["reviewMatches"],
  right: CanonicalMemberImportPreview["reviewMatches"],
): boolean {
  const withoutDecision = (values: CanonicalMemberImportPreview["reviewMatches"]) =>
    values.map((value) => {
      const rest = { ...value };
      delete (rest as { decision?: unknown }).decision;
      return rest;
    });
  return sameMetadata(withoutDecision(left), withoutDecision(right));
}

function internalReviews(
  preview: CanonicalMemberImportPreview,
  built: BuildCanonicalMemberImportManifestResult,
  decisions: ReadonlyMap<string, "accept" | "reject">,
): readonly CanonicalMemberImportInternalReview[] {
  return Object.freeze(
    built.reviewCandidates.map((candidate) => {
      const classification = preview.classifications[candidate.rowIndex];
      const decision =
        classification === undefined ? undefined : decisions.get(classification.rowMac);
      if (classification === undefined || decision === undefined)
        throw new HttpsError("invalid-argument", "Member import review is incomplete");
      return Object.freeze({
        rowIndex: candidate.rowIndex,
        decision,
        existingStudentId: candidate.candidate.studentId,
      });
    }),
  );
}

function mapError(error: unknown): never {
  if (error instanceof HttpsError) throw error;
  if (error instanceof CanonicalMemberImportSourceError) {
    if (error.code === "invalid")
      throw new HttpsError("invalid-argument", "Uploaded member report is invalid");
    if (error.code === "limit")
      throw new HttpsError("resource-exhausted", "Member import is too large");
    throw new HttpsError("failed-precondition", "Member import source is unavailable");
  }
  if (error instanceof CanonicalMemberImportError) {
    switch (error.code) {
      case "unauthorized":
        throw new HttpsError("permission-denied", "Member import is not permitted");
      case "invalid":
        throw new HttpsError("invalid-argument", "Invalid member import request");
      case "unavailable":
        throw new HttpsError("failed-precondition", "Member directory is unavailable");
      case "conflict":
        throw new HttpsError("failed-precondition", "Member import contains conflicts");
      case "capacity":
        throw new HttpsError("resource-exhausted", "Member directory capacity is unavailable");
      case "limit":
        throw new HttpsError("resource-exhausted", "Member import is too large");
      case "replay":
        throw new HttpsError("failed-precondition", "Member import replay was rejected");
    }
  }
  throw new HttpsError("failed-precondition", "Member import operation is unavailable");
}

export async function createCanonicalMemberImportSessionHandler(
  request: CallableRequest<unknown>,
  services: CanonicalMemberImportCallableServices,
) {
  const input = parseRequest(request.data, createRequestSchema);
  const actor = await canonicalActor(request, services);
  const operationWriteTime = services.now();
  const expiresAt = new Date(Date.parse(operationWriteTime) + sessionDurationMs).toISOString();
  const files = input.files.map((file) => {
    try {
      return validatePdfUpload(file);
    } catch {
      throw new HttpsError("invalid-argument", "Invalid member import request");
    }
  });
  const sessionId = services.sessionIdFor({
    academyId: actor.academyId,
    actorId: actor.actorId,
    operationId: input.operationId,
  });
  if (!sessionIdPattern.test(sessionId))
    throw new HttpsError("failed-precondition", "Member import session is unavailable");
  const uploadManifestMac = services.uploadManifestMacFor({
    academyId: actor.academyId,
    actorId: actor.actorId,
    operationId: input.operationId,
    files,
  });
  if (!macPattern.test(uploadManifestMac))
    throw new HttpsError("failed-precondition", "Member import session is unavailable");
  const uploads = Object.freeze(
    files.map((file, index) =>
      Object.freeze({
        objectKey: `academies/${actor.academyId}/member-imports/${sessionId}/${index}.pdf`,
        sizeBytes: file.sizeBytes,
      }),
    ),
  );
  const immutableSession = Object.freeze({
    sessionId,
    operationId: input.operationId,
    academyId: actor.academyId,
    actorId: actor.actorId,
    actorRole: actor.role,
    projectId: services.projectId,
    targetProjectClassification: services.targetProjectClassification,
    uploadManifestMac,
    uploads,
    trainingCenter: input.trainingCenter,
    trainingTimePreferences: input.trainingTimePreferences,
    operationWriteTime,
    expiresAt,
    createdAt: operationWriteTime,
    schemaVersion: "1",
  });
  const candidate: CanonicalMemberImportUploadingSession = Object.freeze({
    ...immutableSession,
    sessionMac: services.sessionMacFor(immutableSession),
    updatedAt: operationWriteTime,
    status: "uploading",
  });
  try {
    const session = await services.sessions.createOrGet(candidate, operationWriteTime);
    const remainingSeconds = Math.floor(
      (Date.parse(session.expiresAt) - Date.parse(operationWriteTime)) / 1_000,
    );
    if (remainingSeconds < 60)
      throw new HttpsError("failed-precondition", "Member import session is unavailable");
    const signedUploads = await Promise.all(
      session.uploads.map(async (upload, index) => {
        const file = files[index];
        if (file === undefined || file.sizeBytes !== upload.sizeBytes)
          throw new HttpsError("failed-precondition", "Member import session is unavailable");
        return Object.freeze({
          uploadUrl: await services.r2.createPdfUploadUrl({
            ...file,
            objectKey: upload.objectKey,
            expiresInSeconds: Math.min(600, remainingSeconds),
          }),
        });
      }),
    );
    return Object.freeze({
      sessionId: session.sessionId,
      operationId: session.operationId,
      uploads: Object.freeze(signedUploads),
      expiresAt: session.expiresAt,
    });
  } catch (error) {
    return mapError(error);
  }
}

export async function previewCanonicalMemberImportHandler(
  request: CallableRequest<unknown>,
  services: CanonicalMemberImportCallableServices,
): Promise<CanonicalMemberImportPreview> {
  const input = parseRequest(request.data, previewRequestSchema);
  const actor = await canonicalActor(request, services);
  const now = services.now();
  try {
    const session = await services.sessions.read(actor.academyId, input.sessionId);
    if (session === undefined)
      throw new HttpsError("failed-precondition", "Member import session is unavailable");
    assertSessionBinding(session, actor, input.operationId, services, now);
    if (session.status === "previewed") return session.preview;
    if (session.status !== "uploading")
      throw new HttpsError("failed-precondition", "Member import session is closed");
    const source = await services.sources.read(session);
    const built = await services.buildPrivateManifest({
      actor,
      operationId: session.operationId,
      rows: source.rows,
      operationWriteTime: session.operationWriteTime,
      expiresAt: session.expiresAt,
      trainingCenter: session.trainingCenter,
      trainingTimePreferences: session.trainingTimePreferences,
    });
    const preview = await services.core.dryRun({
      actor,
      operationId: session.operationId,
      rows: source.rows,
      manifest: built.manifest,
      now,
    });
    const publicPreview = attachReviewMatches(preview, built);
    const persisted = await services.sessions.persistPreview({
      academyId: actor.academyId,
      sessionId: session.sessionId,
      operationId: session.operationId,
      sourceUploadMac: source.sourceUploadMac,
      privateManifest: built.manifest,
      preview: publicPreview,
      now,
    });
    return persisted.preview;
  } catch (error) {
    return mapError(error);
  }
}

export async function reviewCanonicalMemberImportMatchesHandler(
  request: CallableRequest<unknown>,
  services: CanonicalMemberImportCallableServices,
): Promise<CanonicalMemberImportPreview> {
  const input = parseRequest(request.data, reviewRequestSchema);
  const actor = await canonicalActor(request, services);
  const now = services.now();
  try {
    const session = await services.sessions.read(actor.academyId, input.sessionId);
    if (session === undefined || session.status !== "previewed")
      throw new HttpsError("failed-precondition", "Member import preview is required");
    assertSessionBinding(session, actor, input.operationId, services, now);
    if (session.preview.reviewMatches.length === 0)
      throw new HttpsError("failed-precondition", "Member import has no reviewable matches");
    const source = await services.sources.read(session);
    if (source.sourceUploadMac !== session.sourceUploadMac)
      throw new HttpsError("failed-precondition", "Member import source changed after preview");
    const baseInput = {
      actor,
      operationId: session.operationId,
      rows: source.rows,
      operationWriteTime: session.operationWriteTime,
      expiresAt: session.expiresAt,
      trainingCenter: session.trainingCenter,
      trainingTimePreferences: session.trainingTimePreferences,
    } as const;
    const initialBuilt = await services.buildPrivateManifest(baseInput);
    const initialCore = await services.core.dryRun({
      actor,
      operationId: session.operationId,
      rows: source.rows,
      manifest: initialBuilt.manifest,
      now,
    });
    const currentPending = attachReviewMatches(initialCore, initialBuilt);
    if (!sameReviewCandidates(session.preview.reviewMatches, currentPending.reviewMatches))
      throw new HttpsError("failed-precondition", "Member import candidate changed");
    const decisionMap = new Map(input.decisions.map((value) => [value.rowMac, value.decision]));
    if (
      decisionMap.size !== currentPending.reviewMatches.length ||
      currentPending.reviewMatches.some((match) => !decisionMap.has(match.rowMac))
    )
      throw new HttpsError("invalid-argument", "Member import review is incomplete");
    if (session.preview.reviewMatches.every((match) => match.decision !== "pending")) {
      const exact = session.preview.reviewMatches.every(
        (match) =>
          decisionMap.get(match.rowMac) === (match.decision === "accepted" ? "accept" : "reject"),
      );
      if (!exact)
        throw new HttpsError("failed-precondition", "Member import review replay was rejected");
      return session.preview;
    }
    const reviews = internalReviews(currentPending, initialBuilt, decisionMap);
    const reviewedBuilt = await services.buildPrivateManifest({ ...baseInput, reviews });
    const reviewedCore = await services.core.dryRun({
      actor,
      operationId: session.operationId,
      rows: source.rows,
      manifest: reviewedBuilt.manifest,
      now,
    });
    const reviewedPreview = attachReviewMatches(reviewedCore, initialBuilt, decisionMap);
    const persisted = await services.sessions.persistReview({
      academyId: actor.academyId,
      sessionId: session.sessionId,
      operationId: session.operationId,
      sourceUploadMac: source.sourceUploadMac,
      previousPreview: session.preview,
      privateManifest: reviewedBuilt.manifest,
      preview: reviewedPreview,
      now,
    });
    return persisted.preview;
  } catch (error) {
    return mapError(error);
  }
}

export async function confirmCanonicalMemberImportHandler(
  request: CallableRequest<unknown>,
  services: CanonicalMemberImportCallableServices,
) {
  const input = parseRequest(request.data, confirmRequestSchema);
  const actor = await canonicalActor(request, services);
  const now = services.now();
  try {
    const session = await services.sessions.read(actor.academyId, input.sessionId);
    if (session === undefined)
      throw new HttpsError("failed-precondition", "Member import session is unavailable");
    assertSessionBinding(session, actor, input.operationId, services, now);
    if (session.status === "uploading")
      throw new HttpsError("failed-precondition", "Member import preview is required");
    if (!session.preview.confirmable || !sameMetadata(input.receipt, session.preview.receipt))
      throw new HttpsError("failed-precondition", "Member import receipt is invalid");
    const source = await services.sources.read(session);
    if (source.sourceUploadMac !== session.sourceUploadMac)
      throw new HttpsError("failed-precondition", "Member import source changed after preview");
    const initialBuilt = await services.buildPrivateManifest({
      actor,
      operationId: session.operationId,
      rows: source.rows,
      operationWriteTime: session.operationWriteTime,
      expiresAt: session.expiresAt,
      trainingCenter: session.trainingCenter,
      trainingTimePreferences: session.trainingTimePreferences,
    });
    const initialPreview = attachReviewMatches(
      await services.core.dryRun({
        actor,
        operationId: session.operationId,
        rows: source.rows,
        manifest: initialBuilt.manifest,
        now,
      }),
      initialBuilt,
    );
    if (!sameReviewCandidates(session.preview.reviewMatches, initialPreview.reviewMatches))
      throw new HttpsError("failed-precondition", "Member import candidate changed");
    const storedDecisions = new Map(
      session.preview.reviewMatches.map((match) => [
        match.rowMac,
        match.decision === "accepted"
          ? ("accept" as const)
          : match.decision === "rejected"
            ? ("reject" as const)
            : undefined,
      ]),
    );
    if ([...storedDecisions.values()].some((decision) => decision === undefined))
      throw new HttpsError("failed-precondition", "Member import review is incomplete");
    const reviews = internalReviews(
      initialPreview,
      initialBuilt,
      storedDecisions as ReadonlyMap<string, "accept" | "reject">,
    );
    const reviewedBuilt =
      reviews.length === 0
        ? initialBuilt
        : await services.buildPrivateManifest({
            actor,
            operationId: session.operationId,
            rows: source.rows,
            operationWriteTime: session.operationWriteTime,
            expiresAt: session.expiresAt,
            trainingCenter: session.trainingCenter,
            trainingTimePreferences: session.trainingTimePreferences,
            reviews,
          });
    if (!sameMetadata(reviewedBuilt.manifest, session.privateManifest))
      throw new HttpsError("failed-precondition", "Member import manifest changed after review");
    const result = await services.core.confirm({
      actor,
      operationId: session.operationId,
      rows: source.rows,
      manifest: reviewedBuilt.manifest,
      receipt: input.receipt,
      now,
    });
    const persisted = await services.sessions.persistResult({
      academyId: actor.academyId,
      sessionId: session.sessionId,
      operationId: session.operationId,
      sourceUploadMac: source.sourceUploadMac,
      preview: session.preview,
      result,
      now,
    });
    return persisted.result;
  } catch (error) {
    return mapError(error);
  }
}

type PdfParseResult = Readonly<{ text: string }>;
type PdfTextPage = Readonly<{
  getTextContent: (
    options: Readonly<{ normalizeWhitespace: boolean; disableCombineTextItems: boolean }>,
  ) => Promise<{ items: readonly Readonly<{ str: string; transform: readonly number[] }>[] }>;
}>;
type PdfParseOptions = Readonly<{ pagerender?: (page: PdfTextPage) => Promise<string> }>;

async function extractPdfText(bytes: Uint8Array): Promise<string> {
  const loaded = createRequire(import.meta.url)("pdf-parse") as
    | ((input: Uint8Array, options?: PdfParseOptions) => Promise<PdfParseResult>)
    | { default?: (input: Uint8Array, options?: PdfParseOptions) => Promise<PdfParseResult> };
  const parser = typeof loaded === "function" ? loaded : loaded.default;
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

export function createCanonicalMemberImportSourceReader(
  input: Readonly<{
    r2: R2Client;
    pdfTextExtractor?: (bytes: Uint8Array) => Promise<string>;
    integritySecretMaterial: string;
  }>,
): CanonicalMemberImportSourceReader {
  return Object.freeze({
    async read(session) {
      const rows: ParsedMemberRow[] = [];
      const sourceBindings: string[] = [];
      const seenReferences = new Set<string>();
      try {
        for (const [index, upload] of session.uploads.entries()) {
          const bytes = await input.r2.readObject(upload.objectKey);
          if (
            bytes.byteLength !== upload.sizeBytes ||
            bytes[0] !== 37 ||
            bytes[1] !== 80 ||
            bytes[2] !== 68 ||
            bytes[3] !== 70
          )
            throw new CanonicalMemberImportSourceError("invalid");
          const text = await (input.pdfTextExtractor?.(bytes) ?? extractPdfText(bytes));
          const remaining = 50 - rows.length;
          const report = parseMemberReport(text, { maxRows: remaining });
          for (const row of report.rows) {
            const reference = `${row.sourceReport}:${row.sourceRowNumber}`;
            if (seenReferences.has(reference))
              throw new CanonicalMemberImportSourceError("invalid");
            seenReferences.add(reference);
            rows.push(row);
          }
          sourceBindings.push(
            String(index),
            upload.objectKey,
            String(upload.sizeBytes),
            createHash("sha256").update(bytes).digest("hex"),
          );
        }
        if (rows.length === 0 || rows.length > 50)
          throw new CanonicalMemberImportSourceError("limit");
        return Object.freeze({
          rows: Object.freeze(rows),
          sourceUploadMac: createMemberDirectoryIntegrityMac({
            domain: "bpt-canonical-member-import-upload-source-v1",
            values: [session.academyId, session.sessionId, session.operationId, ...sourceBindings],
            secretMaterial: input.integritySecretMaterial,
          }),
        });
      } catch (error) {
        if (error instanceof CanonicalMemberImportSourceError) throw error;
        if (error instanceof MemberPdfImportLimitError)
          throw new CanonicalMemberImportSourceError("limit");
        if (
          error instanceof Error &&
          /invalid|unknown|empty|missing|column|count|row/iu.test(error.message)
        )
          throw new CanonicalMemberImportSourceError("invalid");
        throw new CanonicalMemberImportSourceError("unavailable");
      }
    },
  });
}

function defaultServices(): CanonicalMemberImportCallableServices {
  const app = getApp();
  const explicitProjectId = app.options.projectId;
  if (typeof explicitProjectId !== "string" || explicitProjectId.length === 0)
    throw new HttpsError("failed-precondition", "Firebase project binding is unavailable");
  const binding = assertMemberDirectoryOperationEnvironment({
    target: process.env.MEMBER_DIRECTORY_OPERATION_TARGET ?? "",
    explicitProjectId,
    environment: {
      ...(process.env.GCLOUD_PROJECT === undefined
        ? {}
        : { GCLOUD_PROJECT: process.env.GCLOUD_PROJECT }),
      ...(process.env.GOOGLE_CLOUD_PROJECT === undefined
        ? {}
        : { GOOGLE_CLOUD_PROJECT: process.env.GOOGLE_CLOUD_PROJECT }),
      ...(process.env.FIREBASE_CONFIG === undefined
        ? {}
        : { FIREBASE_CONFIG: process.env.FIREBASE_CONFIG }),
      ...(process.env.FIRESTORE_EMULATOR_HOST === undefined
        ? {}
        : { FIRESTORE_EMULATOR_HOST: process.env.FIRESTORE_EMULATOR_HOST }),
      ...(process.env.FIREBASE_AUTH_EMULATOR_HOST === undefined
        ? {}
        : { FIREBASE_AUTH_EMULATOR_HOST: process.env.FIREBASE_AUTH_EMULATOR_HOST }),
    },
    app: { name: app.name, projectId: explicitProjectId },
  });
  const identityMaterial = identityKeySecret.value();
  const integrityMaterial = migrationIntegritySecret.value();
  const firestore = getFirestore(app);
  const auth = getAuth(app);
  const r2 = createR2ClientFromEnvironment();
  const adapter = createCanonicalMemberImportFirestoreAdapter(firestore, {
    identitySecretMaterial: identityMaterial,
    identitySecretVersion,
    integritySecretMaterial: integrityMaterial,
  });
  return Object.freeze({
    sessions: adapter.sessions,
    core: createCanonicalMemberImportService({
      firestore: adapter.firestore,
      scanExistingStudents: adapter.scanExistingStudents,
      projectId: binding.projectId,
      targetProjectClassification: binding.targetProjectClassification,
      identitySecretMaterial: identityMaterial,
      identitySecretVersion,
      integritySecretMaterial: integrityMaterial,
      integritySecretVersion,
    }),
    r2,
    sources: createCanonicalMemberImportSourceReader({
      r2,
      integritySecretMaterial: integrityMaterial,
    }),
    buildPrivateManifest: adapter.buildPrivateManifest,
    isActorActive: createCanonicalMemberImportActorActivityCheck({
      getAuthUser: (uid) => auth.getUser(uid),
      getDocument: (path) => firestore.doc(path).get(),
    }),
    sessionIdFor: ({ academyId, actorId, operationId }) =>
      `import-session-${createMemberDirectoryIntegrityMac({ domain: "bpt-canonical-member-import-session-id-v1", values: [binding.projectId, academyId, actorId, operationId], secretMaterial: integrityMaterial })}`,
    uploadManifestMacFor: ({ academyId, actorId, operationId, files }) =>
      createMemberDirectoryIntegrityMac({
        domain: "bpt-canonical-member-import-upload-manifest-v1",
        values: [
          binding.projectId,
          academyId,
          actorId,
          operationId,
          canonicalizeMemberDirectoryValue(files),
        ],
        secretMaterial: integrityMaterial,
      }),
    sessionMacFor: (input) => createCanonicalMemberImportSessionMac(input, integrityMaterial),
    projectId: binding.projectId,
    targetProjectClassification: binding.targetProjectClassification,
    now: serverTimestamp,
  });
}

const callableOptions = {
  enforceAppCheck: true,
  secrets: [
    identityKeySecret,
    migrationIntegritySecret,
    r2AccessKeyIdSecret,
    r2SecretAccessKeySecret,
  ],
};

export const createMemberPdfImportSession = onCall(callableOptions, async (request) =>
  createCanonicalMemberImportSessionHandler(request, defaultServices()),
);

export const previewMemberPdfImport = onCall(callableOptions, async (request) =>
  previewCanonicalMemberImportHandler(request, defaultServices()),
);

export const reviewMemberPdfImportMatches = onCall(callableOptions, async (request) =>
  reviewCanonicalMemberImportMatchesHandler(request, defaultServices()),
);

export const confirmMemberPdfImport = onCall(callableOptions, async (request) =>
  confirmCanonicalMemberImportHandler(request, defaultServices()),
);

export async function cleanupExpiredCanonicalMemberImportsHandler(
  services: CanonicalMemberImportCallableServices,
  now = services.now(),
): Promise<Readonly<{ examined: number; deleted: number; failed: number }>> {
  const sessions = await services.sessions.listExpired(now, 50);
  let deleted = 0;
  let failed = 0;
  for (const session of sessions) {
    try {
      for (const upload of session.uploads) {
        await services.r2.deleteObject(upload.objectKey);
      }
      await services.sessions.deleteExpired({
        academyId: session.academyId,
        sessionId: session.sessionId,
        sessionMac: session.sessionMac,
        now,
      });
      deleted += 1;
    } catch {
      failed += 1;
    }
  }
  return Object.freeze({ examined: sessions.length, deleted, failed });
}

export const cleanupExpiredCanonicalMemberImportSessionsSchedule = onSchedule(
  {
    schedule: "every 15 minutes",
    timeZone: "UTC",
    secrets: [
      identityKeySecret,
      migrationIntegritySecret,
      r2AccessKeyIdSecret,
      r2SecretAccessKeySecret,
    ],
  },
  async () => {
    await cleanupExpiredCanonicalMemberImportsHandler(defaultServices());
  },
);
