import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { HttpsError, onCall, type CallableRequest } from "firebase-functions/v2/https";

import { requireAdminActor } from "../auth/admin-authorization.js";
import { appendAuditEventInTransaction } from "../audit/audit-writer.js";
import { withSharedRoleLock, type SyntheticFirestore } from "../auth/admin-provisioning.js";
import {
  createStaffStore,
  MAX_STAFF_LIST_RECORDS,
  MAX_STAFF_REPLACEMENT_RECORDS,
  StaffStoreError,
  toStaffAssignmentProjection,
  toStaffAvailabilityProjection,
  type ReplaceStaffAssignmentsInput,
  type ReplaceStaffAvailabilityInput,
  type StaffProfileProjection,
  toStaffProfileProjection,
  type StaffStore,
} from "./staff-service.js";

type StaffAuthService = Readonly<{
  getUser: (userId: string) => Promise<Readonly<{ customClaims?: Record<string, unknown> }>>;
  setCustomUserClaims: (userId: string, claims: Record<string, unknown>) => Promise<void>;
}>;

type ClaimsLockControl = Readonly<{ retain: () => void }>;

export type StaffCallableServices = Readonly<{
  auth: StaffAuthService;
  store: StaffStore;
  withClaimsLock: <T>(
    academyId: string,
    actorId: string,
    userId: string,
    operation: (control: ClaimsLockControl) => Promise<T>,
  ) => Promise<T>;
  now?: () => string;
}>;

const staffRoles = ["headCoach", "coach"] as const;
const assignmentTypes = ["location", "program", "class"] as const;
const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const localTimePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/u;
const staffProjectionFields = Object.freeze([
  "staffKey",
  "role",
  "active",
  "status",
  "schemaVersion",
] as const);

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function text(value: unknown): value is string {
  return typeof value === "string" && identifierPattern.test(value);
}

function isDenseArray(value: unknown): value is readonly unknown[] {
  if (!Array.isArray(value)) return false;
  const keys = Reflect.ownKeys(value);
  if (keys.length !== value.length + 1 || !keys.includes("length")) return false;
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) return false;
  }
  return true;
}

function invalidPayload(): never {
  throw new HttpsError("invalid-argument", "Staff payload is invalid");
}

function exactFields(value: Record<string, unknown>, fields: readonly string[]): boolean {
  const keys = Reflect.ownKeys(value);
  return (
    keys.length === fields.length &&
    keys.every((key) => {
      if (typeof key !== "string" || !fields.includes(key)) return false;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return (
        descriptor?.enumerable === true &&
        descriptor.get === undefined &&
        descriptor.set === undefined
      );
    })
  );
}

function payloadRecord(value: unknown, fields: readonly string[]): Record<string, unknown> {
  if (!isPlainRecord(value) || !exactFields(value, fields)) return invalidPayload();
  return value;
}

function parseCreate(value: unknown) {
  const payload = payloadRecord(value, ["userId", "role", "requestId"]);
  if (
    !text(payload.userId) ||
    !text(payload.requestId) ||
    !staffRoles.includes(payload.role as never)
  ) {
    return invalidPayload();
  }
  return {
    userId: payload.userId,
    role: payload.role as "headCoach" | "coach",
    requestId: payload.requestId,
  };
}

function parseUpdate(value: unknown) {
  const payload = payloadRecord(value, ["staffKey", "role"]);
  if (!text(payload.staffKey) || !staffRoles.includes(payload.role as never))
    return invalidPayload();
  return { staffId: payload.staffKey, role: payload.role as "headCoach" | "coach" };
}

function parseActive(value: unknown) {
  const payload = payloadRecord(value, ["staffKey", "active"]);
  if (!text(payload.staffKey) || typeof payload.active !== "boolean") return invalidPayload();
  return { staffId: payload.staffKey, active: payload.active };
}

function parseAssignments(value: unknown): ReplaceStaffAssignmentsInput["assignments"] {
  if (!isDenseArray(value) || value.length > MAX_STAFF_REPLACEMENT_RECORDS) return invalidPayload();
  return Object.freeze(
    value.map((item) => {
      const payload = payloadRecord(item, ["targetType", "targetId"]);
      if (!assignmentTypes.includes(payload.targetType as never) || !text(payload.targetId)) {
        return invalidPayload();
      }
      return {
        targetType: payload.targetType as "location" | "program" | "class",
        targetId: payload.targetId,
      };
    }),
  );
}

