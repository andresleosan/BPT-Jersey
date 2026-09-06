import { getFirestore } from "firebase-admin/firestore";
import { HttpsError, onCall, type CallableRequest } from "firebase-functions/v2/https";

import type { AuditEventDraft } from "@bpt-jersey/domain/audit";
import {
  parseEnrolmentRequestReview,
  parseEnrolmentRequestSubmission,
  toEnrolmentRequestClientView,
  toEnrolmentRequestRow,
  type EnrolmentRequestClientView,
  type EnrolmentRequestRow,
} from "@bpt-jersey/domain/members/enrolment-requests";
import { appendAuditEventInTransaction } from "../audit/audit-writer.js";
import { browserAdminCallableOptions } from "../auth/callable-options.js";
import { requireUserActor } from "../auth/user-authorization.js";
import {
  createEnrolmentRequestStore,
  EnrolmentRequestStoreError,
  type EnrolmentRequestStore,
} from "./enrolment-request-service.js";

/**
 * The self-service enrolment request (T121). A signed-in client fills the same form office fills,
 * and office reviews the result before anything reaches the canonical directory.
 *
 * What this surface deliberately does not do: it never creates a student, never grants a role and
 * never exposes an applicant's confidential detail to the office queue. The queue lists names and
 * status; approving a request, with the canonical write and the claim that follows it, is its own
 * reviewed step and is not part of this file.
 */
export type EnrolmentRequestQueue = Readonly<{
  requests: readonly EnrolmentRequestRow[];
  truncated: boolean;
}>;

export type EnrolmentRequestCallableServices = Readonly<{
  store: EnrolmentRequestStore;
  now?: () => string;
}>;

const clientRoles = new Set(["shopper", "guardian", "adultStudent"]);
const officeRoles = new Set(["owner", "administrator"]);

function actorWithRole(request: CallableRequest<unknown>, roles: Set<string>, message: string) {
  const actor = requireUserActor(request);
  if (!roles.has(actor.role)) throw new HttpsError("permission-denied", message);
  return actor;
}

function noPayload(value: unknown): void {
  if (value !== null && value !== undefined) {
    throw new HttpsError("invalid-argument", "Enrolment payload is invalid");
  }
}

function now(services: EnrolmentRequestCallableServices): string {
  return services.now?.() ?? new Date().toISOString();
}

function mapError(error: unknown, operation: "read" | "write"): never {
  if (error instanceof HttpsError) throw error;
  if (error instanceof EnrolmentRequestStoreError) {
    if (error.code === "invalid")
      throw new HttpsError("invalid-argument", "Enrolment payload is invalid");
    if (error.code === "not-found")
      throw new HttpsError("not-found", "Enrolment request not found");
    if (error.code === "tenant")
      throw new HttpsError("permission-denied", "Enrolment request is not available");
    if (error.code === "conflict")
      throw new HttpsError("already-exists", "Enrolment request already used");
    // A precondition message is written for the applicant to read and carries no personal data.
    if (error.code === "precondition") throw new HttpsError("failed-precondition", error.message);
  }
  throw new HttpsError(
    "internal",
    operation === "read"
      ? "Unable to read enrolment requests"
      : "Unable to update the enrolment request",
  );
}

export async function submitEnrolmentRequestHandler(
  request: CallableRequest<unknown>,
  services: EnrolmentRequestCallableServices,
): Promise<EnrolmentRequestClientView> {
  const actor = actorWithRole(request, clientRoles, "A client account is required");
  const occurredAt = now(services);
  const parsed = parseEnrolmentRequestSubmission(request.data, occurredAt.slice(0, 10));
  if (!parsed.ok) throw new HttpsError("invalid-argument", "Enrolment payload is invalid");
  try {
    return toEnrolmentRequestClientView(
      await services.store.submit({
        academyId: actor.academyId,
        actorId: actor.userId,
        now: occurredAt,
        submission: parsed.value,
      }),
    );
  } catch (error) {
    return mapError(error, "write");
  }
}

