import { httpsCallable } from "firebase/functions";
import {
  memberGenders,
  memberReportKeys,
  membershipStatuses,
  paymentStatuses,
  type MemberGender,
  type MemberReportKey,
  type MemberSearchFilters,
} from "@bpt-jersey/domain";

import { getFirebaseFunctions } from "./firebase-client";

export type CreateMemberInput = Readonly<{
  membershipNumber?: string;
  fullName: string;
  email?: string;
  idCardNumber?: string;
  vatNumber?: string;
  birthDate?: string;
  mobileNumber?: string;
  frequency?: string;
  gender?: MemberGender;
  trainingCenter?: string;
}>;

type CreateMemberResponse = Readonly<{ memberId: string }>;

export type MemberSearchProjection = Readonly<{
  memberId: string;
  membershipNumber?: string;
  fullName: string;
  email?: string;
  idCardNumber?: string;
  vatNumber?: string;
  birthDate?: string;
  mobileNumber?: string;
  frequency?: string;
  paymentStatus: "regularized" | "notRegularized" | "unknown";
  gender: MemberGender;
  trainingCenter?: string;
  membershipStatus: "active" | "inactive" | "suspended";
  inactiveAt?: string;
  createdAt: string;
  updatedAt: string;
  source: string;
  schemaVersion: "1";
}>;

export type MemberSearchResult = Readonly<{
  members: readonly MemberSearchProjection[];
  nextPageToken?: string;
}>;

export type MemberReportResult = Readonly<{
  report: MemberReportKey;
  members: readonly MemberSearchProjection[];
  generatedAt: string;
}>;

export type MemberReportSummary = Readonly<{
  report: MemberReportKey;
  count: number;
}>;

type SearchRequest = Readonly<{ filters: MemberSearchFilters; pageToken?: string }>;
type MemberReportPdfResult = Readonly<{ downloadUrl: string; expiresAt: string }>;

const memberInputFields = [
  "membershipNumber",
  "fullName",
  "email",
  "idCardNumber",
  "vatNumber",
  "birthDate",
  "mobileNumber",
  "frequency",
  "gender",
  "trainingCenter",
] as const satisfies readonly (keyof CreateMemberInput)[];

const safeCreateMemberError = "Unable to create member. Please try again.";
const safeSearchMembersError = "Unable to search members. Please try again.";
const safeMemberReportError = "Unable to load member report. Please try again.";
const safeMemberReportSummaryError = "Unable to load member report counters. Please try again.";
const safeMemberReportPdfError = "Unable to download member report. Please try again.";
const MAX_SIGNED_PDF_URL_AGE_MS = 10 * 60 * 1000;

const memberSearchFilterFields = [
  "membershipNumber",
  "name",
  "email",
  "idCardNumber",
  "vatNumber",
  "mobileNumber",
  "frequency",
  "paymentOrStatus",
  "gender",
  "trainingCenter",
  "orderBy",
] as const satisfies readonly (keyof MemberSearchFilters)[];

const projectionFields = new Set([
  "memberId",
  "membershipNumber",
  "fullName",
  "email",
  "idCardNumber",
  "vatNumber",
  "birthDate",
  "mobileNumber",
  "frequency",
  "paymentStatus",
  "gender",
  "trainingCenter",
  "membershipStatus",
  "inactiveAt",
  "createdAt",
  "updatedAt",
  "source",
  "schemaVersion",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isMemberProjection(value: unknown): value is MemberSearchProjection {
  if (!isRecord(value) || Object.keys(value).some((key) => !projectionFields.has(key))) return false;
  if (
    !isNonEmptyString(value.memberId) ||
    !isNonEmptyString(value.fullName) ||
    !isNonEmptyString(value.paymentStatus) ||
    !paymentStatuses.includes(value.paymentStatus as MemberSearchProjection["paymentStatus"]) ||
    !memberGenders.includes(value.gender as MemberGender) ||
    !membershipStatuses.includes(
      value.membershipStatus as MemberSearchProjection["membershipStatus"],
    ) ||
    !isNonEmptyString(value.createdAt) ||
    !isNonEmptyString(value.updatedAt) ||
    !isNonEmptyString(value.source) ||
    value.schemaVersion !== "1"
  ) {
    return false;
  }

  return [
    "membershipNumber",
    "email",
    "idCardNumber",
    "vatNumber",
    "birthDate",
    "mobileNumber",
    "frequency",
    "trainingCenter",
    "inactiveAt",
  ].every((field) => value[field] === undefined || isNonEmptyString(value[field]));
}

function isMemberSearchResult(value: unknown): value is MemberSearchResult {
  return (
    isRecord(value) &&
    Array.isArray(value.members) &&
    value.members.every(isMemberProjection) &&
    (value.nextPageToken === undefined || isNonEmptyString(value.nextPageToken))
  );
}

function isMemberReportResult(value: unknown): value is MemberReportResult {
  return (
    isRecord(value) &&
    memberReportKeys.includes(value.report as MemberReportKey) &&
    Array.isArray(value.members) &&
    value.members.every(isMemberProjection) &&
    isNonEmptyString(value.generatedAt)
  );
}

function isMemberReportSummary(value: unknown): value is MemberReportSummary {
  return (
    isRecord(value) &&
    Object.keys(value).every((key) => key === "report" || key === "count") &&
    memberReportKeys.includes(value.report as MemberReportKey) &&
    typeof value.count === "number" &&
    Number.isSafeInteger(value.count) &&
    value.count >= 0
  );
}

function isMemberReportPdfResult(value: unknown): value is MemberReportPdfResult {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.downloadUrl) ||
    !isNonEmptyString(value.expiresAt)
  ) {
    return false;
  }
  try {
    const expiresAt = Date.parse(value.expiresAt);
    const now = Date.now();
    return (
      new URL(value.downloadUrl).protocol === "https:" &&
      Number.isFinite(expiresAt) &&
      new Date(expiresAt).toISOString() === value.expiresAt &&
      expiresAt > now &&
      expiresAt <= now + MAX_SIGNED_PDF_URL_AGE_MS
    );
  } catch {
    return false;
  }
}

