import { createHash } from "node:crypto";

import type { AuditEventDraft } from "@bpt-jersey/domain/audit";
import {
  parseStaffAvailabilityWindow,
  parseStaffProfile,
  parseStaffRoleAssignment,
  type StaffAvailabilityWindow,
  type StaffProfile,
  type StaffRole,
  type StaffRoleAssignment,
} from "@bpt-jersey/domain/staff";

export type StaffDocumentData = Readonly<Record<string, unknown>>;
export type StaffDocumentReference = Readonly<{ id: string; path: string }>;
export type StaffDocumentSnapshot = Readonly<{
  id: string;
  exists: boolean;
  data: () => StaffDocumentData | undefined;
}>;
export type StaffQuerySnapshot = Readonly<{
  docs: readonly StaffDocumentSnapshot[];
}>;
export type StaffQuery = Readonly<{
  path: string;
  field?: string;
  value?: unknown;
  limit: number;
}>;
export type StaffCollectionReference = Readonly<{
  doc: (id?: string) => StaffDocumentReference;
  limit: (count: number) => StaffQuery;
  where: (
    field: string,
    operator: "==",
    value: unknown,
  ) => Readonly<{ limit: (count: number) => StaffQuery }>;
}>;
export type StaffTransaction = Readonly<{
  get: (
    target: StaffDocumentReference | StaffQuery,
  ) => Promise<StaffDocumentSnapshot | StaffQuerySnapshot>;
  create: (ref: StaffDocumentReference, data: StaffDocumentData) => StaffTransaction;
  set: (ref: StaffDocumentReference, data: StaffDocumentData) => StaffTransaction;
}>;
export type StaffFirestore = Readonly<{
  doc: (path: string) => StaffDocumentReference;
  collection: (path: string) => StaffCollectionReference;
  runTransaction: <T>(callback: (transaction: StaffTransaction) => Promise<T>) => Promise<T>;
}>;

export type CreateStaffProfileInput = Readonly<{
  academyId: string;
  actorId: string;
  userId: string;
  role: StaffRole;
  now: string;
  requestId: string;
}>;

export type UpdateStaffProfileInput = Readonly<{
  academyId: string;
  actorId: string;
  staffId: string;
  role: StaffRole;
  now: string;
}>;

export type SetStaffActiveInput = Readonly<{
  academyId: string;
  actorId: string;
  staffId: string;
  active: boolean;
  now: string;
}>;

export type StaffAvailabilityDraft = Readonly<
  Omit<StaffAvailabilityWindow, "academyId" | "staffId">
>;

export type ReplaceStaffAvailabilityInput = Readonly<{
  academyId: string;
  actorId: string;
  staffId: string;
  windows: readonly StaffAvailabilityDraft[];
}>;

export type StaffAssignmentDraft = Readonly<Omit<StaffRoleAssignment, "academyId" | "staffId">>;

export type ReplaceStaffAssignmentsInput = Readonly<{
  academyId: string;
  actorId: string;
  staffId: string;
  assignments: readonly StaffAssignmentDraft[];
}>;

export type StaffProfileProjection = Readonly<{
  staffKey: string;
  role: StaffRole;
  active: boolean;
  status: "active" | "inactive";
  schemaVersion: "1";
}>;

export type StaffAvailabilityProjection = Readonly<
  Pick<StaffAvailabilityWindow, "weekday" | "startLocal" | "endLocal" | "timezone">
>;

export type StaffAssignmentProjection = Readonly<
  Pick<StaffRoleAssignment, "targetType" | "targetId">
>;

export type StaffStore = Readonly<{
  getStaffProfile: (academyId: string, staffId: string) => Promise<StaffProfile>;
  listStaffProfiles: (academyId: string) => Promise<readonly StaffProfileProjection[]>;
  createStaffProfile: (input: CreateStaffProfileInput) => Promise<StaffProfile>;
  updateStaffProfile: (input: UpdateStaffProfileInput) => Promise<StaffProfile>;
  setStaffActive: (input: SetStaffActiveInput) => Promise<StaffProfile>;
  replaceStaffAvailability: (
    input: ReplaceStaffAvailabilityInput,
  ) => Promise<readonly StaffAvailabilityWindow[]>;
  replaceStaffAssignments: (
    input: ReplaceStaffAssignmentsInput,
  ) => Promise<readonly StaffRoleAssignment[]>;
}>;

