import { getFirestore } from "firebase-admin/firestore";
import { HttpsError, onCall, type CallableRequest } from "firebase-functions/v2/https";

import {
  parseHealthProfileChangeRequestInput,
  parseHealthProfileSaveInput,
  type HealthProfileChangeRequestInput,
  type HealthProfileSaveInput,
} from "@bpt-jersey/domain/health";
import { requireUserActor } from "../auth/user-authorization.js";
import {
  createHealthStore,
  HealthStoreError,
  type HealthActorRole,
  type HealthStore,
} from "./health-service.js";

export type HealthCallableServices = Readonly<{
  store: HealthStore;
  pilotEnabled?: boolean;
  now?: () => string;
}>;
const roles = ["owner", "administrator", "headCoach", "coach", "guardian"] as const;

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
function requireRole(request: CallableRequest<unknown>, allowed: readonly HealthActorRole[]) {
  const actor = requireUserActor(request);
  if (!allowed.includes(actor.role as HealthActorRole))
    throw new HttpsError("permission-denied", "Health access is not permitted");
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
  pilot(services);
  const actor = requireRole(request, roles);
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
  pilot(services);
  const actor = requireRole(request, ["owner", "administrator"]);
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
export async function deactivateHealthProfileHandler(
  request: CallableRequest<unknown>,
  services: HealthCallableServices,
) {
  pilot(services);
  const actor = requireRole(request, ["owner", "administrator"]);
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
  pilot(services);
  const actor = requireRole(request, ["owner", "administrator"]);
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
function callableServices(): HealthCallableServices {
  return {
    pilotEnabled: process.env.BPT_SYNTHETIC_PILOT === "true",
    store: createHealthStore({
      firestore: getFirestore() as unknown as Parameters<typeof createHealthStore>[0]["firestore"],
      hasCurrentStudentAssignment: async () => false,
    }),
  };
}
export const getHealthProfile = onCall((request) =>
  getHealthProfileHandler(request, callableServices()),
);
export const saveHealthProfile = onCall((request) =>
  saveHealthProfileHandler(request, callableServices()),
);
export const deactivateHealthProfile = onCall((request) =>
  deactivateHealthProfileHandler(request, callableServices()),
);
export const createHealthProfileChangeRequest = onCall((request) =>
  createHealthProfileChangeRequestHandler(request, callableServices()),
);
export const cancelHealthProfileChangeRequest = onCall((request) =>
  cancelHealthProfileChangeRequestHandler(request, callableServices()),
);
export const reviewHealthProfileChangeRequest = onCall((request) =>
  reviewHealthProfileChangeRequestHandler(request, callableServices()),
);
