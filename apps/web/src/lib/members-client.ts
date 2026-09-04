import { httpsCallable } from "firebase/functions";

import {
  adminCreateStudentInputSchema,
  adminUpdateStudentInputSchema,
  adminDirectoryRowSchema,
  memberRecordMaintenanceDetailSchema,
  type AdminCreateStudentInput,
  type AdminDirectoryRow,
  type AdminUpdateStudentInput,
  type MemberRecordMaintenanceDetail,
  type PublicAdminIdentifierLookupKind,
} from "@bpt-jersey/domain/members/directory";

import {
  regyfitMemberDirectoryPageSchema,
  regyfitMemberRecordSchema,
  type RegyfitMemberDirectoryPage,
  type RegyfitMemberRecord,
} from "@bpt-jersey/domain/members/regyfit-records";

import { getFirebaseFunctions } from "./firebase-client";

export type CreateMemberInput = AdminCreateStudentInput;
export type UpdateMemberInput = AdminUpdateStudentInput;
export type MemberDirectoryPage = Readonly<{
  rows: readonly AdminDirectoryRow[];
  nextCursor?: string;
}>;
export type MemberIdentityLookupResult =
  | Readonly<{ matched: false }>
  | Readonly<{ matched: true; row: AdminDirectoryRow }>;

const safeCreateError = "Unable to create member. Please try again.";
const safeUpdateError = "Unable to update member. Please try again.";
const safeListError = "Unable to load members. Please try again.";
const safeDetailError = "Unable to load member details. Please try again.";
const safeLookupError = "Unable to find member. Please try again.";
const safeRegyfitListError = "Unable to load the academy directory. Please try again.";
const safeRegyfitRecordError = "Unable to load the member record. Please try again.";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function parseCreateResponse(value: unknown): Readonly<{
  memberId: string;
  studentId: string;
}> {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["memberId", "studentId"]) ||
    typeof value.memberId !== "string" ||
    typeof value.studentId !== "string" ||
    value.memberId.length === 0 ||
    value.memberId !== value.studentId
  ) {
    throw new Error(safeCreateError);
  }
  return Object.freeze({ memberId: value.memberId, studentId: value.studentId });
}

function parseDirectoryPage(value: unknown): MemberDirectoryPage {
  if (
    !isRecord(value) ||
    !hasExactKeys(
      value,
      value.nextCursor === undefined ? ["rows"] : ["rows", "nextCursor"],
    ) ||
    !Array.isArray(value.rows) ||
    (value.nextCursor !== undefined &&
      (typeof value.nextCursor !== "string" || value.nextCursor.length === 0))
  ) {
    throw new Error(safeListError);
  }
  const rows = value.rows.map((row) => {
    const parsed = adminDirectoryRowSchema.safeParse(row);
    if (!parsed.success) throw new Error(safeListError);
    return Object.freeze(parsed.data);
  });
  return Object.freeze({
    rows: Object.freeze(rows),
    ...(value.nextCursor === undefined ? {} : { nextCursor: value.nextCursor }),
  });
}

function parseLookupResult(value: unknown): MemberIdentityLookupResult {
  if (!isRecord(value) || typeof value.matched !== "boolean") {
    throw new Error(safeLookupError);
  }
  if (!value.matched) {
    if (!hasExactKeys(value, ["matched"])) throw new Error(safeLookupError);
    return Object.freeze({ matched: false });
  }
  if (!hasExactKeys(value, ["matched", "row"])) throw new Error(safeLookupError);
  const row = adminDirectoryRowSchema.safeParse(value.row);
  if (!row.success) throw new Error(safeLookupError);
  return Object.freeze({ matched: true, row: Object.freeze(row.data) });
}

