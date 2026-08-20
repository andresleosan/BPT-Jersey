import { randomUUID } from "node:crypto";

import {
  deriveParticipantType,
  parseStudentProfile,
  parseUserProfile,
  type ClientProfileProjection,
  type StudentProfile,
  type TrainingCenter,
  type TrainingTimePreference,
  type UserProfile,
} from "@bpt-jersey/domain/profiles";

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
  generateStudentId?: () => string;
}>;

export class ProfileStoreError extends Error {
  public readonly code: "invalid" | "tenant" | "duplicate" | "conflict";

  public constructor(code: "invalid" | "tenant" | "duplicate" | "conflict", message: string) {
    super(message);
    this.name = "ProfileStoreError";
    this.code = code;
  }
}

function pathSegment(value: string, label: string): string {
  if (value.length === 0 || value.includes("/")) {
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
  return Object.freeze({ user, student });
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function createProfileStore(dependencies: ProfileStoreDependencies): ProfileStore {
  const generateStudentId = dependencies.generateStudentId ?? randomUUID;

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
      const safeAcademyId = pathSegment(input.academyId, "academy");
      const safeUserId = pathSegment(input.userId, "user");
      const userRef = dependencies.firestore.doc(userPath(safeAcademyId, safeUserId));
      const query = dependencies.firestore
        .collection(studentsPath(safeAcademyId))
        .where("userId", "==", safeUserId)
        .limit(2);

      return dependencies.firestore.runTransaction(async (transaction) => {
        const userSnapshot = await transaction.get(userRef);
        const studentSnapshot = await transaction.get(query);
        if (!isQuerySnapshot(studentSnapshot) || !isDocumentSnapshot(userSnapshot)) {
          throw new ProfileStoreError("invalid", "Invalid student lookup");
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
          existingStudent = readSnapshotData(studentSnapshotDocument, "student") as StudentProfile;
          if (
            existingStudent.academyId !== safeAcademyId ||
            existingStudent.userId !== safeUserId
          ) {
            throw new ProfileStoreError("tenant", "Profile tenant mismatch");
          }
        }

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
          createdAt: existingUser?.createdAt ?? input.now,
          createdBy: existingUser?.createdBy ?? safeUserId,
          updatedAt: input.now,
          updatedBy: safeUserId,
        };
        const studentId = existingStudent?.studentId ?? pathSegment(generateStudentId(), "student");
        const student: StudentProfile = {
          studentId,
          academyId: safeAcademyId,
          userId: safeUserId,
          fullName: input.fullName,
          dateOfBirth: input.dateOfBirth,
          phoneNumber: input.phoneNumber,
          email: normalizeEmail(input.email),
          trainingCenter: input.trainingCenter,
          trainingTimePreferences: Object.freeze([...input.trainingTimePreferences]),
          participantType: deriveParticipantType(input.dateOfBirth, input.now.slice(0, 10)),
          active: existingStudent?.active ?? true,
          status: existingStudent?.status ?? "active",
          schemaVersion: "1",
          createdAt: existingStudent?.createdAt ?? input.now,
          createdBy: existingStudent?.createdBy ?? safeUserId,
          updatedAt: input.now,
          updatedBy: safeUserId,
        };

        const parsedUser = parseUserProfile(user);
        const parsedStudent = parseStudentProfile(student);
        if (!parsedUser.ok || !parsedStudent.ok) {
          throw new ProfileStoreError("invalid", "Invalid profile input");
        }

        if (existingUser) transaction.set(userRef, parsedUser.value);
        else transaction.create(userRef, parsedUser.value);
        const studentRef = dependencies.firestore.doc(
          `${studentsPath(safeAcademyId)}/${studentId}`,
        );
        if (existingStudent) transaction.set(studentRef, parsedStudent.value);
        else transaction.create(studentRef, parsedStudent.value);
        return Object.freeze({ user: parsedUser.value, student: parsedStudent.value });
      });
    },
  });
}
