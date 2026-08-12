import { httpsCallable } from "firebase/functions";
import { parseMemberImportPreview, type MemberImportPreview } from "@bpt-jersey/domain";

import { getFirebaseFunctions } from "./firebase-client";

const MAX_FILES = 5;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_SESSION_AGE_MS = 10 * 60 * 1000;
const safeStartError = "Unable to start member import. Please try again.";
const safeUploadError = "Unable to upload member reports. Please try again.";
const safePreviewError = "Unable to prepare member import. Please try again.";
const safeConfirmError = "Unable to confirm member import. Please try again.";

export type MemberImportFile = Readonly<{
  fileName: string;
  contentType: "application/pdf";
  sizeBytes: number;
  file: File;
}>;

export type MemberImportUpload = Readonly<{
  objectKey: string;
  uploadUrl: string;
}>;

export type MemberImportSessionResponse = Readonly<{
  sessionId: string;
  uploads: readonly MemberImportUpload[];
  expiresAt: string;
}>;

export type MemberImportWriteResult = Readonly<{
  imported: number;
  updated: number;
  conflicts: number;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isCanonicalIsoDate(value: unknown): value is string {
  return (
    typeof value === "string" &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}

function isFutureBoundedDate(value: unknown): value is string {
  if (!isCanonicalIsoDate(value)) return false;
  const expiresAt = Date.parse(value);
  const now = Date.now();
  return expiresAt > now && expiresAt <= now + MAX_SESSION_AGE_MS;
}

export function isMemberImportExpiryValid(value: string, now = Date.now()): boolean {
  if (!isCanonicalIsoDate(value)) return false;
  const expiresAt = Date.parse(value);
  return expiresAt > now && expiresAt <= now + MAX_SESSION_AGE_MS;
}

function isHttpsUrl(value: unknown): value is string {
  if (!isNonEmptyString(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname.length > 0;
  } catch {
    return false;
  }
}

function isMemberImportSessionResponse(value: unknown): value is MemberImportSessionResponse {
  if (!isRecord(value)) return false;
  if (
    Object.keys(value).some((key) => !["sessionId", "uploads", "expiresAt"].includes(key)) ||
    !isNonEmptyString(value.sessionId) ||
    !isFutureBoundedDate(value.expiresAt) ||
    !Array.isArray(value.uploads) ||
    value.uploads.length === 0 ||
    value.uploads.length > MAX_FILES
  ) {
    return false;
  }

  return value.uploads.every((upload) => {
    if (!isRecord(upload)) return false;
    return (
      Object.keys(upload).every((key) => key === "objectKey" || key === "uploadUrl") &&
      isNonEmptyString(upload.objectKey) &&
      isHttpsUrl(upload.uploadUrl)
    );
  });
}

function isMemberImportWriteResult(value: unknown): value is MemberImportWriteResult {
  return (
    isRecord(value) &&
    Object.keys(value).every((key) => ["imported", "updated", "conflicts"].includes(key)) &&
    ["imported", "updated", "conflicts"].every(
      (key) => typeof value[key] === "number" && Number.isSafeInteger(value[key]) && value[key] >= 0,
    )
  );
}

function sanitizedError(message: string): Error {
  return new Error(message);
}

export function validateMemberImportFiles(files: readonly File[]): readonly MemberImportFile[] {
  if (files.length === 0 || files.length > MAX_FILES) return [];
  const valid = files.every(
    (file) =>
      file instanceof File &&
      file.type === "application/pdf" &&
      file.name.toLowerCase().endsWith(".pdf") &&
      Number.isSafeInteger(file.size) &&
      file.size > 0 &&
      file.size <= MAX_FILE_BYTES,
  );
  if (!valid) return [];
  return Object.freeze(
    files.map((file) =>
      Object.freeze({
        fileName: file.name,
        contentType: "application/pdf" as const,
        sizeBytes: file.size,
        file,
      }),
    ),
  );
}

export async function createMemberImportSession(
  files: readonly MemberImportFile[],
): Promise<MemberImportSessionResponse> {
  try {
    const callable = httpsCallable<
      { files: readonly { fileName: string; contentType: "application/pdf"; sizeBytes: number }[] },
      unknown
    >(getFirebaseFunctions(), "createMemberPdfImportSession");
    const result = await callable({
      files: files.map(({ fileName, contentType, sizeBytes }) => ({
        fileName,
        contentType,
        sizeBytes,
      })),
    });
    if (!isMemberImportSessionResponse(result.data)) throw sanitizedError(safeStartError);
    return result.data;
  } catch {
    throw sanitizedError(safeStartError);
  }
}

export async function uploadMemberImportFiles(
  files: readonly MemberImportFile[],
  session: MemberImportSessionResponse,
  onProgress?: (completed: number, total: number) => void,
): Promise<void> {
  try {
    if (files.length !== session.uploads.length) throw new Error("Upload count mismatch");
    await Promise.all(
      files.map(async (file, index) => {
        const upload = session.uploads[index];
        if (upload === undefined) throw new Error("Upload URL is missing");
        if (!isHttpsUrl(upload.uploadUrl)) throw new Error("Upload URL is invalid");
        const response = await fetch(upload.uploadUrl, {
          method: "PUT",
          headers: { "Content-Type": file.contentType },
          body: file.file,
        });
        if (!response.ok) throw new Error("Upload failed");
        onProgress?.(index + 1, files.length);
      }),
    );
  } catch {
    throw sanitizedError(safeUploadError);
  }
}

export async function previewMemberImport(sessionId: string): Promise<MemberImportPreview> {
  try {
    const callable = httpsCallable<{ sessionId: string }, unknown>(
      getFirebaseFunctions(),
      "previewMemberPdfImport",
    );
    const result = await callable({ sessionId });
    const parsed = parseMemberImportPreview(result.data);
    if (!parsed.ok || !isFutureBoundedDate(parsed.value.expiresAt)) {
      throw sanitizedError(safePreviewError);
    }
    return parsed.value;
  } catch {
    throw sanitizedError(safePreviewError);
  }
}

export async function confirmMemberImport(
  sessionId: string,
  previewId: string,
): Promise<MemberImportWriteResult> {
  try {
    const callable = httpsCallable<
      { sessionId: string; previewId: string; confirm: true },
      unknown
    >(getFirebaseFunctions(), "confirmMemberPdfImport");
    const result = await callable({ sessionId, previewId, confirm: true });
    if (!isMemberImportWriteResult(result.data)) throw sanitizedError(safeConfirmError);
    return result.data;
  } catch {
    throw sanitizedError(safeConfirmError);
  }
}
