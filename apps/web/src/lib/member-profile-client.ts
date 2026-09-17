import { httpsCallable } from "firebase/functions";

import {
  memberNameSearchResultSchema,
  memberProfileSchema,
  updateMemberDetailsInputSchema,
  type MemberNameSearchResult,
  type MemberProfile,
  type UpdateMemberDetailsInput,
} from "@bpt-jersey/domain/members/profile";

import { getFirebaseFunctions } from "./firebase-client";

/**
 * T051V2: the canonical member record. Every response is parsed against the role-trimmed schema, and
 * every failure becomes one fixed sentence: no backend message, identifier or value reaches the page.
 */
export const memberRecordIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

export function isMemberRecordId(value: string | null): value is string {
  return value !== null && memberRecordIdPattern.test(value);
}

const invalidLinkError = "This member record link is not valid.";
const notFoundError = "This member record was not found.";
const deniedError = "You do not have access to this member record.";
const rateLimitedError =
  "Too many member records opened in a few minutes. Wait a moment and try again.";
const loadError = "Unable to load this member record. Please try again.";
const conflictError = "That member number is already used by another member.";
const saveError = "Unable to save member details. Please try again.";
// The per-actor budget is shared by every member-record caller, so the office will meet it: the
// sentence has to say that waiting is the fix, not that something unknown went wrong.
const saveRateLimitedError =
  "Too many member changes in a few minutes. Wait a moment and try again.";
const searchError = "Unable to search members. Please try again.";

export class MemberRecordLoadError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "MemberRecordLoadError";
  }
}

/** A save failure whose message is already safe to show, so the form can surface it as it is. */
export class MemberDetailsSaveError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "MemberDetailsSaveError";
  }
}

export class MemberDetailsConflictError extends Error {
  public constructor() {
    super(conflictError);
    this.name = "MemberDetailsConflictError";
  }
}

function errorCode(error: unknown): string {
  return typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof (error as { code: unknown }).code === "string"
    ? (error as { code: string }).code
    : "";
}

export async function getMemberProfile(studentId: string): Promise<MemberProfile> {
  if (!isMemberRecordId(studentId)) throw new MemberRecordLoadError(invalidLinkError);
  let data: unknown;
  try {
    const callable = httpsCallable<Readonly<{ studentId: string }>, unknown>(
      getFirebaseFunctions(),
      "getMemberProfile",
    );
    data = (await callable({ studentId })).data;
  } catch (error) {
    const code = errorCode(error);
    if (code.endsWith("not-found")) throw new MemberRecordLoadError(notFoundError);
    if (code.endsWith("permission-denied")) throw new MemberRecordLoadError(deniedError);
    if (code.endsWith("resource-exhausted")) throw new MemberRecordLoadError(rateLimitedError);
    throw new MemberRecordLoadError(loadError);
  }
  const parsed = memberProfileSchema.safeParse(data);
  if (!parsed.success || parsed.data.header.studentId !== studentId) {
    throw new MemberRecordLoadError(loadError);
  }
  return parsed.data;
}

export async function saveMemberDetails(input: UpdateMemberDetailsInput): Promise<void> {
  const parsed = updateMemberDetailsInputSchema.safeParse(input);
  if (!parsed.success) throw new MemberDetailsSaveError(saveError);
  let data: unknown;
  try {
    const callable = httpsCallable<UpdateMemberDetailsInput, unknown>(
      getFirebaseFunctions(),
      "updateMember",
    );
    data = (await callable(parsed.data)).data;
  } catch (error) {
    const code = errorCode(error);
    if (code.endsWith("already-exists")) throw new MemberDetailsConflictError();
    if (code.endsWith("resource-exhausted")) throw new MemberDetailsSaveError(saveRateLimitedError);
    throw new MemberDetailsSaveError(saveError);
  }
  if (
    typeof data !== "object" ||
    data === null ||
    (data as { studentId?: unknown }).studentId !== parsed.data.studentId
  ) {
    throw new MemberDetailsSaveError(saveError);
  }
}

export async function searchMemberNames(query: string): Promise<MemberNameSearchResult["members"]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];
  try {
    const callable = httpsCallable<Readonly<{ query: string }>, unknown>(
      getFirebaseFunctions(),
      "searchMemberNames",
    );
    const parsed = memberNameSearchResultSchema.safeParse(
      (await callable({ query: trimmed.slice(0, 80) })).data,
    );
    if (!parsed.success) throw new Error(searchError);
    return parsed.data.members;
  } catch {
    throw new Error(searchError);
  }
}
