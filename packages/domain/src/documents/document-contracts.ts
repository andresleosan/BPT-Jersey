import { err, ok, type Result } from "../result";

export const privateDocumentKinds = ["waiver"] as const;
export type PrivateDocumentKind = (typeof privateDocumentKinds)[number];
export const privateDocumentStatuses = ["active", "revoked"] as const;
export type PrivateDocumentStatus = (typeof privateDocumentStatuses)[number];
export const MAX_PRIVATE_DOCUMENT_BYTES = 10 * 1024 * 1024;

export type PrivateDocumentRecord = Readonly<{
  documentId: string;
  academyId: string;
  studentId: string;
  kind: PrivateDocumentKind;
  objectKey: string;
  fileName: string;
  contentType: "application/pdf";
  sizeBytes: number;
  sha256: string;
  signedAt: string | null;
  status: PrivateDocumentStatus;
  schemaVersion: "1";
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
}>;
export type PrivateDocumentUploadInput = Readonly<{
  studentId: string;
  fileName: string;
  contentType: "application/pdf";
  sizeBytes: number;
  signedAt: string | null;
}>;
export type PrivateDocumentProjection = Readonly<{
  documentId: string;
  studentId: string;
  kind: PrivateDocumentKind;
  fileName: string;
  contentType: "application/pdf";
  sizeBytes: number;
  sha256: string;
  signedAt: string | null;
  status: PrivateDocumentStatus;
  schemaVersion: "1";
}>;
export type ValidationIssue = Readonly<{ path: readonly (string | number)[]; code: string }>;

const safeIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const isoDateTimePattern =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:?\d{2})$/u;
const sha256Pattern = /^[a-f0-9]{64}$/u;
const filePattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}\.pdf$/iu;
function issue(path: readonly (string | number)[], code: string): ValidationIssue {
  return { path, code };
}
function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}
function exactFields(value: Record<string, unknown>, fields: readonly string[]): boolean {
  const keys = Reflect.ownKeys(value);
  return (
    keys.length === fields.length &&
    keys.every((key) => typeof key === "string" && fields.includes(key))
  );
}
function validId(value: unknown): value is string {
  return typeof value === "string" && safeIdPattern.test(value);
}
function validDate(value: unknown): value is string {
  return (
    typeof value === "string" && isoDateTimePattern.test(value) && !Number.isNaN(Date.parse(value))
  );
}

