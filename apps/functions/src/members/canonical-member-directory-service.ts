import { randomUUID } from "node:crypto";

import type { AuditEventDraft } from "@bpt-jersey/domain/audit";
import {
  MEMBER_MIGRATION_ID,
  memberMigrationDecisionRecordSchema,
  legacyStudentInputSchema,
  memberReviewInputSchema,
  type LegacyStudentInput,
} from "@bpt-jersey/domain/members/migration";
import {
  parseAdminCreateStudentInput,
  adminCreateStudentInputSchema,
  normalizeAdministrativeIdentifier,
  parseAdminUpdateStudentInput,
  studentAdminProfileSchema,
  type AdminUpdateStudentInput,
  type StudentAdminProfile,
} from "@bpt-jersey/domain/members/directory";
import {
  deriveParticipantType,
  parseStudentProfileAt,
  parseUserProfile,
  type StudentProfile,
  type UserProfile,
} from "@bpt-jersey/domain/profiles";
import { parseFamilyRecord, type FamilyRecord } from "@bpt-jersey/domain/families";
import { z } from "zod";
import { parseStoredRegyfitMemberRecord } from "@bpt-jersey/domain/members/regyfit-records";

import { appendAuditEventInTransaction, matchesAuditEventReplay } from "../audit/audit-writer.js";
import {
  buildStudentIdentityKey,
  canonicalizeMemberDirectoryValue,
  constantTimeMacEquals,
  createMemberDirectoryIntegrityMac,
  decodeMemberDirectorySecret,
  studentIdentityKeySchema,
  type StudentIdentityKey,
} from "./member-directory-crypto.js";
import {
  advanceMemberDirectoryControlPlane,
  assertCanonicalMemberDirectoryWriterReady,
  assertMemberDirectoryControlPlane,
  memberDirectoryRestoreGuardSchema,
} from "./member-directory-state.js";
import { matchesProvisionedMemberDirectoryActor } from "./member-directory-actor-authorization.js";

export type MemberDirectoryDocumentData = Readonly<Record<string, unknown>>;
export type MemberDirectoryDocumentReference = Readonly<{ id: string; path: string }>;
export type MemberDirectoryDocumentSnapshot = Readonly<{
  id: string;
  exists: boolean;
  data: () => MemberDirectoryDocumentData | undefined;
}>;
export type MemberDirectoryTransaction = Readonly<{
  get: (reference: MemberDirectoryDocumentReference) => Promise<MemberDirectoryDocumentSnapshot>;
  create: (
    reference: MemberDirectoryDocumentReference,
    data: MemberDirectoryDocumentData,
  ) => MemberDirectoryTransaction;
  set: (
    reference: MemberDirectoryDocumentReference,
    data: MemberDirectoryDocumentData,
  ) => MemberDirectoryTransaction;
}>;
export type MemberDirectoryFirestore = Readonly<{
  doc: (path: string) => MemberDirectoryDocumentReference;
  runTransaction: <T>(
    callback: (transaction: MemberDirectoryTransaction) => Promise<T>,
  ) => Promise<T>;
}>;

export type CanonicalMemberDirectoryActor = Readonly<{
  actorId: string;
  academyId: string;
  role: "owner" | "administrator" | "headCoach" | "coach" | "guardian" | "adultStudent";
  active: boolean;
  appCheckVerified: boolean;
}>;

export type CreateAdminAdultCommand = Readonly<{
  actor: CanonicalMemberDirectoryActor;
  value: unknown;
  now: string;
}>;

export type OfficeImportedMemberCommand = CreateAdminAdultCommand & Readonly<{ recordId: string }>;
export type LegacyMemberRegistrationCommand = CreateAdminAdultCommand &
  Readonly<{
    legacyMemberId: string;
    recordId?: string;
    trainingCenter: "Town" | "West";
    trainingTimePreferences: readonly ("morning" | "afternoon" | "evening")[];
  }>;
export type LegacyMemberSkipCommand = Readonly<{
  actor: CanonicalMemberDirectoryActor;
  legacyMemberId: string;
  reason: string;
  now: string;
}>;
export const legacyMigrationErrorMessages = Object.freeze({
  alreadyDecided: "Legacy member already decided",
  recordLinked: "Imported record is already linked",
} as const);

export type OfficeMemberDirectoryService = CanonicalMemberDirectoryService &
  Readonly<{
    registerImportedMember: (
      command: OfficeImportedMemberCommand,
    ) => Promise<CreateAdminAdultResult>;
    registerLegacyMember: (
      command: LegacyMemberRegistrationCommand,
    ) => Promise<CreateAdminAdultResult>;
    skipLegacyMember: (command: LegacyMemberSkipCommand) => Promise<void>;
    reviewMember: (command: CreateAdminAdultCommand) => Promise<Readonly<{ studentId: string }>>;
  }>;

export type CreateAdminAdultResult = Readonly<{ memberId: string; studentId: string }>;

/**
 * The account an enrolment is linked to. `displayName` and `email` come from the Auth record
 * rather than from the form: they are what the account already proves about itself, and the
 * academy's client document will not parse without them.
 */
export type MemberAccountLink = Readonly<{
  userId: string;
  displayName: string;
  email: string;
}>;

export type CreateAdminAdultForAccountCommand = Readonly<{
  actor: CanonicalMemberDirectoryActor;
  value: unknown;
  account: MemberAccountLink;
  /** Internal enrolment scope; never accepted from the public member-write payload. */
  enrolmentRequestId?: string;
  courseEnrolmentId?: string;
  now: string;
}>;

export type UpdateAdminMemberCommand = Readonly<{
  actor: CanonicalMemberDirectoryActor;
  value: unknown;
  now: string;
}>;

export type CanonicalMemberDirectoryService = Readonly<{
  createAdminAdult: (command: CreateAdminAdultCommand) => Promise<CreateAdminAdultResult>;
  /**
   * The same enrolment, for somebody whose account the academy already knows. It writes what
   * `createAdminAdult` writes plus the three things that make a record the member's own: the
   * `userId` on the student with their family, their client document, and the `auth-user-id`
   * reservation that stops the self-service profile from creating a second person.
   */
  createAdminAdultForAccount: (
    command: CreateAdminAdultForAccountCommand,
  ) => Promise<CreateAdminAdultResult>;
  updateAdminMember: (command: UpdateAdminMemberCommand) => Promise<CreateAdminAdultResult>;
}>;

export type CanonicalMemberDirectoryDependencies = Readonly<{
  firestore: MemberDirectoryFirestore;
  projectId: string;
  identitySecretMaterial: string;
  identitySecretVersion: string;
  integritySecretMaterial: string;
  integritySecretVersion: string;
  generateStudentId?: () => string;
  generateAuditId?: () => string;
}>;

const safeIdentifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const utcMillisecondPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const macPattern = /^[a-f0-9]{64}$/u;

const writeReceiptSchema = z.strictObject({
  receiptId: z.string().regex(/^write-[a-f0-9]{64}$/u),
  academyId: z.string().regex(safeIdentifierPattern),
  actorId: z.string().regex(safeIdentifierPattern),
  requestMac: z.string().regex(macPattern),
  studentId: z.string().regex(safeIdentifierPattern),
  createdFamilyId: z.string().regex(safeIdentifierPattern).optional(),
  auditEventId: z.string().regex(safeIdentifierPattern),
  stateRevisionBefore: z.number().int().nonnegative().safe(),
  stateRevisionAfter: z.number().int().positive().safe(),
  status: z.literal("completed"),
  createdAt: z.string().regex(utcMillisecondPattern),
  schemaVersion: z.literal("1"),
});

type MemberDirectoryWriteReceipt = Readonly<z.infer<typeof writeReceiptSchema>>;

export class CanonicalMemberDirectoryError extends Error {
  public readonly code: "unauthorized" | "invalid" | "unavailable" | "conflict" | "replay";

  public constructor(
    code: "unauthorized" | "invalid" | "unavailable" | "conflict" | "replay",
    message: string,
  ) {
    super(message);
    this.name = "CanonicalMemberDirectoryError";
    this.code = code;
  }
}

function requiredIdentifier(value: string, label: string): string {
  if (!safeIdentifierPattern.test(value)) {
    throw new CanonicalMemberDirectoryError("invalid", `Invalid ${label}`);
  }
  return value;
}

function requiredTimestamp(value: string): string {
  const parsed = Date.parse(value);
  if (
    !utcMillisecondPattern.test(value) ||
    Number.isNaN(parsed) ||
    new Date(parsed).toISOString() !== value
  ) {
    throw new CanonicalMemberDirectoryError("invalid", "Invalid server timestamp");
  }
  return value;
}

function requireAuthorizedActor(actor: CanonicalMemberDirectoryActor): void {
  if (!actor.appCheckVerified) {
    throw new CanonicalMemberDirectoryError("unauthorized", "Verified App Check is required");
  }
  if (!actor.active || (actor.role !== "owner" && actor.role !== "administrator")) {
    throw new CanonicalMemberDirectoryError("unauthorized", "Authorized active admin is required");
  }
  requiredIdentifier(actor.actorId, "actor ID");
  requiredIdentifier(actor.academyId, "academy ID");
}

