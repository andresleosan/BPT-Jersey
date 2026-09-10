import { randomUUID } from "node:crypto";

import { getApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { defineSecret } from "firebase-functions/params";
import { HttpsError, onCall, type CallableRequest } from "firebase-functions/v2/https";

import type { AuditEventDraft } from "@bpt-jersey/domain/audit";
import {
  parseEnrolmentRequestApproval,
  parseEnrolmentRequestDetailRequest,
  parseEnrolmentRequestReview,
  parseEnrolmentRequestSubmission,
  toEnrolmentRequestClientView,
  toEnrolmentRequestRow,
  type EnrolmentRequestClientView,
  type EnrolmentRequestDetail,
  type EnrolmentRequestRow,
} from "@bpt-jersey/domain/members/enrolment-requests";
import { appendAuditEventInTransaction } from "../audit/audit-writer.js";
import { browserAdminCallableOptions } from "../auth/callable-options.js";
import { requireUserActor } from "../auth/user-authorization.js";
import { createFamilyStore } from "../families/family-service.js";
import { createGuardianProfileStore } from "../profiles/guardian-profile-service.js";
import {
  createMemberDirectoryActorActivityCheck,
  requireCanonicalMemberDirectoryActor,
  type MemberDirectoryActorActivityCheck,
} from "./canonical-actor.js";
import {
  CanonicalMemberDirectoryReadError,
  createCanonicalMemberDirectoryReadService,
  type CanonicalMemberDirectoryReadService,
} from "./canonical-member-directory-read-service.js";
import { createCanonicalMemberDirectoryService } from "./canonical-member-directory-service.js";
import {
  createEnrolmentApprovalService,
  EnrolmentApprovalError,
  type EnrolmentApprovalResult,
  type EnrolmentApprovalService,
} from "./enrolment-approval-service.js";
import {
  createEnrolmentRequestStore,
  EnrolmentRequestStoreError,
  type EnrolmentRequestStore,
} from "./enrolment-request-service.js";
import { createMemberDirectoryFirestoreAdapters } from "./member-directory-firestore.js";

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

/**
 * The office half of the surface. It is deliberately a different set of services from the one the
 * applicant-facing callables use, because it demands a different actor: not "a signed-in account
 * whose claim says owner", but the full canonical stack - App Check verified inside the handler,
 * administrative claims, and a liveness probe against Auth and the academy's own staff document.
 * Approving writes to the canonical member directory, and nothing writes there on the strength of
 * a token alone.
 */
export type EnrolmentOfficeCallableServices = Readonly<{
  reader: CanonicalMemberDirectoryReadService;
  approvals: EnrolmentApprovalService;
  isActorActive: MemberDirectoryActorActivityCheck;
  /**
   * The reviewer's name as their provisioned administrative document records it, for the waiver's
   * `Instructor Name` line. Resolves to undefined rather than throwing: a missing label must never
   * be the reason an enrolment fails.
   */
  reviewerDisplayName?: (academyId: string, actorId: string) => Promise<string | undefined>;
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

function officeNow(services: EnrolmentOfficeCallableServices): string {
  return services.now?.() ?? new Date().toISOString();
}

function mapOfficeError(error: unknown, operation: "read" | "write"): never {
  if (error instanceof HttpsError) throw error;
  if (error instanceof CanonicalMemberDirectoryReadError) {
    if (error.code === "unauthorized")
      throw new HttpsError("permission-denied", "Enrolment request is not available");
    if (error.code === "invalid")
      throw new HttpsError("invalid-argument", "Enrolment payload is invalid");
    if (error.code === "not-found")
      throw new HttpsError("not-found", "Enrolment request not found");
    if (error.code === "unavailable")
      throw new HttpsError("failed-precondition", "Enrolment request is unavailable");
    if (error.code === "rate-limited")
      throw new HttpsError("resource-exhausted", "Restricted read rate limit exceeded");
  }
  if (error instanceof EnrolmentApprovalError) {
    // The failure code travels with the message so a reviewer can act on it and so the same slug
    // appears on the request, in the audit trail and on screen.
    if (error.code === "unauthorized")
      throw new HttpsError("permission-denied", "Enrolment approval is not permitted");
    if (error.code === "invalid")
      throw new HttpsError("invalid-argument", "Enrolment approval request is invalid");
    if (error.code === "not-found")
      throw new HttpsError("not-found", "Enrolment request not found");
    if (error.code === "conflict")
      throw new HttpsError("already-exists", "This applicant already holds a member record");
    throw new HttpsError("failed-precondition", `${error.failureCode}: ${error.message}`);
  }
  return mapError(error, operation);
}

/**
 * The Confidential detail of one request, read immediately before deciding it. Office was
 * previously asked to approve a person while looking at a queue that shows a name and a centre -
 * not the date of birth that decides whether they are a minor, and not the emergency contact the
 * academy is taking responsibility for. This is the read that closes that gap, and it is
 * purpose-bound, audited and counted like every other restricted read.
 */
export async function getEnrolmentRequestDetailHandler(
  request: CallableRequest<unknown>,
  services: EnrolmentOfficeCallableServices,
): Promise<EnrolmentRequestDetail> {
  const actor = await requireCanonicalMemberDirectoryActor(request, services.isActorActive);
  const parsed = parseEnrolmentRequestDetailRequest(request.data);
  if (!parsed.ok) throw new HttpsError("invalid-argument", "Enrolment payload is invalid");
  try {
    return await services.reader.enrolmentRequestDetail({
      actor,
      value: parsed.value,
      now: officeNow(services),
    });
  } catch (error) {
    return mapOfficeError(error, "read");
  }
}

export async function approveEnrolmentRequestHandler(
  request: CallableRequest<unknown>,
  services: EnrolmentOfficeCallableServices,
): Promise<EnrolmentApprovalResult> {
  const actor = await requireCanonicalMemberDirectoryActor(request, services.isActorActive);
  const parsed = parseEnrolmentRequestApproval(request.data);
  if (!parsed.ok) throw new HttpsError("invalid-argument", "Enrolment payload is invalid");
  try {
    const instructorName = await services.reviewerDisplayName?.(actor.academyId, actor.actorId);
    return await services.approvals.approve({
      actor,
      enrolmentRequestId: parsed.value.enrolmentRequestId,
      requestId: parsed.value.requestId,
      now: officeNow(services),
      ...(instructorName === undefined ? {} : { instructorName }),
    });
  } catch (error) {
    return mapOfficeError(error, "write");
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

const identityKeySecret = defineSecret("MEMBER_DIRECTORY_IDENTITY_KEY_SECRET");
const migrationIntegritySecret = defineSecret("MEMBER_DIRECTORY_MIGRATION_INTEGRITY_SECRET");
const directoryCursorSecret = defineSecret("MEMBER_DIRECTORY_CURSOR_SECRET");
const identitySecretVersion = "identity-v1";
const integritySecretVersion = "integrity-v1";
const cursorSecretVersion = "cursor-v1";

function requiredProjectId(): string {
  const projectId = getApp().options.projectId;
  if (typeof projectId !== "string" || projectId.length === 0) {
    throw new HttpsError("failed-precondition", "Firebase project binding is unavailable");
  }
  return projectId;
}

function officeCallableServices(): EnrolmentOfficeCallableServices {
  const firestore = getFirestore();
  const auth = getAuth();
  const adapters = createMemberDirectoryFirestoreAdapters(firestore);
  const store = createEnrolmentRequestStore({
    firestore: firestore as unknown as Parameters<
      typeof createEnrolmentRequestStore
    >[0]["firestore"],
    appendAudit: (transaction, reference, draft) =>
      appendAuditEventInTransaction(transaction, reference, draft as AuditEventDraft),
  });
  return {
    reader: createCanonicalMemberDirectoryReadService({
      store: adapters.reader,
      identitySecretMaterial: identityKeySecret.value(),
      identitySecretVersion,
      cursorSecretMaterial: directoryCursorSecret.value(),
      cursorSecretVersion,
      generateAuditId: randomUUID,
    }),
    approvals: createEnrolmentApprovalService({
      store,
      directory: createCanonicalMemberDirectoryService({
        firestore: adapters.writer,
        projectId: requiredProjectId(),
        identitySecretMaterial: identityKeySecret.value(),
        identitySecretVersion,
        integritySecretMaterial: migrationIntegritySecret.value(),
        integritySecretVersion,
      }),
      guardianProfiles: createGuardianProfileStore({
        firestore: firestore as unknown as Parameters<
          typeof createGuardianProfileStore
        >[0]["firestore"],
        integritySecretMaterial: migrationIntegritySecret.value(),
        integritySecretVersion,
      }),
      families: createFamilyStore({
        auth: {
          getUser: async (userId) => {
            const user = await auth.getUser(userId);
            return {
              uid: user.uid,
              ...(user.disabled !== undefined ? { disabled: user.disabled } : {}),
              ...(user.customClaims
                ? { customClaims: user.customClaims as Readonly<Record<string, unknown>> }
                : {}),
            };
          },
        },
        firestore: firestore as unknown as Parameters<typeof createFamilyStore>[0]["firestore"],
        canonicalControl: {
          projectId: requiredProjectId(),
          identitySecretMaterial: identityKeySecret.value(),
          identitySecretVersion,
          integritySecretMaterial: migrationIntegritySecret.value(),
          integritySecretVersion,
        },
      }),
      auth: {
        getUser: async (uid) => {
          const user = await auth.getUser(uid);
          return {
            uid: user.uid,
            ...(user.disabled !== undefined ? { disabled: user.disabled } : {}),
            ...(user.email === undefined ? {} : { email: user.email }),
            ...(user.displayName === undefined ? {} : { displayName: user.displayName }),
            ...(user.customClaims
              ? { customClaims: user.customClaims as Readonly<Record<string, unknown>> }
              : {}),
          };
        },
        setCustomUserClaims: (uid, claims) => auth.setCustomUserClaims(uid, claims),
      },
    }),
    isActorActive: createMemberDirectoryActorActivityCheck({
      getAuthUser: (uid) => auth.getUser(uid),
      getDocument: (path) => firestore.doc(path).get(),
    }),
    reviewerDisplayName: async (academyId, actorId) => {
      try {
        const snapshot = await firestore.doc(`academies/${academyId}/users/${actorId}`).get();
        const displayName = (snapshot.data() as { displayName?: unknown } | undefined)?.displayName;
        return typeof displayName === "string" && displayName.trim().length > 0
          ? displayName.trim().slice(0, 160)
          : undefined;
      } catch {
        return undefined;
      }
    },
  };
}

export const enrolmentRequestCallableOptions = browserAdminCallableOptions;

/** The office door carries the writer secrets; the applicant-facing callables never need them. */
const enrolmentOfficeCallableOptions = {
  ...browserAdminCallableOptions,
  secrets: [identityKeySecret, migrationIntegritySecret, directoryCursorSecret],
};

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
export const getEnrolmentRequestDetail = onCall(enrolmentOfficeCallableOptions, (request) =>
  getEnrolmentRequestDetailHandler(request, officeCallableServices()),
);
export const approveEnrolmentRequest = onCall(enrolmentOfficeCallableOptions, (request) =>
  approveEnrolmentRequestHandler(request, officeCallableServices()),
);
