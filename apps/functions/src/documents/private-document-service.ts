import { createHash, randomUUID } from "node:crypto";

import {
  buildPrivateDocumentObjectKey,
  parsePrivateDocumentRecord,
  parsePrivateDocumentUploadInput,
  toPrivateDocumentProjection,
  type PrivateDocumentProjection,
  type PrivateDocumentRecord,
  type PrivateDocumentUploadInput,
} from "@bpt-jersey/domain/documents";
import { parseFamilyRelationship } from "@bpt-jersey/domain/families";
import { parseStudentProfile } from "@bpt-jersey/domain/profiles";
import type { R2Client } from "../storage/r2-client.js";

export type DocumentData = Readonly<Record<string, unknown>>;
export type DocumentReference = Readonly<{ id: string; path: string }>;
export type DocumentSnapshot = Readonly<{
  id: string;
  exists: boolean;
  data: () => DocumentData | undefined;
}>;
export type DocumentQuerySnapshot = Readonly<{ docs: readonly DocumentSnapshot[] }>;
export type DocumentQuery = Readonly<{
  path: string;
  field: string;
  value: unknown;
  limit: number;
}>;
export type DocumentCollection = Readonly<{
  doc: (id?: string) => DocumentReference;
  where: (
    field: string,
    operator: "==",
    value: unknown,
  ) => Readonly<{ limit: (count: number) => DocumentQuery }>;
}>;
export type DocumentTransaction = Readonly<{
  get: (
    target: DocumentReference | DocumentQuery,
  ) => Promise<DocumentSnapshot | DocumentQuerySnapshot>;
  create: (ref: DocumentReference, data: DocumentData) => DocumentTransaction;
  set: (ref: DocumentReference, data: DocumentData) => DocumentTransaction;
}>;
export type DocumentFirestore = Readonly<{
  doc: (path: string) => DocumentReference;
  collection: (path: string) => DocumentCollection;
  runTransaction: <T>(callback: (transaction: DocumentTransaction) => Promise<T>) => Promise<T>;
}>;
export type DocumentStoreDependencies = Readonly<{
  firestore: DocumentFirestore;
  r2: R2Client;
  generateDocumentId?: () => string;
}>;
export type CreateUploadResult = Readonly<{
  documentId: string;
  objectKey: string;
  uploadUrl: string;
}>;
export type DocumentStore = Readonly<{
  createWaiverUpload: (
    input: Readonly<
      { academyId: string; actorId: string; now: string } & PrivateDocumentUploadInput
    >,
  ) => Promise<CreateUploadResult>;
  finalizeWaiverUpload: (
    input: Readonly<{
      academyId: string;
      actorId: string;
      documentId: string;
      sha256: string;
      now: string;
      studentId: string;
      fileName: string;
      sizeBytes: number;
      signedAt: string | null;
    }>,
  ) => Promise<PrivateDocumentProjection>;
  getWaiverDownload: (
    input: Readonly<{
      academyId: string;
      actorId: string;
      role: "owner" | "administrator" | "guardian";
      studentId: string;
    }>,
  ) => Promise<Readonly<{ document: PrivateDocumentProjection; downloadUrl: string }> | undefined>;
  revokeWaiver: (
    input: Readonly<{ academyId: string; actorId: string; documentId: string; now: string }>,
  ) => Promise<PrivateDocumentProjection>;
}>;
export class DocumentStoreError extends Error {
  public readonly code: "invalid" | "forbidden" | "not-found" | "conflict" | "precondition";
  public constructor(code: DocumentStoreError["code"], message: string) {
    super(message);
    this.name = "DocumentStoreError";
    this.code = code;
  }
}
const safe = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const iso = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:?\d{2})$/u;
const documentsPath = (academyId: string) => "academies/" + academyId + "/documents";
const documentPath = (academyId: string, documentId: string) =>
  documentsPath(academyId) + "/" + documentId;
const studentPath = (academyId: string, studentId: string) =>
  "academies/" + academyId + "/students/" + studentId;