function documentData(snapshot: MemberDirectoryDocumentSnapshot, label: string): unknown {
  if (!snapshot.exists) {
    throw new CanonicalMemberDirectoryError("unavailable", `${label} is missing`);
  }
  const data = snapshot.data();
  if (data === undefined) {
    throw new CanonicalMemberDirectoryError("unavailable", `${label} is invalid`);
  }
  return data;
}

function statePath(academyId: string): string {
  return `academies/${academyId}/memberDirectoryStates/current`;
}

function receiptPath(academyId: string, receiptId: string): string {
  return `academies/${academyId}/memberDirectoryWriteReceipts/${receiptId}`;
}

function actorPath(academyId: string, actorId: string): string {
  return "academies/" + academyId + "/users/" + actorId;
}

function actorRoleLockPath(academyId: string, actorId: string): string {
  return "academies/" + academyId + "/adminRoleLocks/" + actorId;
}

function studentPath(academyId: string, studentId: string): string {
  return `academies/${academyId}/students/${studentId}`;
}

function profilePath(academyId: string, studentId: string): string {
  return `academies/${academyId}/studentAdminProfiles/${studentId}`;
}

function keyPath(academyId: string, keyId: string): string {
  return `academies/${academyId}/studentIdentityKeys/${keyId}`;
}

function auditPath(academyId: string, auditId: string): string {
  return `academies/${academyId}/auditEvents/${auditId}`;
}

function userPath(academyId: string, userId: string): string {
  return `academies/${academyId}/users/${userId}`;
}

function familyPath(academyId: string, familyId: string): string {
  return `academies/${academyId}/families/${familyId}`;
}

function guardPath(academyId: string): string {
  return `memberDirectoryRestoreGuards/${academyId}`;
}

function guardEventPath(academyId: string, eventId: string): string {
  return `memberDirectoryRestoreGuards/${academyId}/events/${eventId}`;
}

async function assertProvisionedActor(
  transaction: MemberDirectoryTransaction,
  dependencies: CanonicalMemberDirectoryDependencies,
  actor: CanonicalMemberDirectoryActor,
): Promise<void> {
  const [actorSnapshot, roleLockSnapshot] = await Promise.all([
    transaction.get(dependencies.firestore.doc(actorPath(actor.academyId, actor.actorId))),
    transaction.get(dependencies.firestore.doc(actorRoleLockPath(actor.academyId, actor.actorId))),
  ]);
  const actorData = actorSnapshot.data();
  const roleLockData = roleLockSnapshot.data();
  const actorIsCurrent =
    actorSnapshot.id === actor.actorId &&
    actorSnapshot.exists &&
    actorData !== undefined &&
    matchesProvisionedMemberDirectoryActor(actorData, actor);
  const roleLockIsAbsent =
    roleLockSnapshot.id === actor.actorId && !roleLockSnapshot.exists && roleLockData === undefined;
  if (!actorIsCurrent || !roleLockIsAbsent) {
    throw new CanonicalMemberDirectoryError("unauthorized", "Authorized active admin is required");
  }
}

function requestMac(
  academyId: string,
  actorId: string,
  input: LegacyStudentInput,
  secretMaterial: string,
  recordId?: string,
): string {
  return createMemberDirectoryIntegrityMac({
    domain: "bpt-member-directory-write-request-v1",
    values: [
      academyId,
      actorId,
      canonicalizeMemberDirectoryValue(
        Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)),
      ),
      ...(recordId ? [recordId] : []),
    ],
    secretMaterial,
  });
}

function updateRequestMac(
  academyId: string,
  actorId: string,
  input: AdminUpdateStudentInput,
  secretMaterial: string,
): string {
  return createMemberDirectoryIntegrityMac({
    domain: "bpt-member-directory-update-request-v1",
    values: [academyId, actorId, canonicalizeMemberDirectoryValue(input)],
    secretMaterial,
  });
}

function requestReceiptId(
  academyId: string,
  actorId: string,
  requestId: string,
  secretMaterial: string,
): string {
  const digest = createMemberDirectoryIntegrityMac({
    domain: "bpt-member-directory-write-request-id-v1",
    values: [academyId, actorId, requestId],
    secretMaterial,
  });
  return `write-${digest}`;
}

function buildStudent(
  input: LegacyStudentInput,
  academyId: string,
  studentId: string,
  actorId: string,
  now: string,
  /** Present only when office is enrolling somebody whose account is already known. */
  link?: Readonly<{ userId?: string; familyId: string }>,
  legacy = false,
): StudentProfile {
  const record = {
    studentId,
    academyId,
    ...(link === undefined
      ? {}
      : { ...(link.userId ? { userId: link.userId } : {}), familyId: link.familyId }),
    fullName: input.fullName,
    ...(input.dateOfBirth === undefined ? {} : { dateOfBirth: input.dateOfBirth }),
    ...(input.phoneNumber === undefined ? {} : { phoneNumber: input.phoneNumber }),
    ...(input.email === undefined ? {} : { email: input.email }),
    trainingCenter: input.trainingCenter,
    trainingTimePreferences: input.trainingTimePreferences,
    participantType:
      input.dateOfBirth === undefined
        ? "minor"
        : deriveParticipantType(input.dateOfBirth, now.slice(0, 10)),
    ...(input.dateOfBirth === undefined ? { reviewReason: "date-of-birth-missing" } : {}),
    ...(legacy &&
    input.dateOfBirth !== undefined &&
    deriveParticipantType(input.dateOfBirth, now.slice(0, 10)) === "minor"
      ? { guardianStatus: "pending" }
      : {}),
    active: true,
    status: "active" as const,
    schemaVersion: "1" as const,
    createdAt: now,
    createdBy: actorId,
    updatedAt: now,
    updatedBy: actorId,
  };
  const parsed = parseStudentProfileAt(record, now.slice(0, 10));
  if (!parsed.ok) throw new CanonicalMemberDirectoryError("invalid", "Invalid student record");
  return parsed.value;
}

function buildAdminProfile(
  input: LegacyStudentInput,
  academyId: string,
  studentId: string,
  actorId: string,
  now: string,
  legacy?: Readonly<{ legacyMemberId: string }>,
): StudentAdminProfile {
  const parsed = studentAdminProfileSchema.safeParse({
    studentId,
    academyId,
    ...(input.membershipNumber === undefined ? {} : { membershipNumber: input.membershipNumber }),
    ...(input.idCardNumber === undefined ? {} : { idCardNumber: input.idCardNumber }),
    ...(input.vatNumber === undefined ? {} : { vatNumber: input.vatNumber }),
    gender: input.gender ?? "unknown",
    ...(input.frequencyNote === undefined ? {} : { frequencyNote: input.frequencyNote }),
    ...(input.emergencyContact === undefined
      ? {}
      : { emergencyContact: { ...input.emergencyContact } }),
    ...(input.postalAddress === undefined ? {} : { postalAddress: { ...input.postalAddress } }),
    ...(legacy === undefined
      ? { source: "admin" }
      : {
          source: "legacy-member-migration",
          migrationId: MEMBER_MIGRATION_ID,
          legacyMemberId: normalizeAdministrativeIdentifier(legacy.legacyMemberId),
        }),
    schemaVersion: "1",
    createdAt: now,
    createdBy: actorId,
    updatedAt: now,
    updatedBy: actorId,
  });
  if (!parsed.success) {
    throw new CanonicalMemberDirectoryError("invalid", "Invalid admin profile record");
  }
  return Object.freeze(parsed.data);
}

function buildKeys(
  profile: StudentAdminProfile,
  dependencies: CanonicalMemberDirectoryDependencies,
  metadata: Readonly<{ now: string; actorId: string }> = {
    now: profile.createdAt,
    actorId: profile.createdBy,
  },
): readonly StudentIdentityKey[] {
  const values = [
    ["membership-number", profile.membershipNumber],
    ["id-card-number", profile.idCardNumber],
    ["vat-number", profile.vatNumber],
    [
      "legacy-member-id",
      profile.source === "legacy-member-migration" ? profile.legacyMemberId : undefined,
    ],
  ] as const;
  return Object.freeze(
    values.flatMap(([kind, value]) =>
      value === undefined
        ? []
        : [
            buildStudentIdentityKey({
              academyId: profile.academyId,
              kind,
              value,
              ownerStudentId: profile.studentId,
              secretMaterial: dependencies.identitySecretMaterial,
              secretVersion: dependencies.identitySecretVersion,
              now: metadata.now,
              actorId: metadata.actorId,
            }),
          ],
    ),
  );
}

async function guardianReviewFields(
  transaction: MemberDirectoryTransaction,
  firestore: MemberDirectoryFirestore,
  student: StudentProfile,
  dateOfBirth: string,
  today: string,
): Promise<Pick<StudentProfile, "guardianStatus">> {
  if (deriveParticipantType(dateOfBirth, today) !== "minor") return {};
  if (student.familyId !== undefined) {
    const snapshot = await transaction.get(
      firestore.doc(familyPath(student.academyId, student.familyId)),
    );
    if (snapshot.exists) {
      const family = parseFamilyRecord(snapshot.data());
      if (
        !family.ok ||
        family.value.academyId !== student.academyId ||
        family.value.familyId !== student.familyId
      )
        throw new CanonicalMemberDirectoryError("unavailable", "Member family is unavailable");
      if (
        family.value.active &&
        family.value.status === "active" &&
        (family.value.primaryContactUserId !== null || family.value.guardianContact !== undefined)
      )
        return student.guardianStatus === undefined ? {} : { guardianStatus: "assigned" };
    }
  }
  return { guardianStatus: "pending" };
}

