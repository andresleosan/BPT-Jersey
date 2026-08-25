import { httpsCallable } from "firebase/functions";

import {
  parseHealthProfileChangeRequest,
  minimumOperationalSupportCodes,
  parseHealthProfile,
  parseHealthProfileSaveInput,
  parseHealthProfileChangeRequestInput,
  type HealthChangeRequestStatus,
  type HealthProfileChangeRequest,
  type HealthProfileAdminProjection,
  type HealthProfileChangeRequestInput,
  type HealthProfileSaveInput,
  type HealthProfileRedactedProjection,
  type MinimumOperationalSupportCode,
} from "@bpt-jersey/domain/health";

import { getFirebaseFunctions } from "./firebase-client";

export type {
  HealthProfileAdminProjection,
  HealthProfileRedactedProjection,
  MinimumOperationalSupportCode,
} from "@bpt-jersey/domain/health";

const safeLoadError = "Unable to load health support. Please try again.";
const safeRequestError = "Unable to submit the health support request. Please try again.";
const safeCancelError = "Unable to cancel the health support request. Please try again.";
const safeReviewError = "Unable to review the health support request. Please try again.";
const safeSaveError = "Unable to save health support. Please try again.";
const safeIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function hasExactFields(value: Record<string, unknown>, fields: readonly string[]): boolean {
  const keys = Reflect.ownKeys(value);
  return keys.length === fields.length && keys.every((key) => typeof key === "string" && fields.includes(key));
}

function parseProjection(value: unknown): HealthProfileRedactedProjection {
  if (
    !isPlainRecord(value) ||
    !hasExactFields(value, [
      "healthProfileId",
      "studentId",
      "minimumOperationalSupport",
      "conditionSummary",
      "reviewState",
      "expiresAt",
      "status",
      "schemaVersion",
    ]) ||
    typeof value.healthProfileId !== "string" ||
    !safeIdPattern.test(value.healthProfileId) ||
    typeof value.studentId !== "string" ||
    !safeIdPattern.test(value.studentId) ||
    !Array.isArray(value.minimumOperationalSupport) ||
    value.minimumOperationalSupport.length === 0 ||
    value.minimumOperationalSupport.some(
      (code) =>
        typeof code !== "string" ||
        !minimumOperationalSupportCodes.includes(code as MinimumOperationalSupportCode),
    ) ||
    new Set(value.minimumOperationalSupport).size !== value.minimumOperationalSupport.length ||
    (value.minimumOperationalSupport.includes("none") && value.minimumOperationalSupport.length !== 1) ||
    (value.conditionSummary !== null && typeof value.conditionSummary !== "string") ||
    (value.expiresAt !== null && typeof value.expiresAt !== "string") ||
    (value.reviewState !== "current" && value.reviewState !== "needs-review" && value.reviewState !== "expired") ||
    (value.status !== "active" && value.status !== "inactive") ||
    value.schemaVersion !== "1"
  ) {
    throw new Error(safeLoadError);
  }

  return Object.freeze({
    healthProfileId: value.healthProfileId,
    studentId: value.studentId,
    minimumOperationalSupport: Object.freeze(value.minimumOperationalSupport as MinimumOperationalSupportCode[]),
    conditionSummary: value.conditionSummary,
    reviewState: value.reviewState,
    expiresAt: value.expiresAt,
    status: value.status,
    schemaVersion: "1",
  });
}

function cleanStudentId(studentId: string, message: string): string {
  if (typeof studentId !== "string" || !safeIdPattern.test(studentId)) throw new Error(message);
  return studentId;
}

function cleanRequestInput(input: HealthProfileChangeRequestInput): HealthProfileChangeRequestInput {
  const parsed = parseHealthProfileChangeRequestInput(input);
  if (!parsed.ok) throw new Error(safeRequestError);
  return parsed.value;
}

function parseRequest(value: unknown, message: string): HealthProfileChangeRequest {
  const parsed = parseHealthProfileChangeRequest(value);
  if (!parsed.ok) throw new Error(message);
  return parsed.value;
}