export type StaffStoreDependencies = Readonly<{
  firestore: StaffFirestore;
  now?: () => string;
  appendAudit: (
    transaction: StaffTransaction,
    ref: StaffDocumentReference,
    draft: AuditEventDraft,
  ) => void;
}>;

export class StaffStoreError extends Error {
  public readonly code:
    "invalid" | "tenant" | "duplicate" | "not-found" | "conflict" | "precondition";

  public constructor(StaffStoreErrorCode: StaffStoreError["code"], message: string) {
    super(message);
    this.name = "StaffStoreError";
    this.code = StaffStoreErrorCode;
  }
}

const safePathSegmentPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
export const MAX_STAFF_LIST_RECORDS = 100;
export const MAX_STAFF_REPLACEMENT_RECORDS = 100;
const dateTimePattern =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:?\d{2})$/u;
const storedAvailabilityFields = Object.freeze([
  "academyId",
  "staffId",
  "weekday",
  "startLocal",
  "endLocal",
  "timezone",
  "active",
  "updatedAt",
] as const);
const storedAssignmentFields = Object.freeze([
  "academyId",
  "staffId",
  "targetType",
  "targetId",
  "active",
  "updatedAt",
] as const);

function pathSegment(value: unknown, label: string): string {
  if (typeof value !== "string" || !safePathSegmentPattern.test(value)) {
    throw new StaffStoreError("tenant", `Invalid ${label}`);
  }
  return value;
}

function validNow(value: unknown): string {
  if (
    typeof value !== "string" ||
    !dateTimePattern.test(value) ||
    Number.isNaN(Date.parse(value))
  ) {
    throw new StaffStoreError("invalid", "Invalid staff timestamp");
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})/u.exec(value);
  if (match === null) throw new StaffStoreError("invalid", "Invalid staff timestamp");
  const calendar = new Date(0);
  calendar.setUTCFullYear(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  calendar.setUTCHours(0, 0, 0, 0);
  if (
    calendar.getUTCFullYear() !== Number(match[1]) ||
    calendar.getUTCMonth() !== Number(match[2]) - 1 ||
    calendar.getUTCDate() !== Number(match[3])
  ) {
    throw new StaffStoreError("invalid", "Invalid staff timestamp");
  }
  return value;
}

function staffPath(academyId: string, staffId: string): string {
  return `academies/${pathSegment(academyId, "academy")}/staff/${pathSegment(staffId, "staff")}`;
}

function staffCollectionPath(academyId: string): string {
  return `academies/${pathSegment(academyId, "academy")}/staff`;
}

function userPath(academyId: string, userId: string): string {
  return `academies/${pathSegment(academyId, "academy")}/users/${pathSegment(userId, "user")}`;
}

function availabilityCollectionPath(academyId: string): string {
  return `academies/${pathSegment(academyId, "academy")}/staffAvailability`;
}

function availabilityPath(academyId: string, id: string): string {
  return `${availabilityCollectionPath(academyId)}/${pathSegment(id, "availability")}`;
}

function assignmentCollectionPath(academyId: string): string {
  return `academies/${pathSegment(academyId, "academy")}/staffAssignments`;
}

function assignmentId(assignment: StaffRoleAssignment): string {
  return createHash("sha256")
    .update(
      `${assignment.academyId}|${assignment.staffId}|${assignment.targetType}|${assignment.targetId}`,
    )
    .digest("hex")
    .slice(0, 40);
}

function assignmentPath(academyId: string, id: string): string {
  return `${assignmentCollectionPath(academyId)}/${pathSegment(id, "assignment")}`;
}

function targetPath(academyId: string, targetType: string, targetId: string): string {
  const collection =
    targetType === "location" ? "locations" : targetType === "class" ? "classes" : "programs";
  return `academies/${pathSegment(academyId, "academy")}/${collection}/${pathSegment(targetId, "target")}`;
}

function auditEventsPath(academyId: string): string {
  return `academies/${pathSegment(academyId, "academy")}/auditEvents`;
}

function isQuerySnapshot(
  value: StaffDocumentSnapshot | StaffQuerySnapshot,
): value is StaffQuerySnapshot {
  return "docs" in value;
}

