import { randomUUID, timingSafeEqual } from "node:crypto";

import {
  parseFamilyRecord,
  parseFamilyRelationship,
  parseFamilyStudentDraft,
  type FamilyRecord,
  type FamilyRelationship,
  type FamilyStudentDraft,
  type GuardianFamilyProjection,
  type StaffFamilyProjection,
} from "@bpt-jersey/domain/families";
import { parseAuditEventDraft, type AuditEventDraft } from "@bpt-jersey/domain/audit";
import {
  deriveParticipantType,
  parseStudentProfile,
  parseUserProfile,
  type StudentProfile,
  type UserProfile,
} from "@bpt-jersey/domain/profiles";
import type { MemberDirectoryState } from "@bpt-jersey/domain/members/directory";
import { z } from "zod";

import { appendAuditEventInTransaction, matchesAuditEventReplay } from "../audit/audit-writer.js";
import { matchesProvisionedMemberDirectoryActor } from "../members/member-directory-actor-authorization.js";
import {
  canonicalizeMemberDirectoryValue,
  constantTimeMacEquals,
  createMemberDirectoryIntegrityMac,
  decodeMemberDirectorySecret,
} from "../members/member-directory-crypto.js";
import {
  advanceMemberDirectoryControlPlane,
  assertCanonicalMemberDirectoryWriterReady,
  assertMemberDirectoryControlPlane,
  memberDirectoryRestoreGuardSchema,
  type MemberDirectoryGuardEvent,
  type MemberDirectoryRestoreGuard,
} from "../members/member-directory-state.js";

export type FamilyDocumentData = Readonly<Record<string, unknown>>;
export type FamilyDocumentReference = Readonly<{ id: string; path: string }>;
export type FamilyDocumentSnapshot = Readonly<{
  id: string;
  exists: boolean;
  data: () => FamilyDocumentData | undefined;
}>;
export type FamilyQuerySnapshot = Readonly<{
  docs: readonly FamilyDocumentSnapshot[];
}>;
export type FamilyQuery = Readonly<{ path: string; field: string; value: unknown; limit: number }>;
export type FamilyCollectionReference = Readonly<{
  doc: (id?: string) => FamilyDocumentReference;
  where: (
    field: string,
    operator: "==",
    value: unknown,
  ) => Readonly<{ limit: (count: number) => FamilyQuery }>;
}>;
export type FamilyTransaction = Readonly<{
  get: (
    target: FamilyDocumentReference | FamilyQuery,
  ) => Promise<FamilyDocumentSnapshot | FamilyQuerySnapshot>;
  create: (ref: FamilyDocumentReference, data: FamilyDocumentData) => FamilyTransaction;
  set: (ref: FamilyDocumentReference, data: FamilyDocumentData) => FamilyTransaction;
}>;
export type FamilyFirestore = Readonly<{
  doc: (path: string) => FamilyDocumentReference;
  collection: (path: string) => FamilyCollectionReference;
  runTransaction: <T>(callback: (transaction: FamilyTransaction) => Promise<T>) => Promise<T>;
}>;

export type FamilyAuthService = Readonly<{
  getUser: (userId: string) => Promise<
    Readonly<{
      uid: string;
      disabled?: boolean;
      customClaims?: Readonly<Record<string, unknown>>;
    }>
  >;
}>;

export type CreateFamilyInput = Readonly<{
  academyId: string;
  actorId: string;
  actorRole: "owner" | "administrator";
  requestId: string;
  tutorUserId: string;
  students: readonly FamilyStudentDraft[];
  now: string;
}>;

export type UpdateFamilyInput = Readonly<{
  academyId: string;
  actorId: string;
  actorRole: "owner" | "administrator";
  familyId: string;
  operation:
    | Readonly<{ kind: "replaceTutor"; tutorUserId: string }>
    | Readonly<{ kind: "addStudent"; requestId: string; student: FamilyStudentDraft }>
    | Readonly<{ kind: "deactivateRelationship"; studentId: string }>
    | Readonly<{ kind: "deactivateFamily" }>;
  now: string;
}>;

export type GetStaffFamilyInput = Readonly<{
  academyId: string;
  actorId: string;
  actorRole: "owner" | "administrator";
  familyId: string;
}>;

export type FamilyStore = Readonly<{
  createFamily: (input: CreateFamilyInput) => Promise<StaffFamilyProjection>;
  getStaffFamily: (
    academyId: string,
    familyId: string,
  ) => Promise<StaffFamilyProjection | undefined>;
  getStaffFamilyForActor: (
    input: GetStaffFamilyInput,
  ) => Promise<StaffFamilyProjection | undefined>;
  getGuardianFamily: (
    academyId: string,
    adultUserId: string,
  ) => Promise<GuardianFamilyProjection | undefined>;
  updateFamily: (input: UpdateFamilyInput) => Promise<StaffFamilyProjection>;
}>;

export type FamilyStoreDependencies = Readonly<{
  firestore: FamilyFirestore;
  auth: FamilyAuthService;
  canonicalControl?: Readonly<{
    projectId: string;
    identitySecretMaterial: string;
    identitySecretVersion: string;
    integritySecretMaterial: string;
    integritySecretVersion: string;
  }>;
  generateFamilyId?: () => string;
  generateStudentId?: () => string;
  generateAuditId?: () => string;
}>;

export class FamilyStoreError extends Error {
  public readonly code:
    "invalid" | "tenant" | "duplicate" | "conflict" | "not-found" | "precondition";

  public constructor(
    code: "invalid" | "tenant" | "duplicate" | "conflict" | "not-found" | "precondition",
    message: string,
  ) {
    super(message);
    this.name = "FamilyStoreError";
    this.code = code;
  }
}

const MAX_FAMILY_STUDENTS = 100;
const safePathSegmentPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const dateTimePattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const macPattern = /^[a-f0-9]{64}$/u;

const familyWriteReceiptSchema = z.strictObject({
  receiptId: z.string().regex(/^family-write-[a-f0-9]{64}$/u),
  academyId: z.string().regex(safePathSegmentPattern),
  actorId: z.string().regex(safePathSegmentPattern),
  requestMac: z.string().regex(macPattern),
  operation: z.enum(["family.create", "family.student.add"]),
  familyId: z.string().regex(safePathSegmentPattern),
  createdStudentIds: z
    .array(z.string().regex(safePathSegmentPattern))
    .min(1)
    .max(MAX_FAMILY_STUDENTS)
    .readonly(),
  auditEventId: z.string().regex(safePathSegmentPattern),
  stateRevisionBefore: z.number().int().nonnegative().safe(),
  stateRevisionAfter: z.number().int().positive().safe(),
  status: z.literal("completed"),
  createdAt: z.string().regex(dateTimePattern),
  schemaVersion: z.literal("1"),
});