function isCreateMemberResponse(value: unknown): value is CreateMemberResponse {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    typeof (value as { memberId?: unknown }).memberId === "string" &&
    (value as { memberId: string }).memberId.trim().length > 0
  );
}

function memberPayload(input: CreateMemberInput): CreateMemberInput {
  const payload: Record<string, unknown> = {};

  for (const field of memberInputFields) {
    const value = input[field];
    if (value !== undefined) {
      payload[field] = value;
    }
  }

  return payload as CreateMemberInput;
}

function searchFiltersPayload(filters: MemberSearchFilters): MemberSearchFilters {
  const payload: Record<string, unknown> = {};
  for (const field of memberSearchFilterFields) {
    const value = filters[field];
    if (value !== undefined) payload[field] = value;
  }
  return payload as MemberSearchFilters;
}

export async function createMember(input: CreateMemberInput): Promise<{ memberId: string }> {
  try {
    const callable = httpsCallable<CreateMemberInput, CreateMemberResponse>(
      getFirebaseFunctions(),
      "createMember",
    );
    const result = await callable(memberPayload(input));

    if (!isCreateMemberResponse(result.data)) {
      throw new Error(safeCreateMemberError);
    }

    return { memberId: result.data.memberId };
  } catch {
    throw new Error(safeCreateMemberError);
  }
}

export async function searchMembers(
  filters: MemberSearchFilters,
  pageToken?: string,
): Promise<MemberSearchResult> {
  try {
    const callable = httpsCallable<SearchRequest, unknown>(getFirebaseFunctions(), "searchMembers");
    const safeFilters = searchFiltersPayload(filters);
    const request: SearchRequest =
      pageToken === undefined
        ? { filters: safeFilters }
        : { filters: safeFilters, pageToken };
    const result = await callable(request);
    if (!isMemberSearchResult(result.data)) throw new Error(safeSearchMembersError);
    return result.data;
  } catch {
    throw new Error(safeSearchMembersError);
  }
}

export async function getMemberReport(report: MemberReportKey): Promise<MemberReportResult> {
  try {
    const callable = httpsCallable<{ report: MemberReportKey }, unknown>(
      getFirebaseFunctions(),
      "getMemberReport",
    );
    const result = await callable({ report });
    if (!isMemberReportResult(result.data)) throw new Error(safeMemberReportError);
    return result.data;
  } catch {
    throw new Error(safeMemberReportError);
  }
}

export async function getMemberReportSummary(report: MemberReportKey): Promise<MemberReportSummary> {
  try {
    const callable = httpsCallable<{ report: MemberReportKey }, unknown>(
      getFirebaseFunctions(),
      "getMemberReportSummary",
    );
    const result = await callable({ report });
    if (!isMemberReportSummary(result.data)) throw new Error(safeMemberReportSummaryError);
    return result.data;
  } catch {
    throw new Error(safeMemberReportSummaryError);
  }
}

export async function getMemberReportPdf(report: MemberReportKey): Promise<MemberReportPdfResult> {
  try {
    const callable = httpsCallable<{ report: MemberReportKey }, unknown>(
      getFirebaseFunctions(),
      "getMemberReportPdf",
    );
    const result = await callable({ report });
    if (!isMemberReportPdfResult(result.data)) throw new Error(safeMemberReportPdfError);
    return result.data;
  } catch {
    throw new Error(safeMemberReportPdfError);
  }
}
