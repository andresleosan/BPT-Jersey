import { getFirestore } from "firebase-admin/firestore";
import { HttpsError, onCall, type CallableRequest } from "firebase-functions/v2/https";

import {
  parsePrivateDocumentUploadInput,
  type PrivateDocumentUploadInput,
} from "@bpt-jersey/domain/documents";
import { requireUserActor } from "../auth/user-authorization.js";
import { createR2ClientFromEnvironment, type R2Client } from "../storage/r2-client.js";
import {
  createDocumentStore,
  DocumentStoreError,
  type DocumentStore,
} from "./private-document-service.js";

export type DocumentCallableServices = Readonly<{
  store: DocumentStore;
  pilotEnabled?: boolean;
  now?: () => string;
}>;
function invalid(): never {
  throw new HttpsError("invalid-argument", "Private document payload is invalid");
}
function plain(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}
function exact(value: Record<string, unknown>, fields: readonly string[]): boolean {
  const keys = Reflect.ownKeys(value);
  return (
    keys.length === fields.length &&
    keys.every((key) => typeof key === "string" && fields.includes(key))
  );
}
function pilot(services: DocumentCallableServices): void {
  if (services.pilotEnabled !== true)
    throw new HttpsError(
      "failed-precondition",
      "Private documents are disabled outside the synthetic pilot",
    );
}
function admin(request: CallableRequest<unknown>) {
  const actor = requireUserActor(request);
  if (actor.role !== "owner" && actor.role !== "administrator")
    throw new HttpsError("permission-denied", "Private document access is not permitted");
  return actor;
}
function parseUpload(value: unknown): PrivateDocumentUploadInput {
  const parsed = parsePrivateDocumentUploadInput(value);
  if (!parsed.ok) return invalid();
  return parsed.value;
}
function parseStudent(value: unknown): string {
  if (!plain(value) || !exact(value, ["studentId"]) || typeof value.studentId !== "string")
    return invalid();
  return value.studentId;
}
function parseFinalize(
  value: unknown,
): Readonly<{ documentId: string; sha256: string } & PrivateDocumentUploadInput> {
  if (
    !plain(value) ||
    !exact(value, [
      "documentId",
      "sha256",
      "studentId",
      "fileName",
      "contentType",
      "sizeBytes",
      "signedAt",
    ]) ||
    typeof value.documentId !== "string" ||
    typeof value.sha256 !== "string"
  )
    return invalid();
  return Object.freeze({
    documentId: value.documentId,
    sha256: value.sha256,
    ...parseUpload({
      studentId: value.studentId,
      fileName: value.fileName,
      contentType: value.contentType,
      sizeBytes: value.sizeBytes,
      signedAt: value.signedAt,
    }),
  });
}
function parseDocument(value: unknown): string {
  if (!plain(value) || !exact(value, ["documentId"]) || typeof value.documentId !== "string")
    return invalid();
  return value.documentId;
}
function mapError(error: unknown, operation: "read" | "write"): never {
  if (error instanceof HttpsError) throw error;
  if (error instanceof DocumentStoreError) {
    if (error.code === "invalid")
      throw new HttpsError("invalid-argument", "Private document payload is invalid");
    if (error.code === "forbidden" || error.code === "not-found")
      throw new HttpsError("permission-denied", "Private document access is not permitted");
    if (error.code === "conflict" || error.code === "precondition")
      throw new HttpsError("failed-precondition", "Private document operation is not available");
  }
  throw new HttpsError(
    "internal",
    operation === "read" ? "Unable to read private document" : "Unable to update private document",
  );
}
export async function createPrivateWaiverUploadHandler(
  request: CallableRequest<unknown>,
  services: DocumentCallableServices,
) {
  pilot(services);
  const actor = admin(request);
  const payload = parseUpload(request.data);
  try {
    return await services.store.createWaiverUpload({
      academyId: actor.academyId,
      actorId: actor.userId,
      now: services.now?.() ?? new Date().toISOString(),
      ...payload,
    });
  } catch (error) {
    return mapError(error, "write");
  }
}
export async function finalizePrivateWaiverUploadHandler(
  request: CallableRequest<unknown>,
  services: DocumentCallableServices,
) {
  pilot(services);
  const actor = admin(request);
  const payload = parseFinalize(request.data);
  try {
    return await services.store.finalizeWaiverUpload({
      academyId: actor.academyId,
      actorId: actor.userId,
      now: services.now?.() ?? new Date().toISOString(),
      ...payload,
    });
  } catch (error) {
    return mapError(error, "write");
  }
}
export async function getPrivateWaiverDownloadHandler(
  request: CallableRequest<unknown>,
  services: DocumentCallableServices,
) {
  pilot(services);
  const actor = requireUserActor(request);
  if (actor.role !== "owner" && actor.role !== "administrator" && actor.role !== "guardian")
    throw new HttpsError("permission-denied", "Private document access is not permitted");
  const studentId = parseStudent(request.data);
  try {
    return await services.store.getWaiverDownload({
      academyId: actor.academyId,
      actorId: actor.userId,
      role: actor.role,
      studentId,
    });
  } catch (error) {
    return mapError(error, "read");
  }
}
export async function revokePrivateWaiverHandler(
  request: CallableRequest<unknown>,
  services: DocumentCallableServices,
) {
  pilot(services);
  const actor = admin(request);
  const documentId = parseDocument(request.data);
  try {
    return await services.store.revokeWaiver({
      academyId: actor.academyId,
      actorId: actor.userId,
      documentId,
      now: services.now?.() ?? new Date().toISOString(),
    });
  } catch (error) {
    return mapError(error, "write");
  }
}
const disabledR2: R2Client = {
  createPdfUploadUrl: async () => {
    throw new Error("R2 disabled");
  },
  createPdfDownloadUrl: async () => {
    throw new Error("R2 disabled");
  },
  putObject: async () => {
    throw new Error("R2 disabled");
  },
  readObject: async () => {
    throw new Error("R2 disabled");
  },
  deleteObject: async () => {
    throw new Error("R2 disabled");
  },
};
function callableServices(): DocumentCallableServices {
  const pilotEnabled = process.env.BPT_SYNTHETIC_PILOT === "true";
  const hasR2 = Boolean(
    process.env.R2_ACCOUNT_ID &&
    process.env.R2_BUCKET_NAME &&
    process.env.R2_ACCESS_KEY_ID &&
    process.env.R2_SECRET_ACCESS_KEY,
  );
  return {
    pilotEnabled,
    store: createDocumentStore({
      firestore: getFirestore() as unknown as Parameters<
        typeof createDocumentStore
      >[0]["firestore"],
      r2: hasR2 ? createR2ClientFromEnvironment() : disabledR2,
    }),
  } as DocumentCallableServices;
}
export const privateDocumentCallableOptions = { enforceAppCheck: true };

export const createPrivateWaiverUpload = onCall(privateDocumentCallableOptions, (request) =>
  createPrivateWaiverUploadHandler(request, callableServices()),
);
export const finalizePrivateWaiverUpload = onCall(privateDocumentCallableOptions, (request) =>
  finalizePrivateWaiverUploadHandler(request, callableServices()),
);
export const getPrivateWaiverDownload = onCall(privateDocumentCallableOptions, (request) =>
  getPrivateWaiverDownloadHandler(request, callableServices()),
);
export const revokePrivateWaiver = onCall(privateDocumentCallableOptions, (request) =>
  revokePrivateWaiverHandler(request, callableServices()),
);