function parseAvailability(value: unknown): ReplaceStaffAvailabilityInput["windows"] {
  if (!isDenseArray(value) || value.length > MAX_STAFF_REPLACEMENT_RECORDS) return invalidPayload();
  return Object.freeze(
    value.map((item) => {
      const payload = payloadRecord(item, ["weekday", "startLocal", "endLocal", "timezone"]);
      if (
        typeof payload.weekday !== "number" ||
        !Number.isInteger(payload.weekday) ||
        payload.weekday < 0 ||
        payload.weekday > 6 ||
        typeof payload.startLocal !== "string" ||
        !localTimePattern.test(payload.startLocal) ||
        typeof payload.endLocal !== "string" ||
        !localTimePattern.test(payload.endLocal) ||
        typeof payload.timezone !== "string" ||
        payload.timezone.trim().length === 0
      ) {
        return invalidPayload();
      }
      return {
        weekday: payload.weekday,
        startLocal: payload.startLocal,
        endLocal: payload.endLocal,
        timezone: payload.timezone,
      };
    }),
  );
}

function mapStoreError(error: unknown): never {
  if (error instanceof HttpsError) throw error;
  if (error instanceof StaffStoreError) {
    if (error.code === "invalid")
      throw new HttpsError("invalid-argument", "Staff payload is invalid");
    if (error.code === "tenant" || error.code === "duplicate" || error.code === "conflict") {
      throw new HttpsError("permission-denied", "Staff operation is not permitted");
    }
    throw new HttpsError("failed-precondition", "Staff data is not available");
  }
  throw new HttpsError("internal", "Staff operation failed");
}

function safeStaffProjection(value: unknown): StaffProfileProjection {
  if (
    !isPlainRecord(value) ||
    !exactFields(value, staffProjectionFields) ||
    !text(value.staffKey) ||
    !staffRoles.includes(value.role as never) ||
    typeof value.active !== "boolean" ||
    (value.status !== "active" && value.status !== "inactive") ||
    value.active !== (value.status === "active") ||
    value.schemaVersion !== "1"
  ) {
    throw new StaffStoreError("invalid", "Staff projection is invalid");
  }
  return Object.freeze({
    staffKey: value.staffKey,
    role: value.role as StaffProfileProjection["role"],
    active: value.active,
    status: value.status,
    schemaVersion: "1",
  });
}

function safeStaffProjectionList(value: unknown): readonly StaffProfileProjection[] {
  if (!isDenseArray(value) || value.length > MAX_STAFF_LIST_RECORDS) {
    throw new StaffStoreError("invalid", "Staff projection list is invalid");
  }
  return Object.freeze(value.map(safeStaffProjection));
}

function safeAvailabilityProjectionList(
  value: unknown,
): readonly ReturnType<typeof toStaffAvailabilityProjection>[] {
  if (!isDenseArray(value) || value.length > MAX_STAFF_REPLACEMENT_RECORDS) {
    throw new StaffStoreError("invalid", "Staff availability result is invalid");
  }
  return Object.freeze(
    (value as Parameters<typeof toStaffAvailabilityProjection>[0][]).map(
      toStaffAvailabilityProjection,
    ),
  );
}

function safeAssignmentProjectionList(
  value: unknown,
): readonly ReturnType<typeof toStaffAssignmentProjection>[] {
  if (!isDenseArray(value) || value.length > MAX_STAFF_REPLACEMENT_RECORDS) {
    throw new StaffStoreError("invalid", "Staff assignment result is invalid");
  }
  return Object.freeze(
    (value as Parameters<typeof toStaffAssignmentProjection>[0][]).map(toStaffAssignmentProjection),
  );
}

async function readClaims(
  userId: string,
  services: StaffCallableServices,
): Promise<Record<string, unknown>> {
  try {
    return { ...(await services.auth.getUser(userId)).customClaims };
  } catch {
    throw new HttpsError("failed-precondition", "Staff account is not available");
  }
}

function assertClaimsScope(claims: Record<string, unknown>, academyId: string): void {
  const hasAdministrativeRole = claims.role === "owner" || claims.role === "administrator";
  if (
    (Object.hasOwn(claims, "academyId") && claims.academyId !== academyId) ||
    (hasAdministrativeRole && claims.academyId !== academyId)
  ) {
    throw new HttpsError("permission-denied", "Staff account scope is not permitted");
  }
}