type FamilyWriteReceipt = Readonly<z.infer<typeof familyWriteReceiptSchema>>;
type FamilyCanonicalDependencies = NonNullable<FamilyStoreDependencies["canonicalControl"]>;
type FamilyCanonicalControl = Readonly<{
  state: MemberDirectoryState;
  guard: MemberDirectoryRestoreGuard;
  event: MemberDirectoryGuardEvent;
  stateRef: FamilyDocumentReference;
  guardRef: FamilyDocumentReference;
}>;

function pathSegment(value: string, label: string): string {
  if (!safePathSegmentPattern.test(value)) throw new FamilyStoreError("tenant", `Invalid ${label}`);
  return value;
}

function validNow(value: string): string {
  const parsed = Date.parse(value);
  if (
    !dateTimePattern.test(value) ||
    Number.isNaN(parsed) ||
    new Date(parsed).toISOString() !== value
  ) {
    throw new FamilyStoreError("invalid", "Invalid family timestamp");
  }
  return value;
}

function familyPath(academyId: string, familyId: string): string {
  return `academies/${pathSegment(academyId, "academy")}/families/${pathSegment(familyId, "family")}`;
}

function familiesPath(academyId: string): string {
  return `academies/${pathSegment(academyId, "academy")}/families`;
}

function studentsPath(academyId: string): string {
  return `academies/${pathSegment(academyId, "academy")}/students`;
}

function studentPath(academyId: string, studentId: string): string {
  return `${studentsPath(academyId)}/${pathSegment(studentId, "student")}`;
}

function relationshipsPath(academyId: string): string {
  return `academies/${pathSegment(academyId, "academy")}/relationships`;
}

function relationshipPath(academyId: string, relationshipId: string): string {
  return `${relationshipsPath(academyId)}/${pathSegment(relationshipId, "relationship")}`;
}

function userPath(academyId: string, userId: string): string {
  return `academies/${pathSegment(academyId, "academy")}/users/${pathSegment(userId, "user")}`;
}

function adminRoleLockPath(academyId: string, userId: string): string {
  return `academies/${pathSegment(academyId, "academy")}/adminRoleLocks/${pathSegment(userId, "user")}`;
}

function statePath(academyId: string): string {
  return `academies/${pathSegment(academyId, "academy")}/memberDirectoryStates/current`;
}

function receiptPath(academyId: string, receiptId: string): string {
  return `academies/${pathSegment(academyId, "academy")}/familyWriteReceipts/${pathSegment(receiptId, "receipt")}`;
}

function auditPath(academyId: string, auditEventId: string): string {
  return `academies/${pathSegment(academyId, "academy")}/auditEvents/${pathSegment(auditEventId, "audit event")}`;
}

function guardPath(academyId: string): string {
  return `memberDirectoryRestoreGuards/${pathSegment(academyId, "academy")}`;
}

function guardEventPath(academyId: string, eventId: string): string {
  return `${guardPath(academyId)}/events/${pathSegment(eventId, "guard event")}`;
}

function validateCanonicalDependencies(
  value: FamilyStoreDependencies["canonicalControl"],
): FamilyCanonicalDependencies | undefined {
  if (value === undefined) return undefined;
  try {
    if (
      !safePathSegmentPattern.test(value.projectId) ||
      !safePathSegmentPattern.test(value.identitySecretVersion) ||
      !safePathSegmentPattern.test(value.integritySecretVersion)
    ) {
      throw new Error("Invalid canonical control binding");
    }
    const identity = decodeMemberDirectorySecret(value.identitySecretMaterial, "identity");
    const integrity = decodeMemberDirectorySecret(value.integritySecretMaterial, "integrity");
    if (identity.length === integrity.length && timingSafeEqual(identity, integrity)) {
      throw new Error("Canonical purpose secrets must be distinct");
    }
    return Object.freeze({ ...value });
  } catch {
    throw new FamilyStoreError("invalid", "Canonical family writer configuration is invalid");
  }
}

function requireCanonicalDependencies(
  value: FamilyCanonicalDependencies | undefined,
): FamilyCanonicalDependencies {
  if (value === undefined) {
    throw new FamilyStoreError("precondition", "Canonical family writer is unavailable");
  }
  return value;
}

function documentValue(snapshot: FamilyDocumentSnapshot, label: string): FamilyDocumentData {
  if (!snapshot.exists || snapshot.data() === undefined) {
    throw new FamilyStoreError("precondition", `${label} is unavailable`);
  }
  return snapshot.data() as FamilyDocumentData;
}

async function assertTransactionalAdministrativeActor(
  transaction: FamilyTransaction,
  firestore: FamilyFirestore,
  input: Readonly<{
    academyId: string;
    actorId: string;
    actorRole: "owner" | "administrator";
  }>,
): Promise<void> {
  const [actorSnapshot, roleLockSnapshot] = await Promise.all([
    transaction.get(firestore.doc(userPath(input.academyId, input.actorId))),
    transaction.get(firestore.doc(adminRoleLockPath(input.academyId, input.actorId))),
  ]);
  const actorDocument = readDocumentSnapshot(actorSnapshot);
  const roleLock = readDocumentSnapshot(roleLockSnapshot);
  const actor = actorDocument.data();
  if (
    !actorDocument.exists ||
    !matchesProvisionedMemberDirectoryActor(actor, {
      actorId: input.actorId,
      academyId: input.academyId,
      role: input.actorRole,
    }) ||
    roleLock.exists
  ) {
    throw new FamilyStoreError("precondition", "Administrative actor is not active");
  }
}

function familyRequestMac(
  academyId: string,
  actorId: string,
  operation: FamilyWriteReceipt["operation"],
  value: unknown,
  secretMaterial: string,
): string {
  try {
    return createMemberDirectoryIntegrityMac({
      domain: "bpt-family-write-request-v1",
      values: [academyId, actorId, operation, canonicalizeMemberDirectoryValue(value)],
      secretMaterial,
    });
  } catch {
    throw new FamilyStoreError("invalid", "Family request integrity binding is invalid");
  }
}

