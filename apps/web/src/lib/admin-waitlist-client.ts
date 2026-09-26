import { httpsCallable as firebaseHttpsCallable } from "./callable";

import { getFirebaseFunctions } from "./firebase-client";
import {
  parseClientWaitlistItem,
  type ClientWaitlistItem,
} from "./waitlist-client";
import { scheduleCallableClientOptions } from "./schedule-client";

function httpsCallable<RequestData, ResponseData>(
  functions: ReturnType<typeof getFirebaseFunctions>,
  name: string,
) {
  return firebaseHttpsCallable<RequestData, ResponseData>(
    functions,
    name,
    scheduleCallableClientOptions,
  );
}

export type AdminWaitlistItem = ClientWaitlistItem &
  Readonly<{
    studentReference: string;
  }>;

const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const loadError = "Unable to load this class waitlist. Please try again.";
const groupsError = "Unable to load class waitlists. Please try again.";
const mutationError = "Unable to offer the next place. Please try again.";

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

function requireIdentifier(value: string, message: string): string {
  if (!isIdentifier(value)) throw new Error(message);
  return value;
}

function parseAdminWaitlistItem(value: unknown): AdminWaitlistItem {
  if (
    !isRecord(value) ||
    !hasExactFields(value, [
      "sessionId",
      "studentReference",
      "position",
      "status",
      "requestedAt",
      "offeredAt",
      "offerExpiresAt",
      "acceptedAt",
      "cancelledAt",
    ]) ||
    !isIdentifier(value.studentReference)
  ) {
    throw new Error(loadError);
  }
  const studentReference = value.studentReference;
  const studentItem = {
    sessionId: value.sessionId,
    position: value.position,
    status: value.status,
    requestedAt: value.requestedAt,
    offeredAt: value.offeredAt,
    offerExpiresAt: value.offerExpiresAt,
    acceptedAt: value.acceptedAt,
    cancelledAt: value.cancelledAt,
  };
  try {
    return Object.freeze({
      ...parseClientWaitlistItem(studentItem),
      studentReference,
    });
  } catch {
    throw new Error(loadError);
  }
}

function parseEntriesResponse(value: unknown): readonly AdminWaitlistItem[] {
  if (!isRecord(value) || !hasExactFields(value, ["entries"]) || !Array.isArray(value.entries)) {
    throw new Error(loadError);
  }
  return Object.freeze(value.entries.map(parseAdminWaitlistItem));
}

function parseEntryResponse(value: unknown): AdminWaitlistItem {
  if (!isRecord(value) || !hasExactFields(value, ["entry"])) throw new Error(mutationError);
  try {
    return parseAdminWaitlistItem(value.entry);
  } catch {
    throw new Error(mutationError);
  }
}

export type AdminWaitlistGroup = Readonly<{
  groupId: string;
  title: string;
  location: string;
  count: number;
  sessions: readonly Readonly<{
    sessionId: string;
    startAt: string;
    entries: readonly AdminWaitlistItem[];
  }>[];
}>;

const groupIdPattern = /^(?:session:)?[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

function isText(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 200;
}

function parseGroupSession(value: unknown): AdminWaitlistGroup["sessions"][number] {
  if (
    !isRecord(value) ||
    !hasExactFields(value, ["sessionId", "startAt", "entries"]) ||
    !isIdentifier(value.sessionId) ||
    typeof value.startAt !== "string" ||
    Number.isNaN(Date.parse(value.startAt)) ||
    !Array.isArray(value.entries)
  ) {
    throw new Error(groupsError);
  }
  return Object.freeze({
    sessionId: value.sessionId,
    startAt: value.startAt,
    entries: Object.freeze(value.entries.map(parseAdminWaitlistItem)),
  });
}

function parseGroup(value: unknown): AdminWaitlistGroup {
  if (
    !isRecord(value) ||
    !hasExactFields(value, ["groupId", "title", "location", "count", "sessions"]) ||
    typeof value.groupId !== "string" ||
    !groupIdPattern.test(value.groupId) ||
    !isText(value.title) ||
    !isText(value.location) ||
    !Number.isSafeInteger(value.count) ||
    (value.count as number) < 0 ||
    !Array.isArray(value.sessions) ||
    value.sessions.length === 0
  ) {
    throw new Error(groupsError);
  }
  return Object.freeze({
    groupId: value.groupId,
    title: value.title,
    location: value.location,
    count: value.count as number,
    sessions: Object.freeze(value.sessions.map(parseGroupSession)),
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
      return "No eligible participant can be offered this place right now.";
    case "functions/not-found":
      return "This class is no longer available.";
    case "functions/permission-denied":
    case "functions/unauthenticated":
      return "You do not have access to manage class waitlists.";
    default:
      return mutationError;
  }
}

export async function listAdminSessionWaitlist(
  sessionId: string,
): Promise<readonly AdminWaitlistItem[]> {
  try {
    const callable = httpsCallable<{ sessionId: string }, unknown>(
      getFirebaseFunctions(),
      "listSessionWaitlist",
    );
    const result = await callable({ sessionId: requireIdentifier(sessionId, loadError) });
    return parseEntriesResponse(result.data);
  } catch {
    throw new Error(loadError);
  }
}

export async function issueNextAdminWaitlistOffer(
  sessionId: string,
): Promise<AdminWaitlistItem> {
  try {
    const callable = httpsCallable<{ sessionId: string }, unknown>(
      getFirebaseFunctions(),
      "issueNextWaitlistOffer",
    );
    const result = await callable({ sessionId: requireIdentifier(sessionId, mutationError) });
    return parseEntryResponse(result.data);
  } catch (error) {
    throw new Error(safeMutationMessage(error));
  }
}

/** `truncated`: the server hit a read cap, so some queues in the window are not listed. */
export type AdminWaitlistGroups = Readonly<{
  groups: readonly AdminWaitlistGroup[];
  truncated: boolean;
}>;

export async function listAdminWaitlistGroups(): Promise<AdminWaitlistGroups> {
  try {
    const callable = httpsCallable<Record<string, never>, unknown>(
      getFirebaseFunctions(),
      "listAdminWaitlistGroups",
    );
    const result = await callable({});
    const data: unknown = result.data;
    if (
      !isRecord(data) ||
      // A server without the read cap flag answers `groups` only.
      !(hasExactFields(data, ["groups"]) || hasExactFields(data, ["groups", "truncated"])) ||
      !Array.isArray(data.groups) ||
      (data.truncated !== undefined && typeof data.truncated !== "boolean")
    ) {
      throw new Error(groupsError);
    }
    return Object.freeze({
      groups: Object.freeze(data.groups.map(parseGroup)),
      truncated: data.truncated === true,
    });
  } catch {
    throw new Error(groupsError);
  }
}
