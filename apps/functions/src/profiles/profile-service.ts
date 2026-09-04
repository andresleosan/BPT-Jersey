import { randomUUID } from "node:crypto";

import {
  deriveParticipantType,
  parseStudentProfile,
  parseStudentProfileAt,
  parseUserProfile,
  type ClientProfileProjection,
  type StudentProfile,
  type TrainingCenter,
  type TrainingTimePreference,
  type UserProfile,
} from "@bpt-jersey/domain/profiles";
import { parseFamilyRecord, type FamilyRecord } from "@bpt-jersey/domain/families";
import type { AuditEventDraft } from "@bpt-jersey/domain/audit";
import { z } from "zod";

import { appendAuditEventInTransaction, matchesAuditEventReplay } from "../audit/audit-writer.js";
import {
  buildStudentIdentityKey,
  canonicalizeMemberDirectoryValue,
  constantTimeMacEquals,
  createMemberDirectoryIntegrityMac,
  decodeMemberDirectorySecret,
  deriveStudentIdentityKeyId,
  studentIdentityKeySchema,
} from "../members/member-directory-crypto.js";
import {
  advanceMemberDirectoryControlPlane,
  assertCanonicalMemberDirectoryWriterReady,
  assertMemberDirectoryControlPlane,
  memberDirectoryRestoreGuardSchema,
} from "../members/member-directory-state.js";

export type ProfileDocumentData = Readonly<Record<string, unknown>>;

export type ProfileDocumentReference = Readonly<{ id: string; path: string }>;
export type ProfileDocumentSnapshot = Readonly<{
  id: string;
  exists: boolean;
  data: () => ProfileDocumentData | undefined;
}>;
export type ProfileQuerySnapshot = Readonly<{
  docs: readonly ProfileDocumentSnapshot[];
}>;
export type ProfileQuery = Readonly<{ path: string; field: string; value: unknown }>;
export type ProfileCollectionReference = Readonly<{
  doc: (id?: string) => ProfileDocumentReference;
  where: (
    field: string,
    operator: "==",
    value: unknown,
  ) => Readonly<{
    limit: (count: number) => ProfileQuery;
  }>;
}>;
export type ProfileTransaction = Readonly<{
  get: (
    target: ProfileDocumentReference | ProfileQuery,
  ) => Promise<ProfileDocumentSnapshot | ProfileQuerySnapshot>;
  create: (ref: ProfileDocumentReference, data: ProfileDocumentData) => ProfileTransaction;
  set: (ref: ProfileDocumentReference, data: ProfileDocumentData) => ProfileTransaction;
}>;
export type ProfileFirestore = Readonly<{
  doc: (path: string) => ProfileDocumentReference;
  collection: (path: string) => ProfileCollectionReference;
  runTransaction: <T>(callback: (transaction: ProfileTransaction) => Promise<T>) => Promise<T>;
}>;

export type SaveClientProfileInput = Readonly<{
  academyId: string;
  userId: string;
  email: string;
  displayName: string;
  requestId: string;
  fullName: string;
  dateOfBirth: string;
  phoneNumber: string;
  trainingCenter: TrainingCenter;
  trainingTimePreferences: readonly TrainingTimePreference[];
  now: string;
}>;

export type ProfileStore = Readonly<{
  getClientProfile: (
    userId: string,
    academyId: string,
  ) => Promise<ClientProfileProjection | undefined>;
  saveClientProfile: (input: SaveClientProfileInput) => Promise<ClientProfileProjection>;
}>;

export type ProfileStoreDependencies = Readonly<{
  firestore: ProfileFirestore;
  projectId: string;
  identitySecretMaterial: string;
  identitySecretVersion: string;
  integritySecretMaterial: string;
  integritySecretVersion: string;
  generateStudentId?: () => string;
  generateAuditId?: () => string;
}>;

export class ProfileStoreError extends Error {
  public readonly code:
    "invalid" | "tenant" | "duplicate" | "conflict" | "unavailable" | "capacity" | "replay";

  public constructor(
    code: "invalid" | "tenant" | "duplicate" | "conflict" | "unavailable" | "capacity" | "replay",
    message: string,
  ) {
    super(message);
    this.name = "ProfileStoreError";
    this.code = code;
  }
}

const safeIdentifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const utcMillisecondPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const macPattern = /^[a-f0-9]{64}$/u;

