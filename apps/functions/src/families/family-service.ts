import { randomUUID } from "node:crypto";

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
import {
  deriveParticipantType,
  parseStudentProfile,
  parseUserProfile,
  type StudentProfile,
  type UserProfile,
} from "@bpt-jersey/domain/profiles";

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
  getUser: (userId: string) => Promise<Readonly<{ uid: string }>>;
}>;

export type CreateFamilyInput = Readonly<{
  academyId: string;
  actorId: string;
  tutorUserId: string;
  students: readonly FamilyStudentDraft[];
  now: string;
}>;

export type UpdateFamilyInput = Readonly<{
  academyId: string;
  actorId: string;
  familyId: string;
  operation:
    | Readonly<{ kind: "replaceTutor"; tutorUserId: string }>
    | Readonly<{ kind: "addStudent"; student: FamilyStudentDraft }>
    | Readonly<{ kind: "deactivateRelationship"; studentId: string }>
    | Readonly<{ kind: "deactivateFamily" }>;
  now: string;
}>;

export type FamilyStore = Readonly<{
  createFamily: (input: CreateFamilyInput) => Promise<StaffFamilyProjection>;
  getStaffFamily: (
    academyId: string,
    familyId: string,
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
  generateFamilyId?: () => string;
  generateStudentId?: () => string;
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
const dateTimePattern =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:?\d{2})$/u;

function pathSegment(value: string, label: string): string {
  if (!safePathSegmentPattern.test(value)) throw new FamilyStoreError("tenant", `Invalid ${label}`);
  return value;
}

function validNow(value: string): string {
  if (!dateTimePattern.test(value) || Number.isNaN(Date.parse(value))) {
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
  return Object.freeze(
    snapshot.docs
      .map(parseStoredStudent)
      .filter((student) => student.academyId === academyId && student.familyId === familyId)
      .sort((left, right) => left.studentId.localeCompare(right.studentId)),
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
  return Object.freeze(
    snapshot.docs
      .map(parseStoredRelationship)
      .filter(
        (relationship) =>
          relationship.academyId === academyId && relationship.familyId === familyId,
      )
      .sort((left, right) => left.relationshipId.localeCompare(right.relationshipId)),
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

async function verifyAuthUser(auth: FamilyAuthService, userId: string): Promise<void> {
  try {
    const user = await auth.getUser(userId);
    if (user.uid !== userId)
      throw new FamilyStoreError("precondition", "Tutor Auth identity mismatch");
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

export function createFamilyStore(dependencies: FamilyStoreDependencies): FamilyStore {
  const generateFamilyId = dependencies.generateFamilyId ?? randomUUID;
  const generateStudentId = dependencies.generateStudentId ?? randomUUID;

  return Object.freeze({
    async createFamily(input) {
      const academyId = pathSegment(input.academyId, "academy");
      const actorId = pathSegment(input.actorId, "actor");
      const tutorUserId = pathSegment(input.tutorUserId, "tutor");
      const now = validNow(input.now);
      const students = validateDrafts(input.students, now.slice(0, 10));
      await verifyAuthUser(dependencies.auth, tutorUserId);
      const familyId = pathSegment(generateFamilyId(), "family");
      const familyReference = dependencies.firestore.doc(familyPath(academyId, familyId));
      const tutorReference = dependencies.firestore.doc(userPath(academyId, tutorUserId));
      const studentIds = students.map(() => pathSegment(generateStudentId(), "student"));
      if (new Set(studentIds).size !== studentIds.length) {
        throw new FamilyStoreError("duplicate", "Generated student identity collision");
      }

      return dependencies.firestore.runTransaction(async (transaction) => {
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
          const parsedStudent = parseStudentProfile(record);
          if (!parsedStudent.ok)
            throw new FamilyStoreError("invalid", "Student creation is invalid");
          const relation: FamilyRelationship = Object.freeze({
            relationshipId: relationshipId(familyId, studentId),
            academyId,
            familyId,
            studentId,
            adultUserId: tutor.userId,
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
          const parsedRelationship = parseFamilyRelationship(relation);
          if (!parsedRelationship.ok) {
            throw new FamilyStoreError("invalid", "Family relationship creation is invalid");
          }
          return {
            reference,
            student: parsedStudent.value,
            relationship: parsedRelationship.value,
          };
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
        return staffProjection(
          parsedFamily.value,
          records.map((record) => record.student),
          records.map((record) => record.relationship),
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
      const academyId = pathSegment(input.academyId, "academy");
      const actorId = pathSegment(input.actorId, "actor");
      const familyId = pathSegment(input.familyId, "family");
      const now = validNow(input.now);
      return dependencies.firestore.runTransaction(async (transaction) => {
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
          await verifyAuthUser(dependencies.auth, tutorUserId);
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
          if (!family.active || family.status !== "active") {
            throw new FamilyStoreError("conflict", "Inactive family cannot receive students");
          }
          const studentDrafts = validateDrafts([input.operation.student], now.slice(0, 10));
          const student = studentDrafts[0];
          if (student === undefined)
            throw new FamilyStoreError("invalid", "Student draft is missing");
          const studentId = pathSegment(generateStudentId(), "student");
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
          const parsedStudent = parseStudentProfile(record);
          if (!parsedStudent.ok)
            throw new FamilyStoreError("invalid", "Student creation is invalid");
          const relationship: FamilyRelationship = Object.freeze({
            relationshipId: relationshipId(familyId, studentId),
            academyId,
            familyId,
            studentId,
            adultUserId: family.primaryContactUserId,
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
          const parsedRelationship = parseFamilyRelationship(relationship);
          if (!parsedRelationship.ok)
            throw new FamilyStoreError("invalid", "Family relationship creation is invalid");
          transaction.create(studentReference, parsedStudent.value);
          transaction.create(relationshipReference, parsedRelationship.value);
          return staffProjection(
            family,
            [...students, parsedStudent.value],
            [...relationships, parsedRelationship.value],
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
