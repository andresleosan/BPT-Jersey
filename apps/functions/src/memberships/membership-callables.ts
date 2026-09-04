import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { HttpsError, onCall, type CallableRequest } from "firebase-functions/v2/https";

import {
  membershipStatuses,
  type MembershipRecord,
  type MembershipStatus,
} from "@bpt-jersey/domain/memberships/lifecycle";
import { planIds, type PlanId } from "@bpt-jersey/domain/memberships";
import { parseStudentProfile } from "@bpt-jersey/domain/profiles";
import type { UserActorContext } from "@bpt-jersey/domain";
import type { StaffFamilyProjection } from "@bpt-jersey/domain/families";

import { requireUserActor } from "../auth/user-authorization.js";
import { createFamilyStore, type FamilyStore } from "../families/family-service.js";
import {
  createMembershipStore,
  MembershipStoreError,
  type MembershipScope,
  type MembershipStore,
} from "./membership-service.js";

export type MembershipStudentScope = Readonly<{
  studentId: string;
  familyId: string;
  participantType: "adult" | "minor";
  active: boolean;
  status: "active" | "inactive" | "suspended";
}>;

type MembershipFamilyStore = Pick<FamilyStore, "getGuardianFamily" | "getStaffFamily">;

export type MembershipCallableServices = Readonly<{
  store: MembershipStore;
  familyStore: MembershipFamilyStore;
  findStudentByUserId: (
    academyId: string,
    userId: string,
  ) => Promise<MembershipStudentScope | undefined>;
  isActorActive: (actor: UserActorContext) => Promise<boolean>;
  now?: () => string;
}>;

export type MembershipProjection = Readonly<{
  membershipId: string;
  familyId: string;
  studentId: string;
  planId: PlanId;
  status: MembershipStatus;
  startsAt: string;
  endsAt: string | null;
  nextBillingAt: string | null;
}>;

const safeIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const createFields = ["familyId", "studentId", "planId", "status"] as const;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
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

function invalidPayload(): never {
  throw new HttpsError("invalid-argument", "Membership payload is invalid");
}

function exactFields(value: Record<string, unknown>, fields: readonly string[]): boolean {
  try {
    const keys = Reflect.ownKeys(value);
    return (
      keys.length === fields.length &&
      keys.every((key) => typeof key === "string" && fields.includes(key))
    );
  } catch {
    return false;
  }
}

function parseId(value: unknown): string {
  if (typeof value !== "string" || !safeIdPattern.test(value)) return invalidPayload();
  return value;
}

function parsePlanId(value: unknown): PlanId {
  if (
    typeof value !== "string" ||
    !safeIdPattern.test(value) ||
    !planIds.includes(value as PlanId)
  ) {
    return invalidPayload();
  }
  return value as PlanId;
}

function parseStatus(value: unknown): MembershipStatus {
  if (typeof value !== "string" || !membershipStatuses.includes(value as MembershipStatus)) {
    return invalidPayload();
  }
  return value as MembershipStatus;
}

function descriptorValue(value: Record<string, unknown>, field: string): unknown {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, field);
    if (
      descriptor === undefined ||
      descriptor.enumerable !== true ||
      descriptor.get !== undefined ||
      descriptor.set !== undefined ||
      !Object.hasOwn(descriptor, "value")
    ) {
      return invalidPayload();
    }
    return descriptor.value;
  } catch {
    return invalidPayload();
  }
}

function parseNoPayload(value: unknown): void {
  if (value !== null) invalidPayload();
}

function parseMembershipIdPayload(value: unknown): string {
  if (!isPlainRecord(value) || !exactFields(value, ["membershipId"])) return invalidPayload();
  return parseId(descriptorValue(value, "membershipId"));
}

function parseTransitionPayload(value: unknown): Readonly<{
  membershipId: string;
  targetStatus: MembershipStatus;
}> {
  if (!isPlainRecord(value) || !exactFields(value, ["membershipId", "targetStatus"])) {
    return invalidPayload();
  }
  return Object.freeze({
    membershipId: parseId(descriptorValue(value, "membershipId")),
    targetStatus: parseStatus(descriptorValue(value, "targetStatus")),
  });
}

