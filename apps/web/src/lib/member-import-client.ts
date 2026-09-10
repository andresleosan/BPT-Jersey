import {
  memberReportKeys,
  trainingCenters,
  trainingTimePreferences,
  type TrainingCenter,
  type TrainingTimePreference,
} from "@bpt-jersey/domain";
import { normalizeMemberImportPdfFileName } from "@bpt-jersey/domain/members";
import { httpsCallable } from "firebase/functions";

import { getFirebaseFunctions } from "./firebase-client";

const MAX_FILES = 5;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_SESSION_AGE_MS = 10 * 60 * 1000;
const safeStartError = "Unable to start member import. Please try again.";
const safeUploadError = "Unable to upload member reports. Please try again.";
const safePreviewError = "Unable to prepare member import. Please try again.";
const safeReviewError = "Unable to review member matches. Please try again.";
const safeConfirmError = "Unable to confirm member import. Please try again.";
const safeIdentifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const macPattern = /^[a-f0-9]{64}$/u;
const receiptIdPattern = /^import-[a-f0-9]{64}$/u;

export const canonicalMemberImportClassifications = Object.freeze([
  "same-id-compatible",
  "explicit-existing-student-match",
  "createable-adult",
  "minor-requires-family-match",
  "missing-required-fields",
  "identity-conflict",
  "duplicate-membership-number",
  "cross-tenant",
  "invalid-record",
] as const);

export type CanonicalMemberImportClassification =
  (typeof canonicalMemberImportClassifications)[number];

export type MemberImportFile = Readonly<{
  fileName: string;
  contentType: "application/pdf";
  sizeBytes: number;
  file: File;
}>;

export type MemberImportUpload = Readonly<{
  uploadUrl: string;
}>;

export type MemberImportSessionOptions = Readonly<{
  operationId: string;
  trainingCenter: TrainingCenter;
  trainingTimePreferences: readonly TrainingTimePreference[];
}>;

export type MemberImportSessionResponse = Readonly<{
  sessionId: string;
  operationId: string;
  uploads: readonly MemberImportUpload[];
  expiresAt: string;
}>;

export type CanonicalMemberImportReceipt = Readonly<{
  receiptId: string;
  operationId: string;
  academyId: string;
  actorId: string;
  projectId: string;
  targetProjectClassification: string;
  codeVersion: "canonical-member-import-v1";
  schemaVersion: "1";
  operationWriteTime: string;
  expiresAt: string;
  sourceMac: string;
  privateManifestMac: string;
  planMac: string;
  outputSetMac: string;
  digestVersion: "hmac-sha256-v1";
  identitySecretVersion: string;
  integrityMacVersion: "hmac-sha256-v1";
  integritySecretVersion: string;
  identityKeyBaselineMac: string;
  classificationCounts: Readonly<Record<CanonicalMemberImportClassification, number>>;
  preExistingAdmittedStudentCount: number;
  plannedNewStudentCount: number;
  postCutoverAdmittedStudentCount: number;
  reportKeys: readonly (typeof memberReportKeys)[number][];
  maximumApprovedRows: 50;
  stateRevisionBefore: number;
  stateRevisionAfter: number;
  status: "planned";
}>;

export type CanonicalMemberImportPreview = Readonly<{
  classifications: readonly Readonly<{
    rowMac: string;
    classification: CanonicalMemberImportClassification;
  }>[];
  reviewMatches: readonly Readonly<{
    rowMac: string;
    sourceName: string;
    candidate: Readonly<{
      studentId: string;
      fullName: string;
      trainingCenter: TrainingCenter;
      membershipReference?: string;
    }>;
    decision: "pending" | "accepted" | "rejected";
  }>[];
  confirmable: boolean;
  receipt: CanonicalMemberImportReceipt;
}>;

