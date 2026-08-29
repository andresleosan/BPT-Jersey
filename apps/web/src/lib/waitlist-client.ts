import { httpsCallable } from "firebase/functions";

import { getFirebaseFunctions } from "./firebase-client";

export const clientWaitlistStatuses = [
  "waiting",
  "offered",
  "accepted",
  "expired",
  "cancelled",
] as const;

export type ClientWaitlistStatus = (typeof clientWaitlistStatuses)[number];

export type ClientWaitlistItem = Readonly<{
  sessionId: string;
  position: number;
  status: ClientWaitlistStatus;
  requestedAt: string;
  cancelledAt: string | null;
}>;

export type ClientMembership = Readonly<{
  membershipId: string;
  familyId: string;
  studentId: string;
  planId: string;
  status: "trial" | "active" | "paused" | "overdue" | "cancelled";
  startsAt: string;
  endsAt: string | null;
  nextBillingAt: string | null;
}>;

export type JoinClientWaitlistInput = Readonly<{
  sessionId: string;
  studentId: string;
  membershipId: string;
}>;

export type CancelClientWaitlistInput = Readonly<{
  sessionId: string;
  studentId: string;
}>;

const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const dateTimePattern =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(?:Z|[+-]\d{2}:?\d{2})$/u;
const membershipStatuses = ["trial", "active", "paused", "overdue", "cancelled"] as const;
const loadError = "Unable to load your waitlist. Please try again.";
const membershipError = "Unable to load eligible memberships. Please try again.";
const mutationError = "Unable to update your waitlist. Please try again.";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactFields(value: Record<string, unknown>, fields: readonly string[]): boolean {
  const keys = Reflect.ownKeys(value);
  return (
    keys.length === fields.length &&
    keys.every((key) => typeof key === "string" && fields.includes(key))
  );
}

function isIdentifier(value: unknown): value is string {
  return typeof value === "string" && identifierPattern.test(value);
}

function isDateTime(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = dateTimePattern.exec(value);
  if (!match) return false;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const daysInMonth = month >= 1 && month <= 12 ? new Date(Date.UTC(year, month, 0)).getUTCDate() : 0;
  return (
    day >= 1 &&
    day <= daysInMonth &&
    hour <= 23 &&
    minute <= 59 &&
    second <= 59 &&
    !Number.isNaN(Date.parse(value))
  );
}

function isNullableDateTime(value: unknown): value is string | null {
  return value === null || isDateTime(value);
}

function requireIdentifier(value: string): string {
  if (!isIdentifier(value)) throw new Error(mutationError);
  return value;
}

function parseWaitlistItem(value: unknown): ClientWaitlistItem {
  if (
    !isRecord(value) ||
    !hasExactFields(value, [
      "sessionId",
      "position",
      "status",
      "requestedAt",
      "cancelledAt",
    ]) ||
    !isIdentifier(value.sessionId) ||
    typeof value.position !== "number" ||
    !Number.isInteger(value.position) ||
    value.position < 1 ||
    value.position > 10000 ||
    !clientWaitlistStatuses.includes(value.status as ClientWaitlistStatus) ||
    !isDateTime(value.requestedAt) ||
    !isNullableDateTime(value.cancelledAt)
  ) {
    throw new Error(loadError);
  }

  return Object.freeze({
    sessionId: value.sessionId,
    position: value.position,
    status: value.status as ClientWaitlistStatus,
    requestedAt: value.requestedAt,
    cancelledAt: value.cancelledAt,
  });
}

function parseEntryResponse(value: unknown): ClientWaitlistItem {
  if (!isRecord(value) || !hasExactFields(value, ["entry"])) throw new Error(mutationError);
  try {
    return parseWaitlistItem(value.entry);
  } catch {
    throw new Error(mutationError);
  }
}