function parseCreatePayload(value: unknown): Readonly<{
  familyId: string;
  studentId: string;
  planId: PlanId;
  status: "trial" | "active";
}> {
  if (!isPlainRecord(value) || !exactFields(value, createFields)) return invalidPayload();
  const familyId = parseId(descriptorValue(value, "familyId"));
  const studentId = parseId(descriptorValue(value, "studentId"));
  const planId = parsePlanId(descriptorValue(value, "planId"));
  const status = descriptorValue(value, "status");
  if (status !== "trial" && status !== "active") return invalidPayload();
  return Object.freeze({
    familyId,
    studentId,
    planId,
    status,
  });
}

function permissionDenied(): never {
  throw new HttpsError("permission-denied", "Membership access is not permitted");
}

async function requireActiveActor(
  request: CallableRequest<unknown>,
  services: MembershipCallableServices,
): Promise<UserActorContext> {
  const actor = requireUserActor(request);
  try {
    if (!(await services.isActorActive(actor))) permissionDenied();
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    throw new HttpsError("failed-precondition", "Membership operation is not available");
  }
  return actor;
}

async function requireReader(
  request: CallableRequest<unknown>,
  services: MembershipCallableServices,
): Promise<UserActorContext> {
  const actor = await requireActiveActor(request, services);
  if (!["owner", "administrator", "guardian", "adultStudent"].includes(actor.role)) {
    permissionDenied();
  }
  return actor;
}

async function requireAdministrator(
  request: CallableRequest<unknown>,
  services: MembershipCallableServices,
): Promise<UserActorContext> {
  const actor = await requireActiveActor(request, services);
  if (actor.role !== "owner" && actor.role !== "administrator") permissionDenied();
  return actor;
}

function assertTenant(record: MembershipRecord, academyId: string): void {
  if (record.academyId !== academyId) permissionDenied();
}

function scopeContains(scope: MembershipScope, record: MembershipRecord): boolean {
  return (
    scope.academyId === record.academyId &&
    (scope.familyIds === undefined || scope.familyIds.includes(record.familyId)) &&
    (scope.studentIds === undefined || scope.studentIds.includes(record.studentId)) &&
    (scope.membershipIds === undefined || scope.membershipIds.includes(record.membershipId))
  );
}

async function guardianScope(
  actor: UserActorContext,
  services: MembershipCallableServices,
  requestedFamilyId?: string,
  requestedStudentId?: string,
): Promise<MembershipScope> {
  const projection = await services.familyStore.getGuardianFamily(actor.academyId, actor.userId);
  if (
    projection === undefined ||
    !projection.family.active ||
    projection.family.status !== "active" ||
    (projection.family.familyId !== requestedFamilyId && requestedFamilyId !== undefined)
  ) {
    permissionDenied();
  }
  const staffProjection: StaffFamilyProjection | undefined =
    await services.familyStore.getStaffFamily(actor.academyId, projection.family.familyId);
  if (
    staffProjection === undefined ||
    staffProjection.family.academyId !== actor.academyId ||
    staffProjection.family.familyId !== projection.family.familyId ||
    !staffProjection.family.active ||
    staffProjection.family.status !== "active"
  ) {
    permissionDenied();
  }
  const relatedStudentIds = new Set(
    projection.students
      .filter((student) => student.active && student.status === "active")
      .map((student) => student.studentId),
  );
  const studentIds = staffProjection.students
    .filter(
      (student) =>
        student.participantType === "minor" &&
        student.academyId === actor.academyId &&
        student.familyId === projection.family.familyId &&
        student.active &&
        student.status === "active" &&
        relatedStudentIds.has(student.studentId),
    )
    .map((student) => student.studentId);
  if (requestedStudentId !== undefined && !studentIds.includes(requestedStudentId)) {
    permissionDenied();
  }
  if (studentIds.length === 0) permissionDenied();
  return Object.freeze({
    academyId: actor.academyId,
    familyIds: Object.freeze([projection.family.familyId]),
    studentIds: Object.freeze(requestedStudentId === undefined ? studentIds : [requestedStudentId]),
  });
}