const relationshipsPath = (academyId: string) => "academies/" + academyId + "/relationships";
function id(value: string, label: string): string {
  if (!safe.test(value)) throw new DocumentStoreError("invalid", "Invalid " + label);
  return value;
}
function timestamp(value: string): string {
  if (!iso.test(value) || Number.isNaN(Date.parse(value)))
    throw new DocumentStoreError("invalid", "Invalid timestamp");
  return value;
}
function asDoc(value: DocumentSnapshot | DocumentQuerySnapshot): DocumentSnapshot {
  if ("docs" in value) throw new DocumentStoreError("invalid", "Expected document");
  return value;
}
function asQuery(value: DocumentSnapshot | DocumentQuerySnapshot): DocumentQuerySnapshot {
  if (!("docs" in value)) throw new DocumentStoreError("invalid", "Expected query");
  return value;
}
function stored(snapshot: DocumentSnapshot, academyId: string): PrivateDocumentRecord {
  if (!snapshot.exists) throw new DocumentStoreError("not-found", "Document is not available");
  const parsed = parsePrivateDocumentRecord(snapshot.data());
  if (!parsed.ok || parsed.value.academyId !== academyId)
    throw new DocumentStoreError("forbidden", "Document access is not permitted");
  return parsed.value;
}
async function assertMinor(
  transaction: DocumentTransaction,
  firestore: DocumentFirestore,
  academyId: string,
  studentId: string,
): Promise<void> {
  const snapshot = asDoc(await transaction.get(firestore.doc(studentPath(academyId, studentId))));
  if (!snapshot.exists) throw new DocumentStoreError("precondition", "Student is not available");
  const parsed = parseStudentProfile(snapshot.data());
  if (
    !parsed.ok ||
    parsed.value.academyId !== academyId ||
    parsed.value.studentId !== studentId ||
    parsed.value.participantType !== "minor" ||
    parsed.value.active !== true ||
    parsed.value.status !== "active"
  )
    throw new DocumentStoreError("precondition", "Student is not eligible");
}
async function guardianAllowed(
  transaction: DocumentTransaction,
  firestore: DocumentFirestore,
  academyId: string,
  actorId: string,
  studentId: string,
  now: string,
): Promise<boolean> {
  const query = firestore
    .collection(relationshipsPath(academyId))
    .where("studentId", "==", studentId)
    .limit(100);
  return asQuery(await transaction.get(query)).docs.some((snapshot) => {
    if (!snapshot.exists) return false;
    const parsed = parseFamilyRelationship(snapshot.data());
    return (
      parsed.ok &&
      parsed.value.academyId === academyId &&
      parsed.value.studentId === studentId &&
      parsed.value.adultUserId === actorId &&
      parsed.value.active &&
      parsed.value.status === "active" &&
      parsed.value.validFrom <= now &&
      (parsed.value.validTo === undefined || parsed.value.validTo > now)
    );
  });
}
function safeUpload(input: PrivateDocumentUploadInput): PrivateDocumentUploadInput {
  const parsed = parsePrivateDocumentUploadInput(input);
  if (!parsed.ok) throw new DocumentStoreError("invalid", "Private document upload is invalid");
  return parsed.value;
}
function validHash(value: string): boolean {
  return /^[a-f0-9]{64}$/u.test(value);
}
export function createDocumentStore(dependencies: DocumentStoreDependencies): DocumentStore {
  const generateDocumentId = dependencies.generateDocumentId ?? randomUUID;
  return Object.freeze({
    async createWaiverUpload(input) {
      const academyId = id(input.academyId, "academy");
      const actorId = id(input.actorId, "actor");
      const now = timestamp(input.now);
      const upload = safeUpload({
        studentId: input.studentId,
        fileName: input.fileName,
        contentType: input.contentType,
        sizeBytes: input.sizeBytes,
        signedAt: input.signedAt,
      });
      const documentId = id(generateDocumentId(), "document");
      const objectKey = buildPrivateDocumentObjectKey(academyId, upload.studentId, documentId);
      await dependencies.firestore.runTransaction(async (transaction) => {
        await assertMinor(transaction, dependencies.firestore, academyId, upload.studentId);
      });
      let uploadUrl: string;
      try {
        uploadUrl = await dependencies.r2.createPdfUploadUrl({
          ...upload,
          objectKey,
          expiresInSeconds: 600,
        });
      } catch {
        throw new DocumentStoreError("precondition", "Private document storage is not available");
      }
      void actorId;
      void now;
      return Object.freeze({ documentId, objectKey, uploadUrl });
    },
    async finalizeWaiverUpload(input) {
      const academyId = id(input.academyId, "academy");
      const actorId = id(input.actorId, "actor");
      const now = timestamp(input.now);
      const documentId = id(input.documentId, "document");
      const upload = safeUpload({
        studentId: input.studentId,
        fileName: input.fileName,
        contentType: "application/pdf",
        sizeBytes: input.sizeBytes,
        signedAt: input.signedAt,
      });
      if (!validHash(input.sha256))
        throw new DocumentStoreError("invalid", "Document hash is invalid");
      const reference = dependencies.firestore.doc(documentPath(academyId, documentId));
      const bytes = await dependencies.r2
        .readObject(buildPrivateDocumentObjectKey(academyId, upload.studentId, documentId))
        .catch(() => null);
      if (bytes === null)
        throw new DocumentStoreError("precondition", "Private document is not available");
      const actualHash = createHash("sha256").update(bytes).digest("hex");
      if (actualHash !== input.sha256 || bytes.byteLength !== upload.sizeBytes)
        throw new DocumentStoreError(
          "conflict",
          "Document content does not match the declared metadata",
        );
      return dependencies.firestore.runTransaction(async (transaction) => {
        await assertMinor(transaction, dependencies.firestore, academyId, upload.studentId);
        const current = asDoc(await transaction.get(reference));
        if (current.exists)
          throw new DocumentStoreError("conflict", "Document is already finalized");
        const objectKey = buildPrivateDocumentObjectKey(academyId, upload.studentId, documentId);
        const record = {
          documentId,
          academyId,
          studentId: upload.studentId,
          kind: "waiver" as const,
          objectKey,
          fileName: upload.fileName,
          contentType: "application/pdf" as const,
          sizeBytes: bytes.byteLength,
          sha256: actualHash,
          signedAt: upload.signedAt,
          status: "active" as const,
          schemaVersion: "1" as const,
          createdAt: now,
          createdBy: actorId,
          updatedAt: now,
          updatedBy: actorId,
        };
        const parsed = parsePrivateDocumentRecord(record);
        if (!parsed.ok) throw new DocumentStoreError("invalid", "Document contract rejected");
        transaction.create(reference, parsed.value);
        return toPrivateDocumentProjection(parsed.value);
      });
    },
    async getWaiverDownload(input) {
      const academyId = id(input.academyId, "academy");
      const actorId = id(input.actorId, "actor");
      const studentId = id(input.studentId, "student");
      const now = new Date().toISOString();
      const record = await dependencies.firestore.runTransaction(async (transaction) => {
        if (
          input.role === "guardian" &&
          !(await guardianAllowed(
            transaction,
            dependencies.firestore,
            academyId,
            actorId,
            studentId,
            now,
          ))
        ) {
          throw new DocumentStoreError("forbidden", "Document access is not permitted");
        }
        const query = dependencies.firestore
          .collection(documentsPath(academyId))
          .where("studentId", "==", studentId)
          .limit(10);
        const records = asQuery(await transaction.get(query))
          .docs.map((snapshot) => stored(snapshot, academyId))
          .filter((candidate) => candidate.kind === "waiver" && candidate.status === "active");
        return records[0];
      });
      if (!record) return undefined;
      const downloadUrl = await dependencies.r2.createPdfDownloadUrl({
        objectKey: record.objectKey,
        expiresInSeconds: 600,
      });
      return Object.freeze({ document: toPrivateDocumentProjection(record), downloadUrl });
    },
    async revokeWaiver(input) {
      const academyId = id(input.academyId, "academy");
      const actorId = id(input.actorId, "actor");
      const documentId = id(input.documentId, "document");
      const now = timestamp(input.now);
      const reference = dependencies.firestore.doc(documentPath(academyId, documentId));
      return dependencies.firestore.runTransaction(async (transaction) => {
        const current = stored(asDoc(await transaction.get(reference)), academyId);
        const next = { ...current, status: "revoked" as const, updatedAt: now, updatedBy: actorId };
        const parsed = parsePrivateDocumentRecord(next);
        if (!parsed.ok) throw new DocumentStoreError("invalid", "Document contract rejected");
        transaction.set(reference, parsed.value);
        return toPrivateDocumentProjection(parsed.value);
      });
    },
  });
}