function familyReceiptId(
  academyId: string,
  actorId: string,
  operation: FamilyWriteReceipt["operation"],
  requestId: string,
  secretMaterial: string,
): string {
  try {
    const digest = createMemberDirectoryIntegrityMac({
      domain: "bpt-family-write-request-id-v1",
      values: [academyId, actorId, operation, requestId],
      secretMaterial,
    });
    return `family-write-${digest}`;
  } catch {
    throw new FamilyStoreError("invalid", "Family receipt identity is invalid");
  }
}

async function readCanonicalControl(
  transaction: FamilyTransaction,
  firestore: FamilyFirestore,
  academyId: string,
  dependencies: FamilyCanonicalDependencies,
): Promise<FamilyCanonicalControl> {
  try {
    const stateRef = firestore.doc(statePath(academyId));
    const guardRef = firestore.doc(guardPath(academyId));
    const [stateSnapshot, guardSnapshot] = await Promise.all([
      transaction.get(stateRef),
      transaction.get(guardRef),
    ]);
    const state = assertCanonicalMemberDirectoryWriterReady(
      documentValue(readDocumentSnapshot(stateSnapshot), "Member directory state"),
      {
        academyId,
        digestVersion: "hmac-sha256-v1",
        secretVersion: dependencies.identitySecretVersion,
      },
    );
    const parsedGuard = memberDirectoryRestoreGuardSchema.safeParse(
      documentValue(readDocumentSnapshot(guardSnapshot), "Member directory restore guard"),
    );
    if (!parsedGuard.success) throw new Error("Invalid member directory restore guard");
    const eventSnapshot = readDocumentSnapshot(
      await transaction.get(firestore.doc(guardEventPath(academyId, parsedGuard.data.lastEventId))),
    );
    const control = assertMemberDirectoryControlPlane({
      projectId: dependencies.projectId,
      state,
      guard: parsedGuard.data,
      event: documentValue(eventSnapshot, "Member directory guard event"),
      integritySecretMaterial: dependencies.integritySecretMaterial,
      integritySecretVersion: dependencies.integritySecretVersion,
    });
    return Object.freeze({
      ...control,
      stateRef,
      guardRef,
    });
  } catch (error) {
    if (error instanceof FamilyStoreError) throw error;
    throw new FamilyStoreError("precondition", "Canonical family writer is unavailable");
  }
}

function advanceCanonicalControl(
  firestore: FamilyFirestore,
  control: FamilyCanonicalControl,
  dependencies: FamilyCanonicalDependencies,
  input: Readonly<{
    academyId: string;
    actorId: string;
    operationId: string;
    addedStudentCount: number;
    now: string;
  }>,
) {
  const nextCount = control.state.globalLegacyReadEliminated
    ? control.state.rollbackEligibleStudentCount
    : control.state.rollbackEligibleStudentCount + input.addedStudentCount;
  if (nextCount > control.state.rollbackCapacityLimit) {
    throw new FamilyStoreError("precondition", "Member directory rollback capacity is exhausted");
  }
  const nextState: MemberDirectoryState = {
    ...control.state,
    stateRevision: control.state.stateRevision + 1,
    rollbackEligibleStudentCount: nextCount,
    updatedAt: input.now,
    updatedBy: input.actorId,
  };
  try {
    const nextControl = advanceMemberDirectoryControlPlane({
      projectId: dependencies.projectId,
      state: control.state,
      guard: control.guard,
      event: control.event,
      nextState,
      operationId: input.operationId,
      transitionKind: "family-minor-create",
      integritySecretMaterial: dependencies.integritySecretMaterial,
      integritySecretVersion: dependencies.integritySecretVersion,
      now: input.now,
      actorId: input.actorId,
    });
    return Object.freeze({
      state: nextState,
      guard: nextControl.guard,
      event: nextControl.event,
      eventRef: firestore.doc(guardEventPath(input.academyId, nextControl.event.eventId)),
    });
  } catch (error) {
    if (error instanceof FamilyStoreError) throw error;
    throw new FamilyStoreError("precondition", "Canonical family writer is unavailable");
  }
}

function isQuerySnapshot(
  value: FamilyDocumentSnapshot | FamilyQuerySnapshot,
): value is FamilyQuerySnapshot {
  return "docs" in value;
}

function readDocumentSnapshot(
  value: FamilyDocumentSnapshot | FamilyQuerySnapshot,
): FamilyDocumentSnapshot {
  if (isQuerySnapshot(value)) throw new FamilyStoreError("invalid", "Expected document snapshot");
  return value;
}

function readQuerySnapshot(
  value: FamilyDocumentSnapshot | FamilyQuerySnapshot,
): FamilyQuerySnapshot {
  if (!isQuerySnapshot(value)) throw new FamilyStoreError("invalid", "Expected query snapshot");
  return value;
}

function parseStoredFamily(snapshot: FamilyDocumentSnapshot): FamilyRecord {
  if (!snapshot.exists) throw new FamilyStoreError("not-found", "Family is not available");
  const parsed = parseFamilyRecord(snapshot.data());
  if (!parsed.ok) throw new FamilyStoreError("invalid", "Stored family is invalid");
  return parsed.value;
}

function parseStoredStudent(snapshot: FamilyDocumentSnapshot): StudentProfile {
  if (!snapshot.exists) throw new FamilyStoreError("invalid", "Stored student is missing");
  const parsed = parseStudentProfile(snapshot.data());
  if (!parsed.ok) throw new FamilyStoreError("invalid", "Stored student is invalid");
  return parsed.value;
}

function parseStoredRelationship(snapshot: FamilyDocumentSnapshot): FamilyRelationship {
  if (!snapshot.exists) throw new FamilyStoreError("invalid", "Stored relationship is missing");
  const parsed = parseFamilyRelationship(snapshot.data());
  if (!parsed.ok) throw new FamilyStoreError("invalid", "Stored relationship is invalid");
  return parsed.value;
}