export type MemberImportWriteResult = Readonly<{
  receiptId: string;
  created: number;
  matched: number;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isSafeIdentifier(value: unknown): value is string {
  return typeof value === "string" && safeIdentifierPattern.test(value);
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

function isNonNegativeInteger(value: unknown, maximum = Number.MAX_SAFE_INTEGER): value is number {
  return Number.isSafeInteger(value) && typeof value === "number" && value >= 0 && value <= maximum;
}

function isMemberImportSessionResponse(
  value: unknown,
  expectedOperationId: string,
): value is MemberImportSessionResponse {
  if (!isRecord(value) || !hasExactKeys(value, ["sessionId", "operationId", "uploads", "expiresAt"])) {
    return false;
  }
  if (
    !isSafeIdentifier(value.sessionId) ||
    value.operationId !== expectedOperationId ||
    !isFutureBoundedDate(value.expiresAt) ||
    !Array.isArray(value.uploads) ||
    value.uploads.length === 0 ||
    value.uploads.length > MAX_FILES
  ) {
    return false;
  }
  return value.uploads.every(
    (upload) =>
      isRecord(upload) &&
      hasExactKeys(upload, ["uploadUrl"]) &&
      isHttpsUrl(upload.uploadUrl),
  );
}

function isClassificationCounts(
  value: unknown,
): value is Readonly<Record<CanonicalMemberImportClassification, number>> {
  return (
    isRecord(value) &&
    hasExactKeys(value, canonicalMemberImportClassifications) &&
    canonicalMemberImportClassifications.every((key) => isNonNegativeInteger(value[key], 50))
  );
}

function isCanonicalReceipt(
  value: unknown,
  expectedOperationId: string,
): value is CanonicalMemberImportReceipt {
  const keys = [
    "receiptId", "operationId", "academyId", "actorId", "projectId",
    "targetProjectClassification", "codeVersion", "schemaVersion", "operationWriteTime",
    "expiresAt", "sourceMac", "privateManifestMac", "planMac", "outputSetMac",
    "digestVersion", "identitySecretVersion", "integrityMacVersion", "integritySecretVersion",
    "identityKeyBaselineMac", "classificationCounts", "preExistingAdmittedStudentCount",
    "plannedNewStudentCount", "postCutoverAdmittedStudentCount", "reportKeys",
    "maximumApprovedRows", "stateRevisionBefore", "stateRevisionAfter", "status",
  ] as const;
  if (!isRecord(value) || !hasExactKeys(value, keys)) return false;
  if (
    typeof value.receiptId !== "string" || !receiptIdPattern.test(value.receiptId) ||
    value.operationId !== expectedOperationId ||
    !isSafeIdentifier(value.academyId) || !isSafeIdentifier(value.actorId) ||
    !isSafeIdentifier(value.projectId) || !isSafeIdentifier(value.targetProjectClassification) ||
    value.codeVersion !== "canonical-member-import-v1" || value.schemaVersion !== "1" ||
    !isCanonicalIsoDate(value.operationWriteTime) || !isFutureBoundedDate(value.expiresAt) ||
    Date.parse(value.operationWriteTime) > Date.parse(value.expiresAt) ||
    value.digestVersion !== "hmac-sha256-v1" || value.integrityMacVersion !== "hmac-sha256-v1" ||
    !isSafeIdentifier(value.identitySecretVersion) || !isSafeIdentifier(value.integritySecretVersion) ||
    ![value.sourceMac, value.privateManifestMac, value.planMac, value.outputSetMac, value.identityKeyBaselineMac]
      .every((mac) => typeof mac === "string" && macPattern.test(mac)) ||
    !isClassificationCounts(value.classificationCounts) ||
    !isNonNegativeInteger(value.preExistingAdmittedStudentCount, 400) ||
    !isNonNegativeInteger(value.plannedNewStudentCount, 50) ||
    !isNonNegativeInteger(value.postCutoverAdmittedStudentCount, 400) ||
    value.postCutoverAdmittedStudentCount !== value.preExistingAdmittedStudentCount + value.plannedNewStudentCount ||
    !Array.isArray(value.reportKeys) || value.reportKeys.length === 0 ||
    new Set(value.reportKeys).size !== value.reportKeys.length ||
    !value.reportKeys.every((key) => memberReportKeys.includes(key as (typeof memberReportKeys)[number])) ||
    value.maximumApprovedRows !== 50 || !isNonNegativeInteger(value.stateRevisionBefore) ||
    !isNonNegativeInteger(value.stateRevisionAfter) || value.stateRevisionAfter !== value.stateRevisionBefore + 1 ||
    value.status !== "planned"
  ) return false;
  return value.plannedNewStudentCount === value.classificationCounts["createable-adult"];
}

function isCanonicalPreview(
  value: unknown,
  expectedOperationId: string,
): value is CanonicalMemberImportPreview {
  if (!isRecord(value) || !hasExactKeys(value, ["classifications", "reviewMatches", "confirmable", "receipt"])) return false;
  const receipt = value.receipt;
  if (!Array.isArray(value.classifications) || value.classifications.length === 0 || value.classifications.length > 50 || typeof value.confirmable !== "boolean" || !isCanonicalReceipt(receipt, expectedOperationId)) return false;
  const rowMacs = new Set<string>();
  const counts = Object.fromEntries(canonicalMemberImportClassifications.map((key) => [key, 0])) as Record<CanonicalMemberImportClassification, number>;
  for (const item of value.classifications) {
    if (!isRecord(item) || !hasExactKeys(item, ["rowMac", "classification"]) || typeof item.rowMac !== "string" || !macPattern.test(item.rowMac) || !canonicalMemberImportClassifications.includes(item.classification as CanonicalMemberImportClassification) || rowMacs.has(item.rowMac)) return false;
    rowMacs.add(item.rowMac);
    counts[item.classification as CanonicalMemberImportClassification] += 1;
  }
  if (!Array.isArray(value.reviewMatches) || value.reviewMatches.length > 50) return false;
  const reviewedRows = new Set<string>();
  for (const match of value.reviewMatches) {
    if (
      !isRecord(match) ||
      !hasExactKeys(match, ["rowMac", "sourceName", "candidate", "decision"]) ||
      typeof match.rowMac !== "string" ||
      !macPattern.test(match.rowMac) ||
      reviewedRows.has(match.rowMac) ||
      !isNonEmptyString(match.sourceName) ||
      match.sourceName !== match.sourceName.trim() ||
      match.sourceName.length > 160 ||
      !isRecord(match.candidate) ||
      !hasExactKeys(
        match.candidate,
        match.candidate.membershipReference === undefined
          ? ["studentId", "fullName", "trainingCenter"]
          : ["studentId", "fullName", "trainingCenter", "membershipReference"],
      ) ||
      !isSafeIdentifier(match.candidate.studentId) ||
      !isNonEmptyString(match.candidate.fullName) ||
      match.candidate.fullName !== match.candidate.fullName.trim() ||
      match.candidate.fullName.length > 160 ||
      !trainingCenters.includes(match.candidate.trainingCenter as TrainingCenter) ||
      (match.candidate.membershipReference !== undefined &&
        (typeof match.candidate.membershipReference !== "string" ||
          !/^\*{4}.{4}$/u.test(match.candidate.membershipReference))) ||
      !["pending", "accepted", "rejected"].includes(String(match.decision))
    ) return false;
    const classification = value.classifications.find(
      (item) => isRecord(item) && item.rowMac === match.rowMac,
    ) as Record<string, unknown> | undefined;
    if (
      classification === undefined ||
      (match.decision === "accepted"
        ? !["same-id-compatible", "explicit-existing-student-match"].includes(
            String(classification.classification),
          )
        : classification.classification !== "identity-conflict")
    ) return false;
    reviewedRows.add(match.rowMac);
  }
  return canonicalMemberImportClassifications.every((key) => counts[key] === receipt.classificationCounts[key]);
}

function isMemberImportWriteResult(
  value: unknown,
  expectedReceiptId: string,
): value is MemberImportWriteResult {
  return (
    isRecord(value) && hasExactKeys(value, ["receiptId", "created", "matched"]) &&
    value.receiptId === expectedReceiptId && isNonNegativeInteger(value.created, 50) &&
    isNonNegativeInteger(value.matched, 50) && value.created + value.matched <= 50
  );
}

function sanitizedError(message: string): Error {
  return new Error(message);
}

export function validateMemberImportFiles(files: readonly File[]): readonly MemberImportFile[] {
  if (files.length === 0 || files.length > MAX_FILES) return [];
  const validated: MemberImportFile[] = [];
  for (const file of files) {
    const fileName = file instanceof File ? normalizeMemberImportPdfFileName(file.name) : undefined;
    if (
      fileName === undefined ||
      file.type !== "application/pdf" ||
      !Number.isSafeInteger(file.size) ||
      file.size <= 0 ||
      file.size > MAX_FILE_BYTES
    ) {
      return [];
    }
    validated.push(
      Object.freeze({ fileName, contentType: "application/pdf" as const, sizeBytes: file.size, file }),
    );
  }
  return Object.freeze(validated);
}

export async function createMemberImportSession(
  files: readonly MemberImportFile[],
  options: MemberImportSessionOptions,
): Promise<MemberImportSessionResponse> {
  try {
    if (!uuidPattern.test(options.operationId) || !trainingCenters.includes(options.trainingCenter) || options.trainingTimePreferences.length === 0 || new Set(options.trainingTimePreferences).size !== options.trainingTimePreferences.length || !options.trainingTimePreferences.every((value) => trainingTimePreferences.includes(value))) throw new Error("Invalid import options");
    const callable = httpsCallable<
      { operationId: string; trainingCenter: TrainingCenter; trainingTimePreferences: readonly TrainingTimePreference[]; files: readonly { fileName: string; contentType: "application/pdf"; sizeBytes: number }[] },
      unknown
    >(getFirebaseFunctions(), "createMemberPdfImportSession");
    const result = await callable({ operationId: options.operationId, trainingCenter: options.trainingCenter, trainingTimePreferences: [...options.trainingTimePreferences], files: files.map(({ fileName, contentType, sizeBytes }) => ({ fileName, contentType, sizeBytes })) });
    if (!isMemberImportSessionResponse(result.data, options.operationId) || result.data.uploads.length !== files.length) throw new Error("Invalid session response");
    return result.data;
  } catch {
    throw sanitizedError(safeStartError);
  }
}

export async function uploadMemberImportFiles(files: readonly MemberImportFile[], session: MemberImportSessionResponse, onProgress?: (completed: number, total: number) => void): Promise<void> {
  try {
    if (files.length !== session.uploads.length) throw new Error("Upload count mismatch");
    let completed = 0;
    await Promise.all(files.map(async (file, index) => {
      const upload = session.uploads[index];
      if (upload === undefined || !isHttpsUrl(upload.uploadUrl)) throw new Error("Upload URL is invalid");
      const response = await fetch(upload.uploadUrl, { method: "PUT", headers: { "Content-Type": file.contentType }, body: file.file });
      if (!response.ok) throw new Error("Upload failed");
      completed += 1;
      onProgress?.(completed, files.length);
    }));
  } catch {
    throw sanitizedError(safeUploadError);
  }
}

export async function previewMemberImport(sessionId: string, operationId: string): Promise<CanonicalMemberImportPreview> {
  try {
    if (!isSafeIdentifier(sessionId) || !uuidPattern.test(operationId)) throw new Error("Invalid preview request");
    const callable = httpsCallable<{ sessionId: string; operationId: string }, unknown>(getFirebaseFunctions(), "previewMemberPdfImport");
    const result = await callable({ sessionId, operationId });
    if (!isCanonicalPreview(result.data, operationId)) throw new Error("Invalid preview response");
    return result.data;
  } catch {
    throw sanitizedError(safePreviewError);
  }
}

export async function reviewMemberImportMatches(
  sessionId: string,
  operationId: string,
  decisions: readonly Readonly<{ rowMac: string; decision: "accept" | "reject" }>[] ,
): Promise<CanonicalMemberImportPreview> {
  try {
    if (
      !isSafeIdentifier(sessionId) ||
      !uuidPattern.test(operationId) ||
      decisions.length === 0 ||
      decisions.length > 50 ||
      new Set(decisions.map((decision) => decision.rowMac)).size !== decisions.length ||
      decisions.some(
        (decision) =>
          !macPattern.test(decision.rowMac) ||
          (decision.decision !== "accept" && decision.decision !== "reject"),
      )
    ) throw new Error("Invalid review request");
    const callable = httpsCallable<
      {
        sessionId: string;
        operationId: string;
        decisions: readonly Readonly<{ rowMac: string; decision: "accept" | "reject" }>[];
      },
      unknown
    >(getFirebaseFunctions(), "reviewMemberPdfImportMatches");
    const result = await callable({ sessionId, operationId, decisions });
    if (!isCanonicalPreview(result.data, operationId)) throw new Error("Invalid review response");
    return result.data;
  } catch {
    throw sanitizedError(safeReviewError);
  }
}

export async function confirmMemberImport(sessionId: string, operationId: string, receipt: CanonicalMemberImportReceipt): Promise<MemberImportWriteResult> {
  try {
    if (!isSafeIdentifier(sessionId) || !uuidPattern.test(operationId) || !isCanonicalReceipt(receipt, operationId)) throw new Error("Invalid confirmation request");
    const callable = httpsCallable<{ sessionId: string; operationId: string; receipt: CanonicalMemberImportReceipt }, unknown>(getFirebaseFunctions(), "confirmMemberPdfImport");
    const result = await callable({ sessionId, operationId, receipt });
    if (!isMemberImportWriteResult(result.data, receipt.receiptId)) throw new Error("Invalid confirmation response");
    return result.data;
  } catch {
    throw sanitizedError(safeConfirmError);
  }
}