export function buildPrivateDocumentId(
  academyId: string,
  studentId: string,
  version: string,
): string {
  const safeVersion = version.replace(/[^A-Za-z0-9._:-]/gu, "-").slice(0, 32);
  return ("doc_" + academyId + "_" + studentId + "_" + safeVersion).slice(0, 128);
}
export function buildPrivateDocumentObjectKey(
  academyId: string,
  studentId: string,
  documentId: string,
): string {
  if (!validId(academyId) || !validId(studentId) || !validId(documentId))
    throw new Error("Invalid private document identity");
  return "academies/" + academyId + "/documents/" + studentId + "/" + documentId + ".pdf";
}
export function parsePrivateDocumentUploadInput(
  raw: unknown,
): Result<PrivateDocumentUploadInput, readonly ValidationIssue[]> {
  if (
    !isPlainRecord(raw) ||
    !exactFields(raw, ["studentId", "fileName", "contentType", "sizeBytes", "signedAt"])
  )
    return err(Object.freeze([issue(["input"], "unexpected_fields")]));
  const issues: ValidationIssue[] = [];
  if (!validId(raw.studentId)) issues.push(issue(["studentId"], "invalid_student_id"));
  if (typeof raw.fileName !== "string" || !filePattern.test(raw.fileName))
    issues.push(issue(["fileName"], "invalid_pdf_name"));
  if (raw.contentType !== "application/pdf") issues.push(issue(["contentType"], "pdf_only"));
  if (
    !Number.isSafeInteger(raw.sizeBytes) ||
    (raw.sizeBytes as number) <= 0 ||
    (raw.sizeBytes as number) > MAX_PRIVATE_DOCUMENT_BYTES
  )
    issues.push(issue(["sizeBytes"], "invalid_size"));
  if (raw.signedAt !== null && !validDate(raw.signedAt))
    issues.push(issue(["signedAt"], "invalid_timestamp"));
  if (issues.length) return err(Object.freeze(issues));
  return ok(
    Object.freeze({
      studentId: raw.studentId as string,
      fileName: raw.fileName as string,
      contentType: "application/pdf",
      sizeBytes: raw.sizeBytes as number,
      signedAt: raw.signedAt as string | null,
    }),
  );
}
export function parsePrivateDocumentRecord(
  raw: unknown,
): Result<PrivateDocumentRecord, readonly ValidationIssue[]> {
  const fields = [
    "documentId",
    "academyId",
    "studentId",
    "kind",
    "objectKey",
    "fileName",
    "contentType",
    "sizeBytes",
    "sha256",
    "signedAt",
    "status",
    "schemaVersion",
    "createdAt",
    "createdBy",
    "updatedAt",
    "updatedBy",
  ];
  if (!isPlainRecord(raw) || !exactFields(raw, fields))
    return err(Object.freeze([issue(["input"], "unexpected_fields")]));
  const value = raw;
  const issues: ValidationIssue[] = [];
  for (const field of ["documentId", "academyId", "studentId", "createdBy", "updatedBy"] as const)
    if (!validId(value[field])) issues.push(issue([field], "invalid_id"));
  if (!privateDocumentKinds.includes(value.kind as PrivateDocumentKind))
    issues.push(issue(["kind"], "invalid_kind"));
  const expectedObjectKey =
    "academies/" +
    value.academyId +
    "/documents/" +
    value.studentId +
    "/" +
    value.documentId +
    ".pdf";
  if (typeof value.objectKey !== "string" || value.objectKey !== expectedObjectKey)
    issues.push(issue(["objectKey"], "invalid_object_key"));
  if (typeof value.fileName !== "string" || !filePattern.test(value.fileName))
    issues.push(issue(["fileName"], "invalid_pdf_name"));
  if (value.contentType !== "application/pdf") issues.push(issue(["contentType"], "pdf_only"));
  if (
    !Number.isSafeInteger(value.sizeBytes) ||
    (value.sizeBytes as number) <= 0 ||
    (value.sizeBytes as number) > MAX_PRIVATE_DOCUMENT_BYTES
  )
    issues.push(issue(["sizeBytes"], "invalid_size"));
  if (typeof value.sha256 !== "string" || !sha256Pattern.test(value.sha256))
    issues.push(issue(["sha256"], "invalid_sha256"));
  if (value.signedAt !== null && !validDate(value.signedAt))
    issues.push(issue(["signedAt"], "invalid_timestamp"));
  if (!privateDocumentStatuses.includes(value.status as PrivateDocumentStatus))
    issues.push(issue(["status"], "invalid_status"));
  if (value.schemaVersion !== "1")
    issues.push(issue(["schemaVersion"], "unsupported_schema_version"));
  for (const field of ["createdAt", "updatedAt"] as const)
    if (!validDate(value[field])) issues.push(issue([field], "invalid_timestamp"));
  if (issues.length) return err(Object.freeze(issues));
  return ok(Object.freeze(value as PrivateDocumentRecord));
}
export function toPrivateDocumentProjection(
  record: PrivateDocumentRecord,
): PrivateDocumentProjection {
  return Object.freeze({
    documentId: record.documentId,
    studentId: record.studentId,
    kind: record.kind,
    fileName: record.fileName,
    contentType: record.contentType,
    sizeBytes: record.sizeBytes,
    sha256: record.sha256,
    signedAt: record.signedAt,
    status: record.status,
    schemaVersion: record.schemaVersion,
  });
}