async function adultStudentScope(
  actor: UserActorContext,
  services: MembershipCallableServices,
  requestedFamilyId?: string,
  requestedStudentId?: string,
): Promise<MembershipScope> {
  const student = await services.findStudentByUserId(actor.academyId, actor.userId);
  if (
    student === undefined ||
    student.participantType !== "adult" ||
    !student.active ||
    student.status !== "active"
  ) {
    permissionDenied();
  }
  if (
    (requestedFamilyId !== undefined && requestedFamilyId !== student.familyId) ||
    (requestedStudentId !== undefined && requestedStudentId !== student.studentId)
  ) {
    permissionDenied();
  }
  const family = await services.familyStore.getStaffFamily(actor.academyId, student.familyId);
  if (
    family === undefined ||
    family.family.academyId !== actor.academyId ||
    family.family.familyId !== student.familyId ||
    !family.family.active ||
    family.family.status !== "active"
  ) {
    permissionDenied();
  }
  return Object.freeze({
    academyId: actor.academyId,
    familyIds: Object.freeze([student.familyId]),
    studentIds: Object.freeze([student.studentId]),
  });
}

async function readerScope(
  actor: UserActorContext,
  services: MembershipCallableServices,
  familyId?: string,
  studentId?: string,
): Promise<MembershipScope> {
  if (actor.role === "owner" || actor.role === "administrator") {
    return Object.freeze({ academyId: actor.academyId });
  }
  if (actor.role === "guardian") {
    return guardianScope(actor, services, familyId, studentId);
  }
  if (actor.role === "adultStudent") {
    return adultStudentScope(actor, services, familyId, studentId);
  }
  return permissionDenied();
}

function projectMembership(record: MembershipRecord, academyId: string): MembershipProjection {
  assertTenant(record, academyId);
  return Object.freeze({
    membershipId: record.membershipId,
    familyId: record.familyId,
    studentId: record.studentId,
    planId: record.planId,
    status: record.status,
    startsAt: record.startsAt,
    endsAt: record.endsAt,
    nextBillingAt: record.nextBillingAt,
  });
}

function mapMembershipError(error: unknown): never {
  if (error instanceof HttpsError) throw error;
  if (error instanceof MembershipStoreError && error.code === "tenant") permissionDenied();
  throw new HttpsError("failed-precondition", "Membership operation is not available");
}

export async function listMembershipsHandler(
  request: CallableRequest<unknown>,
  services: MembershipCallableServices,
): Promise<readonly MembershipProjection[]> {
  const actor = await requireReader(request, services);
  parseNoPayload(request.data);
  try {
    const scope = await readerScope(actor, services);
    const records = await services.store.listMemberships(scope);
    return Object.freeze(
      records.map((record) => {
        if (!scopeContains(scope, record)) permissionDenied();
        return projectMembership(record, actor.academyId);
      }),
    );
  } catch (error) {
    return mapMembershipError(error);
  }
}

export async function getMembershipHandler(
  request: CallableRequest<unknown>,
  services: MembershipCallableServices,
): Promise<MembershipProjection> {
  const actor = await requireReader(request, services);
  const membershipId = parseMembershipIdPayload(request.data);
  try {
    const baseScope = await readerScope(actor, services);
    const scope = Object.freeze({ ...baseScope, membershipIds: Object.freeze([membershipId]) });
    const record = await services.store.getMembership(scope, membershipId);
    if (record === undefined) {
      if (actor.role === "owner" || actor.role === "administrator") {
        throw new HttpsError("failed-precondition", "Membership operation is not available");
      }
      permissionDenied();
    }
    if (!scopeContains(scope, record)) permissionDenied();
    return projectMembership(record, actor.academyId);
  } catch (error) {
    return mapMembershipError(error);
  }
}

export async function createMembershipHandler(
  request: CallableRequest<unknown>,
  services: MembershipCallableServices,
): Promise<MembershipProjection> {
  const actor = await requireReader(request, services);
  const payload = parseCreatePayload(request.data);
  try {
    const scope =
      actor.role === "owner" || actor.role === "administrator"
        ? Object.freeze({
            academyId: actor.academyId,
            familyIds: Object.freeze([payload.familyId]),
            studentIds: Object.freeze([payload.studentId]),
          })
        : await readerScope(actor, services, payload.familyId, payload.studentId);
    if (actor.role !== "owner" && actor.role !== "administrator" && payload.status !== "trial") {
      permissionDenied();
    }
    const record = await services.store.createMembership({
      academyId: actor.academyId,
      actorId: actor.userId,
      now: services.now?.() ?? new Date().toISOString(),
      familyId: payload.familyId,
      studentId: payload.studentId,
      planId: payload.planId,
      status: payload.status,
      scope,
    });
    if (!scopeContains(scope, record)) permissionDenied();
    return projectMembership(record, actor.academyId);
  } catch (error) {
    return mapMembershipError(error);
  }
}