export async function createMember(
  input: CreateMemberInput,
): Promise<Readonly<{ memberId: string; studentId: string }>> {
  try {
    const parsed = adminCreateStudentInputSchema.safeParse(input);
    if (!parsed.success) throw new Error(safeCreateError);
    const callable = httpsCallable<CreateMemberInput, unknown>(
      getFirebaseFunctions(),
      "createMember",
    );
    const result = await callable(parsed.data);
    return parseCreateResponse(result.data);
  } catch {
    throw new Error(safeCreateError);
  }
}

export async function updateMember(
  input: UpdateMemberInput,
): Promise<Readonly<{ memberId: string; studentId: string }>> {
  try {
    const parsed = adminUpdateStudentInputSchema.safeParse(input);
    if (!parsed.success) throw new Error(safeUpdateError);
    const callable = httpsCallable<UpdateMemberInput, unknown>(
      getFirebaseFunctions(),
      "updateMember",
    );
    const result = await callable(parsed.data);
    const response = parseCreateResponse(result.data);
    if (response.studentId !== parsed.data.studentId) throw new Error(safeUpdateError);
    return response;
  } catch {
    throw new Error(safeUpdateError);
  }
}

export async function listMembers(
  pageSize = 50,
  cursor?: string,
): Promise<MemberDirectoryPage> {
  try {
    if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 50) {
      throw new Error(safeListError);
    }
    const callable = httpsCallable<
      Readonly<{ pageSize: number; cursor?: string }>,
      unknown
    >(getFirebaseFunctions(), "listMembers");
    const result = await callable({
      pageSize,
      ...(cursor === undefined ? {} : { cursor }),
    });
    return parseDirectoryPage(result.data);
  } catch {
    throw new Error(safeListError);
  }
}

export async function getMemberDetail(
  studentId: string,
): Promise<MemberRecordMaintenanceDetail> {
  try {
    const callable = httpsCallable<
      Readonly<{
        studentId: string;
        purpose: "member-record-maintenance";
      }>,
      unknown
    >(getFirebaseFunctions(), "getMemberDetail");
    const result = await callable({
      studentId,
      purpose: "member-record-maintenance",
    });
    const parsed = memberRecordMaintenanceDetailSchema.safeParse(result.data);
    if (!parsed.success) throw new Error(safeDetailError);
    return Object.freeze(parsed.data);
  } catch {
    throw new Error(safeDetailError);
  }
}

export async function listRegyfitMemberRecords(): Promise<RegyfitMemberDirectoryPage> {
  try {
    const callable = httpsCallable<Readonly<Record<string, never>>, unknown>(
      getFirebaseFunctions(),
      "listRegyfitMemberRecords",
    );
    const result = await callable({});
    const parsed = regyfitMemberDirectoryPageSchema.safeParse(result.data);
    if (!parsed.success) throw new Error(safeRegyfitListError);
    return Object.freeze(parsed.data);
  } catch {
    throw new Error(safeRegyfitListError);
  }
}

export async function getRegyfitMemberRecord(recordId: string): Promise<RegyfitMemberRecord> {
  try {
    const callable = httpsCallable<Readonly<{ recordId: string }>, unknown>(
      getFirebaseFunctions(),
      "getRegyfitMemberRecord",
    );
    const result = await callable({ recordId });
    const parsed = regyfitMemberRecordSchema.safeParse(result.data);
    if (!parsed.success) throw new Error(safeRegyfitRecordError);
    return Object.freeze(parsed.data);
  } catch {
    throw new Error(safeRegyfitRecordError);
  }
}

export async function lookupMemberIdentity(
  lookupKind: PublicAdminIdentifierLookupKind,
  value: string,
): Promise<MemberIdentityLookupResult> {
  try {
    const callable = httpsCallable<
      Readonly<{
        lookupKind: PublicAdminIdentifierLookupKind;
        value: string;
        purpose: "member-identity-lookup";
      }>,
      unknown
    >(getFirebaseFunctions(), "lookupMemberIdentity");
    const result = await callable({
      lookupKind,
      value,
      purpose: "member-identity-lookup",
    });
    return parseLookupResult(result.data);
  } catch {
    throw new Error(safeLookupError);
  }
}