const profileWriteReceiptSchema = z
  .strictObject({
    receiptId: z.string().regex(/^write-[a-f0-9]{64}$/u),
    academyId: z.string().regex(safeIdentifierPattern),
    actorId: z.string().regex(safeIdentifierPattern),
    requestMac: z.string().regex(macPattern),
    studentId: z.string().regex(safeIdentifierPattern),
    familyId: z.string().regex(safeIdentifierPattern).optional(),
    identityKeyId: z.string().regex(/^auth-user-id:[a-f0-9]{64}$/u),
    identitySecretVersion: z.string().regex(safeIdentifierPattern),
    integritySecretVersion: z.string().regex(safeIdentifierPattern),
    auditEventId: z.string().regex(safeIdentifierPattern),
    stateRevisionBefore: z.number().int().nonnegative().safe(),
    stateRevisionAfter: z.number().int().positive().safe(),
    createdStudent: z.boolean(),
    createdFamily: z.boolean().optional(),
    familyAuditEventId: z.string().regex(safeIdentifierPattern).optional(),
    status: z.literal("completed"),
    createdAt: z.string().regex(utcMillisecondPattern),
    schemaVersion: z.literal("1"),
  })
  .refine(
    (receipt) => receipt.stateRevisionAfter === receipt.stateRevisionBefore + 1,
    "Profile receipt revision must advance exactly once",
  )
  .refine(
    (receipt) =>
      receipt.createdFamily === true
        ? receipt.familyId !== undefined && receipt.familyAuditEventId !== undefined
        : receipt.familyAuditEventId === undefined,
    "Profile family receipt fields are inconsistent",
  );

type ProfileWriteReceipt = Readonly<z.infer<typeof profileWriteReceiptSchema>>;

function pathSegment(value: string, label: string): string {
  if (!safeIdentifierPattern.test(value)) {
    throw new ProfileStoreError("tenant", `Invalid ${label}`);
  }
  return value;
}

function userPath(academyId: string, userId: string): string {
  return `academies/${pathSegment(academyId, "academy")}/users/${pathSegment(userId, "user")}`;
}

function studentsPath(academyId: string): string {
  return `academies/${pathSegment(academyId, "academy")}/students`;
}

function statePath(academyId: string): string {
  return `academies/${academyId}/memberDirectoryStates/current`;
}

function receiptPath(academyId: string, receiptId: string): string {
  return `academies/${academyId}/profileWriteReceipts/${receiptId}`;
}

function studentPath(academyId: string, studentId: string): string {
  return `${studentsPath(academyId)}/${studentId}`;
}

function familyPath(academyId: string, familyId: string): string {
  return `academies/${pathSegment(academyId, "academy")}/families/${pathSegment(familyId, "family")}`;
}

function keyPath(academyId: string, keyId: string): string {
  return `academies/${academyId}/studentIdentityKeys/${keyId}`;
}

function auditPath(academyId: string, auditEventId: string): string {
  return `academies/${academyId}/auditEvents/${auditEventId}`;
}

function guardPath(academyId: string): string {
  return `memberDirectoryRestoreGuards/${academyId}`;
}

function guardEventPath(academyId: string, eventId: string): string {
  return `memberDirectoryRestoreGuards/${academyId}/events/${eventId}`;
}

function isQuerySnapshot(
  value: ProfileDocumentSnapshot | ProfileQuerySnapshot,
): value is ProfileQuerySnapshot {
  return "docs" in value;
}

function isDocumentSnapshot(
  value: ProfileDocumentSnapshot | ProfileQuerySnapshot,
): value is ProfileDocumentSnapshot {
  return !isQuerySnapshot(value);
}

function readSnapshotData(
  snapshot: ProfileDocumentSnapshot,
  collection: "user" | "student",
): UserProfile | StudentProfile {
  const data = snapshot.data();
  const parsed = collection === "user" ? parseUserProfile(data) : parseStudentProfile(data);
  if (!parsed.ok) throw new ProfileStoreError("invalid", `Invalid stored ${collection} profile`);
  return parsed.value;
}