function parseEntriesResponse(value: unknown): readonly ClientWaitlistItem[] {
  if (!isRecord(value) || !hasExactFields(value, ["entries"]) || !Array.isArray(value.entries)) {
    throw new Error(loadError);
  }
  return Object.freeze(value.entries.map(parseWaitlistItem));
}

function parseMembership(value: unknown): ClientMembership {
  if (
    !isRecord(value) ||
    !hasExactFields(value, [
      "membershipId",
      "familyId",
      "studentId",
      "planId",
      "status",
      "startsAt",
      "endsAt",
      "nextBillingAt",
    ]) ||
    !isIdentifier(value.membershipId) ||
    !isIdentifier(value.familyId) ||
    !isIdentifier(value.studentId) ||
    !isIdentifier(value.planId) ||
    !membershipStatuses.includes(value.status as ClientMembership["status"]) ||
    !isDateTime(value.startsAt) ||
    !isNullableDateTime(value.endsAt) ||
    !isNullableDateTime(value.nextBillingAt)
  ) {
    throw new Error(membershipError);
  }

  return Object.freeze({
    membershipId: value.membershipId,
    familyId: value.familyId,
    studentId: value.studentId,
    planId: value.planId,
    status: value.status as ClientMembership["status"],
    startsAt: value.startsAt,
    endsAt: value.endsAt,
    nextBillingAt: value.nextBillingAt,
  });
}

function errorCode(error: unknown): string | undefined {
  if (!isRecord(error) || typeof error.code !== "string") return undefined;
  return error.code;
}

function safeMutationMessage(error: unknown): string {
  switch (errorCode(error)) {
    case "functions/failed-precondition":
      return "This session is not open for waitlisting. It may still have a space, have started, or already be on your list.";
    case "functions/not-found":
      return "This session or membership is no longer available.";
    case "functions/permission-denied":
    case "functions/unauthenticated":
      return "You do not have access to manage this participant's waitlist.";
    default:
      return mutationError;
  }
}

export async function listClientMemberships(): Promise<readonly ClientMembership[]> {
  try {
    const callable = httpsCallable<null, unknown>(getFirebaseFunctions(), "listMemberships");
    const result = await callable(null);
    if (!Array.isArray(result.data)) throw new Error(membershipError);
    return Object.freeze(result.data.map(parseMembership));
  } catch {
    throw new Error(membershipError);
  }
}

export async function listStudentWaitlist(
  studentId: string,
): Promise<readonly ClientWaitlistItem[]> {
  try {
    const callable = httpsCallable<{ studentId: string }, unknown>(
      getFirebaseFunctions(),
      "listStudentWaitlist",
    );
    const result = await callable({ studentId: requireIdentifier(studentId) });
    return parseEntriesResponse(result.data);
  } catch {
    throw new Error(loadError);
  }
}

export async function joinClientWaitlist(
  input: JoinClientWaitlistInput,
): Promise<ClientWaitlistItem> {
  try {
    const callable = httpsCallable<JoinClientWaitlistInput, unknown>(
      getFirebaseFunctions(),
      "joinWaitlist",
    );
    const result = await callable({
      sessionId: requireIdentifier(input.sessionId),
      studentId: requireIdentifier(input.studentId),
      membershipId: requireIdentifier(input.membershipId),
    });
    return parseEntryResponse(result.data);
  } catch (error) {
    throw new Error(safeMutationMessage(error));
  }
}

export async function cancelClientWaitlist(
  input: CancelClientWaitlistInput,
): Promise<ClientWaitlistItem> {
  try {
    const callable = httpsCallable<CancelClientWaitlistInput, unknown>(
      getFirebaseFunctions(),
      "cancelWaitlistEntry",
    );
    const result = await callable({
      sessionId: requireIdentifier(input.sessionId),
      studentId: requireIdentifier(input.studentId),
    });
    return parseEntryResponse(result.data);
  } catch (error) {
    throw new Error(safeMutationMessage(error));
  }
}