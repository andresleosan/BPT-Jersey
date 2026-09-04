import { getFirestore } from "firebase-admin/firestore";
import { HttpsError, onCall, type CallableRequest } from "firebase-functions/v2/https";

import {
  parseIssueNextWaitlistOfferInput,
  parseJoinWaitlistInput,
  parseRespondToWaitlistOfferInput,
  type WaitlistEntryRecord,
} from "@bpt-jersey/domain/schedule/advanced-booking";
import { requireUserActor } from "../auth/user-authorization.js";
import {
  createFirestoreWaitlistStore,
  WaitlistStoreError,
  type WaitlistStore,
} from "./advanced-booking-service.js";
import {
  createFirestoreCanonicalClientStudentScopeResolver,
  type CanonicalClientStudentScopeResolver,
} from "./canonical-client-student-scope.js";
import { scheduleCallableOptions } from "./schedule-callable-options.js";

const staffRoles = new Set(["owner", "administrator", "headCoach", "coach"]);
const offerIssuerRoles = new Set(["owner", "administrator"]);
const idPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

export type StudentWaitlistItem = Readonly<{
  sessionId: string;
  position: number;
  status: WaitlistEntryRecord["status"];
  requestedAt: string;
  offeredAt: string | null;
  offerExpiresAt: string | null;
  acceptedAt: string | null;
  cancelledAt: string | null;
}>;

export type StaffWaitlistItem = StudentWaitlistItem & Readonly<{ studentReference: string }>;

type ScopeOptions = Readonly<{
  waitlistStore: WaitlistStore;
  resolveClientStudentScope?: CanonicalClientStudentScopeResolver;
}>;

const defaultClientStudentScopeResolver = createFirestoreCanonicalClientStudentScopeResolver();