function buildUpdatedStudent(
  existing: StudentProfile,
  input: AdminUpdateStudentInput,
  actorId: string,
  now: string,
  guardianReview: Pick<StudentProfile, "guardianStatus">,
): StudentProfile {
  const parsed = parseStudentProfileAt(
    {
      studentId: existing.studentId,
      academyId: existing.academyId,
      ...(existing.familyId === undefined ? {} : { familyId: existing.familyId }),
      ...(existing.userId === undefined ? {} : { userId: existing.userId }),
      fullName: input.fullName,
      dateOfBirth: input.dateOfBirth,
      ...(input.phoneNumber === undefined ? {} : { phoneNumber: input.phoneNumber }),
      ...(input.email === undefined ? {} : { email: input.email }),
      trainingCenter: input.trainingCenter,
      trainingTimePreferences: input.trainingTimePreferences,
      participantType: deriveParticipantType(input.dateOfBirth, now.slice(0, 10)),
      ...guardianReview,
      active: existing.active,
      status: existing.status,
      schemaVersion: existing.schemaVersion,
      createdAt: existing.createdAt,
      createdBy: existing.createdBy,
      updatedAt: now,
      updatedBy: actorId,
    },
    now.slice(0, 10),
  );
  if (!parsed.ok) {
    throw new CanonicalMemberDirectoryError("invalid", "Invalid updated student record");
  }
  return parsed.value;
}

function profileProvenance(profile: StudentAdminProfile): Readonly<Record<string, string>> {
  switch (profile.source) {
    case "admin":
      return Object.freeze({ source: profile.source });
    case "regyfit-account-recovery":
      return Object.freeze({ source: profile.source, recoveryId: profile.recoveryId });
    case "member-pdf-import":
      return Object.freeze({ source: profile.source, importRunId: profile.importRunId });
    case "legacy-member-migration":
      return Object.freeze({
        source: profile.source,
        migrationId: profile.migrationId,
        legacyMemberId: profile.legacyMemberId,
        ...(profile.importRunId === undefined ? {} : { importRunId: profile.importRunId }),
      });
  }
}

function buildUpdatedAdminProfile(
  existing: StudentAdminProfile,
  input: AdminUpdateStudentInput,
  actorId: string,
  now: string,
): StudentAdminProfile {
  // T051V2: `details` is the one block an older caller does not know about, so "not sent" keeps it
  // and an empty object clears it. Every other field keeps its full-replacement meaning.
  const nextDetails = input.details ?? existing.details;
  const parsed = studentAdminProfileSchema.safeParse({
    studentId: existing.studentId,
    academyId: existing.academyId,
    ...(input.membershipNumber === undefined ? {} : { membershipNumber: input.membershipNumber }),
    ...(input.idCardNumber === undefined ? {} : { idCardNumber: input.idCardNumber }),
    ...(input.vatNumber === undefined ? {} : { vatNumber: input.vatNumber }),
    gender: input.gender,
    ...(input.frequencyNote === undefined ? {} : { frequencyNote: input.frequencyNote }),
    ...(input.emergencyContact === undefined
      ? {}
      : { emergencyContact: { ...input.emergencyContact } }),
    ...(input.postalAddress === undefined ? {} : { postalAddress: { ...input.postalAddress } }),
    ...(nextDetails === undefined || Object.keys(nextDetails).length === 0
      ? {}
      : { details: { ...nextDetails } }),
    ...profileProvenance(existing),
    schemaVersion: existing.schemaVersion,
    createdAt: existing.createdAt,
    createdBy: existing.createdBy,
    updatedAt: now,
    updatedBy: actorId,
  });
  if (!parsed.success) {
    throw new CanonicalMemberDirectoryError("invalid", "Invalid updated admin profile");
  }
  return Object.freeze(parsed.data);
}

/**
 * The profile a member without one starts from when office first saves their record: no
 * identifiers, so no reservation is released, and `admin` provenance because office creates it.
 */
function emptyAdminProfile(
  student: StudentProfile,
  actorId: string,
  now: string,
): StudentAdminProfile {
  return Object.freeze(
    studentAdminProfileSchema.parse({
      studentId: student.studentId,
      academyId: student.academyId,
      gender: "unknown",
      source: "admin",
      schemaVersion: "1",
      createdAt: now,
      createdBy: actorId,
      updatedAt: now,
      updatedBy: actorId,
    }),
  );
}

function matchesIdentityReservation(
  snapshot: MemberDirectoryDocumentSnapshot,
  expected: StudentIdentityKey,
): boolean {
  if (snapshot.id !== expected.keyId || !snapshot.exists) return false;
  const parsed = studentIdentityKeySchema.safeParse(snapshot.data());
  return (
    parsed.success &&
    parsed.data.keyId === expected.keyId &&
    parsed.data.academyId === expected.academyId &&
    parsed.data.kind === expected.kind &&
    parsed.data.digestVersion === expected.digestVersion &&
    parsed.data.secretVersion === expected.secretVersion &&
    parsed.data.ownerStudentId === expected.ownerStudentId
  );
}

async function resolveUpdateReplay(
  transaction: MemberDirectoryTransaction,
  dependencies: CanonicalMemberDirectoryDependencies,
  receiptValue: unknown,
  expectedReceiptId: string,
  expectedAcademyId: string,
  expectedActorId: string,
  expectedRequestMac: string,
  input: AdminUpdateStudentInput,
): Promise<CreateAdminAdultResult> {
  const receipt = writeReceiptSchema.safeParse(receiptValue);
  if (
    !receipt.success ||
    receipt.data.receiptId !== expectedReceiptId ||
    receipt.data.academyId !== expectedAcademyId ||
    receipt.data.actorId !== expectedActorId ||
    receipt.data.studentId !== input.studentId ||
    !constantTimeMacEquals(receipt.data.requestMac, expectedRequestMac)
  ) {
    throw new CanonicalMemberDirectoryError("replay", "Divergent member update replay");
  }
  const studentRef = dependencies.firestore.doc(
    studentPath(expectedAcademyId, receipt.data.studentId),
  );
  const profileRef = dependencies.firestore.doc(
    profilePath(expectedAcademyId, receipt.data.studentId),
  );
  const auditRef = dependencies.firestore.doc(
    auditPath(expectedAcademyId, receipt.data.auditEventId),
  );
  const [studentSnapshot, profileSnapshot, auditSnapshot] = await Promise.all([
    transaction.get(studentRef),
    transaction.get(profileRef),
    transaction.get(auditRef),
  ]);
  const student = parseStudentProfileAt(
    documentData(studentSnapshot, "Replay student"),
    receipt.data.createdAt.slice(0, 10),
  );
  const profile = studentAdminProfileSchema.safeParse(
    documentData(profileSnapshot, "Replay admin profile"),
  );
  const intendedProfile = profile.success
    ? buildUpdatedAdminProfile(profile.data, input, expectedActorId, receipt.data.createdAt)
    : undefined;
  const expectedKeys =
    intendedProfile === undefined ? [] : buildKeys(intendedProfile, dependencies);
  const keySnapshots = await Promise.all(
    expectedKeys.map((key) =>
      transaction.get(dependencies.firestore.doc(keyPath(expectedAcademyId, key.keyId))),
    ),
  );
  const auditIsCurrent =
    auditSnapshot.id === receipt.data.auditEventId &&
    auditSnapshot.exists &&
    matchesAuditEventReplay(auditSnapshot.data(), receipt.data.auditEventId, {
      academyId: expectedAcademyId,
      actorId: expectedActorId,
      action: "member.updated",
      targetRef: studentRef.path,
      purpose: "member-record-maintenance",
      correlationId: expectedReceiptId,
    } as unknown as AuditEventDraft);
  if (
    !student.ok ||
    !profile.success ||
    student.value.studentId !== receipt.data.studentId ||
    student.value.academyId !== expectedAcademyId ||
    profile.data.studentId !== receipt.data.studentId ||
    profile.data.academyId !== expectedAcademyId ||
    !auditIsCurrent ||
    !expectedKeys.every((key, index) => {
      const snapshot = keySnapshots[index];
      return snapshot !== undefined && matchesIdentityReservation(snapshot, key);
    })
  ) {
    throw new CanonicalMemberDirectoryError("replay", "Completed member update replay is invalid");
  }
  return Object.freeze({ memberId: receipt.data.studentId, studentId: receipt.data.studentId });
}

