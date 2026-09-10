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

/**
 * Names the two directory failures a reviewer can actually act on, instead of collapsing every
 * cause into one sentence.
 *
 * This exists because of the day it cost: with the canonical directory never initialized, every
 * read answered `failed-precondition` and the page said only "please try again", so the real cause
 * lived in the browser console and nowhere else. A message that cannot be acted on is not safer
 * than a specific one - it just moves the diagnosis somewhere nobody looks.
 */
/**
 * Its own type, because this is the one directory failure with a remedy attached: an owner can fix
 * it from the page. Everything else is a message; this one is a button.
 */
export class MemberDirectoryUninitializedError extends Error {
  constructor() {
    super(
      "The member directory of this academy has not been initialized, so no member can be read " +
        "or enrolled. An owner has to initialize it once before this page can work.",
    );
    this.name = "MemberDirectoryUninitializedError";
  }
}

/**
 * The 403 the enrolment queue already learned to name, said here too: a claim without the staff
 * document the canonical directory insists on.
 */
export class MemberDirectoryNotProvisionedError extends Error {
  constructor() {
    super(
      "Your administrator account is not fully provisioned for the member directory. Ask an owner " +
        "to grant your administrative role again.",
    );
    this.name = "MemberDirectoryNotProvisionedError";
  }
}

function directoryFailure(error: unknown, fallback: string): Error {
  const code = isRecord(error) && typeof error.code === "string" ? error.code : "";
  if (code.endsWith("failed-precondition")) {
    return new MemberDirectoryUninitializedError();
  }
  if (code.endsWith("permission-denied")) {
    return new MemberDirectoryNotProvisionedError();
  }
  return new Error(fallback);
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
  } catch (error) {
    throw directoryFailure(error, safeListError);
  }
}

export type CanonicalDirectoryInitializationOutcome = Readonly<{
  academyId: string;
  alreadyInitialized: boolean;
}>;

const safeInitializeError = "Unable to initialize the member directory. Please try again.";

/**
 * Initializes this academy's canonical member directory. Owner only, and takes no arguments: the
 * academy comes from the verified claim, never from here.
 *
 * Running it twice is safe and reports `alreadyInitialized` rather than failing.
 */
export async function initializeMemberDirectory(): Promise<CanonicalDirectoryInitializationOutcome> {
  try {
    const callable = httpsCallable<Record<string, never>, unknown>(
      getFirebaseFunctions(),
      "initializeCanonicalMemberDirectory",
    );
    const result = await callable({});
    if (
      !isRecord(result.data) ||
      !hasExactKeys(result.data, ["academyId", "alreadyInitialized"]) ||
      typeof result.data.academyId !== "string" ||
      typeof result.data.alreadyInitialized !== "boolean"
    ) {
      throw new Error(safeInitializeError);
    }
    return Object.freeze({
      academyId: result.data.academyId,
      alreadyInitialized: result.data.alreadyInitialized,
    });
  } catch (error) {
    // `failed-precondition` here means the academy is not empty, and the server's message names the
    // collections that stopped it. That detail is the whole answer, so it is passed through: a
    // directory with members in it needs a migration, not an initialization.
    const code = isRecord(error) && typeof error.code === "string" ? error.code : "";
    if (code.endsWith("failed-precondition") && error instanceof Error) {
      throw new Error(error.message);
    }
    if (code.endsWith("permission-denied")) {
      throw new Error("Only an owner can initialize the member directory.");
    }
    throw new Error(safeInitializeError);
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