function parseStoredTutor(snapshot: FamilyDocumentSnapshot, academyId: string): UserProfile {
  if (!snapshot.exists) throw new FamilyStoreError("precondition", "Tutor profile is missing");
  const parsed = parseUserProfile(snapshot.data());
  if (!parsed.ok) throw new FamilyStoreError("invalid", "Stored tutor profile is invalid");
  if (parsed.value.academyId !== academyId) {
    throw new FamilyStoreError("tenant", "Tutor profile tenant mismatch");
  }
  if (
    parsed.value.accountType !== "client" ||
    parsed.value.active !== true ||
    parsed.value.status !== "active"
  ) {
    throw new FamilyStoreError("precondition", "Tutor profile is not eligible");
  }
  return parsed.value;
}

async function readStudents(
  transaction: FamilyTransaction,
  firestore: FamilyFirestore,
  academyId: string,
  familyId: string,
): Promise<readonly StudentProfile[]> {
  const snapshot = readQuerySnapshot(
    await transaction.get(
      firestore
        .collection(studentsPath(academyId))
        .where("familyId", "==", familyId)
        .limit(MAX_FAMILY_STUDENTS + 1),
    ),
  );
  if (snapshot.docs.length > MAX_FAMILY_STUDENTS) {
    throw new FamilyStoreError("precondition", "Family has too many students");
  }
  const students = snapshot.docs.map(parseStoredStudent);
  if (
    students.some((student) => student.academyId !== academyId || student.familyId !== familyId)
  ) {
    throw new FamilyStoreError("tenant", "Student family tenant mismatch");
  }
  return Object.freeze(
    students.sort((left, right) => left.studentId.localeCompare(right.studentId)),
  );
}

async function readRelationships(
  transaction: FamilyTransaction,
  firestore: FamilyFirestore,
  academyId: string,
  familyId: string,
): Promise<readonly FamilyRelationship[]> {
  const snapshot = readQuerySnapshot(
    await transaction.get(
      firestore
        .collection(relationshipsPath(academyId))
        .where("familyId", "==", familyId)
        .limit(MAX_FAMILY_STUDENTS + 1),
    ),
  );
  if (snapshot.docs.length > MAX_FAMILY_STUDENTS) {
    throw new FamilyStoreError("precondition", "Family has too many relationships");
  }
  const relationships = snapshot.docs.map(parseStoredRelationship);
  if (
    relationships.some(
      (relationship) => relationship.academyId !== academyId || relationship.familyId !== familyId,
    )
  ) {
    throw new FamilyStoreError("tenant", "Relationship family tenant mismatch");
  }
  return Object.freeze(
    relationships.sort((left, right) => left.relationshipId.localeCompare(right.relationshipId)),
  );
}

function relationshipId(familyId: string, studentId: string): string {
  return `${familyId}--${studentId}`;
}

function validateDrafts(
  students: readonly FamilyStudentDraft[],
  today: string,
): readonly FamilyStudentDraft[] {
  if (students.length === 0 || students.length > MAX_FAMILY_STUDENTS) {
    throw new FamilyStoreError("invalid", "At least one student is required");
  }
  const parsed = students.map((student) => {
    const result = parseFamilyStudentDraft(student);
    if (!result.ok) throw new FamilyStoreError("invalid", "Family student draft is invalid");
    try {
      if (deriveParticipantType(result.value.dateOfBirth, today) !== "minor") {
        throw new FamilyStoreError("precondition", "Family students must be minors");
      }
    } catch (error) {
      if (error instanceof FamilyStoreError) throw error;
      throw new FamilyStoreError("invalid", "Family student date is invalid");
    }
    return result.value;
  });
  return Object.freeze(parsed);
}

async function verifyAuthUser(
  auth: FamilyAuthService,
  userId: string,
  academyId: string,
): Promise<void> {
  try {
    const user = await auth.getUser(userId);
    if (user.customClaims?.academyId !== academyId) {
      throw new FamilyStoreError("tenant", "Tutor Auth tenant mismatch");
    }
    if (user.uid !== userId || user.disabled === true || user.customClaims?.role !== "guardian") {
      throw new FamilyStoreError("precondition", "Tutor Auth identity mismatch");
    }
  } catch (error) {
    if (error instanceof FamilyStoreError) throw error;
    throw new FamilyStoreError("precondition", "Tutor Auth account is unavailable");
  }
}

function staffProjection(
  family: FamilyRecord,
  students: readonly StudentProfile[],
  relationships: readonly FamilyRelationship[],
): StaffFamilyProjection {
  return Object.freeze({
    family,
    students: Object.freeze([...students]),
    relationships: Object.freeze([...relationships]),
  });
}

function guardianProjection(
  family: FamilyRecord,
  tutor: UserProfile,
  students: readonly StudentProfile[],
): GuardianFamilyProjection {
  return Object.freeze({
    family: Object.freeze({
      familyId: family.familyId,
      active: family.active,
      status: family.status,
    }),
    tutor: Object.freeze({
      userId: tutor.userId,
      displayName: tutor.displayName,
      email: tutor.email,
      phoneNumber: tutor.phoneNumber,
    }),
    students: Object.freeze(
      students.map((student) =>
        Object.freeze({
          studentId: student.studentId,
          fullName: student.fullName,
          dateOfBirth: student.dateOfBirth,
          trainingCenter: student.trainingCenter,
          trainingTimePreferences: Object.freeze([...student.trainingTimePreferences]),
          active: student.active,
          status: student.status,
        }),
      ),
    ),
  });
}

function buildMinorStudent(
  student: FamilyStudentDraft,
  academyId: string,
  familyId: string,
  studentId: string,
  actorId: string,
  now: string,
): StudentProfile {
  const record: StudentProfile = Object.freeze({
    studentId,
    academyId,
    familyId,
    fullName: student.fullName,
    dateOfBirth: student.dateOfBirth,
    ...(student.phoneNumber === undefined ? {} : { phoneNumber: student.phoneNumber }),
    ...(student.email === undefined ? {} : { email: student.email }),
    trainingCenter: student.trainingCenter,
    trainingTimePreferences: Object.freeze([...student.trainingTimePreferences]),
    participantType: "minor",
    active: true,
    status: "active",
    schemaVersion: "1",
    createdAt: now,
    createdBy: actorId,
    updatedAt: now,
    updatedBy: actorId,
  });
  const parsed = parseStudentProfile(record);
  if (!parsed.ok) throw new FamilyStoreError("invalid", "Student creation is invalid");
  return parsed.value;
}