function canonicalClaims(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalClaims);
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, canonicalClaims(nested)]),
    );
  }
  return value;
}

function sameClaims(left: Record<string, unknown>, right: Record<string, unknown>): boolean {
  return JSON.stringify(canonicalClaims(left)) === JSON.stringify(canonicalClaims(right));
}

function claimsWithoutStaffRole(claims: Record<string, unknown>): Record<string, unknown> {
  const safeClaims = { ...claims };
  delete safeClaims.role;
  return safeClaims;
}

async function applyClaims(
  actorId: string,
  userId: string,
  profile: {
    staffId: string;
    academyId: string;
    role: "headCoach" | "coach";
    active: boolean;
  },
  services: StaffCallableServices,
  control: ClaimsLockControl,
): Promise<void> {
  const current = await readClaims(userId, services);
  assertClaimsScope(current, profile.academyId);
  const hasAdministrativeRole = current.role === "owner" || current.role === "administrator";
  if (hasAdministrativeRole) return;
  const next: Record<string, unknown> = { ...current, academyId: profile.academyId };
  if (profile.active) next.role = profile.role;
  else delete next.role;
  if (sameClaims(current, next)) return;
  try {
    await services.auth.setCustomUserClaims(userId, next);
    const observed = await readClaims(userId, services);
    if (!sameClaims(observed, next)) {
      throw new HttpsError("aborted", "Staff claims synchronization diverged");
    }
  } catch (error) {
    let safeClaimsApplied = false;
    try {
      const observed = await readClaims(userId, services);
      if (sameClaims(observed, current) || sameClaims(observed, next)) {
        const safeClaims = claimsWithoutStaffRole(observed);
        await services.auth.setCustomUserClaims(userId, safeClaims);
        safeClaimsApplied = sameClaims(await readClaims(userId, services), safeClaims);
      }
    } catch {
      safeClaimsApplied = false;
    }
    if (!safeClaimsApplied) control.retain();
    try {
      await services.store.setStaffActive({
        academyId: profile.academyId,
        actorId,
        staffId: profile.staffId,
        active: false,
        now: services.now?.() ?? new Date().toISOString(),
      });
    } catch {
      control.retain();
      throw new HttpsError("internal", "Staff claims synchronization could not be quarantined");
    }
    if (!safeClaimsApplied) {
      throw new HttpsError("internal", "Staff claims synchronization could not be secured");
    }
    if (error instanceof HttpsError) throw error;
    throw new HttpsError("failed-precondition", "Staff claims synchronization failed");
  }
}

async function withClaimsMutation<T>(
  actorId: string,
  academyId: string,
  userId: string,
  services: StaffCallableServices,
  operation: (control: ClaimsLockControl) => Promise<T>,
): Promise<T> {
  return services.withClaimsLock(academyId, actorId, userId, async (control) => {
    assertClaimsScope(await readClaims(userId, services), academyId);
    return operation(control);
  });
}

async function syncClaimsAfterStore<
  T extends {
    staffId: string;
    userId: string;
    academyId: string;
    role: "headCoach" | "coach";
    active: boolean;
  },
>(
  actorId: string,
  profile: T,
  services: StaffCallableServices,
  control: ClaimsLockControl,
): Promise<T> {
  await applyClaims(actorId, profile.userId, profile, services, control);
  return profile;
}

export async function createStaffProfileHandler(
  request: CallableRequest<unknown>,
  services: StaffCallableServices,
) {
  const actor = requireAdminActor(request);
  const payload = parseCreate(request.data);
  try {
    const profile = await withClaimsMutation(
      actor.uid,
      actor.academyId,
      payload.userId,
      services,
      async (control) =>
        syncClaimsAfterStore(
          actor.uid,
          await services.store.createStaffProfile({
            academyId: actor.academyId,
            actorId: actor.uid,
            ...payload,
            now: services.now?.() ?? new Date().toISOString(),
          }),
          services,
          control,
        ),
    );
    return toStaffProfileProjection(profile);
  } catch (error) {
    return mapStoreError(error);
  }
}

