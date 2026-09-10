import { getApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { defineSecret } from "firebase-functions/params";
import { HttpsError, onCall, type CallableRequest } from "firebase-functions/v2/https";

import {
  parseFamilyStudentDraft,
  type FamilyStudentDraft,
  type GuardianFamilyProjection,
  type StaffFamilyProjection,
} from "@bpt-jersey/domain/families";

import { requireUserActor } from "../auth/user-authorization.js";
import { matchesProvisionedMemberDirectoryActor } from "../members/member-directory-actor-authorization.js";
import {
  createFamilyStore,
  FamilyStoreError,
  type FamilyStore,
  type UpdateFamilyInput,
} from "./family-service.js";

const identityKeySecret = defineSecret("MEMBER_DIRECTORY_IDENTITY_KEY_SECRET");
const migrationIntegritySecret = defineSecret("MEMBER_DIRECTORY_MIGRATION_INTEGRITY_SECRET");
const identitySecretVersion = "identity-v1";
const integritySecretVersion = "integrity-v1";

type FamilyActorStatusInput = Readonly<{
  uid: string;
  academyId: string;
  role: "owner" | "administrator" | "guardian";
}>;

type FamilyAdministrativeActor = Readonly<{
  userId: string;
  academyId: string;
  role: "owner" | "administrator";
}>;

type FamilyActivityAuthUser = Readonly<{
  uid: string;
  disabled: boolean;
  customClaims?: Readonly<Record<string, unknown>>;
}>;

type FamilyActivityDocument = Readonly<{
  exists: boolean;
  data: () => unknown;
}>;

export type FamilyActorActivityDependencies = Readonly<{
  getAuthUser: (uid: string) => Promise<FamilyActivityAuthUser>;
  getDocument: (path: string) => Promise<FamilyActivityDocument>;
}>;

export type FamilyCallableServices = Readonly<{
  store: FamilyStore;
  isActorActive: (input: FamilyActorStatusInput) => Promise<boolean>;
  now?: () => string;
}>;

type FamilyCreatePayload = Readonly<{
  requestId: string;
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
  if (!isPlainRecord(value) || !exactFields(value, ["requestId", "tutorUserId", "students"])) {
    return invalidPayload();
  }
  if (!Array.isArray(value.students) || value.students.length === 0) return invalidPayload();
  return Object.freeze({
    requestId: parseId(value.requestId),
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
    if (!exactFields(value, ["kind", "requestId", "student"])) return invalidPayload();
    return Object.freeze({
      kind: "addStudent",
      requestId: parseId(value.requestId),
      student: parseStudentDraft(value.student),
    });
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

export function createFamilyActorActivityCheck(
  dependencies: FamilyActorActivityDependencies,
): FamilyCallableServices["isActorActive"] {
  return async ({ uid, academyId, role }) => {
    try {
      const authUser = await dependencies.getAuthUser(uid);
      const claims = authUser.customClaims;
      if (
        authUser.uid !== uid ||
        authUser.disabled ||
        !isPlainRecord(claims) ||
        claims.academyId !== academyId ||
        claims.role !== role
      ) {
        return false;
      }
      if (role === "guardian") return true;

      const [adminDocument, roleLock] = await Promise.all([
        dependencies.getDocument(`academies/${academyId}/users/${uid}`),
        dependencies.getDocument(`academies/${academyId}/adminRoleLocks/${uid}`),
      ]);
      if (!adminDocument.exists || roleLock.exists) {
        return false;
      }
      return matchesProvisionedMemberDirectoryActor(adminDocument.data(), {
        actorId: uid,
        academyId,
        role,
      });
    } catch {
      return false;
    }
  };
}

async function requireAdministrativeRole(
  request: CallableRequest<unknown>,
  services: FamilyCallableServices,
): Promise<FamilyAdministrativeActor> {
  const actor = requireUserActor(request);
  const role = actor.role;
  if (role !== "owner" && role !== "administrator") {
    throw new HttpsError("permission-denied", "Family access is not permitted");
  }
  if (request.app === undefined) {
    throw new HttpsError("unauthenticated", "Verified App Check is required");
  }
  let active: boolean;
  try {
    active = await services.isActorActive({
      uid: actor.userId,
      academyId: actor.academyId,
      role,
    });
  } catch {
    throw new HttpsError("failed-precondition", "Administrative account status is unavailable");
  }
  if (!active) {
    throw new HttpsError("permission-denied", "An active administrative account is required");
  }
  return Object.freeze({
    userId: actor.userId,
    academyId: actor.academyId,
    role,
  });
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
  const actor = await requireAdministrativeRole(request, services);
  const payload = parseCreatePayload(request.data);
  try {
    return await services.store.createFamily({
      academyId: actor.academyId,
      actorId: actor.userId,
      actorRole: actor.role,
      requestId: payload.requestId,
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
  if (request.app === undefined) {
    throw new HttpsError("unauthenticated", "Verified App Check is required");
  }
  const actor = requireUserActor(request);
  try {
    if (actor.role === "guardian") {
      if (request.data !== null) invalidPayload();
      if (
        !(await services.isActorActive({
          uid: actor.userId,
          academyId: actor.academyId,
          role: "guardian",
        }))
      ) {
        throw new HttpsError("permission-denied", "Family access is not permitted");
      }
      const projection = await services.store.getGuardianFamily(actor.academyId, actor.userId);
      if (projection === undefined) {
        throw new HttpsError("permission-denied", "Family access is not permitted");
      }
      return projection;
    }
    if (actor.role !== "owner" && actor.role !== "administrator") {
      throw new HttpsError("permission-denied", "Family access is not permitted");
    }
    const administrativeActor = await requireAdministrativeRole(request, services);
    const familyId = parseStaffGetPayload(request.data);
    const projection = await services.store.getStaffFamilyForActor({
      academyId: administrativeActor.academyId,
      actorId: administrativeActor.userId,
      actorRole: administrativeActor.role,
      familyId,
    });
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
  const actor = await requireAdministrativeRole(request, services);
  const payload = parseUpdatePayload(request.data);
  try {
    return await services.store.updateFamily({
      academyId: actor.academyId,
      actorId: actor.userId,
      actorRole: actor.role,
      familyId: payload.familyId,
      operation: payload.operation,
      now: services.now?.() ?? new Date().toISOString(),
    });
  } catch (error) {
    return mapFamilyError(error, "write");
  }
}

function requiredProjectId(): string {
  const projectId = getApp().options.projectId;
  if (typeof projectId !== "string" || projectId.length === 0) {
    throw new HttpsError("failed-precondition", "Firebase project binding is unavailable");
  }
  return projectId;
}

function familyCallableServices(writerEnabled: boolean): FamilyCallableServices {
  const auth = getAuth();
  const firestore = getFirestore();
  return {
    store: createFamilyStore({
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
      ...(writerEnabled
        ? {
            canonicalControl: {
              projectId: requiredProjectId(),
              identitySecretMaterial: identityKeySecret.value(),
              identitySecretVersion,
              integritySecretMaterial: migrationIntegritySecret.value(),
              integritySecretVersion,
            },
          }
        : {}),
    }),
    isActorActive: createFamilyActorActivityCheck({
      getAuthUser: (uid) => auth.getUser(uid),
      getDocument: (path) => firestore.doc(path).get(),
    }),
  };
}

const familyWriterCallableOptions = {
  enforceAppCheck: true,
  secrets: [identityKeySecret, migrationIntegritySecret],
};

export const familyReadCallableOptions = { enforceAppCheck: true };

export const createFamily = onCall(familyWriterCallableOptions, async (request) =>
  createFamilyHandler(request, familyCallableServices(true)),
);

export const getFamily = onCall(familyReadCallableOptions, async (request) =>
  getFamilyHandler(request, familyCallableServices(false)),
);

export const updateFamily = onCall(familyWriterCallableOptions, async (request) =>
  updateFamilyHandler(request, familyCallableServices(true)),
);