function buildGuardianRelationship(
  academyId: string,
  familyId: string,
  studentId: string,
  tutorUserId: string,
  actorId: string,
  now: string,
): FamilyRelationship {
  const relation: FamilyRelationship = Object.freeze({
    relationshipId: relationshipId(familyId, studentId),
    academyId,
    familyId,
    studentId,
    adultUserId: tutorUserId,
    relationshipType: "guardian",
    permissions: Object.freeze(["readProfile"] as const),
    validFrom: now,
    active: true,
    status: "active",
    schemaVersion: "1",
    createdAt: now,
    createdBy: actorId,
    updatedAt: now,
    updatedBy: actorId,
  });
  const parsed = parseFamilyRelationship(relation);
  if (!parsed.ok) {
    throw new FamilyStoreError("invalid", "Family relationship creation is invalid");
  }
  return parsed.value;
}

function familyAuditEvent(
  academyId: string,
  actorId: string,
  receiptId: string,
  operation: FamilyWriteReceipt["operation"],
  targetRef: string,
): AuditEventDraft {
  const parsed = parseAuditEventDraft({
    academyId,
    actorId,
    action: operation === "family.create" ? "family.created" : "family.student.added",
    targetRef,
    purpose: "family-record-maintenance",
    correlationId: receiptId,
  });
  if (!parsed.ok) {
    throw new FamilyStoreError("invalid", "Family audit event is invalid");
  }
  return parsed.value;
}

async function resolveFamilyWriteReplay(
  transaction: FamilyTransaction,
  dependencies: FamilyStoreDependencies,
  receiptValue: unknown,
  expected: Readonly<{
    receiptId: string;
    academyId: string;
    actorId: string;
    operation: FamilyWriteReceipt["operation"];
    requestMac: string;
    familyId?: string;
  }>,
): Promise<StaffFamilyProjection> {
  const receipt = familyWriteReceiptSchema.safeParse(receiptValue);
  if (
    !receipt.success ||
    receipt.data.receiptId !== expected.receiptId ||
    receipt.data.academyId !== expected.academyId ||
    receipt.data.actorId !== expected.actorId ||
    receipt.data.operation !== expected.operation ||
    (expected.familyId !== undefined && receipt.data.familyId !== expected.familyId) ||
    receipt.data.stateRevisionAfter !== receipt.data.stateRevisionBefore + 1 ||
    new Set(receipt.data.createdStudentIds).size !== receipt.data.createdStudentIds.length ||
    !constantTimeMacEquals(receipt.data.requestMac, expected.requestMac)
  ) {
    throw new FamilyStoreError("conflict", "Divergent family write replay");
  }
  const family = parseStoredFamily(
    readDocumentSnapshot(
      await transaction.get(
        dependencies.firestore.doc(familyPath(receipt.data.academyId, receipt.data.familyId)),
      ),
    ),
  );
  if (family.academyId !== receipt.data.academyId) {
    throw new FamilyStoreError("conflict", "Family write replay tenant mismatch");
  }
  const [students, relationships, auditSnapshot] = await Promise.all([
    readStudents(
      transaction,
      dependencies.firestore,
      receipt.data.academyId,
      receipt.data.familyId,
    ),
    readRelationships(
      transaction,
      dependencies.firestore,
      receipt.data.academyId,
      receipt.data.familyId,
    ),
    transaction.get(
      dependencies.firestore.doc(auditPath(receipt.data.academyId, receipt.data.auditEventId)),
    ),
  ]);
  const studentIds = new Set(students.map((student) => student.studentId));
  const relatedStudentIds = new Set(relationships.map((relationship) => relationship.studentId));
  if (
    receipt.data.createdStudentIds.some(
      (studentId) => !studentIds.has(studentId) || !relatedStudentIds.has(studentId),
    )
  ) {
    throw new FamilyStoreError("conflict", "Completed family write replay is invalid");
  }
  const audit = documentValue(readDocumentSnapshot(auditSnapshot), "Family write audit event");
  const auditTarget =
    receipt.data.operation === "family.create"
      ? familyPath(receipt.data.academyId, receipt.data.familyId)
      : studentPath(receipt.data.academyId, receipt.data.createdStudentIds[0] ?? "invalid");
  if (
    (receipt.data.operation === "family.student.add" &&
      receipt.data.createdStudentIds.length !== 1) ||
    !matchesAuditEventReplay(
      audit,
      receipt.data.auditEventId,
      familyAuditEvent(
        receipt.data.academyId,
        receipt.data.actorId,
        receipt.data.receiptId,
        receipt.data.operation,
        auditTarget,
      ),
    )
  ) {
    throw new FamilyStoreError("conflict", "Family write audit replay is invalid");
  }
  return staffProjection(family, students, relationships);
}