function exactObject(value: unknown, fields: readonly string[]): value is Record<string, unknown> {
  try {
    if (
      typeof value !== "object" ||
      value === null ||
      Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Object.prototype
    ) {
      return false;
    }
    const keys = Object.keys(value).sort();
    const expected = [...fields].sort();
    return (
      keys.length === expected.length &&
      keys.every((key, index) => {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        return (
          key === expected[index] &&
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

async function requireOfferResponseScope(
  request: CallableRequest<unknown>,
  studentId: string,
  resolver: CanonicalClientStudentScopeResolver = defaultClientStudentScopeResolver,
): Promise<void> {
  const actor = requireUserActor(request);
  if (
    (actor.role === "guardian" || actor.role === "adultStudent") &&
    (await resolver({
      academyId: actor.academyId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      requestedStudentId: studentId,
    }))
  ) {
    return;
  }
  throw new HttpsError("permission-denied", "Waitlist offer response is not permitted");
}

function identifier(value: unknown, label: string): string {
  if (typeof value !== "string" || !idPattern.test(value)) {
    throw new HttpsError("invalid-argument", label + " is invalid");
  }
  return value;
}

async function requireWaitlistStudentScope(
  request: CallableRequest<unknown>,
  studentId: string,
  resolver: CanonicalClientStudentScopeResolver = defaultClientStudentScopeResolver,
): Promise<void> {
  const actor = requireUserActor(request);
  if (offerIssuerRoles.has(actor.role)) return;
  if (
    (actor.role === "guardian" || actor.role === "adultStudent") &&
    (await resolver({
      academyId: actor.academyId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      requestedStudentId: studentId,
    }))
  ) {
    return;
  }
  throw new HttpsError("permission-denied", "Student waitlist access is not permitted");
}

function studentItem(entry: WaitlistEntryRecord): StudentWaitlistItem {
  return Object.freeze({
    sessionId: entry.sessionId,
    position: entry.position,
    status: entry.status,
    requestedAt: entry.requestedAt,
    offeredAt: entry.offeredAt,
    offerExpiresAt: entry.offerExpiresAt,
    acceptedAt: entry.acceptedAt,
    cancelledAt: entry.cancelledAt,
  });
}

function staffItem(entry: WaitlistEntryRecord): StaffWaitlistItem {
  return Object.freeze({ ...studentItem(entry), studentReference: entry.studentId });
}

function mapStoreError(error: unknown): never {
  if (error instanceof HttpsError) throw error;
  if (error instanceof WaitlistStoreError) {
    if (error.code === "invalid") {
      throw new HttpsError("invalid-argument", "Waitlist request is invalid");
    }
    if (error.code === "not-found") {
      throw new HttpsError("not-found", "Waitlist dependency was not found");
    }
    if (error.code === "conflict" || error.code === "ineligible") {
      throw new HttpsError("failed-precondition", "Waitlist request is not eligible");
    }
  }
  throw new HttpsError("internal", "Waitlist is not available");
}

export function createJoinWaitlistHandler(options: ScopeOptions) {
  return async (request: CallableRequest<unknown>): Promise<{ entry: StudentWaitlistItem }> => {
    const actor = requireUserActor(request);
    const parsed = parseJoinWaitlistInput(request.data);
    if (!parsed.ok) throw new HttpsError("invalid-argument", "Waitlist request is invalid");
    await requireWaitlistStudentScope(
      request,
      parsed.value.studentId,
      options.resolveClientStudentScope,
    );
    try {
      const entry = await options.waitlistStore.joinWaitlist({
        academyId: actor.academyId,
        request: parsed.value,
        actorId: actor.userId,
      });
      return { entry: studentItem(entry) };
    } catch (error) {
      return mapStoreError(error);
    }
  };
}

export function createCancelWaitlistHandler(options: ScopeOptions) {
  return async (request: CallableRequest<unknown>): Promise<{ entry: StudentWaitlistItem }> => {
    const actor = requireUserActor(request);
    if (!exactObject(request.data, ["sessionId", "studentId"])) {
      throw new HttpsError("invalid-argument", "Waitlist cancellation is invalid");
    }
    const sessionId = identifier(request.data.sessionId, "sessionId");
    const studentId = identifier(request.data.studentId, "studentId");
    await requireWaitlistStudentScope(request, studentId, options.resolveClientStudentScope);
    try {
      const entry = await options.waitlistStore.cancelWaitlist({
        academyId: actor.academyId,
        sessionId,
        studentId,
        actorId: actor.userId,
      });
      return { entry: studentItem(entry) };
    } catch (error) {
      return mapStoreError(error);
    }
  };
}

export function createIssueNextWaitlistOfferHandler({
  waitlistStore,
}: {
  waitlistStore: WaitlistStore;
}) {
  return async (request: CallableRequest<unknown>): Promise<{ entry: StaffWaitlistItem }> => {
    const actor = requireUserActor(request);
    if (!offerIssuerRoles.has(actor.role)) {
      throw new HttpsError("permission-denied", "Waitlist offer issuance is not permitted");
    }
    const parsed = parseIssueNextWaitlistOfferInput(request.data);
    if (!parsed.ok) {
      throw new HttpsError("invalid-argument", "Waitlist offer request is invalid");
    }
    try {
      const entry = await waitlistStore.issueNextWaitlistOffer({
        academyId: actor.academyId,
        sessionId: parsed.value.sessionId,
        actorId: actor.userId,
      });
      return { entry: staffItem(entry) };
    } catch (error) {
      return mapStoreError(error);
    }
  };
}

function createRespondToWaitlistOfferHandler(
  options: ScopeOptions,
  response: "accept" | "decline",
) {
  return async (request: CallableRequest<unknown>): Promise<{ entry: StudentWaitlistItem }> => {
    const actor = requireUserActor(request);
    if (!exactObject(request.data, ["sessionId", "studentId"])) {
      throw new HttpsError("invalid-argument", "Waitlist offer response is invalid");
    }
    const parsed = parseRespondToWaitlistOfferInput({
      sessionId: request.data.sessionId,
      studentId: request.data.studentId,
      response,
    });
    if (!parsed.ok) {
      throw new HttpsError("invalid-argument", "Waitlist offer response is invalid");
    }
    await requireOfferResponseScope(
      request,
      parsed.value.studentId,
      options.resolveClientStudentScope,
    );
    try {
      const entry = await options.waitlistStore.respondToWaitlistOffer({
        academyId: actor.academyId,
        sessionId: parsed.value.sessionId,
        studentId: parsed.value.studentId,
        response,
        actorId: actor.userId,
      });
      return { entry: studentItem(entry) };
    } catch (error) {
      return mapStoreError(error);
    }
  };
}

export function createAcceptWaitlistOfferHandler(options: ScopeOptions) {
  return createRespondToWaitlistOfferHandler(options, "accept");
}

export function createDeclineWaitlistOfferHandler(options: ScopeOptions) {
  return createRespondToWaitlistOfferHandler(options, "decline");
}

export function createListStudentWaitlistHandler(options: ScopeOptions) {
  return async (
    request: CallableRequest<unknown>,
  ): Promise<{ entries: readonly StudentWaitlistItem[] }> => {
    const actor = requireUserActor(request);
    if (!exactObject(request.data, ["studentId"])) {
      throw new HttpsError("invalid-argument", "Student waitlist query is invalid");
    }
    const studentId = identifier(request.data.studentId, "studentId");
    await requireWaitlistStudentScope(request, studentId, options.resolveClientStudentScope);
    try {
      const entries = await options.waitlistStore.listStudentWaitlist(actor.academyId, studentId);
      return { entries: Object.freeze(entries.map(studentItem)) };
    } catch (error) {
      return mapStoreError(error);
    }
  };
}

export function createListSessionWaitlistHandler({
  waitlistStore,
}: {
  waitlistStore: WaitlistStore;
}) {
  return async (
    request: CallableRequest<unknown>,
  ): Promise<{ entries: readonly StaffWaitlistItem[] }> => {
    const actor = requireUserActor(request);
    if (!staffRoles.has(actor.role)) {
      throw new HttpsError("permission-denied", "Staff waitlist access is not permitted");
    }
    if (!exactObject(request.data, ["sessionId"])) {
      throw new HttpsError("invalid-argument", "Session waitlist query is invalid");
    }
    const sessionId = identifier(request.data.sessionId, "sessionId");
    try {
      const entries = await waitlistStore.listSessionWaitlist(actor.academyId, sessionId);
      return { entries: Object.freeze(entries.map(staffItem)) };
    } catch (error) {
      return mapStoreError(error);
    }
  };
}

let defaultStore: WaitlistStore | undefined;
function getStore(): WaitlistStore {
  defaultStore ??= createFirestoreWaitlistStore({
    firestore: getFirestore() as unknown as Parameters<
      typeof createFirestoreWaitlistStore
    >[0]["firestore"],
  });
  return defaultStore;
}

function scopeOptions(): ScopeOptions {
  return {
    waitlistStore: getStore(),
    resolveClientStudentScope: defaultClientStudentScopeResolver,
  };
}

export const joinWaitlist = onCall(scheduleCallableOptions, async (request) =>
  createJoinWaitlistHandler(scopeOptions())(request),
);
export const cancelWaitlistEntry = onCall(scheduleCallableOptions, async (request) =>
  createCancelWaitlistHandler(scopeOptions())(request),
);
export const issueNextWaitlistOffer = onCall(scheduleCallableOptions, async (request) =>
  createIssueNextWaitlistOfferHandler({ waitlistStore: getStore() })(request),
);
export const acceptWaitlistOffer = onCall(scheduleCallableOptions, async (request) =>
  createAcceptWaitlistOfferHandler(scopeOptions())(request),
);
export const declineWaitlistOffer = onCall(scheduleCallableOptions, async (request) =>
  createDeclineWaitlistOfferHandler(scopeOptions())(request),
);
export const listStudentWaitlist = onCall(scheduleCallableOptions, async (request) =>
  createListStudentWaitlistHandler(scopeOptions())(request),
);
export const listSessionWaitlist = onCall(scheduleCallableOptions, async (request) =>
  createListSessionWaitlistHandler({ waitlistStore: getStore() })(request),
);
