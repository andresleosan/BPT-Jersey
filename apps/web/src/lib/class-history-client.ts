import { httpsCallable } from "./callable";

import { userRoles } from "@bpt-jersey/domain";
import {
  classActorGroups,
  classAuditActions,
  classAuditSources,
  type ClassActorGroup,
  type ClassActorRole,
  type ClassAuditAction,
  type ClassAuditSource,
} from "@bpt-jersey/domain/audit";
import {
  classHistoryRegistrationTypes,
  type ClassHistoryRegistrationType,
  type ClassHistoryRow,
  type ListClassHistoryInput,
} from "@bpt-jersey/domain/audit/class-history";

import { getFirebaseFunctions } from "./firebase-client";

export type FetchClassHistoryInput = ListClassHistoryInput;

export type ClassHistoryListing = Readonly<{
  rows: readonly ClassHistoryRow[];
  total: number;
}>;

export type DownloadClassHistoryPdfResult = Readonly<{
  blob: Blob;
  fileName: string;
}>;

const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const fileNamePattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}\.pdf$/u;

const safeListError = "The log is temporarily unavailable. Please try again.";
const safeExportError = "The PDF could not be prepared. Please try again.";

const inputFields = [
  "academyId",
  "since",
  "actorId",
  "registrationType",
  "limit",
  "cursor",
] as const;
const rowFields = [
  "id",
  "occurredAt",
  "action",
  "actorId",
  "actorRole",
  "actorGroup",
  "actorName",
  "actorIp",
  "studentId",
  "studentName",
  "sessionId",
  "sessionStartAt",
  "programId",
  "programName",
  "locationId",
  "source",
  "sentence",
] as const;
const listingFields = ["rows", "total"] as const;
const exportFields = ["pdfBase64", "fileName"] as const;

const classActorRoles: readonly ClassActorRole[] = Object.freeze([
  ...userRoles,
  "system",
  "regyfit",
]);

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function hasExactFields(value: Record<string, unknown>, fields: readonly string[]): boolean {
  const keys = Reflect.ownKeys(value);
  return (
    keys.length === fields.length &&
    keys.every((key) => {
      if (typeof key !== "string" || !fields.includes(key)) return false;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return (
        descriptor?.enumerable === true &&
        descriptor.get === undefined &&
        descriptor.set === undefined &&
        Object.hasOwn(descriptor, "value")
      );
    })
  );
}

function isDenseArray(value: unknown): value is readonly unknown[] {
  if (!Array.isArray(value)) return false;
  const keys = Reflect.ownKeys(value);
  if (keys.length !== value.length + 1 || !keys.includes("length")) return false;
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) return false;
  }
  return true;
}

function isSafeId(value: unknown): value is string {
  return typeof value === "string" && identifierPattern.test(value);
}

function isNullableSafeId(value: unknown): value is string | null {
  return value === null || isSafeId(value);
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function isNullableTimestamp(value: unknown): value is string | null {
  return value === null || isTimestamp(value);
}

function isClassAuditAction(value: unknown): value is ClassAuditAction {
  return typeof value === "string" && classAuditActions.includes(value as ClassAuditAction);
}

function isClassActorGroup(value: unknown): value is ClassActorGroup {
  return typeof value === "string" && classActorGroups.includes(value as ClassActorGroup);
}

function isClassActorRole(value: unknown): value is ClassActorRole {
  return typeof value === "string" && classActorRoles.includes(value as ClassActorRole);
}

function isClassAuditSource(value: unknown): value is ClassAuditSource {
  return typeof value === "string" && classAuditSources.includes(value as ClassAuditSource);
}

function isClassHistoryRow(value: unknown): value is ClassHistoryRow {
  return (
    isPlainRecord(value) &&
    hasExactFields(value, rowFields) &&
    isSafeId(value.id) &&
    isTimestamp(value.occurredAt) &&
    isClassAuditAction(value.action) &&
    typeof value.actorId === "string" &&
    value.actorId.length > 0 &&
    isClassActorRole(value.actorRole) &&
    isClassActorGroup(value.actorGroup) &&
    isNullableString(value.actorName) &&
    isNullableString(value.actorIp) &&
    isNullableSafeId(value.studentId) &&
    isNullableString(value.studentName) &&
    isNullableSafeId(value.sessionId) &&
    isNullableTimestamp(value.sessionStartAt) &&
    isNullableSafeId(value.programId) &&
    isNullableString(value.programName) &&
    isNullableSafeId(value.locationId) &&
    isClassAuditSource(value.source) &&
    typeof value.sentence === "string" &&
    value.sentence.length > 0
  );
}

function isRegistrationType(value: unknown): value is ClassHistoryRegistrationType {
  return (
    typeof value === "string" &&
    classHistoryRegistrationTypes.includes(value as ClassHistoryRegistrationType)
  );
}

function listingResponse(value: unknown): ClassHistoryListing {
  if (
    !isPlainRecord(value) ||
    !hasExactFields(value, listingFields) ||
    !isDenseArray(value.rows) ||
    !value.rows.every(isClassHistoryRow) ||
    typeof value.total !== "number" ||
    !Number.isInteger(value.total) ||
    value.total < 0
  ) {
    throw new Error(safeListError);
  }
  return Object.freeze({ rows: Object.freeze([...value.rows]), total: value.total });
}

function listPayload(input: FetchClassHistoryInput): FetchClassHistoryInput {
  if (
    !isPlainRecord(input) ||
    !hasExactFields(input, inputFields) ||
    !isSafeId(input.academyId) ||
    !isTimestamp(input.since) ||
    !isNullableSafeId(input.actorId) ||
    !isRegistrationType(input.registrationType) ||
    typeof input.limit !== "number" ||
    !Number.isInteger(input.limit) ||
    !isNullableTimestamp(input.cursor)
  ) {
    throw new Error(safeListError);
  }
  return Object.freeze({
    academyId: input.academyId,
    since: input.since,
    actorId: input.actorId,
    registrationType: input.registrationType,
    limit: input.limit,
    cursor: input.cursor,
  });
}

function exportResponse(value: unknown): { pdfBase64: string; fileName: string } {
  if (
    !isPlainRecord(value) ||
    !hasExactFields(value, exportFields) ||
    typeof value.pdfBase64 !== "string" ||
    value.pdfBase64.length === 0 ||
    typeof value.fileName !== "string" ||
    !fileNamePattern.test(value.fileName)
  ) {
    throw new Error(safeExportError);
  }
  return { pdfBase64: value.pdfBase64, fileName: value.fileName };
}

function decodeBase64ToBlob(base64: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Blob([bytes], { type: "application/pdf" });
}

export async function fetchClassHistory(
  input: FetchClassHistoryInput,
): Promise<ClassHistoryListing> {
  try {
    const callable = httpsCallable<FetchClassHistoryInput, unknown>(
      getFirebaseFunctions(),
      "listClassHistory",
    );
    return listingResponse((await callable(listPayload(input))).data);
  } catch {
    throw new Error(safeListError);
  }
}

export async function downloadClassHistoryPdf(
  input: FetchClassHistoryInput,
): Promise<DownloadClassHistoryPdfResult> {
  try {
    const callable = httpsCallable<FetchClassHistoryInput, unknown>(
      getFirebaseFunctions(),
      "exportClassHistoryPdf",
    );
    const { pdfBase64, fileName } = exportResponse((await callable(listPayload(input))).data);
    return { blob: decodeBase64ToBlob(pdfBase64), fileName };
  } catch {
    throw new Error(safeExportError);
  }
}