async function transitionMembershipWithStatus(
  actor: UserActorContext,
  membershipId: string,
  targetStatus: MembershipStatus,
  services: MembershipCallableServices,
): Promise<MembershipProjection> {
  const baseScope = Object.freeze({
    academyId: actor.academyId,
    membershipIds: Object.freeze([membershipId]),
  });
  const current = await services.store.getMembership(baseScope, membershipId);
  if (current === undefined) {
    throw new HttpsError("failed-precondition", "Membership operation is not available");
  }
  assertTenant(current, actor.academyId);
  const scope = Object.freeze({
    academyId: actor.academyId,
    familyIds: Object.freeze([current.familyId]),
    studentIds: Object.freeze([current.studentId]),
    membershipIds: Object.freeze([membershipId]),
  });
  const record = await services.store.transitionMembership({
    academyId: actor.academyId,
    actorId: actor.userId,
    now: services.now?.() ?? new Date().toISOString(),
    membershipId,
    targetStatus,
    scope,
  });
  if (!scopeContains(scope, record)) permissionDenied();
  return projectMembership(record, actor.academyId);
}

export async function transitionMembershipHandler(
  request: CallableRequest<unknown>,
  services: MembershipCallableServices,
): Promise<MembershipProjection> {
  const actor = await requireAdministrator(request, services);
  const payload = parseTransitionPayload(request.data);
  try {
    return await transitionMembershipWithStatus(
      actor,
      payload.membershipId,
      payload.targetStatus,
      services,
    );
  } catch (error) {
    return mapMembershipError(error);
  }
}

export async function cancelMembershipHandler(
  request: CallableRequest<unknown>,
  services: MembershipCallableServices,
): Promise<MembershipProjection> {
  const actor = await requireAdministrator(request, services);
  const membershipId = parseMembershipIdPayload(request.data);
  try {
    return await transitionMembershipWithStatus(actor, membershipId, "cancelled", services);
  } catch (error) {
    return mapMembershipError(error);
  }
}

async function findStudentByUserId(
  academyId: string,
  userId: string,
): Promise<MembershipStudentScope | undefined> {
  if (!safeIdPattern.test(academyId) || !safeIdPattern.test(userId)) return undefined;
  const snapshot = await getFirestore()
    .collection(`academies/${academyId}/students`)
    .where("userId", "==", userId)
    .limit(2)
    .get();
  if (snapshot.docs.length !== 1) return undefined;
  const document = snapshot.docs[0];
  if (document === undefined) return undefined;
  const parsed = parseStudentProfile(document.data());
  if (!parsed.ok || document.id !== parsed.value.studentId) return undefined;
  const student = parsed.value;
  if (
    student.academyId !== academyId ||
    student.userId !== userId ||
    student.familyId === undefined
  ) {
    return undefined;
  }
  return {
    studentId: student.studentId,
    familyId: student.familyId,
    participantType: student.participantType,
    active: student.active,
    status: student.status,
  };
}

function membershipCallableServices(): MembershipCallableServices {
  const firestore = getFirestore();
  return {
    store: createMembershipStore({
      firestore: firestore as unknown as Parameters<typeof createMembershipStore>[0]["firestore"],
    }),
    familyStore: createFamilyStore({
      auth: {
        getUser: async (userId) => ({ uid: (await getAuth().getUser(userId)).uid }),
      },
      firestore: firestore as unknown as Parameters<typeof createFamilyStore>[0]["firestore"],
    }),
    findStudentByUserId,
    isActorActive: async (actor) => !(await getAuth().getUser(actor.userId)).disabled,
  };
}

export const membershipCallableOptions = { enforceAppCheck: true };

export const listMemberships = onCall(membershipCallableOptions, async (request) =>
  listMembershipsHandler(request, membershipCallableServices()),
);

export const getMembership = onCall(membershipCallableOptions, async (request) =>
  getMembershipHandler(request, membershipCallableServices()),
);

export const createMembership = onCall(membershipCallableOptions, async (request) =>
  createMembershipHandler(request, membershipCallableServices()),
);

export const transitionMembership = onCall(membershipCallableOptions, async (request) =>
  transitionMembershipHandler(request, membershipCallableServices()),
);

export const cancelMembership = onCall(membershipCallableOptions, async (request) =>
  cancelMembershipHandler(request, membershipCallableServices()),
);
