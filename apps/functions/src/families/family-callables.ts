import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { HttpsError, onCall, type CallableRequest } from "firebase-functions/v2/https";

import {
  parseFamilyStudentDraft,
  type FamilyStudentDraft,
  type GuardianFamilyProjection,
  type StaffFamilyProjection,
} from "@bpt-jersey/domain/families";

import { requireUserActor } from "../auth/user-authorization.js";
import {
  createFamilyStore,
  FamilyStoreError,
  type FamilyStore,
  type UpdateFamilyInput,
} from "./family-service.js";

export type FamilyCallableServices = Readonly<{
  store: FamilyStore;
  now?: () => string;
}>;

type FamilyCreatePayload = Readonly<{
  tutorUserId: string;
  students: readonly FamilyStudentDraft[];
}>;

type FamilyUpdateOperation = UpdateFamilyInput["operation"];

const safeIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function invalidPayload(): never {
  throw new HttpsError("invalid-argument", "Family payload is invalid");
}

function exactFields(value: Record<string, unknown>, fields: readonly string[]): boolean {
  const keys = Reflect.ownKeys(value);
  return (
    keys.length === fields.length &&
    keys.every((key) => typeof key === "string" && fields.includes(key))
  );
}

function parseId(value: unknown): string {
  if (typeof value !== "string" || !safeIdPattern.test(value)) return invalidPayload();
  return value;
}

function parseStudentDraft(value: unknown): FamilyStudentDraft {
  const parsed = parseFamilyStudentDraft(value);
  if (!parsed.ok) return invalidPayload();
  return parsed.value;
}

function parseCreatePayload(value: unknown): FamilyCreatePayload {
  if (!isPlainRecord(value) || !exactFields(value, ["tutorUserId", "students"])) {
    return invalidPayload();
  }
  if (!Array.isArray(value.students) || value.students.length === 0) return invalidPayload();
  return Object.freeze({
    tutorUserId: parseId(value.tutorUserId),
    students: Object.freeze(value.students.map(parseStudentDraft)),
  });
}

function parseUpdateOperation(value: unknown): FamilyUpdateOperation {
  if (!isPlainRecord(value) || typeof value.kind !== "string") return invalidPayload();
  if (value.kind === "replaceTutor") {
    if (!exactFields(value, ["kind", "tutorUserId"])) return invalidPayload();
    return Object.freeze({ kind: "replaceTutor", tutorUserId: parseId(value.tutorUserId) });
  }
  if (value.kind === "addStudent") {
    if (!exactFields(value, ["kind", "student"])) return invalidPayload();
    return Object.freeze({ kind: "addStudent", student: parseStudentDraft(value.student) });
  }
  if (value.kind === "deactivateRelationship") {
    if (!exactFields(value, ["kind", "studentId"])) return invalidPayload();
    return Object.freeze({ kind: "deactivateRelationship", studentId: parseId(value.studentId) });
  }
  if (value.kind === "deactivateFamily") {
    if (!exactFields(value, ["kind"])) return invalidPayload();
    return Object.freeze({ kind: "deactivateFamily" });
  }
  return invalidPayload();
}

function parseUpdatePayload(value: unknown): Readonly<{
  familyId: string;
  operation: FamilyUpdateOperation;
}> {
  if (!isPlainRecord(value) || !exactFields(value, ["familyId", "operation"])) {
    return invalidPayload();
  }
  return Object.freeze({
    familyId: parseId(value.familyId),
    operation: parseUpdateOperation(value.operation),
  });
}

function parseStaffGetPayload(value: unknown): string {
  if (!isPlainRecord(value) || !exactFields(value, ["familyId"])) return invalidPayload();
  return parseId(value.familyId);
}

function requireAdministrativeRole(request: CallableRequest<unknown>) {
  const actor = requireUserActor(request);
  if (actor.role !== "owner" && actor.role !== "administrator") {
    throw new HttpsError("permission-denied", "Family access is not permitted");
  }
  return actor;
}

function mapFamilyError(error: unknown, operation: "load" | "write"): never {
  if (error instanceof HttpsError) throw error;
  if (error instanceof FamilyStoreError) {
    if (error.code === "invalid")
      throw new HttpsError("invalid-argument", "Family payload is invalid");
    if (error.code === "tenant")
      throw new HttpsError("permission-denied", "Family access is not permitted");
    throw new HttpsError(
      error.code === "not-found" && operation === "load"
        ? "permission-denied"
        : "failed-precondition",
      "Family operation is not available",
    );
  }
  throw new HttpsError(
    "internal",
    operation === "load" ? "Unable to load family" : "Unable to update family",
  );
}

export async function createFamilyHandler(
  request: CallableRequest<unknown>,
  services: FamilyCallableServices,
): Promise<StaffFamilyProjection> {
  const actor = requireAdministrativeRole(request);
  const payload = parseCreatePayload(request.data);
  try {
    return await services.store.createFamily({
      academyId: actor.academyId,
      actorId: actor.userId,
      tutorUserId: payload.tutorUserId,
      students: payload.students,
      now: services.now?.() ?? new Date().toISOString(),
    });
  } catch (error) {
    return mapFamilyError(error, "write");
  }
}

export async function getFamilyHandler(
  request: CallableRequest<unknown>,
  services: FamilyCallableServices,
): Promise<StaffFamilyProjection | GuardianFamilyProjection> {
  const actor = requireUserActor(request);
  try {
    if (actor.role === "guardian") {
      if (request.data !== null) invalidPayload();
      const projection = await services.store.getGuardianFamily(actor.academyId, actor.userId);
      if (projection === undefined) {
        throw new HttpsError("permission-denied", "Family access is not permitted");
      }
      return projection;
    }
    if (actor.role !== "owner" && actor.role !== "administrator") {
      throw new HttpsError("permission-denied", "Family access is not permitted");
    }
    const familyId = parseStaffGetPayload(request.data);
    const projection = await services.store.getStaffFamily(actor.academyId, familyId);
    if (projection === undefined) {
      throw new HttpsError("failed-precondition", "Family operation is not available");
    }
    return projection;
  } catch (error) {
    return mapFamilyError(error, "load");
  }
}

export async function updateFamilyHandler(
  request: CallableRequest<unknown>,
  services: FamilyCallableServices,
): Promise<StaffFamilyProjection> {
  const actor = requireAdministrativeRole(request);
  const payload = parseUpdatePayload(request.data);
  try {
    return await services.store.updateFamily({
      academyId: actor.academyId,
      actorId: actor.userId,
      familyId: payload.familyId,
      operation: payload.operation,
      now: services.now?.() ?? new Date().toISOString(),
    });
  } catch (error) {
    return mapFamilyError(error, "write");
  }
}

function familyCallableServices(): FamilyCallableServices {
  return {
    store: createFamilyStore({
      auth: {
        getUser: async (userId) => ({ uid: (await getAuth().getUser(userId)).uid }),
      },
      firestore: getFirestore() as unknown as Parameters<typeof createFamilyStore>[0]["firestore"],
    }),
  };
}

export const createFamily = onCall(async (request) =>
  createFamilyHandler(request, familyCallableServices()),
);

export const getFamily = onCall(async (request) =>
  getFamilyHandler(request, familyCallableServices()),
);

export const updateFamily = onCall(async (request) =>
  updateFamilyHandler(request, familyCallableServices()),
);
