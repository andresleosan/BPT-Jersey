import { requireMemberAccountActor } from "../members/member-access-callables.js";
import { getFirestore } from "firebase-admin/firestore";
import { HttpsError, onCall, type CallableRequest } from "firebase-functions/v2/https";

import {
  parseHealthProfileChangeRequestInput,
  parseHealthProfileSaveInput,
  type HealthProfileChangeRequestInput,
  type HealthProfileSaveInput,
} from "@bpt-jersey/domain/health";
import { requireActiveOfficeActor } from "../auth/office-actor.js";
import { requireUserActor } from "../auth/user-authorization.js";
import {
  createHealthStore,
  HealthStoreError,
  type HealthActorRole,
  type HealthStore,
} from "./health-service.js";

export type HealthCallableServices = Readonly<{
  store: HealthStore;
  authorizeOffice: typeof requireActiveOfficeActor;
  pilotEnabled?: boolean;
  now?: () => string;
}>;
const roles = ["owner", "administrator", "headCoach", "coach", "guardian", "adultStudent", "teenStudent"] as const;
const staffRoles = ["owner", "administrator", "headCoach", "coach"] as const;

function pilot(services: HealthCallableServices): void {
  if (services.pilotEnabled !== true)
    throw new HttpsError(
      "failed-precondition",
      "Health support is disabled outside the synthetic pilot",
    );
}
function invalidPayload(): never {
  throw new HttpsError("invalid-argument", "Health payload is invalid");
}
function parseInput<T>(raw: unknown, parser: (value: unknown) => { ok: boolean; value?: T }): T {
  const result = parser(raw);
  if (!result.ok || result.value === undefined) return invalidPayload();
  return result.value as T;
}
function parseStudentPayload(raw: unknown): string {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return invalidPayload();
  const keys = Reflect.ownKeys(raw);
  if (
    keys.length !== 1 ||
    keys[0] !== "studentId" ||
    typeof (raw as Record<string, unknown>).studentId !== "string"
  )
    return invalidPayload();
  return (raw as Record<string, unknown>).studentId as string;
}
function parseRequestPayload(raw: unknown): string {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return invalidPayload();
  const keys = Reflect.ownKeys(raw);
  if (
    keys.length !== 1 ||
    keys[0] !== "requestId" ||
    typeof (raw as Record<string, unknown>).requestId !== "string"
  )
    return invalidPayload();
  return (raw as Record<string, unknown>).requestId as string;
}
function parseReviewPayload(raw: unknown): { requestId: string; decision: "approve" | "reject" } {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return invalidPayload();
  const value = raw as Record<string, unknown>;
  const keys = Reflect.ownKeys(value);
  if (
    keys.length !== 2 ||
    !keys.includes("requestId") ||
    !keys.includes("decision") ||
    typeof value.requestId !== "string" ||
    (value.decision !== "approve" && value.decision !== "reject")
  )
    return invalidPayload();
  return { requestId: value.requestId, decision: value.decision };
}
function parseReferenceLabelPayload(raw: unknown): {
  studentId: string;
  staffReferenceLabel: string | null;
} {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return invalidPayload();
  const value = raw as Record<string, unknown>;
  const keys = Reflect.ownKeys(value);
  if (
    keys.length !== 2 ||
    !keys.includes("studentId") ||
    !keys.includes("staffReferenceLabel") ||
    typeof value.studentId !== "string" ||
    (value.staffReferenceLabel !== null && typeof value.staffReferenceLabel !== "string")
  )
    return invalidPayload();
  return {
    studentId: value.studentId,
    staffReferenceLabel: value.staffReferenceLabel as string | null,
  };
}
function requireRole(request: CallableRequest<unknown>, allowed: readonly HealthActorRole[]) {
  const actor = requireUserActor(request);
  if (!allowed.includes(actor.role as HealthActorRole))
    throw new HttpsError("permission-denied", "Health access is not permitted");
  return actor;
}
/** Office manages member health with live authority. Other roles keep their pilot boundary. */
async function requireHealthActor(
  request: CallableRequest<unknown>,
  services: HealthCallableServices,
  allowed: readonly HealthActorRole[],
) {
  const actor = requireRole(request, allowed);
  if (actor.role === "owner" || actor.role === "administrator") {
    if (!request.app) throw new HttpsError("unauthenticated", "Verified application is required");
    return services.authorizeOffice(request);
  }
  pilot(services);
  if (["guardian", "adultStudent", "teenStudent"].includes(actor.role)) return requireMemberAccountActor(request);
  return actor;
}

function mapError(error: unknown, operation: "read" | "write"): never {
  if (error instanceof HttpsError) throw error;
  if (error instanceof HealthStoreError) {
    if (error.code === "invalid")
      throw new HttpsError("invalid-argument", "Health payload is invalid");
    if (error.code === "forbidden" || error.code === "tenant" || error.code === "not-found")
      throw new HttpsError("permission-denied", "Health access is not permitted");
    if (error.code === "conflict" || error.code === "precondition")
      throw new HttpsError("failed-precondition", "Health operation is not available");
  }
  throw new HttpsError(
    "internal",
    operation === "read" ? "Unable to read health support" : "Unable to update health support",
  );
}