async function readProjection(
  transaction: ProfileTransaction,
  userRef: ProfileDocumentReference,
  studentQuery: ProfileQuery,
  academyId: string,
): Promise<ClientProfileProjection | undefined> {
  const userSnapshot = await transaction.get(userRef);
  const studentSnapshot = await transaction.get(studentQuery);
  if (!isQuerySnapshot(studentSnapshot) || !isDocumentSnapshot(userSnapshot)) {
    throw new ProfileStoreError("invalid", "Invalid student lookup");
  }
  if (!userSnapshot.exists) {
    if (studentSnapshot.docs.length !== 0) {
      throw new ProfileStoreError("invalid", "Orphaned student profile");
    }
    return undefined;
  }
  if (studentSnapshot.docs.length > 1) {
    throw new ProfileStoreError("duplicate", "Duplicate student profile identity");
  }
  if (studentSnapshot.docs.length === 0) {
    throw new ProfileStoreError("invalid", "Student profile is missing");
  }

  const user = readSnapshotData(userSnapshot as ProfileDocumentSnapshot, "user") as UserProfile;
  const studentSnapshotDocument = studentSnapshot.docs[0];
  if (!studentSnapshotDocument) {
    throw new ProfileStoreError("invalid", "Student profile is missing");
  }
  const student = readSnapshotData(studentSnapshotDocument, "student") as StudentProfile;
  if (user.academyId !== academyId || student.academyId !== academyId) {
    throw new ProfileStoreError("tenant", "Profile tenant mismatch");
  }
  if (student.userId !== user.userId) {
    throw new ProfileStoreError("conflict", "Profile identity mismatch");
  }
  if (
    user.accountType !== "client" ||
    !user.active ||
    user.status !== "active" ||
    !student.active ||
    student.status !== "active"
  ) {
    throw new ProfileStoreError("tenant", "Client profile is not active");
  }
  return Object.freeze({ user, student });
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function requiredTimestamp(value: string): string {
  const parsed = Date.parse(value);
  if (
    !utcMillisecondPattern.test(value) ||
    Number.isNaN(parsed) ||
    new Date(parsed).toISOString() !== value
  ) {
    throw new ProfileStoreError("invalid", "Invalid server timestamp");
  }
  return value;
}

function documentData(snapshot: ProfileDocumentSnapshot, label: string): ProfileDocumentData {
  if (!snapshot.exists) {
    throw new ProfileStoreError("unavailable", `${label} is missing`);
  }
  const data = snapshot.data();
  if (data === undefined) {
    throw new ProfileStoreError("unavailable", `${label} is invalid`);
  }
  return data;
}

function profileRequestMac(
  input: SaveClientProfileInput,
  academyId: string,
  userId: string,
  secretMaterial: string,
): string {
  return createMemberDirectoryIntegrityMac({
    domain: "bpt-profile-write-request-v1",
    values: [
      academyId,
      userId,
      canonicalizeMemberDirectoryValue({
        requestId: input.requestId,
        email: normalizeEmail(input.email),
        displayName: input.displayName,
        fullName: input.fullName,
        dateOfBirth: input.dateOfBirth,
        phoneNumber: input.phoneNumber,
        trainingCenter: input.trainingCenter,
        trainingTimePreferences: [...input.trainingTimePreferences],
      }),
    ],
    secretMaterial,
  });
}

function profileReceiptId(
  academyId: string,
  userId: string,
  requestId: string,
  secretMaterial: string,
): string {
  const digest = createMemberDirectoryIntegrityMac({
    domain: "bpt-profile-write-request-id-v1",
    values: [academyId, userId, requestId],
    secretMaterial,
  });
  return `write-${digest}`;
}

function adultFamilyIdentity(
  academyId: string,
  userId: string,
  secretMaterial: string,
): Readonly<{
  familyId: string;
  auditEventId: string;
  correlationId: string;
}> {
  const familyDigest = createMemberDirectoryIntegrityMac({
    domain: "bpt-adult-family-identity-v1",
    values: [academyId, userId],
    secretMaterial,
  });
  const familyId = `adult-${familyDigest}`;
  const auditDigest = createMemberDirectoryIntegrityMac({
    domain: "bpt-adult-family-audit-v1",
    values: [academyId, userId, familyId],
    secretMaterial,
  });
  return Object.freeze({
    familyId,
    auditEventId: `adult-family-${auditDigest}`,
    correlationId: `family-write-${auditDigest}`,
  });
}

function profileAuditDraft(
  academyId: string,
  actorId: string,
  studentReference: string,
  receiptId: string,
  createdStudent: boolean,
): AuditEventDraft {
  return {
    academyId,
    actorId,
    action: createdStudent ? "member.created" : "member.updated",
    targetRef: studentReference,
    purpose: "member-record-maintenance",
    correlationId: receiptId,
  } as unknown as AuditEventDraft;
}

function adultFamilyAuditDraft(
  academyId: string,
  actorId: string,
  familyReference: string,
  correlationId: string,
): AuditEventDraft {
  return {
    academyId,
    actorId,
    action: "family.created",
    targetRef: familyReference,
    purpose: "family-record-maintenance",
    correlationId,
  } as unknown as AuditEventDraft;
}

async function resolveProfileReplay(
  transaction: ProfileTransaction,
  dependencies: ProfileStoreDependencies,
  receiptValue: unknown,
  expectedReceiptId: string,
  expectedRequestMac: string,
  expectedAcademyId: string,
  expectedUserId: string,
): Promise<ClientProfileProjection> {
  const receipt = profileWriteReceiptSchema.safeParse(receiptValue);
  if (
    !receipt.success ||
    receipt.data.receiptId !== expectedReceiptId ||
    receipt.data.academyId !== expectedAcademyId ||
    receipt.data.actorId !== expectedUserId ||
    receipt.data.identitySecretVersion !== dependencies.identitySecretVersion ||
    receipt.data.integritySecretVersion !== dependencies.integritySecretVersion ||
    !constantTimeMacEquals(receipt.data.requestMac, expectedRequestMac)
  ) {
    throw new ProfileStoreError("replay", "Divergent profile write replay");
  }

  const userRef = dependencies.firestore.doc(userPath(expectedAcademyId, expectedUserId));
  const studentRef = dependencies.firestore.doc(
    studentPath(expectedAcademyId, receipt.data.studentId),
  );
  const keyRef = dependencies.firestore.doc(keyPath(expectedAcademyId, receipt.data.identityKeyId));
  const auditRef = dependencies.firestore.doc(
    auditPath(expectedAcademyId, receipt.data.auditEventId),
  );
  const [userSnapshot, studentSnapshot, keySnapshot, auditSnapshot] = await Promise.all([
    transaction.get(userRef),
    transaction.get(studentRef),
    transaction.get(keyRef),
    transaction.get(auditRef),
  ]);
  if (
    !isDocumentSnapshot(userSnapshot) ||
    !isDocumentSnapshot(studentSnapshot) ||
    !isDocumentSnapshot(keySnapshot) ||
    !isDocumentSnapshot(auditSnapshot)
  ) {
    throw new ProfileStoreError("replay", "Completed profile write replay is invalid");
  }

  const parsedUser = parseUserProfile(documentData(userSnapshot, "Replay user"));
  const parsedStudent = parseStudentProfileAt(
    documentData(studentSnapshot, "Replay student"),
    receipt.data.createdAt.slice(0, 10),
  );
  const parsedKey = studentIdentityKeySchema.safeParse(
    documentData(keySnapshot, "Replay identity reservation"),
  );
  const auditValue = documentData(auditSnapshot, "Replay audit event");
  const expectedAudit = profileAuditDraft(
    expectedAcademyId,
    expectedUserId,
    studentRef.path,
    receipt.data.receiptId,
    receipt.data.createdStudent,
  );
  if (
    !parsedUser.ok ||
    !parsedStudent.ok ||
    !parsedKey.success ||
    parsedUser.value.academyId !== expectedAcademyId ||
    parsedUser.value.userId !== expectedUserId ||
    parsedStudent.value.academyId !== expectedAcademyId ||
    parsedStudent.value.studentId !== receipt.data.studentId ||
    parsedStudent.value.userId !== expectedUserId ||
    parsedKey.data.keyId !== receipt.data.identityKeyId ||
    parsedKey.data.academyId !== expectedAcademyId ||
    parsedKey.data.ownerStudentId !== receipt.data.studentId ||
    parsedKey.data.kind !== "auth-user-id" ||
    parsedKey.data.secretVersion !== dependencies.identitySecretVersion ||
    !matchesAuditEventReplay(auditValue, receipt.data.auditEventId, expectedAudit) ||
    receipt.data.identityKeyId !==
      deriveStudentIdentityKeyId({
        academyId: expectedAcademyId,
        kind: "auth-user-id",
        value: expectedUserId,
        secretMaterial: dependencies.identitySecretMaterial,
      })
  ) {
    throw new ProfileStoreError("replay", "Completed profile write replay is invalid");
  }

  const replayFamilyId = parsedStudent.value.familyId;
  if (
    replayFamilyId === undefined ||
    (receipt.data.familyId !== undefined && receipt.data.familyId !== replayFamilyId)
  ) {
    throw new ProfileStoreError("replay", "Completed profile family replay is invalid");
  }
  const replayFamilyRef = dependencies.firestore.doc(familyPath(expectedAcademyId, replayFamilyId));
  const replayFamilySnapshot = await transaction.get(replayFamilyRef);
  if (!isDocumentSnapshot(replayFamilySnapshot)) {
    throw new ProfileStoreError("replay", "Completed profile family replay is invalid");
  }
  const parsedFamily = parseFamilyRecord(documentData(replayFamilySnapshot, "Replay family"));
  if (
    !parsedFamily.ok ||
    parsedFamily.value.familyId !== replayFamilyId ||
    parsedFamily.value.academyId !== expectedAcademyId ||
    !parsedFamily.value.active ||
    parsedFamily.value.status !== "active"
  ) {
    throw new ProfileStoreError("replay", "Completed profile family replay is invalid");
  }

  if (receipt.data.createdFamily === true) {
    const familyIdentity = adultFamilyIdentity(
      expectedAcademyId,
      expectedUserId,
      dependencies.integritySecretMaterial,
    );
    const familyAuditEventId = receipt.data.familyAuditEventId;
    if (
      replayFamilyId !== familyIdentity.familyId ||
      familyAuditEventId === undefined ||
      familyAuditEventId !== familyIdentity.auditEventId ||
      parsedFamily.value.primaryContactUserId !== expectedUserId ||
      parsedFamily.value.billingContactUserId !== expectedUserId
    ) {
      throw new ProfileStoreError("replay", "Completed profile family replay is invalid");
    }
    const familyAuditSnapshot = await transaction.get(
      dependencies.firestore.doc(auditPath(expectedAcademyId, familyAuditEventId)),
    );
    if (
      !isDocumentSnapshot(familyAuditSnapshot) ||
      !matchesAuditEventReplay(
        documentData(familyAuditSnapshot, "Replay family audit event"),
        familyAuditEventId,
        adultFamilyAuditDraft(
          expectedAcademyId,
          expectedUserId,
          replayFamilyRef.path,
          familyIdentity.correlationId,
        ),
      )
    ) {
      throw new ProfileStoreError("replay", "Completed profile family replay is invalid");
    }
  }
  return Object.freeze({ user: parsedUser.value, student: parsedStudent.value });
}

export function createProfileStore(dependencies: ProfileStoreDependencies): ProfileStore {
  pathSegment(dependencies.projectId, "project");
  pathSegment(dependencies.identitySecretVersion, "identity secret version");
  pathSegment(dependencies.integritySecretVersion, "integrity secret version");
  try {
    decodeMemberDirectorySecret(dependencies.identitySecretMaterial, "identity");
    decodeMemberDirectorySecret(dependencies.integritySecretMaterial, "integrity");
  } catch {
    throw new ProfileStoreError("invalid", "Invalid member directory purpose secret");
  }
  if (
    constantTimeMacEquals(
      createMemberDirectoryIntegrityMac({
        domain: "bpt-profile-secret-distinct-v1",
        values: [],
        secretMaterial: dependencies.identitySecretMaterial,
      }),
      createMemberDirectoryIntegrityMac({
        domain: "bpt-profile-secret-distinct-v1",
        values: [],
        secretMaterial: dependencies.integritySecretMaterial,
      }),
    )
  ) {
    throw new ProfileStoreError("invalid", "Purpose secrets must be distinct");
  }
  const generateStudentId = dependencies.generateStudentId ?? randomUUID;
  const generateAuditId = dependencies.generateAuditId ?? randomUUID;

  return Object.freeze({
    async getClientProfile(userId, academyId) {
      const safeUserId = pathSegment(userId, "user");
      const safeAcademyId = pathSegment(academyId, "academy");
      const userRef = dependencies.firestore.doc(userPath(safeAcademyId, safeUserId));
      const query = dependencies.firestore
        .collection(studentsPath(safeAcademyId))
        .where("userId", "==", safeUserId)
        .limit(2);
      return dependencies.firestore.runTransaction((transaction) =>
        readProjection(transaction, userRef, query, safeAcademyId),
      );
    },

    async saveClientProfile(input) {
      const now = requiredTimestamp(input.now);
      const safeAcademyId = pathSegment(input.academyId, "academy");
      const safeUserId = pathSegment(input.userId, "user");
      const safeRequestId = pathSegment(input.requestId, "request");
      const candidateStudentId = pathSegment(generateStudentId(), "generated student");
      const auditEventId = pathSegment(generateAuditId(), "generated audit");
      const expectedRequestMac = profileRequestMac(
        input,
        safeAcademyId,
        safeUserId,
        dependencies.integritySecretMaterial,
      );
      const receiptId = profileReceiptId(
        safeAcademyId,
        safeUserId,
        safeRequestId,
        dependencies.integritySecretMaterial,
      );
      const identityKeyId = deriveStudentIdentityKeyId({
        academyId: safeAcademyId,
        kind: "auth-user-id",
        value: safeUserId,
        secretMaterial: dependencies.identitySecretMaterial,
      });
      const userRef = dependencies.firestore.doc(userPath(safeAcademyId, safeUserId));
      const query = dependencies.firestore
        .collection(studentsPath(safeAcademyId))
        .where("userId", "==", safeUserId)
        .limit(2);
      const receiptRef = dependencies.firestore.doc(receiptPath(safeAcademyId, receiptId));
      const stateRef = dependencies.firestore.doc(statePath(safeAcademyId));
      const guardRef = dependencies.firestore.doc(guardPath(safeAcademyId));
      const keyRef = dependencies.firestore.doc(keyPath(safeAcademyId, identityKeyId));

      return dependencies.firestore.runTransaction(async (transaction) => {
        const receiptSnapshot = await transaction.get(receiptRef);
        if (!isDocumentSnapshot(receiptSnapshot)) {
          throw new ProfileStoreError("invalid", "Invalid profile receipt lookup");
        }
        if (receiptSnapshot.exists) {
          return resolveProfileReplay(
            transaction,
            dependencies,
            receiptSnapshot.data(),
            receiptId,
            expectedRequestMac,
            safeAcademyId,
            safeUserId,
          );
        }

        const [stateSnapshot, guardSnapshot, userSnapshot, studentSnapshot, keySnapshot] =
          await Promise.all([
            transaction.get(stateRef),
            transaction.get(guardRef),
            transaction.get(userRef),
            transaction.get(query),
            transaction.get(keyRef),
          ]);
        if (
          !isDocumentSnapshot(stateSnapshot) ||
          !isDocumentSnapshot(guardSnapshot) ||
          !isDocumentSnapshot(userSnapshot) ||
          !isQuerySnapshot(studentSnapshot) ||
          !isDocumentSnapshot(keySnapshot)
        ) {
          throw new ProfileStoreError("invalid", "Invalid student lookup");
        }

        let state;
        let guard;
        try {
          state = assertCanonicalMemberDirectoryWriterReady(
            documentData(stateSnapshot, "Member directory state"),
            {
              academyId: safeAcademyId,
              digestVersion: "hmac-sha256-v1",
              secretVersion: dependencies.identitySecretVersion,
            },
          );
          const parsedGuard = memberDirectoryRestoreGuardSchema.safeParse(
            documentData(guardSnapshot, "Member directory restore guard"),
          );
          if (!parsedGuard.success) throw new Error("Invalid restore guard");
          guard = parsedGuard.data;
        } catch {
          throw new ProfileStoreError(
            "unavailable",
            "Canonical member directory writer is unavailable",
          );
        }
        const currentEventRef = dependencies.firestore.doc(
          guardEventPath(safeAcademyId, guard.lastEventId),
        );
        const currentEventSnapshot = await transaction.get(currentEventRef);
        if (!isDocumentSnapshot(currentEventSnapshot)) {
          throw new ProfileStoreError("unavailable", "Invalid member directory guard event");
        }
        let currentControl;
        try {
          currentControl = assertMemberDirectoryControlPlane({
            projectId: dependencies.projectId,
            state,
            guard,
            event: documentData(currentEventSnapshot, "Member directory guard event"),
            integritySecretMaterial: dependencies.integritySecretMaterial,
            integritySecretVersion: dependencies.integritySecretVersion,
          });
        } catch {
          throw new ProfileStoreError(
            "unavailable",
            "Member directory control plane is unavailable",
          );
        }

        if (studentSnapshot.docs.length > 1) {
          throw new ProfileStoreError("duplicate", "Duplicate student profile identity");
        }

        let existingUser: UserProfile | undefined;
        if (userSnapshot.exists) {
          existingUser = readSnapshotData(
            userSnapshot as ProfileDocumentSnapshot,
            "user",
          ) as UserProfile;
          if (existingUser.academyId !== safeAcademyId || existingUser.userId !== safeUserId) {
            throw new ProfileStoreError("tenant", "Profile tenant mismatch");
          }
        }

        let existingStudent: StudentProfile | undefined;
        if (studentSnapshot.docs.length === 1) {
          const studentSnapshotDocument = studentSnapshot.docs[0];
          if (!studentSnapshotDocument) {
            throw new ProfileStoreError("invalid", "Student profile is missing");
          }
          const parsedStoredStudent = parseStudentProfileAt(
            studentSnapshotDocument.data(),
            now.slice(0, 10),
          );
          if (!parsedStoredStudent.ok) {
            throw new ProfileStoreError("invalid", "Invalid stored student profile");
          }
          existingStudent = parsedStoredStudent.value;
          if (
            studentSnapshotDocument.id !== existingStudent.studentId ||
            existingStudent.academyId !== safeAcademyId ||
            existingStudent.userId !== safeUserId
          ) {
            throw new ProfileStoreError("tenant", "Profile tenant mismatch");
          }
        }

        let existingIdentityKey: Readonly<z.infer<typeof studentIdentityKeySchema>> | undefined;
        if (keySnapshot.exists) {
          const parsedKey = studentIdentityKeySchema.safeParse(keySnapshot.data());
          if (
            !parsedKey.success ||
            parsedKey.data.academyId !== safeAcademyId ||
            parsedKey.data.keyId !== identityKeyId ||
            parsedKey.data.kind !== "auth-user-id" ||
            parsedKey.data.secretVersion !== dependencies.identitySecretVersion
          ) {
            throw new ProfileStoreError("conflict", "Auth identity reservation is invalid");
          }
          existingIdentityKey = parsedKey.data;
        }
        if (
          (existingIdentityKey !== undefined && existingStudent === undefined) ||
          (existingIdentityKey !== undefined &&
            existingStudent !== undefined &&
            existingIdentityKey.ownerStudentId !== existingStudent.studentId)
        ) {
          throw new ProfileStoreError("conflict", "Auth identity is reserved by another student");
        }

        const createdStudent = existingStudent === undefined;
        if (
          createdStudent &&
          state.globalLegacyReadEliminated === false &&
          state.rollbackEligibleStudentCount >= state.rollbackCapacityLimit
        ) {
          throw new ProfileStoreError(
            "capacity",
            "Member directory rollback capacity is exhausted",
          );
        }

        const studentId = existingStudent?.studentId ?? candidateStudentId;
        const selfFamilyIdentity = adultFamilyIdentity(
          safeAcademyId,
          safeUserId,
          dependencies.integritySecretMaterial,
        );
        const familyId = existingStudent?.familyId ?? selfFamilyIdentity.familyId;
        const familyRef = dependencies.firestore.doc(familyPath(safeAcademyId, familyId));
        const familySnapshot = await transaction.get(familyRef);
        if (!isDocumentSnapshot(familySnapshot)) {
          throw new ProfileStoreError("invalid", "Invalid adult family lookup");
        }
        let existingFamily: FamilyRecord | undefined;
        if (familySnapshot.exists) {
          const parsedExistingFamily = parseFamilyRecord(familySnapshot.data());
          if (
            !parsedExistingFamily.ok ||
            parsedExistingFamily.value.familyId !== familyId ||
            parsedExistingFamily.value.academyId !== safeAcademyId ||
            !parsedExistingFamily.value.active ||
            parsedExistingFamily.value.status !== "active"
          ) {
            throw new ProfileStoreError("conflict", "Adult family is invalid");
          }
          existingFamily = parsedExistingFamily.value;
          if (
            existingStudent?.familyId === undefined &&
            (existingFamily.primaryContactUserId !== safeUserId ||
              existingFamily.billingContactUserId !== safeUserId)
          ) {
            throw new ProfileStoreError("conflict", "Adult family identity is already reserved");
          }
        } else if (existingStudent?.familyId !== undefined) {
          throw new ProfileStoreError("conflict", "Student family reference is missing");
        }
        const createdFamily = existingFamily === undefined;

        const user: UserProfile = {
          userId: safeUserId,
          academyId: safeAcademyId,
          accountType: "client",
          displayName: input.displayName,
          email: normalizeEmail(input.email),
          phoneNumber: input.phoneNumber,
          active: existingUser?.active ?? true,
          status: existingUser?.status ?? "active",
          schemaVersion: "1",
          createdAt: existingUser?.createdAt ?? now,
          createdBy: existingUser?.createdBy ?? safeUserId,
          updatedAt: now,
          updatedBy: safeUserId,
        };
        const student: StudentProfile = {
          studentId,
          academyId: safeAcademyId,
          familyId,
          userId: safeUserId,
          fullName: input.fullName,
          dateOfBirth: input.dateOfBirth,
          phoneNumber: input.phoneNumber,
          email: normalizeEmail(input.email),
          trainingCenter: input.trainingCenter,
          trainingTimePreferences: Object.freeze([...input.trainingTimePreferences]),
          participantType: deriveParticipantType(input.dateOfBirth, now.slice(0, 10)),
          active: existingStudent?.active ?? true,
          status: existingStudent?.status ?? "active",
          schemaVersion: "1",
          createdAt: existingStudent?.createdAt ?? now,
          createdBy: existingStudent?.createdBy ?? safeUserId,
          updatedAt: now,
          updatedBy: safeUserId,
        };
        const family: FamilyRecord =
          existingFamily ??
          Object.freeze({
            familyId,
            academyId: safeAcademyId,
            primaryContactUserId: safeUserId,
            billingContactUserId: safeUserId,
            active: true,
            status: "active",
            schemaVersion: "1",
            createdAt: now,
            createdBy: safeUserId,
            updatedAt: now,
            updatedBy: safeUserId,
          });

        const parsedUser = parseUserProfile(user);
        const parsedStudent = parseStudentProfileAt(student, now.slice(0, 10));
        const parsedFamily = parseFamilyRecord(family);
        if (
          !parsedUser.ok ||
          !parsedStudent.ok ||
          !parsedFamily.ok ||
          parsedStudent.value.participantType !== "adult"
        ) {
          throw new ProfileStoreError("invalid", "Invalid profile input");
        }

        const identityKey =
          existingIdentityKey ??
          buildStudentIdentityKey({
            academyId: safeAcademyId,
            kind: "auth-user-id",
            value: safeUserId,
            ownerStudentId: studentId,
            secretMaterial: dependencies.identitySecretMaterial,
            secretVersion: dependencies.identitySecretVersion,
            now,
            actorId: safeUserId,
          });
        const nextState = {
          ...state,
          stateRevision: state.stateRevision + 1,
          rollbackEligibleStudentCount:
            createdStudent && !state.globalLegacyReadEliminated
              ? state.rollbackEligibleStudentCount + 1
              : state.rollbackEligibleStudentCount,
          updatedAt: now,
          updatedBy: safeUserId,
        };
        let nextControl;
        try {
          nextControl = advanceMemberDirectoryControlPlane({
            projectId: dependencies.projectId,
            state: currentControl.state,
            guard: currentControl.guard,
            event: currentControl.event,
            nextState,
            operationId: receiptId,
            transitionKind: "adult-auth-link",
            integritySecretMaterial: dependencies.integritySecretMaterial,
            integritySecretVersion: dependencies.integritySecretVersion,
            now,
            actorId: safeUserId,
          });
        } catch {
          throw new ProfileStoreError(
            "unavailable",
            "Member directory control plane cannot advance",
          );
        }

        const studentRef = dependencies.firestore.doc(studentPath(safeAcademyId, studentId));
        const auditRef = dependencies.firestore.doc(auditPath(safeAcademyId, auditEventId));
        const familyAuditRef = dependencies.firestore.doc(
          auditPath(safeAcademyId, selfFamilyIdentity.auditEventId),
        );
        const nextEventRef = dependencies.firestore.doc(
          guardEventPath(safeAcademyId, nextControl.event.eventId),
        );
        const receipt: ProfileWriteReceipt = profileWriteReceiptSchema.parse({
          receiptId,
          academyId: safeAcademyId,
          actorId: safeUserId,
          requestMac: expectedRequestMac,
          studentId,
          familyId,
          identityKeyId,
          identitySecretVersion: dependencies.identitySecretVersion,
          integritySecretVersion: dependencies.integritySecretVersion,
          auditEventId,
          stateRevisionBefore: state.stateRevision,
          stateRevisionAfter: nextState.stateRevision,
          createdStudent,
          createdFamily,
          ...(createdFamily ? { familyAuditEventId: selfFamilyIdentity.auditEventId } : {}),
          status: "completed",
          createdAt: now,
          schemaVersion: "1",
        });
        const auditDraft = profileAuditDraft(
          safeAcademyId,
          safeUserId,
          studentRef.path,
          receiptId,
          createdStudent,
        );

        if (existingUser) transaction.set(userRef, parsedUser.value);
        else transaction.create(userRef, parsedUser.value);
        if (createdFamily) transaction.create(familyRef, parsedFamily.value);
        if (existingStudent) transaction.set(studentRef, parsedStudent.value);
        else transaction.create(studentRef, parsedStudent.value);
        if (existingIdentityKey === undefined) transaction.create(keyRef, identityKey);
        transaction.set(stateRef, nextState);
        transaction.set(guardRef, nextControl.guard);
        transaction.create(nextEventRef, nextControl.event);
        appendAuditEventInTransaction(transaction, auditRef, auditDraft);
        if (createdFamily) {
          appendAuditEventInTransaction(
            transaction,
            familyAuditRef,
            adultFamilyAuditDraft(
              safeAcademyId,
              safeUserId,
              familyRef.path,
              selfFamilyIdentity.correlationId,
            ),
          );
        }
        transaction.create(receiptRef, receipt);
        return Object.freeze({ user: parsedUser.value, student: parsedStudent.value });
      });
    },
  });
}