export async function listMyEnrolmentRequestsHandler(
  request: CallableRequest<unknown>,
  services: EnrolmentRequestCallableServices,
): Promise<readonly EnrolmentRequestClientView[]> {
  const actor = actorWithRole(request, clientRoles, "A client account is required");
  noPayload(request.data);
  try {
    const records = await services.store.listForSubmitter(actor.academyId, actor.userId);
    return records
      .filter((record) => record.submittedBy === actor.userId)
      .map(toEnrolmentRequestClientView);
  } catch (error) {
    return mapError(error, "read");
  }
}

export async function withdrawEnrolmentRequestHandler(
  request: CallableRequest<unknown>,
  services: EnrolmentRequestCallableServices,
): Promise<EnrolmentRequestClientView> {
  const actor = actorWithRole(request, clientRoles, "A client account is required");
  const payload = request.data;
  if (
    typeof payload !== "object" ||
    payload === null ||
    Array.isArray(payload) ||
    Reflect.ownKeys(payload).length !== 1 ||
    typeof (payload as { enrolmentRequestId?: unknown }).enrolmentRequestId !== "string"
  ) {
    throw new HttpsError("invalid-argument", "Enrolment payload is invalid");
  }
  try {
    return toEnrolmentRequestClientView(
      await services.store.withdraw({
        academyId: actor.academyId,
        actorId: actor.userId,
        now: now(services),
        enrolmentRequestId: (payload as { enrolmentRequestId: string }).enrolmentRequestId,
      }),
    );
  } catch (error) {
    return mapError(error, "write");
  }
}

export async function listEnrolmentRequestsHandler(
  request: CallableRequest<unknown>,
  services: EnrolmentRequestCallableServices,
): Promise<EnrolmentRequestQueue> {
  const actor = actorWithRole(request, officeRoles, "Office access is required");
  noPayload(request.data);
  try {
    const page = await services.store.listForAcademy(actor.academyId);
    // A queue that silently drops the overflow reads as "this is everybody". Say when it is not.
    return Object.freeze({
      requests: page.requests.map(toEnrolmentRequestRow),
      truncated: page.truncated,
    });
  } catch (error) {
    return mapError(error, "read");
  }
}

export async function returnEnrolmentRequestHandler(
  request: CallableRequest<unknown>,
  services: EnrolmentRequestCallableServices,
): Promise<EnrolmentRequestRow> {
  const actor = actorWithRole(request, officeRoles, "Office access is required");
  const parsed = parseEnrolmentRequestReview(request.data);
  if (!parsed.ok) throw new HttpsError("invalid-argument", "Enrolment payload is invalid");
  try {
    return toEnrolmentRequestRow(
      await services.store.returnForChanges({
        academyId: actor.academyId,
        actorId: actor.userId,
        now: now(services),
        enrolmentRequestId: parsed.value.enrolmentRequestId,
        note: parsed.value.note,
      }),
    );
  } catch (error) {
    return mapError(error, "write");
  }
}

function callableServices(): EnrolmentRequestCallableServices {
  const firestore = getFirestore() as unknown as Parameters<
    typeof createEnrolmentRequestStore
  >[0]["firestore"];
  return {
    store: createEnrolmentRequestStore({
      firestore,
      appendAudit: (transaction, reference, draft) =>
        appendAuditEventInTransaction(transaction, reference, draft as AuditEventDraft),
    }),
  };
}

export const enrolmentRequestCallableOptions = browserAdminCallableOptions;

export const submitEnrolmentRequest = onCall(enrolmentRequestCallableOptions, (request) =>
  submitEnrolmentRequestHandler(request, callableServices()),
);
export const listMyEnrolmentRequests = onCall(enrolmentRequestCallableOptions, (request) =>
  listMyEnrolmentRequestsHandler(request, callableServices()),
);
export const withdrawEnrolmentRequest = onCall(enrolmentRequestCallableOptions, (request) =>
  withdrawEnrolmentRequestHandler(request, callableServices()),
);
export const listEnrolmentRequests = onCall(enrolmentRequestCallableOptions, (request) =>
  listEnrolmentRequestsHandler(request, callableServices()),
);
export const returnEnrolmentRequest = onCall(enrolmentRequestCallableOptions, (request) =>
  returnEnrolmentRequestHandler(request, callableServices()),
);