export async function getHealthProfileHandler(
  request: CallableRequest<unknown>,
  services: HealthCallableServices,
) {
  const actor = await requireHealthActor(request, services, roles);
  const studentId = parseStudentPayload(request.data);
  try {
    return await services.store.getHealthProfile({
      academyId: actor.academyId,
      actorId: actor.userId,
      role: actor.role as HealthActorRole,
      studentId,
    });
  } catch (error) {
    return mapError(error, "read");
  }
}
export async function saveHealthProfileHandler(
  request: CallableRequest<unknown>,
  services: HealthCallableServices,
) {
  const actor = await requireHealthActor(request, services, ["owner", "administrator"]);
  const payload = parseInput<HealthProfileSaveInput>(request.data, parseHealthProfileSaveInput);
  try {
    return await services.store.saveHealthProfile({
      academyId: actor.academyId,
      actorId: actor.userId,
      now: services.now?.() ?? new Date().toISOString(),
      ...payload,
    });
  } catch (error) {
    return mapError(error, "write");
  }
}
/**
 * The mat keeps the 25-character label and nothing else (ADR-010). The clinical note never enters
 * or leaves this callable: only the stored profile carries it.
 */
export async function saveHealthReferenceLabelHandler(
  request: CallableRequest<unknown>,
  services: HealthCallableServices,
) {
  const actor = await requireHealthActor(request, services, staffRoles);
  const payload = parseReferenceLabelPayload(request.data);
  try {
    return await services.store.saveReferenceLabel({
      academyId: actor.academyId,
      actorId: actor.userId,
      now: services.now?.() ?? new Date().toISOString(),
      ...payload,
    });
  } catch (error) {
    return mapError(error, "write");
  }
}
export async function deactivateHealthProfileHandler(
  request: CallableRequest<unknown>,
  services: HealthCallableServices,
) {
  const actor = await requireHealthActor(request, services, ["owner", "administrator"]);
  const studentId = parseStudentPayload(request.data);
  try {
    return await services.store.deactivateHealthProfile({
      academyId: actor.academyId,
      actorId: actor.userId,
      studentId,
    });
  } catch (error) {
    return mapError(error, "write");
  }
}
export async function createHealthProfileChangeRequestHandler(
  request: CallableRequest<unknown>,
  services: HealthCallableServices,
) {
  pilot(services);
  const actor = requireRole(request, ["guardian"]);
  const payload = parseInput<HealthProfileChangeRequestInput>(
    request.data,
    parseHealthProfileChangeRequestInput,
  );
  try {
    return await services.store.createChangeRequest({
      academyId: actor.academyId,
      actorId: actor.userId,
      ...payload,
    });
  } catch (error) {
    return mapError(error, "write");
  }
}
export async function cancelHealthProfileChangeRequestHandler(
  request: CallableRequest<unknown>,
  services: HealthCallableServices,
) {
  pilot(services);
  const actor = requireRole(request, ["guardian"]);
  const requestId = parseRequestPayload(request.data);
  try {
    return await services.store.cancelChangeRequest({
      academyId: actor.academyId,
      actorId: actor.userId,
      requestId,
    });
  } catch (error) {
    return mapError(error, "write");
  }
}
export async function reviewHealthProfileChangeRequestHandler(
  request: CallableRequest<unknown>,
  services: HealthCallableServices,
) {
  const actor = await requireHealthActor(request, services, ["owner", "administrator"]);
  const payload = parseReviewPayload(request.data);
  try {
    return await services.store.reviewChangeRequest({
      academyId: actor.academyId,
      actorId: actor.userId,
      ...payload,
    });
  } catch (error) {
    return mapError(error, "write");
  }
}
export async function listHealthReferencesHandler(
  request: CallableRequest<unknown>,
  services: HealthCallableServices,
) {
  const actor = await requireHealthActor(request, services, staffRoles);
  if (request.data !== null && request.data !== undefined) invalidPayload();
  try {
    return { references: await services.store.listReferences({ academyId: actor.academyId }) };
  } catch (error) {
    return mapError(error, "read");
  }
}
function callableServices(): HealthCallableServices {
  return {
    authorizeOffice: requireActiveOfficeActor,
    pilotEnabled: process.env.BPT_SYNTHETIC_PILOT === "true",
    store: createHealthStore({
      firestore: getFirestore() as unknown as Parameters<typeof createHealthStore>[0]["firestore"],
      hasCurrentStudentAssignment: async () => false,
    }),
  };
}
export const healthCallableOptions = { enforceAppCheck: true };

export const getHealthProfile = onCall(healthCallableOptions, (request) =>
  getHealthProfileHandler(request, callableServices()),
);
export const saveHealthProfile = onCall(healthCallableOptions, (request) =>
  saveHealthProfileHandler(request, callableServices()),
);
export const deactivateHealthProfile = onCall(healthCallableOptions, (request) =>
  deactivateHealthProfileHandler(request, callableServices()),
);
export const createHealthProfileChangeRequest = onCall(healthCallableOptions, (request) =>
  createHealthProfileChangeRequestHandler(request, callableServices()),
);
export const cancelHealthProfileChangeRequest = onCall(healthCallableOptions, (request) =>
  cancelHealthProfileChangeRequestHandler(request, callableServices()),
);
export const reviewHealthProfileChangeRequest = onCall(healthCallableOptions, (request) =>
  reviewHealthProfileChangeRequestHandler(request, callableServices()),
);
export const listHealthReferences = onCall(healthCallableOptions, (request) =>
  listHealthReferencesHandler(request, callableServices()),
);
export const saveHealthReferenceLabel = onCall(healthCallableOptions, (request) =>
  saveHealthReferenceLabelHandler(request, callableServices()),
);