export function createFamilyStore(dependencies: FamilyStoreDependencies): FamilyStore {
  const canonicalDependencies = validateCanonicalDependencies(dependencies.canonicalControl);
  const generateFamilyId = dependencies.generateFamilyId ?? randomUUID;
  const generateStudentId = dependencies.generateStudentId ?? randomUUID;
  const generateAuditId = dependencies.generateAuditId ?? randomUUID;

  return Object.freeze({
    async createFamily(input) {
      const writer = requireCanonicalDependencies(canonicalDependencies);
      const academyId = pathSegment(input.academyId, "academy");
      const actorId = pathSegment(input.actorId, "actor");
      const requestId = pathSegment(input.requestId, "request");
      const tutorUserId = pathSegment(input.tutorUserId, "tutor");
      const now = validNow(input.now);
      const students = validateDrafts(input.students, now.slice(0, 10));
      const requestValue = Object.freeze({
        requestId,
        tutorUserId,
        students,
      });
      const requestMac = familyRequestMac(
        academyId,
        actorId,
        "family.create",
        requestValue,
        writer.integritySecretMaterial,
      );
      const receiptId = familyReceiptId(
        academyId,
        actorId,
        "family.create",
        requestId,
        writer.integritySecretMaterial,
      );
      const familyId = pathSegment(generateFamilyId(), "family");
      const auditEventId = pathSegment(generateAuditId(), "audit event");
      const familyReference = dependencies.firestore.doc(familyPath(academyId, familyId));
      const tutorReference = dependencies.firestore.doc(userPath(academyId, tutorUserId));
      const receiptReference = dependencies.firestore.doc(receiptPath(academyId, receiptId));
      const studentIds = students.map(() => pathSegment(generateStudentId(), "student"));
      if (new Set(studentIds).size !== studentIds.length) {
        throw new FamilyStoreError("duplicate", "Generated student identity collision");
      }

      return dependencies.firestore.runTransaction(async (transaction) => {
        await assertTransactionalAdministrativeActor(transaction, dependencies.firestore, {
          academyId,
          actorId,
          actorRole: input.actorRole,
        });
        const receiptSnapshot = readDocumentSnapshot(await transaction.get(receiptReference));
        if (receiptSnapshot.exists) {
          return resolveFamilyWriteReplay(transaction, dependencies, receiptSnapshot.data(), {
            receiptId,
            academyId,
            actorId,
            operation: "family.create",
            requestMac,
          });
        }
        await verifyAuthUser(dependencies.auth, tutorUserId, academyId);
        const control = await readCanonicalControl(
          transaction,
          dependencies.firestore,
          academyId,
          writer,
        );
        if (readDocumentSnapshot(await transaction.get(familyReference)).exists) {
          throw new FamilyStoreError("duplicate", "Family identity is already in use");
        }
        const existingFamilies = readQuerySnapshot(
          await transaction.get(
            dependencies.firestore
              .collection(familiesPath(academyId))
              .where("primaryContactUserId", "==", tutorUserId)
              .limit(2),
          ),
        );
        if (existingFamilies.docs.length > 0) {
          throw new FamilyStoreError("duplicate", "Tutor already belongs to a family");
        }
        const tutor = parseStoredTutor(
          readDocumentSnapshot(await transaction.get(tutorReference)),
          academyId,
        );
        const studentReferences = studentIds.map((studentId) =>
          dependencies.firestore.doc(studentPath(academyId, studentId)),
        );
        const relationshipReferences = studentIds.map((studentId) =>
          dependencies.firestore.doc(
            relationshipPath(academyId, relationshipId(familyId, studentId)),
          ),
        );
        const studentSnapshots = await Promise.all(
          studentReferences.map((reference) => transaction.get(reference)),
        );
        const relationshipSnapshots = await Promise.all(
          relationshipReferences.map((reference) => transaction.get(reference)),
        );
        if (
          studentSnapshots.some((snapshot) => readDocumentSnapshot(snapshot).exists) ||
          relationshipSnapshots.some((snapshot) => readDocumentSnapshot(snapshot).exists)
        ) {
          throw new FamilyStoreError("duplicate", "Student identity is already linked");
        }

        const family: FamilyRecord = Object.freeze({
          familyId,
          academyId,
          primaryContactUserId: tutor.userId,
          billingContactUserId: tutor.userId,
          active: true,
          status: "active",
          schemaVersion: "1",
          createdAt: now,
          createdBy: actorId,
          updatedAt: now,
          updatedBy: actorId,
        });
        const parsedFamily = parseFamilyRecord(family);
        if (!parsedFamily.ok) throw new FamilyStoreError("invalid", "Family creation is invalid");

        const records = students.map((student, index) => {
          const studentId = studentIds[index];
          const reference = studentReferences[index];
          if (studentId === undefined || reference === undefined) {
            throw new FamilyStoreError("invalid", "Student identity is missing");
          }
          return {
            reference,
            student: buildMinorStudent(student, academyId, familyId, studentId, actorId, now),
            relationship: buildGuardianRelationship(
              academyId,
              familyId,
              studentId,
              tutor.userId,
              actorId,
              now,
            ),
          };
        });
        const nextControl = advanceCanonicalControl(dependencies.firestore, control, writer, {
          academyId,
          actorId,
          operationId: receiptId,
          addedStudentCount: records.length,
          now,
        });
        const auditReference = dependencies.firestore.doc(auditPath(academyId, auditEventId));
        const receipt = familyWriteReceiptSchema.parse({
          receiptId,
          academyId,
          actorId,
          requestMac,
          operation: "family.create",
          familyId,
          createdStudentIds: studentIds,
          auditEventId,
          stateRevisionBefore: control.state.stateRevision,
          stateRevisionAfter: nextControl.state.stateRevision,
          status: "completed",
          createdAt: now,
          schemaVersion: "1",
        });

        transaction.create(familyReference, parsedFamily.value);
        for (const [index, record] of records.entries()) {
          const relationshipReference = relationshipReferences[index];
          if (relationshipReference === undefined) {
            throw new FamilyStoreError("invalid", "Relationship identity is missing");
          }
          transaction.create(record.reference, record.student);
          transaction.create(relationshipReference, record.relationship);
        }
        transaction.set(control.stateRef, nextControl.state);
        transaction.set(control.guardRef, nextControl.guard);
        transaction.create(nextControl.eventRef, nextControl.event);
        appendAuditEventInTransaction(
          transaction,
          auditReference,
          familyAuditEvent(academyId, actorId, receiptId, "family.create", familyReference.path),
        );
        transaction.create(receiptReference, receipt);
        return staffProjection(
          parsedFamily.value,
          records
            .map((record) => record.student)
            .sort((left, right) => left.studentId.localeCompare(right.studentId)),
          records
            .map((record) => record.relationship)
            .sort((left, right) => left.relationshipId.localeCompare(right.relationshipId)),
        );
      });
    },

    async getStaffFamily(academyIdInput, familyIdInput) {
      const academyId = pathSegment(academyIdInput, "academy");
      const familyId = pathSegment(familyIdInput, "family");
      return dependencies.firestore.runTransaction(async (transaction) => {
        const familySnapshot = readDocumentSnapshot(
          await transaction.get(dependencies.firestore.doc(familyPath(academyId, familyId))),
        );
        if (!familySnapshot.exists) return undefined;
        const family = parseStoredFamily(familySnapshot);
        if (family.academyId !== academyId)
          throw new FamilyStoreError("tenant", "Family tenant mismatch");
        const students = await readStudents(
          transaction,
          dependencies.firestore,
          academyId,
          familyId,
        );
        const relationships = await readRelationships(
          transaction,
          dependencies.firestore,
          academyId,
          familyId,
        );
        return staffProjection(family, students, relationships);
      });
    },

    async getStaffFamilyForActor(input) {
      const academyId = pathSegment(input.academyId, "academy");
      const actorId = pathSegment(input.actorId, "actor");
      const familyId = pathSegment(input.familyId, "family");
      return dependencies.firestore.runTransaction(async (transaction) => {
        await assertTransactionalAdministrativeActor(transaction, dependencies.firestore, {
          academyId,
          actorId,
          actorRole: input.actorRole,
        });
        const familySnapshot = readDocumentSnapshot(
          await transaction.get(dependencies.firestore.doc(familyPath(academyId, familyId))),
        );
        if (!familySnapshot.exists) return undefined;
        const family = parseStoredFamily(familySnapshot);
        if (family.academyId !== academyId) {
          throw new FamilyStoreError("tenant", "Family tenant mismatch");
        }
        const students = await readStudents(
          transaction,
          dependencies.firestore,
          academyId,
          familyId,
        );
        const relationships = await readRelationships(
          transaction,
          dependencies.firestore,
          academyId,
          familyId,
        );
        return staffProjection(family, students, relationships);
      });
    },

    async getGuardianFamily(academyIdInput, adultUserIdInput) {
      const academyId = pathSegment(academyIdInput, "academy");
      const adultUserId = pathSegment(adultUserIdInput, "adult");
      return dependencies.firestore.runTransaction(async (transaction) => {
        const relationshipSnapshot = readQuerySnapshot(
          await transaction.get(
            dependencies.firestore
              .collection(relationshipsPath(academyId))
              .where("adultUserId", "==", adultUserId)
              .limit(MAX_FAMILY_STUDENTS + 1),
          ),
        );
        const activeRelationships = relationshipSnapshot.docs
          .map(parseStoredRelationship)
          .filter(
            (relationship) =>
              relationship.academyId === academyId &&
              relationship.adultUserId === adultUserId &&
              relationship.active &&
              relationship.status === "active",
          );
        if (activeRelationships.length === 0) return undefined;
        const familyIds = new Set(activeRelationships.map((relationship) => relationship.familyId));
        if (familyIds.size !== 1)
          throw new FamilyStoreError("duplicate", "Guardian family is ambiguous");
        const familyId = [...familyIds][0];
        if (familyId === undefined)
          throw new FamilyStoreError("invalid", "Guardian family is missing");
        const family = parseStoredFamily(
          readDocumentSnapshot(
            await transaction.get(dependencies.firestore.doc(familyPath(academyId, familyId))),
          ),
        );
        if (
          !family.active ||
          family.status !== "active" ||
          family.primaryContactUserId !== adultUserId
        ) {
          return undefined;
        }
        const tutor = parseStoredTutor(
          readDocumentSnapshot(
            await transaction.get(dependencies.firestore.doc(userPath(academyId, adultUserId))),
          ),
          academyId,
        );
        const students = await readStudents(
          transaction,
          dependencies.firestore,
          academyId,
          familyId,
        );
        const linkedStudentIds = new Set(
          activeRelationships.map((relationship) => relationship.studentId),
        );
        const linkedStudents = students.filter((student) =>
          linkedStudentIds.has(student.studentId),
        );
        if (linkedStudents.length !== linkedStudentIds.size) {
          throw new FamilyStoreError(
            "conflict",
            "Guardian relationship points to a missing student",
          );
        }
        return guardianProjection(family, tutor, linkedStudents);
      });
    },

    async updateFamily(input) {
      const writer = requireCanonicalDependencies(canonicalDependencies);
      const academyId = pathSegment(input.academyId, "academy");
      const actorId = pathSegment(input.actorId, "actor");
      const familyId = pathSegment(input.familyId, "family");
      const now = validNow(input.now);
      const addPlan =
        input.operation.kind === "addStudent"
          ? (() => {
              const requestId = pathSegment(input.operation.requestId, "request");
              const student = validateDrafts([input.operation.student], now.slice(0, 10))[0];
              if (student === undefined) {
                throw new FamilyStoreError("invalid", "Student draft is missing");
              }
              const requestMac = familyRequestMac(
                academyId,
                actorId,
                "family.student.add",
                Object.freeze({ familyId, requestId, student }),
                writer.integritySecretMaterial,
              );
              const receiptId = familyReceiptId(
                academyId,
                actorId,
                "family.student.add",
                requestId,
                writer.integritySecretMaterial,
              );
              const studentId = pathSegment(generateStudentId(), "student");
              const auditEventId = pathSegment(generateAuditId(), "audit event");
              return Object.freeze({
                student,
                studentId,
                auditEventId,
                requestMac,
                receiptId,
                receiptReference: dependencies.firestore.doc(receiptPath(academyId, receiptId)),
              });
            })()
          : undefined;
      return dependencies.firestore.runTransaction(async (transaction) => {
        await assertTransactionalAdministrativeActor(transaction, dependencies.firestore, {
          academyId,
          actorId,
          actorRole: input.actorRole,
        });
        if (addPlan !== undefined) {
          const receiptSnapshot = readDocumentSnapshot(
            await transaction.get(addPlan.receiptReference),
          );
          if (receiptSnapshot.exists) {
            return resolveFamilyWriteReplay(transaction, dependencies, receiptSnapshot.data(), {
              receiptId: addPlan.receiptId,
              academyId,
              actorId,
              operation: "family.student.add",
              requestMac: addPlan.requestMac,
              familyId,
            });
          }
        }
        const control = await readCanonicalControl(
          transaction,
          dependencies.firestore,
          academyId,
          writer,
        );
        const familyReference = dependencies.firestore.doc(familyPath(academyId, familyId));
        const family = parseStoredFamily(
          readDocumentSnapshot(await transaction.get(familyReference)),
        );
        if (family.academyId !== academyId)
          throw new FamilyStoreError("tenant", "Family tenant mismatch");
        const students = [
          ...(await readStudents(transaction, dependencies.firestore, academyId, familyId)),
        ];
        const relationships = [
          ...(await readRelationships(transaction, dependencies.firestore, academyId, familyId)),
        ];

        if (input.operation.kind === "replaceTutor") {
          const tutorUserId = pathSegment(input.operation.tutorUserId, "tutor");
          await verifyAuthUser(dependencies.auth, tutorUserId, academyId);
          const tutor = parseStoredTutor(
            readDocumentSnapshot(
              await transaction.get(dependencies.firestore.doc(userPath(academyId, tutorUserId))),
            ),
            academyId,
          );
          const otherFamilies = readQuerySnapshot(
            await transaction.get(
              dependencies.firestore
                .collection(familiesPath(academyId))
                .where("primaryContactUserId", "==", tutorUserId)
                .limit(2),
            ),
          ).docs.filter((snapshot) => snapshot.id !== familyId);
          if (otherFamilies.length > 0) {
            throw new FamilyStoreError("duplicate", "Tutor already belongs to another family");
          }
          if (family.primaryContactUserId === tutorUserId) {
            return staffProjection(family, students, relationships);
          }
          const updatedFamily: FamilyRecord = Object.freeze({
            ...family,
            primaryContactUserId: tutor.userId,
            billingContactUserId: tutor.userId,
            updatedAt: now,
            updatedBy: actorId,
          });
          transaction.set(familyReference, updatedFamily);
          for (const relationship of relationships) {
            if (!relationship.active || relationship.status !== "active") continue;
            transaction.set(
              dependencies.firestore.doc(relationshipPath(academyId, relationship.relationshipId)),
              Object.freeze({
                ...relationship,
                adultUserId: tutor.userId,
                updatedAt: now,
                updatedBy: actorId,
              }),
            );
          }
          return staffProjection(
            updatedFamily,
            students,
            relationships.map((relationship) =>
              relationship.active && relationship.status === "active"
                ? Object.freeze({
                    ...relationship,
                    adultUserId: tutor.userId,
                    updatedAt: now,
                    updatedBy: actorId,
                  })
                : relationship,
            ),
          );
        }

        if (input.operation.kind === "addStudent") {
          if (addPlan === undefined) {
            throw new FamilyStoreError("invalid", "Student write plan is missing");
          }
          if (!family.active || family.status !== "active") {
            throw new FamilyStoreError("conflict", "Inactive family cannot receive students");
          }
          if (students.length >= MAX_FAMILY_STUDENTS) {
            throw new FamilyStoreError("precondition", "Family has too many students");
          }
          await verifyAuthUser(dependencies.auth, family.primaryContactUserId, academyId);
          const tutor = parseStoredTutor(
            readDocumentSnapshot(
              await transaction.get(
                dependencies.firestore.doc(userPath(academyId, family.primaryContactUserId)),
              ),
            ),
            academyId,
          );
          const studentId = addPlan.studentId;
          const studentReference = dependencies.firestore.doc(studentPath(academyId, studentId));
          if (readDocumentSnapshot(await transaction.get(studentReference)).exists) {
            throw new FamilyStoreError("duplicate", "Student identity is already linked");
          }
          const relationshipReference = dependencies.firestore.doc(
            relationshipPath(academyId, relationshipId(familyId, studentId)),
          );
          if (readDocumentSnapshot(await transaction.get(relationshipReference)).exists) {
            throw new FamilyStoreError("duplicate", "Relationship identity is already in use");
          }
          const student = buildMinorStudent(
            addPlan.student,
            academyId,
            familyId,
            studentId,
            actorId,
            now,
          );
          const relationship = buildGuardianRelationship(
            academyId,
            familyId,
            studentId,
            tutor.userId,
            actorId,
            now,
          );
          const nextControl = advanceCanonicalControl(dependencies.firestore, control, writer, {
            academyId,
            actorId,
            operationId: addPlan.receiptId,
            addedStudentCount: 1,
            now,
          });
          const auditReference = dependencies.firestore.doc(
            auditPath(academyId, addPlan.auditEventId),
          );
          const receipt = familyWriteReceiptSchema.parse({
            receiptId: addPlan.receiptId,
            academyId,
            actorId,
            requestMac: addPlan.requestMac,
            operation: "family.student.add",
            familyId,
            createdStudentIds: [studentId],
            auditEventId: addPlan.auditEventId,
            stateRevisionBefore: control.state.stateRevision,
            stateRevisionAfter: nextControl.state.stateRevision,
            status: "completed",
            createdAt: now,
            schemaVersion: "1",
          });
          transaction.create(studentReference, student);
          transaction.create(relationshipReference, relationship);
          transaction.set(control.stateRef, nextControl.state);
          transaction.set(control.guardRef, nextControl.guard);
          transaction.create(nextControl.eventRef, nextControl.event);
          appendAuditEventInTransaction(
            transaction,
            auditReference,
            familyAuditEvent(
              academyId,
              actorId,
              addPlan.receiptId,
              "family.student.add",
              studentReference.path,
            ),
          );
          transaction.create(addPlan.receiptReference, receipt);
          return staffProjection(
            family,
            [...students, student].sort((left, right) =>
              left.studentId.localeCompare(right.studentId),
            ),
            [...relationships, relationship].sort((left, right) =>
              left.relationshipId.localeCompare(right.relationshipId),
            ),
          );
        }

        if (input.operation.kind === "deactivateRelationship") {
          const studentId = pathSegment(input.operation.studentId, "student");
          const relationship = relationships.find((item) => item.studentId === studentId);
          if (relationship === undefined)
            throw new FamilyStoreError("not-found", "Family relationship is missing");
          if (relationship.active && relationship.status === "active") {
            const updated = Object.freeze({
              ...relationship,
              active: false,
              status: "inactive" as const,
              updatedAt: now,
              updatedBy: actorId,
            });
            transaction.set(
              dependencies.firestore.doc(relationshipPath(academyId, relationship.relationshipId)),
              updated,
            );
            return staffProjection(
              family,
              students,
              relationships.map((item) => (item.studentId === studentId ? updated : item)),
            );
          }
          return staffProjection(family, students, relationships);
        }

        if (!family.active || family.status !== "active") {
          return staffProjection(family, students, relationships);
        }
        const updatedFamily = Object.freeze({
          ...family,
          active: false,
          status: "inactive" as const,
          updatedAt: now,
          updatedBy: actorId,
        });
        transaction.set(familyReference, updatedFamily);
        const updatedRelationships = relationships.map((relationship) => {
          if (!relationship.active || relationship.status !== "active") return relationship;
          const updated = Object.freeze({
            ...relationship,
            active: false,
            status: "inactive" as const,
            updatedAt: now,
            updatedBy: actorId,
          });
          transaction.set(
            dependencies.firestore.doc(relationshipPath(academyId, relationship.relationshipId)),
            updated,
          );
          return updated;
        });
        return staffProjection(updatedFamily, students, updatedRelationships);
      });
    },
  });
}