function documentSnapshot(
  value: StaffDocumentSnapshot | StaffQuerySnapshot,
): StaffDocumentSnapshot {
  if (isQuerySnapshot(value)) throw new StaffStoreError("invalid", "Expected document snapshot");
  return value;
}

function querySnapshot(value: StaffDocumentSnapshot | StaffQuerySnapshot): StaffQuerySnapshot {
  if (!isQuerySnapshot(value)) throw new StaffStoreError("invalid", "Expected query snapshot");
  return value;
}

function storedStaff(snapshot: StaffDocumentSnapshot, expectedStaffId: string): StaffProfile {
  if (!snapshot.exists) throw new StaffStoreError("not-found", "Staff profile is unavailable");
  if (snapshot.id !== expectedStaffId) {
    throw new StaffStoreError("invalid", "Staff identity is invalid");
  }
  const parsed = parseStaffProfile(snapshot.data());
  if (!parsed.ok) throw new StaffStoreError("invalid", "Stored staff profile is invalid");
  if (parsed.value.staffId !== expectedStaffId) {
    throw new StaffStoreError("invalid", "Staff identity is invalid");
  }
  return parsed.value;
}

export function toStaffProfileProjection(profile: StaffProfile): StaffProfileProjection {
  return Object.freeze({
    staffKey: profile.staffId,
    role: profile.role,
    active: profile.active,
    status: profile.status,
    schemaVersion: profile.schemaVersion,
  });
}

export function toStaffAvailabilityProjection(
  window: StaffAvailabilityWindow,
): StaffAvailabilityProjection {
  return Object.freeze({
    weekday: window.weekday,
    startLocal: window.startLocal,
    endLocal: window.endLocal,
    timezone: window.timezone,
  });
}

export function toStaffAssignmentProjection(
  assignment: StaffRoleAssignment,
): StaffAssignmentProjection {
  return Object.freeze({
    targetType: assignment.targetType,
    targetId: assignment.targetId,
  });
}

function assertActive(staff: StaffProfile): void {
  if (!staff.active || staff.status !== "active") {
    throw new StaffStoreError("precondition", "Staff profile is inactive");
  }
}

function assertUserIdentity(
  snapshot: StaffDocumentSnapshot,
  academyId: string,
  userId: string,
): StaffDocumentData {
  if (!snapshot.exists) throw new StaffStoreError("precondition", "Canonical user is unavailable");
  const data = snapshot.data();
  if (
    data === undefined ||
    snapshot.id !== userId ||
    data.userId !== userId ||
    data.academyId !== academyId
  ) {
    throw new StaffStoreError("tenant", "Canonical user tenant mismatch");
  }
  if (data.accountType !== "staff") {
    throw new StaffStoreError("precondition", "Canonical user is not eligible");
  }
  return data;
}