async function resolveReplay(
  transaction: MemberDirectoryTransaction,
  dependencies: CanonicalMemberDirectoryDependencies,
  receiptValue: unknown,
  expectedReceiptId: string,
  expectedAcademyId: string,
  expectedActorId: string,
  expectedRequestMac: string,
): Promise<CreateAdminAdultResult> {
  const receipt = writeReceiptSchema.safeParse(receiptValue);
  if (
    !receipt.success ||
    receipt.data.receiptId !== expectedReceiptId ||
    receipt.data.academyId !== expectedAcademyId ||
    receipt.data.actorId !== expectedActorId ||
    !constantTimeMacEquals(receipt.data.requestMac, expectedRequestMac)
  ) {
    throw new CanonicalMemberDirectoryError("replay", "Divergent member write replay");
  }
  const studentSnapshot = await transaction.get(
    dependencies.firestore.doc(studentPath(receipt.data.academyId, receipt.data.studentId)),
  );
  const profileSnapshot = await transaction.get(
    dependencies.firestore.doc(profilePath(receipt.data.academyId, receipt.data.studentId)),
  );
  const auditSnapshot = await transaction.get(
    dependencies.firestore.doc(auditPath(receipt.data.academyId, receipt.data.auditEventId)),
  );
  const student = parseStudentProfileAt(
    documentData(studentSnapshot, "Replay student"),
    receipt.data.createdAt.slice(0, 10),
  );
  const profile = studentAdminProfileSchema.safeParse(
    documentData(profileSnapshot, "Replay admin profile"),
  );
  const expectedKeys = profile.success ? buildKeys(profile.data, dependencies) : [];
  const keySnapshots = await Promise.all(
    expectedKeys.map((key) =>
      transaction.get(dependencies.firestore.doc(keyPath(receipt.data.academyId, key.keyId))),
    ),
  );
  const keysAreCurrent = expectedKeys.every((expectedKey, index) => {
    const snapshot = keySnapshots[index];
    if (snapshot === undefined || snapshot.id !== expectedKey.keyId || !snapshot.exists)
      return false;
    const parsedKey = studentIdentityKeySchema.safeParse(snapshot.data());
    return (
      parsedKey.success &&
      parsedKey.data.keyId === expectedKey.keyId &&
      parsedKey.data.academyId === expectedKey.academyId &&
      parsedKey.data.kind === expectedKey.kind &&
      parsedKey.data.digestVersion === expectedKey.digestVersion &&
      parsedKey.data.secretVersion === expectedKey.secretVersion &&
      parsedKey.data.ownerStudentId === expectedKey.ownerStudentId
    );
  });
  const auditIsCurrent =
    auditSnapshot.id === receipt.data.auditEventId &&
    auditSnapshot.exists &&
    matchesAuditEventReplay(auditSnapshot.data(), receipt.data.auditEventId, {
      academyId: receipt.data.academyId,
      actorId: receipt.data.actorId,
      action: "member.created",
      targetRef: studentPath(receipt.data.academyId, receipt.data.studentId),
      purpose: "member-record-maintenance",
      correlationId: receipt.data.receiptId,
    } as unknown as AuditEventDraft);
  if (
    !student.ok ||
    !profile.success ||
    !auditIsCurrent ||
    student.value.studentId !== receipt.data.studentId ||
    student.value.academyId !== receipt.data.academyId ||
    profile.data.studentId !== receipt.data.studentId ||
    profile.data.academyId !== receipt.data.academyId ||
    !keysAreCurrent
  ) {
    throw new CanonicalMemberDirectoryError("replay", "Completed member write replay is invalid");
  }
  return Object.freeze({ memberId: receipt.data.studentId, studentId: receipt.data.studentId });
}