export async function updateStaffProfileHandler(
  request: CallableRequest<unknown>,
  services: StaffCallableServices,
) {
  const actor = requireAdminActor(request);
  const payload = parseUpdate(request.data);
  try {
    const current = await services.store.getStaffProfile(actor.academyId, payload.staffId);
    const profile = await withClaimsMutation(
      actor.uid,
      actor.academyId,
      current.userId,
      services,
      async (control) =>
        syncClaimsAfterStore(
          actor.uid,
          await services.store.updateStaffProfile({
            academyId: actor.academyId,
            actorId: actor.uid,
            ...payload,
            now: services.now?.() ?? new Date().toISOString(),
          }),
          services,
          control,
        ),
    );
    return toStaffProfileProjection(profile);
  } catch (error) {
    return mapStoreError(error);
  }
}

export async function setStaffActiveHandler(
  request: CallableRequest<unknown>,
  services: StaffCallableServices,
) {
  const actor = requireAdminActor(request);
  const payload = parseActive(request.data);
  try {
    const current = await services.store.getStaffProfile(actor.academyId, payload.staffId);
    const profile = await withClaimsMutation(
      actor.uid,
      actor.academyId,
      current.userId,
      services,
      async (control) =>
        syncClaimsAfterStore(
          actor.uid,
          await services.store.setStaffActive({
            academyId: actor.academyId,
            actorId: actor.uid,
            ...payload,
            now: services.now?.() ?? new Date().toISOString(),
          }),
          services,
          control,
        ),
    );
    return toStaffProfileProjection(profile);
  } catch (error) {
    return mapStoreError(error);
  }
}

export async function replaceStaffAvailabilityHandler(
  request: CallableRequest<unknown>,
  services: StaffCallableServices,
) {
  const actor = requireAdminActor(request);
  const payload = payloadRecord(request.data, ["staffKey", "windows"]);
  if (!text(payload.staffKey)) return invalidPayload();
  try {
    const windows = await services.store.replaceStaffAvailability({
      academyId: actor.academyId,
      actorId: actor.uid,
      staffId: payload.staffKey,
      windows: parseAvailability(payload.windows),
    });
    return safeAvailabilityProjectionList(windows);
  } catch (error) {
    return mapStoreError(error);
  }
}

export async function replaceStaffAssignmentsHandler(
  request: CallableRequest<unknown>,
  services: StaffCallableServices,
) {
  const actor = requireAdminActor(request);
  const payload = payloadRecord(request.data, ["staffKey", "assignments"]);
  if (!text(payload.staffKey)) return invalidPayload();
  try {
    const assignments = await services.store.replaceStaffAssignments({
      academyId: actor.academyId,
      actorId: actor.uid,
      staffId: payload.staffKey,
      assignments: parseAssignments(payload.assignments),
    });
    return safeAssignmentProjectionList(assignments);
  } catch (error) {
    return mapStoreError(error);
  }
}

export async function listStaffProfilesHandler(
  request: CallableRequest<unknown>,
  services: StaffCallableServices,
) {
  const actor = requireAdminActor(request);
  payloadRecord(request.data, []);
  try {
    return safeStaffProjectionList(await services.store.listStaffProfiles(actor.academyId));
  } catch (error) {
    return mapStoreError(error);
  }
}

function callableServices(): StaffCallableServices {
  const firestore = getFirestore() as unknown as SyntheticFirestore;
  return {
    store: createStaffStore({
      firestore: firestore as unknown as Parameters<typeof createStaffStore>[0]["firestore"],
      appendAudit: (transaction, ref, draft) => {
        appendAuditEventInTransaction(transaction, ref, draft);
      },
    }),
    withClaimsLock: (academyId, actorId, userId, operation) =>
      withSharedRoleLock(firestore, academyId, actorId, userId, operation),
    auth: {
      getUser: async (userId) => {
        const user = await getAuth().getUser(userId);
        return { customClaims: user.customClaims ?? {} };
      },
      setCustomUserClaims: (userId, claims) => getAuth().setCustomUserClaims(userId, claims),
    },
  };
}

export const createStaffProfile = onCall(async (request) =>
  createStaffProfileHandler(request, callableServices()),
);
export const updateStaffProfile = onCall(async (request) =>
  updateStaffProfileHandler(request, callableServices()),
);
export const setStaffActive = onCall(async (request) =>
  setStaffActiveHandler(request, callableServices()),
);
export const replaceStaffAvailability = onCall(async (request) =>
  replaceStaffAvailabilityHandler(request, callableServices()),
);
export const replaceStaffAssignments = onCall(async (request) =>
  replaceStaffAssignmentsHandler(request, callableServices()),
);
export const listStaffProfiles = onCall(async (request) =>
  listStaffProfilesHandler(request, callableServices()),
);