function assertUser(snapshot: StaffDocumentSnapshot, academyId: string, userId: string): void {
  const data = assertUserIdentity(snapshot, academyId, userId);
  if (data.active !== true || data.status !== "active") {
    throw new StaffStoreError("precondition", "Canonical user is not eligible");
  }
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

function parseAvailability(
  academyId: string,
  staffId: string,
  windows: readonly StaffAvailabilityDraft[],
): readonly StaffAvailabilityWindow[] {
  if (!isDenseArray(windows) || windows.length > MAX_STAFF_REPLACEMENT_RECORDS) {
    throw new StaffStoreError(
      "precondition",
      "Staff availability exceeds the safe replacement limit",
    );
  }
  const parsed = windows.map((window) => {
    const result = parseStaffAvailabilityWindow({ academyId, staffId, ...window });
    if (!result.ok) throw new StaffStoreError("invalid", "Invalid staff availability");
    return result.value;
  });
  const grouped = new Map<string, StaffAvailabilityWindow[]>();
  for (const window of parsed) {
    const key = `${window.weekday}:${window.timezone}`;
    const current = grouped.get(key) ?? [];
    current.push(window);
    grouped.set(key, current);
  }
  for (const windowsForKey of grouped.values()) {
    windowsForKey.sort((left, right) => left.startLocal.localeCompare(right.startLocal));
    for (let index = 1; index < windowsForKey.length; index += 1) {
      if (windowsForKey[index]!.startLocal < windowsForKey[index - 1]!.endLocal) {
        throw new StaffStoreError("conflict", "Staff availability windows overlap");
      }
    }
  }
  return Object.freeze([...parsed]);
}

function parseAssignments(
  academyId: string,
  staffId: string,
  assignments: readonly StaffAssignmentDraft[],
): readonly StaffRoleAssignment[] {
  if (!isDenseArray(assignments) || assignments.length > MAX_STAFF_REPLACEMENT_RECORDS) {
    throw new StaffStoreError(
      "precondition",
      "Staff assignments exceed the safe replacement limit",
    );
  }
  const parsed = assignments.map((assignment) => {
    const result = parseStaffRoleAssignment({ academyId, staffId, ...assignment });
    if (!result.ok) throw new StaffStoreError("invalid", "Invalid staff assignment");
    return result.value;
  });
  const keys = parsed.map((assignment) => `${assignment.targetType}:${assignment.targetId}`);
  if (new Set(keys).size !== keys.length) {
    throw new StaffStoreError("conflict", "Duplicate staff assignment target");
  }
  return Object.freeze([...parsed]);
}

function availabilityId(window: StaffAvailabilityWindow): string {
  return createHash("sha256")
    .update(
      `${window.academyId}|${window.staffId}|${window.weekday}|${window.startLocal}|${window.endLocal}|${window.timezone}`,
    )
    .digest("hex")
    .slice(0, 40);
}

function appendStaffAudit(
  dependencies: StaffStoreDependencies,
  transaction: StaffTransaction,
  academyId: string,
  actorId: string,
  staffId: string,
  action:
    | "staff.created"
    | "staff.updated"
    | "staff.status.changed"
    | "staff.availability.replaced"
    | "staff.assignments.replaced",
): void {
  const auditReference = dependencies.firestore.collection(auditEventsPath(academyId)).doc();
  dependencies.appendAudit(transaction, auditReference, {
    academyId,
    actorId,
    action,
    targetRef: staffPath(academyId, staffId),
    purpose: "staff lifecycle operation",
    correlationId: `staff:${staffId}:${auditReference.id}`,
  } as unknown as AuditEventDraft);
}

function requestStaffId(academyId: string, userId: string, requestId: string): string {
  return createHash("sha256")
    .update(`${academyId}|${userId}|${requestId}`)
    .digest("hex")
    .slice(0, 40);
}

function storedActiveRecord(data: StaffDocumentData | undefined): boolean {
  return data?.active === true;
}

function hasExactStoredFields(
  data: StaffDocumentData | undefined,
  fields: readonly string[],
): data is StaffDocumentData {
  if (data === undefined) return false;
  const keys = Reflect.ownKeys(data);
  return (
    keys.length === fields.length &&
    keys.every((key) => {
      if (typeof key !== "string" || !fields.includes(key)) return false;
      const descriptor = Object.getOwnPropertyDescriptor(data, key);
      return (
        descriptor?.enumerable === true &&
        descriptor.get === undefined &&
        descriptor.set === undefined &&
        Object.hasOwn(descriptor, "value")
      );
    })
  );
}

type StoredStaffAvailability = Readonly<
  StaffAvailabilityWindow & { active: boolean; updatedAt: string }
>;

type StoredStaffAssignment = Readonly<StaffRoleAssignment & { active: boolean; updatedAt: string }>;

function storedAvailability(
  snapshot: StaffDocumentSnapshot,
  academyId: string,
  staffId: string,
  requireCanonicalId = false,
): StoredStaffAvailability {
  const data = snapshot.data();
  if (
    !snapshot.exists ||
    !hasExactStoredFields(data, storedAvailabilityFields) ||
    typeof data.active !== "boolean" ||
    data.academyId !== academyId ||
    data.staffId !== staffId
  ) {
    throw new StaffStoreError("invalid", "Stored staff availability is invalid");
  }
  const parsed = parseStaffAvailabilityWindow({
    academyId: data.academyId,
    staffId: data.staffId,
    weekday: data.weekday,
    startLocal: data.startLocal,
    endLocal: data.endLocal,
    timezone: data.timezone,
  });
  if (!parsed.ok || typeof data.updatedAt !== "string") {
    throw new StaffStoreError("invalid", "Stored staff availability is invalid");
  }
  if (requireCanonicalId && snapshot.id !== availabilityId(parsed.value)) {
    throw new StaffStoreError("invalid", "Stored staff availability ID is invalid");
  }
  const updatedAt = validNow(data.updatedAt);
  return Object.freeze({ ...parsed.value, active: data.active, updatedAt });
}

function storedAssignment(
  snapshot: StaffDocumentSnapshot,
  academyId: string,
  staffId: string,
  requireCanonicalId = false,
): StoredStaffAssignment {
  const data = snapshot.data();
  if (
    !snapshot.exists ||
    !hasExactStoredFields(data, storedAssignmentFields) ||
    typeof data.active !== "boolean" ||
    data.academyId !== academyId ||
    data.staffId !== staffId
  ) {
    throw new StaffStoreError("invalid", "Stored staff assignment is invalid");
  }
  const parsed = parseStaffRoleAssignment({
    academyId: data.academyId,
    staffId: data.staffId,
    targetType: data.targetType,
    targetId: data.targetId,
  });
  if (!parsed.ok || typeof data.updatedAt !== "string") {
    throw new StaffStoreError("invalid", "Stored staff assignment is invalid");
  }
  if (requireCanonicalId && snapshot.id !== assignmentId(parsed.value)) {
    throw new StaffStoreError("invalid", "Stored staff assignment ID is invalid");
  }
  const updatedAt = validNow(data.updatedAt);
  return Object.freeze({ ...parsed.value, active: data.active, updatedAt });
}

function assertQueryWithinLimit(snapshot: StaffQuerySnapshot, label: string): void {
  if (snapshot.docs.length > MAX_STAFF_REPLACEMENT_RECORDS) {
    throw new StaffStoreError("precondition", `${label} exceeds the safe replacement limit`);
  }
}

function sameAvailability(
  data: StaffAvailabilityWindow | undefined,
  window: StaffAvailabilityWindow,
): boolean {
  return (
    data?.academyId === window.academyId &&
    data?.staffId === window.staffId &&
    data?.weekday === window.weekday &&
    data?.startLocal === window.startLocal &&
    data?.endLocal === window.endLocal &&
    data?.timezone === window.timezone
  );
}

function sameAssignment(
  data: StaffRoleAssignment | undefined,
  assignment: StaffRoleAssignment,
): boolean {
  return (
    data?.academyId === assignment.academyId &&
    data?.staffId === assignment.staffId &&
    data?.targetType === assignment.targetType &&
    data?.targetId === assignment.targetId
  );
}

export function createStaffStore(dependencies: StaffStoreDependencies): StaffStore {
  const now = dependencies.now ?? (() => new Date().toISOString());

  return Object.freeze({
    async getStaffProfile(academyIdInput, staffIdInput) {
      const academyId = pathSegment(academyIdInput, "academy");
      const staffId = pathSegment(staffIdInput, "staff");
      const reference = dependencies.firestore.doc(staffPath(academyId, staffId));
      return dependencies.firestore.runTransaction(async (transaction) => {
        const profile = storedStaff(documentSnapshot(await transaction.get(reference)), staffId);
        if (profile.academyId !== academyId) {
          throw new StaffStoreError("tenant", "Staff tenant mismatch");
        }
        return profile;
      });
    },

    async listStaffProfiles(academyIdInput) {
      const academyId = pathSegment(academyIdInput, "academy");
      const collection = dependencies.firestore.collection(staffCollectionPath(academyId));
      const query = collection.limit(MAX_STAFF_LIST_RECORDS + 1);
      return dependencies.firestore.runTransaction(async (transaction) => {
        const snapshot = querySnapshot(await transaction.get(query));
        if (snapshot.docs.length > MAX_STAFF_LIST_RECORDS) {
          throw new StaffStoreError("precondition", "Staff list exceeds the safe limit");
        }
        const profiles = snapshot.docs.map((document) => {
          const profile = storedStaff(document, document.id);
          if (profile.academyId !== academyId) {
            throw new StaffStoreError("tenant", "Staff tenant mismatch");
          }
          return profile;
        });
        profiles.sort((left, right) => left.staffId.localeCompare(right.staffId));
        return Object.freeze(profiles.map(toStaffProfileProjection));
      });
    },

    async createStaffProfile(input) {
      const academyId = pathSegment(input.academyId, "academy");
      const actorId = pathSegment(input.actorId, "actor");
      const userId = pathSegment(input.userId, "user");
      const timestamp = validNow(input.now);
      const requestId = pathSegment(input.requestId, "request");
      const staffId = requestStaffId(academyId, userId, requestId);
      const staffReference = dependencies.firestore.doc(staffPath(academyId, staffId));
      const userReference = dependencies.firestore.doc(userPath(academyId, userId));
      const existingStaffQuery = dependencies.firestore
        .collection(staffCollectionPath(academyId))
        .where("userId", "==", userId)
        .limit(MAX_STAFF_REPLACEMENT_RECORDS + 1);

      return dependencies.firestore.runTransaction(async (transaction) => {
        const userSnapshot = documentSnapshot(await transaction.get(userReference));
        assertUser(userSnapshot, academyId, userId);
        const requestedSnapshot = documentSnapshot(await transaction.get(staffReference));
        if (requestedSnapshot.exists) {
          const existingProfile = storedStaff(requestedSnapshot, staffId);
          if (
            existingProfile.academyId === academyId &&
            existingProfile.userId === userId &&
            existingProfile.role === input.role
          ) {
            return existingProfile;
          }
          throw new StaffStoreError("conflict", "Staff request conflicts with existing profile");
        }
        const existing = querySnapshot(await transaction.get(existingStaffQuery));
        assertQueryWithinLimit(existing, "Staff identity");
        for (const snapshot of existing.docs) {
          if (!snapshot.exists) continue;
          const data = snapshot.data();
          if (data?.academyId !== academyId) {
            throw new StaffStoreError("tenant", "Existing staff tenant mismatch");
          }
          if (storedActiveRecord(data)) {
            throw new StaffStoreError("duplicate", "Duplicate active staff profile");
          }
        }

        const record = {
          staffId,
          academyId,
          userId,
          role: input.role,
          active: true,
          status: "active",
          schemaVersion: "1",
          createdAt: timestamp,
          createdBy: actorId,
          updatedAt: timestamp,
          updatedBy: actorId,
        };
        const parsed = parseStaffProfile(record);
        if (!parsed.ok) throw new StaffStoreError("invalid", "Invalid staff profile input");
        transaction.create(staffReference, parsed.value);
        appendStaffAudit(dependencies, transaction, academyId, actorId, staffId, "staff.created");
        return parsed.value;
      });
    },

    async updateStaffProfile(input) {
      const academyId = pathSegment(input.academyId, "academy");
      const actorId = pathSegment(input.actorId, "actor");
      const staffId = pathSegment(input.staffId, "staff");
      const timestamp = validNow(input.now);
      const reference = dependencies.firestore.doc(staffPath(academyId, staffId));
      return dependencies.firestore.runTransaction(async (transaction) => {
        const current = storedStaff(documentSnapshot(await transaction.get(reference)), staffId);
        if (current.academyId !== academyId) {
          throw new StaffStoreError("tenant", "Staff tenant mismatch");
        }
        assertUserIdentity(
          documentSnapshot(
            await transaction.get(dependencies.firestore.doc(userPath(academyId, current.userId))),
          ),
          academyId,
          current.userId,
        );
        if (current.role === input.role) return current;
        const next: StaffProfile = {
          ...current,
          role: input.role,
          updatedAt: timestamp,
          updatedBy: actorId,
        };
        const parsed = parseStaffProfile(next);
        if (!parsed.ok) throw new StaffStoreError("invalid", "Invalid staff profile update");
        transaction.set(reference, parsed.value);
        appendStaffAudit(dependencies, transaction, academyId, actorId, staffId, "staff.updated");
        return parsed.value;
      });
    },

    async setStaffActive(input) {
      const academyId = pathSegment(input.academyId, "academy");
      const actorId = pathSegment(input.actorId, "actor");
      const staffId = pathSegment(input.staffId, "staff");
      const timestamp = validNow(input.now);
      if (typeof input.active !== "boolean") {
        throw new StaffStoreError("invalid", "Invalid staff active state");
      }
      const reference = dependencies.firestore.doc(staffPath(academyId, staffId));
      const availabilityCollection = dependencies.firestore.collection(
        availabilityCollectionPath(academyId),
      );
      const assignmentCollection = dependencies.firestore.collection(
        assignmentCollectionPath(academyId),
      );
      return dependencies.firestore.runTransaction(async (transaction) => {
        const current = storedStaff(documentSnapshot(await transaction.get(reference)), staffId);
        if (current.academyId !== academyId) {
          throw new StaffStoreError("tenant", "Staff tenant mismatch");
        }
        const user = assertUserIdentity(
          documentSnapshot(
            await transaction.get(dependencies.firestore.doc(userPath(academyId, current.userId))),
          ),
          academyId,
          current.userId,
        );
        if (input.active && (user.active !== true || user.status !== "active")) {
          throw new StaffStoreError("precondition", "Canonical user is not eligible");
        }
        let activeAvailability: StaffQuerySnapshot | undefined;
        let activeAssignments: StaffQuerySnapshot | undefined;
        if (!input.active) {
          activeAvailability = querySnapshot(
            await transaction.get(
              availabilityCollection
                .where("staffId", "==", staffId)
                .limit(MAX_STAFF_REPLACEMENT_RECORDS + 1),
            ),
          );
          activeAssignments = querySnapshot(
            await transaction.get(
              assignmentCollection
                .where("staffId", "==", staffId)
                .limit(MAX_STAFF_REPLACEMENT_RECORDS + 1),
            ),
          );
          assertQueryWithinLimit(activeAvailability, "Staff availability");
          assertQueryWithinLimit(activeAssignments, "Staff assignments");
        }
        const next: StaffProfile = {
          ...current,
          active: input.active,
          status: input.active ? "active" : "inactive",
          updatedAt: timestamp,
          updatedBy: actorId,
        };
        const parsed = parseStaffProfile(next);
        if (!parsed.ok) throw new StaffStoreError("invalid", "Invalid staff status update");
        const profileChanged = current.active !== input.active;
        const activeAvailabilityRecords = (activeAvailability?.docs ?? [])
          .filter((snapshot) => storedActiveRecord(snapshot.data()))
          .map((snapshot) => ({
            snapshot,
            record: storedAvailability(snapshot, academyId, staffId),
          }));
        const activeAssignmentRecords = (activeAssignments?.docs ?? [])
          .filter((snapshot) => storedActiveRecord(snapshot.data()))
          .map((snapshot) => ({
            snapshot,
            record: storedAssignment(snapshot, academyId, staffId),
          }));
        const hasActiveDerivedRecords =
          activeAvailabilityRecords.length > 0 || activeAssignmentRecords.length > 0;
        if (!profileChanged && !hasActiveDerivedRecords) return current;
        for (const { snapshot, record } of activeAvailabilityRecords) {
          transaction.set(dependencies.firestore.doc(availabilityPath(academyId, snapshot.id)), {
            ...record,
            active: false,
            updatedAt: timestamp,
          });
        }
        for (const { snapshot, record } of activeAssignmentRecords) {
          transaction.set(dependencies.firestore.doc(assignmentPath(academyId, snapshot.id)), {
            ...record,
            active: false,
            updatedAt: timestamp,
          });
        }
        if (profileChanged) transaction.set(reference, parsed.value);
        appendStaffAudit(
          dependencies,
          transaction,
          academyId,
          actorId,
          staffId,
          "staff.status.changed",
        );
        return profileChanged ? parsed.value : current;
      });
    },

    async replaceStaffAvailability(input) {
      const academyId = pathSegment(input.academyId, "academy");
      const actorId = pathSegment(input.actorId, "actor");
      const staffId = pathSegment(input.staffId, "staff");
      const windows = parseAvailability(academyId, staffId, input.windows);
      const staffReference = dependencies.firestore.doc(staffPath(academyId, staffId));
      const collection = dependencies.firestore.collection(availabilityCollectionPath(academyId));
      return dependencies.firestore.runTransaction(async (transaction) => {
        const staff = storedStaff(documentSnapshot(await transaction.get(staffReference)), staffId);
        if (staff.academyId !== academyId) {
          throw new StaffStoreError("tenant", "Staff tenant mismatch");
        }
        assertActive(staff);
        const existing = querySnapshot(
          await transaction.get(
            collection.where("staffId", "==", staffId).limit(MAX_STAFF_REPLACEMENT_RECORDS + 1),
          ),
        );
        assertQueryWithinLimit(existing, "Staff availability");
        const existingRecords = existing.docs.map((snapshot) => ({
          snapshot,
          record: storedAvailability(snapshot, academyId, staffId, true),
        }));
        const desiredIds = new Set(windows.map(availabilityId));
        let changed = false;
        for (const { snapshot, record } of existingRecords) {
          if (record.active && !desiredIds.has(snapshot.id)) {
            transaction.set(
              dependencies.firestore.doc(
                snapshot.id.includes("/") ? snapshot.id : availabilityPath(academyId, snapshot.id),
              ),
              {
                ...record,
                active: false,
                updatedAt: now(),
              },
            );
            changed = true;
          }
        }
        for (const window of windows) {
          const id = availabilityId(window);
          const currentRecord = existingRecords.find(({ snapshot }) => snapshot.id === id)?.record;
          const current = currentRecord?.active === true ? currentRecord : undefined;
          if (!sameAvailability(current, window)) {
            transaction.set(dependencies.firestore.doc(availabilityPath(academyId, id)), {
              ...window,
              active: true,
              updatedAt: now(),
            });
            changed = true;
          }
        }
        if (changed) {
          appendStaffAudit(
            dependencies,
            transaction,
            academyId,
            actorId,
            staffId,
            "staff.availability.replaced",
          );
        }
        return windows;
      });
    },

    async replaceStaffAssignments(input) {
      const academyId = pathSegment(input.academyId, "academy");
      const actorId = pathSegment(input.actorId, "actor");
      const staffId = pathSegment(input.staffId, "staff");
      const assignments = parseAssignments(academyId, staffId, input.assignments);
      const staffReference = dependencies.firestore.doc(staffPath(academyId, staffId));
      const collection = dependencies.firestore.collection(assignmentCollectionPath(academyId));
      return dependencies.firestore.runTransaction(async (transaction) => {
        const staff = storedStaff(documentSnapshot(await transaction.get(staffReference)), staffId);
        if (staff.academyId !== academyId) {
          throw new StaffStoreError("tenant", "Staff tenant mismatch");
        }
        assertActive(staff);
        const targetSnapshots = await Promise.all(
          assignments.map((assignment) =>
            transaction.get(
              dependencies.firestore.doc(
                targetPath(academyId, assignment.targetType, assignment.targetId),
              ),
            ),
          ),
        );
        targetSnapshots.forEach((value, index) => {
          const snapshot = documentSnapshot(value);
          const assignment = assignments[index]!;
          if (
            !snapshot.exists ||
            snapshot.id !== assignment.targetId ||
            snapshot.data()?.academyId !== academyId
          ) {
            throw new StaffStoreError("precondition", "Staff assignment target is unavailable");
          }
        });

        const existing = querySnapshot(
          await transaction.get(
            collection.where("staffId", "==", staffId).limit(MAX_STAFF_REPLACEMENT_RECORDS + 1),
          ),
        );
        assertQueryWithinLimit(existing, "Staff assignments");
        const existingRecords = existing.docs.map((snapshot) => ({
          snapshot,
          record: storedAssignment(snapshot, academyId, staffId, true),
        }));
        const desiredIds = new Set(assignments.map(assignmentId));
        let changed = false;
        for (const { snapshot, record } of existingRecords) {
          if (record.active && !desiredIds.has(snapshot.id)) {
            transaction.set(dependencies.firestore.doc(assignmentPath(academyId, snapshot.id)), {
              ...record,
              active: false,
              updatedAt: now(),
            });
            changed = true;
          }
        }
        for (const assignment of assignments) {
          const id = assignmentId(assignment);
          const currentRecord = existingRecords.find(({ snapshot }) => snapshot.id === id)?.record;
          const current = currentRecord?.active === true ? currentRecord : undefined;
          if (!sameAssignment(current, assignment)) {
            transaction.set(dependencies.firestore.doc(assignmentPath(academyId, id)), {
              ...assignment,
              active: true,
              updatedAt: now(),
            });
            changed = true;
          }
        }
        if (changed) {
          appendStaffAudit(
            dependencies,
            transaction,
            academyId,
            actorId,
            staffId,
            "staff.assignments.replaced",
          );
        }
        return assignments;
      });
    },
  });
}