function parseAdminProjection(value: unknown, message: string): HealthProfileAdminProjection {
  if (!isPlainRecord(value) || !Object.prototype.hasOwnProperty.call(value, "pendingChangeRequest")) {
    throw new Error(message);
  }
  const { pendingChangeRequest, ...profileValue } = value;
  const profile = parseHealthProfile(profileValue);
  if (!profile.ok) throw new Error(message);
  const pending = pendingChangeRequest === null ? null : parseRequest(pendingChangeRequest, message);
  return Object.freeze({ ...profile.value, pendingChangeRequest: pending });
}

function cleanSaveInput(input: HealthProfileSaveInput): HealthProfileSaveInput {
  const parsed = parseHealthProfileSaveInput(input);
  if (!parsed.ok) throw new Error(safeSaveError);
  return parsed.value;
}

export async function getHealthProfile(studentId: string): Promise<HealthProfileRedactedProjection | undefined> {
  try {
    const callable = httpsCallable<{ studentId: string }, unknown>(getFirebaseFunctions(), "getHealthProfile");
    const result = await callable({ studentId: cleanStudentId(studentId, safeLoadError) });
    if (result.data === null || result.data === undefined) return undefined;
    return parseProjection(result.data);
  } catch {
    throw new Error(safeLoadError);
  }
}

export async function createHealthProfileChangeRequest(
  input: HealthProfileChangeRequestInput,
): Promise<HealthProfileChangeRequest> {
  try {
    const callable = httpsCallable<HealthProfileChangeRequestInput, unknown>(
      getFirebaseFunctions(),
      "createHealthProfileChangeRequest",
    );
    const result = await callable(cleanRequestInput(input));
    return parseRequest(result.data, safeRequestError);
  } catch {
    throw new Error(safeRequestError);
  }
}

export async function cancelHealthProfileChangeRequest(requestId: string): Promise<HealthProfileChangeRequest> {
  try {
    const callable = httpsCallable<{ requestId: string }, unknown>(
      getFirebaseFunctions(),
      "cancelHealthProfileChangeRequest",
    );
    if (typeof requestId !== "string" || !safeIdPattern.test(requestId)) throw new Error(safeCancelError);
    const result = await callable({ requestId });
    return parseRequest(result.data, safeCancelError);
  } catch {
    throw new Error(safeCancelError);
  }
}

export type HealthSupportRequestState = HealthChangeRequestStatus;


export async function getHealthAdminProfile(studentId: string): Promise<HealthProfileAdminProjection | undefined> {
  try {
    const callable = httpsCallable<{ studentId: string }, unknown>(getFirebaseFunctions(), "getHealthProfile");
    const result = await callable({ studentId: cleanStudentId(studentId, safeLoadError) });
    if (result.data === null || result.data === undefined) return undefined;
    return parseAdminProjection(result.data, safeLoadError);
  } catch {
    throw new Error(safeLoadError);
  }
}

export async function saveHealthProfile(input: HealthProfileSaveInput): Promise<HealthProfileAdminProjection> {
  try {
    const callable = httpsCallable<HealthProfileSaveInput, unknown>(getFirebaseFunctions(), "saveHealthProfile");
    const result = await callable(cleanSaveInput(input));
    return parseAdminProjection(result.data, safeSaveError);
  } catch {
    throw new Error(safeSaveError);
  }
}

export async function deactivateHealthProfile(studentId: string): Promise<HealthProfileAdminProjection> {
  try {
    const callable = httpsCallable<{ studentId: string }, unknown>(
      getFirebaseFunctions(),
      "deactivateHealthProfile",
    );
    const result = await callable({ studentId: cleanStudentId(studentId, safeSaveError) });
    return parseAdminProjection(result.data, safeSaveError);
  } catch {
    throw new Error(safeSaveError);
  }
}

export async function reviewHealthProfileChangeRequest(
  requestId: string,
  decision: "approve" | "reject",
): Promise<HealthProfileChangeRequest> {
  try {
    const callable = httpsCallable<
      { requestId: string; decision: "approve" | "reject" },
      unknown
    >(getFirebaseFunctions(), "reviewHealthProfileChangeRequest");
    if (
      typeof requestId !== "string" ||
      !safeIdPattern.test(requestId) ||
      (decision !== "approve" && decision !== "reject")
    ) {
      throw new Error(safeReviewError);
    }
    const result = await callable({ requestId, decision });
    return parseRequest(result.data, safeReviewError);
  } catch {
    throw new Error(safeReviewError);
  }
}