export function createCanonicalMemberDirectoryService(
  dependencies: CanonicalMemberDirectoryDependencies,
): OfficeMemberDirectoryService {
  requiredIdentifier(dependencies.projectId, "project ID");
  requiredIdentifier(dependencies.identitySecretVersion, "identity secret version");
  requiredIdentifier(dependencies.integritySecretVersion, "integrity secret version");
  const identitySecret = decodeMemberDirectorySecret(
    dependencies.identitySecretMaterial,
    "identity",
  );
  const integritySecret = decodeMemberDirectorySecret(
    dependencies.integritySecretMaterial,
    "integrity",
  );
  if (
    identitySecret.length === integritySecret.length &&
    constantTimeMacEquals(
      createMemberDirectoryIntegrityMac({
        domain: "bpt-member-directory-secret-distinct-v1",
        values: [],
        secretMaterial: dependencies.identitySecretMaterial,
      }),
      createMemberDirectoryIntegrityMac({
        domain: "bpt-member-directory-secret-distinct-v1",
        values: [],
        secretMaterial: dependencies.integritySecretMaterial,
      }),
    )
  ) {
    throw new CanonicalMemberDirectoryError("invalid", "Purpose secrets must be distinct");
  }
  const generateStudentId = dependencies.generateStudentId ?? randomUUID;
  const generateAuditId = dependencies.generateAuditId ?? randomUUID;

  /**
   * One write plan for both doors. `account` is present only when office is enrolling somebody
   * whose account the academy already knows, and it is the difference between a record the member
   * can sign in to and a record that gets silently duplicated the first time they do.
   */
  async function createAdult(
    command: CreateAdminAdultCommand,
    account?: MemberAccountLink,
    sourceRecordId?: string,
    legacy?: Readonly<{
      legacyMemberId: string;
      trainingCenter: string;
      trainingTimePreferences: readonly string[];
    }>,
    enrolmentRequestId?: string,
    courseEnrolmentId?: string,
  ): Promise<CreateAdminAdultResult> {
    requireAuthorizedActor(command.actor);
    const now = requiredTimestamp(command.now);
    const officeInput = legacy
      ? legacyStudentInputSchema.safeParse(command.value)
      : sourceRecordId
        ? adminCreateStudentInputSchema.safeParse(command.value)
        : null;
    const parsedInput =
      legacy || sourceRecordId
        ? officeInput?.success
          ? { ok: true as const, value: officeInput.data }
          : { ok: false as const }
        : parseAdminCreateStudentInput(command.value, now.slice(0, 10));
    if (
      !parsedInput.ok ||
      (parsedInput.value.dateOfBirth !== undefined &&
        parsedInput.value.dateOfBirth > now.slice(0, 10))
    ) {
      throw new CanonicalMemberDirectoryError("invalid", "Invalid admin student input");
    }
    const needsReview =
      legacy !== undefined &&
      (parsedInput.value.dateOfBirth === undefined ||
        deriveParticipantType(parsedInput.value.dateOfBirth, now.slice(0, 10)) === "minor");
    const academyId = command.actor.academyId;
    const actorId = command.actor.actorId;
    // Only the internal account-linking path supplies this scope. Authority and audit retain
    // the real reviewer; receipts belong to the enrolment so another office user can resume.
    const receiptActorId =
      courseEnrolmentId !== undefined ? `course:${requiredIdentifier(account?.userId ?? "", "course account")}` :
      enrolmentRequestId === undefined ? actorId : `enrolment:${requiredIdentifier(enrolmentRequestId, "enrolment request")}`;
    if (account !== undefined && parsedInput.value.phoneNumber === undefined) {
      // The academy's client document will not parse without one, and a member without that
      // document is denied by levels and by the family projection: half-enrolled, in silence.
      throw new CanonicalMemberDirectoryError("invalid", "A linked enrolment needs a phone number");
    }
    const accountLink =
      account === undefined
        ? undefined
        : {
            displayName: account.displayName,
            email: account.email,
            userId: requiredIdentifier(account.userId, "account user ID"),
            familyId:
              "adult-" +
              createMemberDirectoryIntegrityMac({
                domain: "bpt-adult-family-identity-v1",
                values: [academyId, account.userId],
                secretMaterial: dependencies.integritySecretMaterial,
              }),
          };
    const expectedRequestMac = requestMac(
      academyId,
      receiptActorId,
      parsedInput.value,
      dependencies.integritySecretMaterial,
      sourceRecordId,
    );
    const receiptId = requestReceiptId(
      academyId,
      receiptActorId,
      parsedInput.value.requestId,
      dependencies.integritySecretMaterial,
    );
    const studentId = requiredIdentifier(generateStudentId(), "generated student ID");
    const auditEventId = requiredIdentifier(generateAuditId(), "generated audit ID");
    const receiptRef = dependencies.firestore.doc(receiptPath(academyId, receiptId));

    return dependencies.firestore.runTransaction(async (transaction) => {
      await assertProvisionedActor(transaction, dependencies, command.actor);
      if (courseEnrolmentId !== undefined) {
        const courseRequest = await transaction.get(dependencies.firestore.doc(`academies/${academyId}/courseEnrolments/${requiredIdentifier(courseEnrolmentId, "course enrolment")}`));
        const value = courseRequest.data();
        if (!value || value.applicantUid !== account?.userId || !value.proofId || !["review", "expired", "rejected", "cancelled"].includes(String(value.status)))
          throw new CanonicalMemberDirectoryError("conflict", "Course identity approval is not available");
        const participant = value.participant as {kind?: string; candidateId?: string} | undefined;
        if (participant?.kind !== "candidate" || participant.candidateId !== parsedInput.value.requestId)
          throw new CanonicalMemberDirectoryError("conflict", "Course candidate identity does not match");
        const candidate = (await transaction.get(dependencies.firestore.doc(`academies/${academyId}/courseCandidates/${requiredIdentifier(participant.candidateId, "course candidate")}`))).data();
        if (!candidate || candidate.applicantUid !== account?.userId || candidate.kind !== "adult" || candidate.fullName !== parsedInput.value.fullName || candidate.dateOfBirth !== parsedInput.value.dateOfBirth)
          throw new CanonicalMemberDirectoryError("conflict", "Course candidate details do not match");
      }
      const officeLinkRef = sourceRecordId
        ? dependencies.firestore.doc(`academies/${academyId}/regyfitOfficeLinks/${sourceRecordId}`)
        : undefined;
      const decisionRef = legacy
        ? dependencies.firestore.doc(
            `academies/${academyId}/memberMigrationDecisions/${legacy.legacyMemberId}`,
          )
        : undefined;
      if (decisionRef && (await transaction.get(decisionRef)).exists) {
        throw new CanonicalMemberDirectoryError(
          "conflict",
          legacyMigrationErrorMessages.alreadyDecided,
        );
      }
      if (officeLinkRef) {
        const [sourceSnapshot, linkSnapshot, recoveredSnapshot] = await Promise.all([
          transaction.get(
            dependencies.firestore.doc(
              `academies/${academyId}/regyfitMemberRecords/${sourceRecordId}`,
            ),
          ),
          transaction.get(officeLinkRef),
          transaction.get(
            dependencies.firestore.doc(
              `academies/${academyId}/regyfitMemberLinks/${sourceRecordId}`,
            ),
          ),
        ]);
        const storedSource = sourceSnapshot.data();
        const source = parseStoredRegyfitMemberRecord(storedSource);
        if (
          !source.ok ||
          source.value.recordId !== sourceRecordId ||
          (storedSource?.academyId !== undefined && storedSource.academyId !== academyId) ||
          source.value.fullName !== parsedInput.value.fullName ||
          (!legacy &&
            source.value.birthDate &&
            source.value.birthDate !== parsedInput.value.dateOfBirth) ||
          (source.value.memberNumber
            ? normalizeAdministrativeIdentifier(source.value.memberNumber)
            : undefined) !== parsedInput.value.membershipNumber
        )
          throw new CanonicalMemberDirectoryError(
            "invalid",
            "Imported identity changed. Refresh before registering.",
          );
        if (
          linkSnapshot.exists &&
          recoveredSnapshot.exists &&
          linkSnapshot.data()?.studentId !== recoveredSnapshot.data()?.studentId
        )
          throw new CanonicalMemberDirectoryError("conflict", "Conflicting imported member links");
        for (const snapshot of [linkSnapshot, recoveredSnapshot]) {
          if (!snapshot.exists) continue;
          const link = snapshot.data();
          if (
            link?.academyId !== academyId ||
            link.recordId !== sourceRecordId ||
            typeof link.studentId !== "string"
          )
            throw new CanonicalMemberDirectoryError("conflict", "Invalid imported member link");
        }
        if (legacy && (linkSnapshot.exists || recoveredSnapshot.exists)) {
          throw new CanonicalMemberDirectoryError(
            "conflict",
            legacyMigrationErrorMessages.recordLinked,
          );
        }
        const linked = linkSnapshot.exists ? linkSnapshot.data() : recoveredSnapshot.data();
        if (linked) {
          if (
            linked.academyId !== academyId ||
            linked.recordId !== sourceRecordId ||
            typeof linked.studentId !== "string"
          )
            throw new CanonicalMemberDirectoryError("conflict", "Invalid imported member link");
          const target = await transaction.get(
            dependencies.firestore.doc(studentPath(academyId, linked.studentId)),
          );
          const parsed = parseStudentProfileAt(target.data(), now.slice(0, 10));
          if (
            !parsed.ok ||
            parsed.value.academyId !== academyId ||
            parsed.value.studentId !== linked.studentId
          )
            throw new CanonicalMemberDirectoryError("conflict", "Linked member is unavailable");
          return { memberId: linked.studentId, studentId: linked.studentId };
        }
      }
      const receiptSnapshot = await transaction.get(receiptRef);
      if (receiptSnapshot.exists) {
        if (legacy !== undefined) {
          throw new CanonicalMemberDirectoryError("replay", "Divergent member write replay");
        }
        return resolveReplay(
          transaction,
          dependencies,
          receiptSnapshot.data(),
          receiptId,
          academyId,
          enrolmentRequestId === undefined && courseEnrolmentId === undefined
            ? actorId
            : String(receiptSnapshot.data()?.actorId ?? ""),
          expectedRequestMac,
        );
      }

      const stateRef = dependencies.firestore.doc(statePath(academyId));
      const guardRef = dependencies.firestore.doc(guardPath(academyId));
      const [stateSnapshot, guardSnapshot] = await Promise.all([
        transaction.get(stateRef),
        transaction.get(guardRef),
      ]);
      const stateValue = documentData(stateSnapshot, "Member directory state");
      const state = assertCanonicalMemberDirectoryWriterReady(stateValue, {
        academyId,
        digestVersion: "hmac-sha256-v1",
        secretVersion: dependencies.identitySecretVersion,
      });
      if (!guardSnapshot.exists) {
        throw new CanonicalMemberDirectoryError(
          "unavailable",
          "Member directory restore guard is missing",
        );
      }
      const guard = memberDirectoryRestoreGuardSchema.safeParse(guardSnapshot.data());
      if (!guard.success) {
        throw new CanonicalMemberDirectoryError(
          "unavailable",
          "Member directory restore guard is invalid",
        );
      }
      const currentEventRef = dependencies.firestore.doc(
        guardEventPath(academyId, guard.data.lastEventId),
      );
      const currentEventSnapshot = await transaction.get(currentEventRef);
      const currentControl = assertMemberDirectoryControlPlane({
        projectId: dependencies.projectId,
        state,
        guard: guard.data,
        event: documentData(currentEventSnapshot, "Member directory guard event"),
        integritySecretMaterial: dependencies.integritySecretMaterial,
        integritySecretVersion: dependencies.integritySecretVersion,
      });
      if (
        state.globalLegacyReadEliminated === false &&
        state.rollbackEligibleStudentCount >= state.rollbackCapacityLimit
      ) {
        throw new CanonicalMemberDirectoryError(
          "unavailable",
          "Member directory rollback capacity is exhausted",
        );
      }

      const student = buildStudent(
        parsedInput.value,
        academyId,
        studentId,
        actorId,
        now,
        needsReview
          ? undefined
          : accountLink === undefined
            ? { familyId: `office-${studentId}` }
            : { userId: accountLink.userId, familyId: accountLink.familyId },
        legacy !== undefined,
      );
      const profile = buildAdminProfile(
        parsedInput.value,
        academyId,
        studentId,
        actorId,
        now,
        legacy,
      );
      const administrativeKeys = buildKeys(profile, dependencies);
      // The reservation the self-service profile looks for. Without it that path finds nothing
      // and mints a second student for the same person.
      const authKey =
        accountLink === undefined
          ? undefined
          : buildStudentIdentityKey({
              academyId,
              kind: "auth-user-id",
              value: accountLink.userId,
              ownerStudentId: studentId,
              secretMaterial: dependencies.identitySecretMaterial,
              secretVersion: dependencies.identitySecretVersion,
              now,
              actorId,
            });
      const keys = authKey === undefined ? administrativeKeys : [...administrativeKeys, authKey];
      const keyReferences = keys.map((key) =>
        dependencies.firestore.doc(keyPath(academyId, key.keyId)),
      );
      const keySnapshots = await Promise.all(
        keyReferences.map((reference) => transaction.get(reference)),
      );
      if (keySnapshots.some((snapshot) => snapshot.exists)) {
        throw new CanonicalMemberDirectoryError(
          "conflict",
          "Administrative identifier is already reserved",
        );
      }

      // This method only ever creates a fresh linked member. If the academy already holds a
      // family or a client document for that account, somebody built part of this person
      // already, and joining the two halves is not a decision this write may take on its own.
      const linkedRefs =
        accountLink === undefined
          ? undefined
          : {
              family: dependencies.firestore.doc(familyPath(academyId, accountLink.familyId)),
              user: dependencies.firestore.doc(courseEnrolmentId === undefined ? userPath(academyId, accountLink.userId) : `academies/${academyId}/courseParticipantAccounts/${accountLink.userId}`),
            };
      let linkedRecords: Readonly<{ family: FamilyRecord; user: UserProfile }> | undefined;
      if (accountLink !== undefined && linkedRefs !== undefined) {
        const [familySnapshot, userSnapshot] = await Promise.all([
          transaction.get(linkedRefs.family),
          transaction.get(linkedRefs.user),
        ]);
        if (familySnapshot.exists || (userSnapshot.exists && courseEnrolmentId === undefined)) {
          throw new CanonicalMemberDirectoryError(
            "conflict",
            "This account already holds a member record",
          );
        }
        const family = parseFamilyRecord({
          familyId: accountLink.familyId,
          academyId,
          primaryContactUserId: accountLink.userId,
          billingContactUserId: accountLink.userId,
          active: true,
          status: "active",
          schemaVersion: "1",
          createdAt: now,
          createdBy: actorId,
          updatedAt: now,
          updatedBy: actorId,
        });
        const user = parseUserProfile({
          userId: accountLink.userId,
          academyId,
          accountType: "client",
          displayName: accountLink.displayName,
          email: accountLink.email.trim().toLowerCase(),
          phoneNumber: parsedInput.value.phoneNumber,
          active: true,
          status: "active",
          schemaVersion: "1",
          createdAt: now,
          createdBy: actorId,
          updatedAt: now,
          updatedBy: actorId,
        });
        if (!family.ok || !user.ok) {
          throw new CanonicalMemberDirectoryError("invalid", "Invalid linked member record");
        }
        linkedRecords = { family: family.value, user: user.value };
      }

      const officeFamily =
        accountLink === undefined && !needsReview
          ? parseFamilyRecord({
              familyId: student.familyId,
              academyId,
              primaryContactUserId: null,
              billingContactUserId: null,
              active: true,
              status: "active",
              schemaVersion: "1",
              createdAt: now,
              createdBy: actorId,
              updatedAt: now,
              updatedBy: actorId,
            })
          : null;
      if (officeFamily && !officeFamily.ok)
        throw new CanonicalMemberDirectoryError("invalid", "Invalid office billing account");
      const officeFamilyRef = officeFamily?.ok
        ? dependencies.firestore.doc(familyPath(academyId, officeFamily.value.familyId))
        : undefined;
      if (officeFamilyRef && (await transaction.get(officeFamilyRef)).exists)
        throw new CanonicalMemberDirectoryError("conflict", "Billing account already exists");
      const nextState = {
        ...state,
        stateRevision: state.stateRevision + 1,
        rollbackEligibleStudentCount: state.globalLegacyReadEliminated
          ? state.rollbackEligibleStudentCount
          : state.rollbackEligibleStudentCount + 1,
        updatedAt: now,
        updatedBy: actorId,
      };
      const nextControl = advanceMemberDirectoryControlPlane({
        projectId: dependencies.projectId,
        state: currentControl.state,
        guard: currentControl.guard,
        event: currentControl.event,
        nextState,
        operationId: receiptId,
        transitionKind: accountLink === undefined ? "canonical-identity-create" : "adult-auth-link",
        integritySecretMaterial: dependencies.integritySecretMaterial,
        integritySecretVersion: dependencies.integritySecretVersion,
        now,
        actorId,
      });
      const nextEventRef = dependencies.firestore.doc(
        guardEventPath(academyId, nextControl.event.eventId),
      );
      const studentRef = dependencies.firestore.doc(studentPath(academyId, studentId));
      const profileRef = dependencies.firestore.doc(profilePath(academyId, studentId));
      const auditRef = dependencies.firestore.doc(auditPath(academyId, auditEventId));
      const receipt: MemberDirectoryWriteReceipt = writeReceiptSchema.parse({
        receiptId,
        academyId,
        actorId,
        requestMac: expectedRequestMac,
        studentId,
        ...(officeFamily?.ok ? { createdFamilyId: officeFamily.value.familyId } : {}),
        auditEventId,
        stateRevisionBefore: state.stateRevision,
        stateRevisionAfter: nextState.stateRevision,
        status: "completed",
        createdAt: now,
        schemaVersion: "1",
      });

      if (officeFamilyRef && officeFamily?.ok)
        transaction.create(officeFamilyRef, officeFamily.value);
      if (officeLinkRef) {
        transaction.create(officeLinkRef, {
          academyId,
          recordId: sourceRecordId,
          studentId,
          createdAt: now,
          createdBy: actorId,
          schemaVersion: "1",
        });
      }
      transaction.create(studentRef, student);
      transaction.create(profileRef, profile);
      if (decisionRef && legacy) {
        const decision = memberMigrationDecisionRecordSchema.parse({
          legacyMemberId: legacy.legacyMemberId,
          academyId,
          migrationId: MEMBER_MIGRATION_ID,
          kind: sourceRecordId ? "link" : "create-unlinked",
          ...(sourceRecordId ? { recordId: sourceRecordId } : {}),
          studentId,
          trainingCenter: legacy.trainingCenter,
          trainingTimePreferences: [...legacy.trainingTimePreferences],
          decidedAt: now,
          decidedBy: actorId,
          schemaVersion: "1",
        });
        transaction.create(decisionRef, decision);
      }
      keys.forEach((key, index) => {
        const reference = keyReferences[index];
        if (reference === undefined) {
          throw new CanonicalMemberDirectoryError("invalid", "Identity key plan mismatch");
        }
        transaction.create(reference, key);
      });
      if (linkedRefs !== undefined && linkedRecords !== undefined) {
        transaction.create(linkedRefs.family, linkedRecords.family);
        if (courseEnrolmentId === undefined) transaction.create(linkedRefs.user, linkedRecords.user);
        else transaction.set(linkedRefs.user, linkedRecords.user);
      }
      transaction.set(stateRef, nextState);
      transaction.set(guardRef, nextControl.guard);
      transaction.create(nextEventRef, nextControl.event);
      appendAuditEventInTransaction(transaction, auditRef, {
        academyId,
        actorId,
        action: "member.created",
        targetRef: studentRef.path,
        purpose: "member-record-maintenance",
        correlationId: receiptId,
      } as unknown as AuditEventDraft);
      transaction.create(receiptRef, receipt);
      return Object.freeze({ memberId: studentId, studentId });
    });
  }

  return Object.freeze({
    async reviewMember(command: CreateAdminAdultCommand) {
      requireAuthorizedActor(command.actor);
      const now = requiredTimestamp(command.now);
      const parsed = memberReviewInputSchema.safeParse(command.value);
      if (
        !parsed.success ||
        (parsed.data.kind === "set-date-of-birth" && parsed.data.dateOfBirth > now.slice(0, 10))
      ) {
        throw new CanonicalMemberDirectoryError("invalid", "Invalid member review input");
      }
      const input = parsed.data;
      const { academyId, actorId } = command.actor;
      const { studentId } = input;
      const receiptId = requestReceiptId(
        academyId,
        actorId,
        input.requestId,
        dependencies.integritySecretMaterial,
      );
      const expectedMac = createMemberDirectoryIntegrityMac({
        domain: "bpt-member-review-request-v1",
        values: [academyId, actorId, canonicalizeMemberDirectoryValue(input)],
        secretMaterial: dependencies.integritySecretMaterial,
      });
      const receiptRef = dependencies.firestore.doc(receiptPath(academyId, receiptId));
      const studentRef = dependencies.firestore.doc(studentPath(academyId, studentId));
      const action =
        input.kind === "assign-guardian" ? "member.guardian.assigned" : "member.date-of-birth.set";
      const auditDraft = {
        academyId,
        actorId,
        action,
        targetRef: studentRef.path,
        purpose: "member-record-maintenance",
        correlationId: receiptId,
      } as AuditEventDraft;
      const auditEventId = requiredIdentifier(generateAuditId(), "generated audit ID");
      return dependencies.firestore.runTransaction(async (transaction) => {
        await assertProvisionedActor(transaction, dependencies, command.actor);
        const receiptSnapshot = await transaction.get(receiptRef);
        const studentSnapshot = await transaction.get(studentRef);
        // Replays validate the original audit and binding, but never reapply an older mutation.
        if (receiptSnapshot.exists) {
          const receipt = writeReceiptSchema.safeParse(receiptSnapshot.data());
          if (
            !receipt.success ||
            receipt.data.receiptId !== receiptId ||
            receipt.data.academyId !== academyId ||
            receipt.data.actorId !== actorId ||
            receipt.data.studentId !== studentId ||
            !constantTimeMacEquals(receipt.data.requestMac, expectedMac)
          ) {
            throw new CanonicalMemberDirectoryError("replay", "Divergent member review replay");
          }
          const audit = await transaction.get(
            dependencies.firestore.doc(auditPath(academyId, receipt.data.auditEventId)),
          );
          if (
            !studentSnapshot.exists ||
            studentSnapshot.data()?.academyId !== academyId ||
            studentSnapshot.data()?.studentId !== studentId ||
            !matchesAuditEventReplay(audit.data(), receipt.data.auditEventId, auditDraft)
          ) {
            throw new CanonicalMemberDirectoryError(
              "replay",
              "Completed member review is unavailable",
            );
          }
          return { studentId };
        }
        const student = parseStudentProfileAt(studentSnapshot.data(), now.slice(0, 10));
        if (
          !student.ok ||
          student.value.academyId !== academyId ||
          student.value.studentId !== studentId
        ) {
          throw new CanonicalMemberDirectoryError("invalid", "Member is unavailable");
        }
        const stateRef = dependencies.firestore.doc(statePath(academyId));
        const guardRef = dependencies.firestore.doc(guardPath(academyId));
        const [stateSnapshot, guardSnapshot] = await Promise.all([
          transaction.get(stateRef),
          transaction.get(guardRef),
        ]);
        const state = assertCanonicalMemberDirectoryWriterReady(
          documentData(stateSnapshot, "Member directory state"),
          {
            academyId,
            digestVersion: "hmac-sha256-v1",
            secretVersion: dependencies.identitySecretVersion,
          },
        );
        const guard = memberDirectoryRestoreGuardSchema.safeParse(guardSnapshot.data());
        if (!guard.success)
          throw new CanonicalMemberDirectoryError(
            "unavailable",
            "Member directory restore guard is unavailable",
          );
        const event = await transaction.get(
          dependencies.firestore.doc(guardEventPath(academyId, guard.data.lastEventId)),
        );
        const currentControl = assertMemberDirectoryControlPlane({
          projectId: dependencies.projectId,
          state,
          guard: guard.data,
          event: documentData(event, "Member directory guard event"),
          integritySecretMaterial: dependencies.integritySecretMaterial,
          integritySecretVersion: dependencies.integritySecretVersion,
        });
        let nextStudent: StudentProfile;
        let family: FamilyRecord | undefined;
        let familyRef: MemberDirectoryDocumentReference | undefined;
        let existingFamily = false;
        if (input.kind === "assign-guardian") {
          if (
            student.value.guardianStatus !== "pending" ||
            student.value.participantType !== "minor" ||
            student.value.dateOfBirth === undefined ||
            (student.value.familyId !== undefined &&
              student.value.familyId !== `office-${studentId}`)
          ) {
            throw new CanonicalMemberDirectoryError(
              "conflict",
              "Member does not need an office guardian",
            );
          }
          const familyId = `office-${studentId}`;
          familyRef = dependencies.firestore.doc(familyPath(academyId, familyId));
          const familySnapshot = await transaction.get(familyRef);
          existingFamily = familySnapshot.exists;
          const storedFamily = existingFamily
            ? parseFamilyRecord(familySnapshot.data())
            : undefined;
          if (
            existingFamily &&
            (student.value.familyId !== familyId ||
              !storedFamily?.ok ||
              storedFamily.value.familyId !== familyId ||
              storedFamily.value.academyId !== academyId ||
              !storedFamily.value.active ||
              storedFamily.value.status !== "active" ||
              storedFamily.value.primaryContactUserId !== null ||
              storedFamily.value.billingContactUserId !== null ||
              storedFamily.value.guardianContact !== undefined)
          )
            throw new CanonicalMemberDirectoryError("conflict", "Office family already exists");
          const parsedFamily = parseFamilyRecord({
            familyId,
            academyId,
            primaryContactUserId: null,
            billingContactUserId: null,
            guardianContact: input.guardianContact,
            active: true,
            status: "active",
            schemaVersion: "1",
            createdAt: storedFamily?.ok ? storedFamily.value.createdAt : now,
            createdBy: storedFamily?.ok ? storedFamily.value.createdBy : actorId,
            updatedAt: now,
            updatedBy: actorId,
          });
          if (!parsedFamily.ok)
            throw new CanonicalMemberDirectoryError("invalid", "Invalid guardian contact");
          family = parsedFamily.value;
          nextStudent = {
            ...student.value,
            familyId,
            guardianStatus: "assigned",
            updatedAt: now,
            updatedBy: actorId,
          };
        } else {
          const base = { ...student.value };
          delete base.reviewReason;
          delete base.guardianStatus;
          const participantType = deriveParticipantType(input.dateOfBirth, now.slice(0, 10));
          nextStudent = {
            ...base,
            dateOfBirth: input.dateOfBirth,
            participantType,
            ...(await guardianReviewFields(
              transaction,
              dependencies.firestore,
              student.value,
              input.dateOfBirth,
              now.slice(0, 10),
            )),
            updatedAt: now,
            updatedBy: actorId,
          };
        }
        if (!parseStudentProfileAt(nextStudent, now.slice(0, 10)).ok)
          throw new CanonicalMemberDirectoryError("invalid", "Invalid reviewed student");
        const nextState = {
          ...state,
          stateRevision: state.stateRevision + 1,
          updatedAt: now,
          updatedBy: actorId,
        };
        const nextControl = advanceMemberDirectoryControlPlane({
          projectId: dependencies.projectId,
          state: currentControl.state,
          guard: currentControl.guard,
          event: currentControl.event,
          nextState,
          operationId: receiptId,
          transitionKind: "canonical-identity-update",
          integritySecretMaterial: dependencies.integritySecretMaterial,
          integritySecretVersion: dependencies.integritySecretVersion,
          now,
          actorId,
        });
        const receipt = writeReceiptSchema.parse({
          receiptId,
          academyId,
          actorId,
          requestMac: expectedMac,
          studentId,
          ...(family && !existingFamily ? { createdFamilyId: family.familyId } : {}),
          auditEventId,
          stateRevisionBefore: state.stateRevision,
          stateRevisionAfter: nextState.stateRevision,
          status: "completed",
          createdAt: now,
          schemaVersion: "1",
        });
        transaction.set(studentRef, nextStudent);
        if (familyRef && family) {
          if (existingFamily) transaction.set(familyRef, family);
          else transaction.create(familyRef, family);
        }
        transaction.set(stateRef, nextState);
        transaction.set(guardRef, nextControl.guard);
        transaction.create(
          dependencies.firestore.doc(guardEventPath(academyId, nextControl.event.eventId)),
          nextControl.event,
        );
        appendAuditEventInTransaction(
          transaction,
          dependencies.firestore.doc(auditPath(academyId, auditEventId)),
          auditDraft,
        );
        transaction.create(receiptRef, receipt);
        return { studentId };
      });
    },
    async registerLegacyMember(command: LegacyMemberRegistrationCommand) {
      if (command.recordId !== undefined && !/^[0-9]{1,12}$/u.test(command.recordId))
        throw new CanonicalMemberDirectoryError("invalid", "Invalid imported record ID");
      return createAdult(command, undefined, command.recordId, {
        legacyMemberId: command.legacyMemberId,
        trainingCenter: command.trainingCenter,
        trainingTimePreferences: command.trainingTimePreferences,
      });
    },
    async skipLegacyMember(command: LegacyMemberSkipCommand) {
      requireAuthorizedActor(command.actor);
      const now = requiredTimestamp(command.now);
      const academyId = command.actor.academyId;
      const decisionRef = dependencies.firestore.doc(
        `academies/${academyId}/memberMigrationDecisions/${command.legacyMemberId}`,
      );
      const auditRef = dependencies.firestore.doc(
        auditPath(academyId, requiredIdentifier(generateAuditId(), "generated audit ID")),
      );
      await dependencies.firestore.runTransaction(async (transaction) => {
        await assertProvisionedActor(transaction, dependencies, command.actor);
        if ((await transaction.get(decisionRef)).exists)
          throw new CanonicalMemberDirectoryError(
            "conflict",
            legacyMigrationErrorMessages.alreadyDecided,
          );
        transaction.create(
          decisionRef,
          memberMigrationDecisionRecordSchema.parse({
            legacyMemberId: command.legacyMemberId,
            academyId,
            migrationId: MEMBER_MIGRATION_ID,
            kind: "skip",
            reason: command.reason.trim(),
            decidedAt: now,
            decidedBy: command.actor.actorId,
            schemaVersion: "1",
          }),
        );
        appendAuditEventInTransaction(transaction, auditRef, {
          academyId,
          actorId: command.actor.actorId,
          action: "member.migration.skipped",
          targetRef: decisionRef.path,
          purpose: "member-record-maintenance",
          correlationId: `${MEMBER_MIGRATION_ID}:${command.legacyMemberId}`,
        } as unknown as AuditEventDraft);
      });
    },
    async registerImportedMember(command: OfficeImportedMemberCommand) {
      if (!/^[0-9]{1,12}$/u.test(command.recordId))
        throw new CanonicalMemberDirectoryError("invalid", "Invalid imported record ID");
      return createAdult(command, undefined, command.recordId);
    },
    async createAdminAdult(command) {
      return createAdult(command);
    },
    async createAdminAdultForAccount(command) {
      return createAdult(
        command,
        command.account,
        undefined,
        undefined,
        command.enrolmentRequestId,
        command.courseEnrolmentId,
      );
    },
    async updateAdminMember(command) {
      requireAuthorizedActor(command.actor);
      const now = requiredTimestamp(command.now);
      const parsedInput = parseAdminUpdateStudentInput(command.value, now.slice(0, 10));
      if (!parsedInput.ok) {
        throw new CanonicalMemberDirectoryError("invalid", "Invalid admin member update");
      }
      const academyId = command.actor.academyId;
      const actorId = command.actor.actorId;
      const studentId = parsedInput.value.studentId;
      const expectedRequestMac = updateRequestMac(
        academyId,
        actorId,
        parsedInput.value,
        dependencies.integritySecretMaterial,
      );
      const receiptId = requestReceiptId(
        academyId,
        actorId,
        parsedInput.value.requestId,
        dependencies.integritySecretMaterial,
      );
      const auditEventId = requiredIdentifier(generateAuditId(), "generated audit ID");
      const receiptRef = dependencies.firestore.doc(receiptPath(academyId, receiptId));

      return dependencies.firestore.runTransaction(async (transaction) => {
        await assertProvisionedActor(transaction, dependencies, command.actor);
        const receiptSnapshot = await transaction.get(receiptRef);
        if (receiptSnapshot.exists) {
          return resolveUpdateReplay(
            transaction,
            dependencies,
            receiptSnapshot.data(),
            receiptId,
            academyId,
            actorId,
            expectedRequestMac,
            parsedInput.value,
          );
        }

        const stateRef = dependencies.firestore.doc(statePath(academyId));
        const guardRef = dependencies.firestore.doc(guardPath(academyId));
        const [stateSnapshot, guardSnapshot] = await Promise.all([
          transaction.get(stateRef),
          transaction.get(guardRef),
        ]);
        const state = assertCanonicalMemberDirectoryWriterReady(
          documentData(stateSnapshot, "Member directory state"),
          {
            academyId,
            digestVersion: "hmac-sha256-v1",
            secretVersion: dependencies.identitySecretVersion,
          },
        );
        if (!guardSnapshot.exists) {
          throw new CanonicalMemberDirectoryError(
            "unavailable",
            "Member directory restore guard is missing",
          );
        }
        const guard = memberDirectoryRestoreGuardSchema.safeParse(guardSnapshot.data());
        if (!guard.success) {
          throw new CanonicalMemberDirectoryError(
            "unavailable",
            "Member directory restore guard is invalid",
          );
        }
        const currentEventRef = dependencies.firestore.doc(
          guardEventPath(academyId, guard.data.lastEventId),
        );
        const currentEventSnapshot = await transaction.get(currentEventRef);
        const currentControl = assertMemberDirectoryControlPlane({
          projectId: dependencies.projectId,
          state,
          guard: guard.data,
          event: documentData(currentEventSnapshot, "Member directory guard event"),
          integritySecretMaterial: dependencies.integritySecretMaterial,
          integritySecretVersion: dependencies.integritySecretVersion,
        });

        const studentRef = dependencies.firestore.doc(studentPath(academyId, studentId));
        const profileRef = dependencies.firestore.doc(profilePath(academyId, studentId));
        const [studentSnapshot, profileSnapshot] = await Promise.all([
          transaction.get(studentRef),
          transaction.get(profileRef),
        ]);
        const existingStudent = parseStudentProfileAt(
          documentData(studentSnapshot, "Student"),
          now.slice(0, 10),
        );
        if (
          !existingStudent.ok ||
          studentSnapshot.id !== studentId ||
          existingStudent.value.studentId !== studentId ||
          existingStudent.value.academyId !== academyId
        ) {
          throw new CanonicalMemberDirectoryError(
            "unavailable",
            "Canonical member record is unavailable",
          );
        }
        // T051V2: minors created through Families only get an admin profile when the waiver carried
        // optional blocks, so office's first save is what creates one for them.
        const profileIsNew = !profileSnapshot.exists;
        const storedProfile = profileIsNew
          ? undefined
          : studentAdminProfileSchema.safeParse(
              documentData(profileSnapshot, "Student admin profile"),
            );
        if (
          storedProfile !== undefined &&
          (!storedProfile.success ||
            profileSnapshot.id !== studentId ||
            storedProfile.data.studentId !== studentId ||
            storedProfile.data.academyId !== academyId)
        ) {
          throw new CanonicalMemberDirectoryError(
            "unavailable",
            "Canonical member record is unavailable",
          );
        }
        const existingProfile =
          storedProfile?.success === true
            ? storedProfile.data
            : emptyAdminProfile(existingStudent.value, actorId, now);

        const nextStudent = buildUpdatedStudent(
          existingStudent.value,
          parsedInput.value,
          actorId,
          now,
          await guardianReviewFields(
            transaction,
            dependencies.firestore,
            existingStudent.value,
            parsedInput.value.dateOfBirth,
            now.slice(0, 10),
          ),
        );
        const nextProfile = buildUpdatedAdminProfile(
          existingProfile,
          parsedInput.value,
          actorId,
          now,
        );
        // T051V2: the domain can only refuse a self-recommendation, so the writer is the only place
        // that can prove the recommender is a real student of this academy before storing it. Only
        // the block being written is checked: a kept block was already validated when it was sent,
        // and re-checking it would fail unrelated saves once that recommender leaves the academy.
        const recommendedByStudentId = parsedInput.value.details?.recommendedByStudentId;
        if (recommendedByStudentId !== undefined) {
          const recommenderSnapshot = await transaction.get(
            dependencies.firestore.doc(studentPath(academyId, recommendedByStudentId)),
          );
          const recommender = recommenderSnapshot.exists
            ? parseStudentProfileAt(recommenderSnapshot.data(), now.slice(0, 10))
            : undefined;
          if (
            recommender?.ok !== true ||
            recommender.value.studentId !== recommendedByStudentId ||
            recommender.value.academyId !== academyId
          ) {
            throw new CanonicalMemberDirectoryError(
              "invalid",
              "Recommending student is unavailable",
            );
          }
        }
        const oldKeys = buildKeys(existingProfile, dependencies);
        const desiredKeys = buildKeys(nextProfile, dependencies, { now, actorId });
        const keyPlan = new Map<string, StudentIdentityKey>();
        oldKeys.forEach((key) => keyPlan.set(key.keyId, key));
        desiredKeys.forEach((key) => keyPlan.set(key.keyId, key));
        const keyEntries = [...keyPlan.entries()].map(([keyId, key]) => ({
          key,
          reference: dependencies.firestore.doc(keyPath(academyId, keyId)),
        }));
        const keySnapshots = await Promise.all(
          keyEntries.map(({ reference }) => transaction.get(reference)),
        );
        const snapshotsByKeyId = new Map(
          keyEntries.map(({ key }, index) => [key.keyId, keySnapshots[index]] as const),
        );
        for (const oldKey of oldKeys) {
          const snapshot = snapshotsByKeyId.get(oldKey.keyId);
          if (snapshot === undefined || !matchesIdentityReservation(snapshot, oldKey)) {
            throw new CanonicalMemberDirectoryError(
              "unavailable",
              "Existing identity reservation is unavailable",
            );
          }
        }
        const newReservations: Array<
          Readonly<{
            key: StudentIdentityKey;
            reference: MemberDirectoryDocumentReference;
          }>
        > = [];
        for (const desiredKey of desiredKeys) {
          const snapshot = snapshotsByKeyId.get(desiredKey.keyId);
          if (snapshot === undefined) {
            throw new CanonicalMemberDirectoryError("unavailable", "Identity key plan mismatch");
          }
          if (snapshot.exists) {
            const parsedKey = studentIdentityKeySchema.safeParse(snapshot.data());
            if (
              parsedKey.success &&
              parsedKey.data.academyId === academyId &&
              parsedKey.data.keyId === desiredKey.keyId &&
              parsedKey.data.ownerStudentId !== studentId
            ) {
              throw new CanonicalMemberDirectoryError(
                "conflict",
                "Administrative identifier is already reserved",
              );
            }
            if (!matchesIdentityReservation(snapshot, desiredKey)) {
              throw new CanonicalMemberDirectoryError(
                "unavailable",
                "Identity reservation is invalid",
              );
            }
          } else {
            newReservations.push({
              key: desiredKey,
              reference: dependencies.firestore.doc(keyPath(academyId, desiredKey.keyId)),
            });
          }
        }

        const nextState = {
          ...state,
          stateRevision: state.stateRevision + 1,
          updatedAt: now,
          updatedBy: actorId,
        };
        const nextControl = advanceMemberDirectoryControlPlane({
          projectId: dependencies.projectId,
          state: currentControl.state,
          guard: currentControl.guard,
          event: currentControl.event,
          nextState,
          operationId: receiptId,
          transitionKind: "canonical-identity-update",
          integritySecretMaterial: dependencies.integritySecretMaterial,
          integritySecretVersion: dependencies.integritySecretVersion,
          now,
          actorId,
        });
        const nextEventRef = dependencies.firestore.doc(
          guardEventPath(academyId, nextControl.event.eventId),
        );
        const auditRef = dependencies.firestore.doc(auditPath(academyId, auditEventId));
        const receipt: MemberDirectoryWriteReceipt = writeReceiptSchema.parse({
          receiptId,
          academyId,
          actorId,
          requestMac: expectedRequestMac,
          studentId,
          auditEventId,
          stateRevisionBefore: state.stateRevision,
          stateRevisionAfter: nextState.stateRevision,
          status: "completed",
          createdAt: now,
          schemaVersion: "1",
        });

        transaction.set(studentRef, nextStudent);
        if (profileIsNew) transaction.create(profileRef, nextProfile);
        else transaction.set(profileRef, nextProfile);
        newReservations.forEach(({ key, reference }) => transaction.create(reference, key));
        transaction.set(stateRef, nextState);
        transaction.set(guardRef, nextControl.guard);
        transaction.create(nextEventRef, nextControl.event);
        appendAuditEventInTransaction(transaction, auditRef, {
          academyId,
          actorId,
          action: "member.updated",
          targetRef: studentRef.path,
          purpose: "member-record-maintenance",
          correlationId: receiptId,
        } as unknown as AuditEventDraft);
        transaction.create(receiptRef, receipt);
        return Object.freeze({ memberId: studentId, studentId });
      });
    },
  });
}
