import { randomUUID } from "node:crypto";

import type { AuditEventDraft } from "@bpt-jersey/domain/audit";
import {
  parseAdminCreateStudentInput,
  parseAdminUpdateStudentInput,
  studentAdminProfileSchema,
  type AdminCreateStudentInput,
  type AdminUpdateStudentInput,
  type StudentAdminProfile,
} from "@bpt-jersey/domain/members/directory";
import { parseStudentProfileAt, type StudentProfile } from "@bpt-jersey/domain/profiles";
import { z } from "zod";

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

export type CreateAdminAdultResult = Readonly<{ memberId: string; studentId: string }>;

export type UpdateAdminMemberCommand = Readonly<{
  actor: CanonicalMemberDirectoryActor;
  value: unknown;
  now: string;
}>;

export type CanonicalMemberDirectoryService = Readonly<{
  createAdminAdult: (command: CreateAdminAdultCommand) => Promise<CreateAdminAdultResult>;
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
  input: AdminCreateStudentInput,
  secretMaterial: string,
): string {
  return createMemberDirectoryIntegrityMac({
    domain: "bpt-member-directory-write-request-v1",
    values: [academyId, actorId, canonicalizeMemberDirectoryValue(input)],
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
  input: AdminCreateStudentInput,
  academyId: string,
  studentId: string,
  actorId: string,
  now: string,
): StudentProfile {
  const record = {
    studentId,
    academyId,
    fullName: input.fullName,
    dateOfBirth: input.dateOfBirth,
    ...(input.phoneNumber === undefined ? {} : { phoneNumber: input.phoneNumber }),
    ...(input.email === undefined ? {} : { email: input.email }),
    trainingCenter: input.trainingCenter,
    trainingTimePreferences: input.trainingTimePreferences,
    participantType: "adult" as const,
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
  input: AdminCreateStudentInput,
  academyId: string,
  studentId: string,
  actorId: string,
  now: string,
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
    source: "admin",
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

function buildUpdatedStudent(
  existing: StudentProfile,
  input: AdminUpdateStudentInput,
  actorId: string,
  now: string,
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
      participantType: existing.participantType,
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
): CanonicalMemberDirectoryService {
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

  return Object.freeze({
    async createAdminAdult(command) {
      requireAuthorizedActor(command.actor);
      const now = requiredTimestamp(command.now);
      const parsedInput = parseAdminCreateStudentInput(command.value, now.slice(0, 10));
      if (!parsedInput.ok) {
        throw new CanonicalMemberDirectoryError("invalid", "Invalid admin student input");
      }
      const academyId = command.actor.academyId;
      const actorId = command.actor.actorId;
      const expectedRequestMac = requestMac(
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
      const studentId = requiredIdentifier(generateStudentId(), "generated student ID");
      const auditEventId = requiredIdentifier(generateAuditId(), "generated audit ID");
      const receiptRef = dependencies.firestore.doc(receiptPath(academyId, receiptId));

      return dependencies.firestore.runTransaction(async (transaction) => {
        await assertProvisionedActor(transaction, dependencies, command.actor);
        const receiptSnapshot = await transaction.get(receiptRef);
        if (receiptSnapshot.exists) {
          return resolveReplay(
            transaction,
            dependencies,
            receiptSnapshot.data(),
            receiptId,
            academyId,
            actorId,
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

        const student = buildStudent(parsedInput.value, academyId, studentId, actorId, now);
        const profile = buildAdminProfile(parsedInput.value, academyId, studentId, actorId, now);
        const keys = buildKeys(profile, dependencies);
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
          transitionKind: "canonical-identity-create",
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
          auditEventId,
          stateRevisionBefore: state.stateRevision,
          stateRevisionAfter: nextState.stateRevision,
          status: "completed",
          createdAt: now,
          schemaVersion: "1",
        });

        transaction.create(studentRef, student);
        transaction.create(profileRef, profile);
        keys.forEach((key, index) => {
          const reference = keyReferences[index];
          if (reference === undefined) {
            throw new CanonicalMemberDirectoryError("invalid", "Identity key plan mismatch");
          }
          transaction.create(reference, key);
        });
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
        const existingProfile = studentAdminProfileSchema.safeParse(
          documentData(profileSnapshot, "Student admin profile"),
        );
        if (
          !existingStudent.ok ||
          !existingProfile.success ||
          studentSnapshot.id !== studentId ||
          profileSnapshot.id !== studentId ||
          existingStudent.value.studentId !== studentId ||
          existingStudent.value.academyId !== academyId ||
          existingProfile.data.studentId !== studentId ||
          existingProfile.data.academyId !== academyId
        ) {
          throw new CanonicalMemberDirectoryError(
            "unavailable",
            "Canonical member record is unavailable",
          );
        }

        const nextStudent = buildUpdatedStudent(
          existingStudent.value,
          parsedInput.value,
          actorId,
          now,
        );
        const nextProfile = buildUpdatedAdminProfile(
          existingProfile.data,
          parsedInput.value,
          actorId,
          now,
        );
        const oldKeys = buildKeys(existingProfile.data, dependencies);
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
        transaction.set(profileRef, nextProfile);
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
