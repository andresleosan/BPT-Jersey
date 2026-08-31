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
  offeredAt: string | null;
  offerExpiresAt: string | null;
  acceptedAt: string | null;
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

export type ClientWaitlistOfferInput = CancelClientWaitlistInput;

const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const dateTimePattern =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(?:Z|[+-]\d{2}:?\d{2})$/u;
const membershipStatuses = ["trial", "active", "paused", "overdue", "cancelled"] as const;
const loadError = "Unable to load your waitlist. Please try again.";
const membershipError = "Unable to load eligible memberships. Please try again.";
const mutationError = "Unable to update your waitlist. Please try again.";

function isRecord(value: unknown): value is Record<string, unknown> {
  try {
    return (
      typeof value === "object" &&
      value !== null &&
      !Array.isArray(value) &&
      Object.getPrototypeOf(value) === Object.prototype
    );
  } catch {
    return false;
  }
}

function hasExactFields(value: Record<string, unknown>, fields: readonly string[]): boolean {
  try {
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
  } catch {
    return false;
  }
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

function toEpochNanoseconds(value: string): bigint {
  const fraction = /\.(\d{1,9})(?=Z|[+-]\d{2}:?\d{2}$)/u.exec(value)?.[1] ?? "";
  const milliseconds = fraction.length === 0 ? 0 : Number(fraction.padEnd(3, "0").slice(0, 3));
  const nanoseconds = fraction.length === 0 ? 0 : Number(fraction.padEnd(9, "0"));
  return BigInt(Date.parse(value) - milliseconds) * BigInt(1_000_000) + BigInt(nanoseconds);
}

function compareDateTimes(left: string, right: string): number {
  const leftNanoseconds = toEpochNanoseconds(left);
  const rightNanoseconds = toEpochNanoseconds(right);
  return leftNanoseconds < rightNanoseconds ? -1 : leftNanoseconds > rightNanoseconds ? 1 : 0;
}

function requireIdentifier(value: string): string {
  if (!isIdentifier(value)) throw new Error(mutationError);
  return value;
}

function hasValidStatusTimestamps(
  status: ClientWaitlistStatus,
  requestedAt: string,
  offeredAt: string | null,
  offerExpiresAt: string | null,
  acceptedAt: string | null,
  cancelledAt: string | null,
): boolean {
  const hasOfferWindow = offeredAt !== null && offerExpiresAt !== null;
  if ((offeredAt === null) !== (offerExpiresAt === null)) return false;
  if (
    hasOfferWindow &&
    (compareDateTimes(requestedAt, offeredAt) > 0 ||
      compareDateTimes(offeredAt, offerExpiresAt) >= 0)
  )
    return false;
  if (status === "waiting") {
    return (
      offeredAt === null &&
      offerExpiresAt === null &&
      acceptedAt === null &&
      cancelledAt === null
    );
  }
  if (status === "offered") {
    return (
      offeredAt !== null &&
      offerExpiresAt !== null &&
      acceptedAt === null &&
      cancelledAt === null
    );
  }
  if (status === "accepted") {
    return (
      hasOfferWindow &&
      acceptedAt !== null &&
      cancelledAt === null &&
      compareDateTimes(offeredAt, acceptedAt) <= 0 &&
      compareDateTimes(acceptedAt, offerExpiresAt) < 0
    );
  }
  if (status === "expired") {
    return (
      offeredAt !== null &&
      offerExpiresAt !== null &&
      acceptedAt === null &&
      cancelledAt === null
    );
  }
  if (status !== "cancelled" || acceptedAt !== null || cancelledAt === null) return false;
  return hasOfferWindow
    ? compareDateTimes(offeredAt, cancelledAt) <= 0 &&
        compareDateTimes(cancelledAt, offerExpiresAt) < 0
    : compareDateTimes(requestedAt, cancelledAt) <= 0;
}

export function parseClientWaitlistItem(value: unknown): ClientWaitlistItem {
  if (
    !isRecord(value) ||
    !hasExactFields(value, [
      "sessionId",
      "position",
      "status",
      "requestedAt",
      "offeredAt",
      "offerExpiresAt",
      "acceptedAt",
      "cancelledAt",
    ]) ||
    !isIdentifier(value.sessionId) ||
    typeof value.position !== "number" ||
    !Number.isInteger(value.position) ||
    value.position < 1 ||
    value.position > 10000 ||
    !clientWaitlistStatuses.includes(value.status as ClientWaitlistStatus) ||
    !isDateTime(value.requestedAt) ||
    !isNullableDateTime(value.offeredAt) ||
    !isNullableDateTime(value.offerExpiresAt) ||
    !isNullableDateTime(value.acceptedAt) ||
    !isNullableDateTime(value.cancelledAt)
  ) {
    throw new Error(loadError);
  }

  const status = value.status as ClientWaitlistStatus;
  const offeredAt = value.offeredAt as string | null;
  const offerExpiresAt = value.offerExpiresAt as string | null;
  const acceptedAt = value.acceptedAt as string | null;
  const cancelledAt = value.cancelledAt as string | null;
  if (
    !hasValidStatusTimestamps(
      status,
      value.requestedAt,
      offeredAt,
      offerExpiresAt,
      acceptedAt,
      cancelledAt,
    )
  ) {
    throw new Error(loadError);
  }

  return Object.freeze({
    sessionId: value.sessionId,
    position: value.position,
    status,
    requestedAt: value.requestedAt,
    offeredAt,
    offerExpiresAt,
    acceptedAt,
    cancelledAt,
  });
}

function parseEntryResponse(value: unknown): ClientWaitlistItem {
  if (!isRecord(value) || !hasExactFields(value, ["entry"])) throw new Error(mutationError);
  try {
    return parseClientWaitlistItem(value.entry);
  } catch {
    throw new Error(mutationError);
  }
}

function parseEntriesResponse(value: unknown): readonly ClientWaitlistItem[] {
  if (!isRecord(value) || !hasExactFields(value, ["entries"]) || !Array.isArray(value.entries)) {
    throw new Error(loadError);
  }
  return Object.freeze(value.entries.map(parseClientWaitlistItem));
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
  if (typeof error !== "object" || error === null) return undefined;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(error, "code");
    return descriptor !== undefined &&
      descriptor.get === undefined &&
      descriptor.set === undefined &&
      typeof descriptor.value === "string"
      ? descriptor.value
      : undefined;
  } catch {
    return undefined;
  }
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

function safeOfferMutationMessage(error: unknown): string {
  switch (errorCode(error)) {
    case "functions/failed-precondition":
      return "This offer is no longer available. Refresh your waitlist and try again.";
    case "functions/not-found":
      return "This class or waitlist request is no longer available.";
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

async function mutateClientWaitlistOffer(
  callableName: "acceptWaitlistOffer" | "declineWaitlistOffer",
  input: ClientWaitlistOfferInput,
): Promise<ClientWaitlistItem> {
  try {
    const callable = httpsCallable<ClientWaitlistOfferInput, unknown>(
      getFirebaseFunctions(),
      callableName,
    );
    const result = await callable({
      sessionId: requireIdentifier(input.sessionId),
      studentId: requireIdentifier(input.studentId),
    });
    return parseEntryResponse(result.data);
  } catch (error) {
    throw new Error(safeOfferMutationMessage(error));
  }
}

export async function acceptClientWaitlistOffer(
  input: ClientWaitlistOfferInput,
): Promise<ClientWaitlistItem> {
  return mutateClientWaitlistOffer("acceptWaitlistOffer", input);
}

export async function declineClientWaitlistOffer(
  input: ClientWaitlistOfferInput,
): Promise<ClientWaitlistItem> {
  return mutateClientWaitlistOffer("declineWaitlistOffer", input);
}
