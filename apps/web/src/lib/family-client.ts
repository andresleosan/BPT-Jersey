import { httpsCallable } from "firebase/functions";

import {
  parseFamilyRecord,
  parseFamilyRelationship,
  parseFamilyStudentDraft,
  type FamilyStudentDraft,
  type GuardianFamilyProjection,
  type StaffFamilyProjection,
} from "@bpt-jersey/domain/families";
import { parseStudentProfile } from "@bpt-jersey/domain/profiles";

import { getFirebaseFunctions } from "./firebase-client";

export type { GuardianFamilyProjection, StaffFamilyProjection } from "@bpt-jersey/domain/families";

export type CreateFamilyClientInput = Readonly<{
  tutorUserId: string;
  students: readonly FamilyStudentDraft[];
}>;

export type UpdateFamilyClientInput = Readonly<{
  familyId: string;
  operation:
    | Readonly<{ kind: "replaceTutor"; tutorUserId: string }>
    | Readonly<{ kind: "addStudent"; student: FamilyStudentDraft }>
    | Readonly<{ kind: "deactivateRelationship"; studentId: string }>
    | Readonly<{ kind: "deactivateFamily" }>;
}>;

const safeCreateError = "Unable to create the family. Please try again.";
const safeLoadError = "Unable to load your family. Please try again.";
const safeUpdateError = "Unable to update your family. Please try again.";
const safeIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function hasExactFields(value: Record<string, unknown>, fields: readonly string[]): boolean {
  const keys = Reflect.ownKeys(value);
  return (
    keys.length === fields.length &&
    keys.every((key) => typeof key === "string" && fields.includes(key))
  );
}

function isSafeId(value: unknown): value is string {
  return typeof value === "string" && safeIdPattern.test(value);
}

function cleanStudentDraft(value: unknown): FamilyStudentDraft {
  const parsed = parseFamilyStudentDraft(value);
  if (!parsed.ok) throw new Error(safeCreateError);
  return parsed.value;
}

function cleanCreateInput(input: CreateFamilyClientInput): CreateFamilyClientInput {
  if (!isPlainRecord(input) || !isSafeId(input.tutorUserId) || !Array.isArray(input.students)) {
    throw new Error(safeCreateError);
  }
  return Object.freeze({
    tutorUserId: input.tutorUserId,
    students: Object.freeze(input.students.map(cleanStudentDraft)),
  });
}

function cleanUpdateInput(input: UpdateFamilyClientInput): UpdateFamilyClientInput {
  if (!isPlainRecord(input) || !isSafeId(input.familyId) || !isPlainRecord(input.operation)) {
    throw new Error(safeUpdateError);
  }
  const operation = input.operation;
  if (operation.kind === "replaceTutor" && isSafeId(operation.tutorUserId)) {
    return Object.freeze({
      familyId: input.familyId,
      operation: Object.freeze({ kind: "replaceTutor", tutorUserId: operation.tutorUserId }),
    });
  }
  if (operation.kind === "addStudent") {
    return Object.freeze({
      familyId: input.familyId,
      operation: Object.freeze({ kind: "addStudent", student: cleanStudentDraft(operation.student) }),
    });
  }
  if (operation.kind === "deactivateRelationship" && isSafeId(operation.studentId)) {
    return Object.freeze({
      familyId: input.familyId,
      operation: Object.freeze({ kind: "deactivateRelationship", studentId: operation.studentId }),
    });
  }
  if (operation.kind === "deactivateFamily") {
    return Object.freeze({
      familyId: input.familyId,
      operation: Object.freeze({ kind: "deactivateFamily" }),
    });
  }
  throw new Error(safeUpdateError);
}

function isStaffProjection(value: unknown): value is StaffFamilyProjection {
  if (!isPlainRecord(value) || !hasExactFields(value, ["family", "students", "relationships"])) {
    return false;
  }
  if (!parseFamilyRecord(value.family).ok || !Array.isArray(value.students) || !Array.isArray(value.relationships)) {
    return false;
  }
  return (
    value.students.every((student) => parseStudentProfile(student).ok) &&
    value.relationships.every((relationship) => parseFamilyRelationship(relationship).ok)
  );
}

function isGuardianProjection(value: unknown): value is GuardianFamilyProjection {
  if (!isPlainRecord(value) || !hasExactFields(value, ["family", "tutor", "students"])) return false;
  if (!isPlainRecord(value.family) || !hasExactFields(value.family, ["familyId", "active", "status"])) {
    return false;
  }
  if (
    !isSafeId(value.family.familyId) ||
    typeof value.family.active !== "boolean" ||
    (value.family.status !== "active" && value.family.status !== "inactive")
  ) {
    return false;
  }
  if (
    !isPlainRecord(value.tutor) ||
    !hasExactFields(value.tutor, ["userId", "displayName", "email", "phoneNumber"]) ||
    !isSafeId(value.tutor.userId) ||
    typeof value.tutor.displayName !== "string" ||
    typeof value.tutor.email !== "string" ||
    typeof value.tutor.phoneNumber !== "string" ||
    !Array.isArray(value.students)
  ) {
    return false;
  }
  return value.students.every((student) => {
    if (
      !isPlainRecord(student) ||
      !hasExactFields(student, [
        "studentId",
        "fullName",
        "dateOfBirth",
        "trainingCenter",
        "trainingTimePreferences",
        "active",
        "status",
      ])
    ) {
      return false;
    }
    return (
      parseFamilyStudentDraft({
        fullName: student.fullName,
        dateOfBirth: student.dateOfBirth,
        trainingCenter: student.trainingCenter,
        trainingTimePreferences: student.trainingTimePreferences,
      }).ok &&
      isSafeId(student.studentId) &&
      typeof student.fullName === "string" &&
      typeof student.dateOfBirth === "string" &&
      /^\d{4}-\d{2}-\d{2}$/u.test(student.dateOfBirth) &&
      (student.trainingCenter === "Town" || student.trainingCenter === "West") &&
      Array.isArray(student.trainingTimePreferences) &&
      student.trainingTimePreferences.length > 0 &&
      new Set(student.trainingTimePreferences).size === student.trainingTimePreferences.length &&
      student.trainingTimePreferences.every(
        (preference) =>
          preference === "morning" || preference === "afternoon" || preference === "evening",
      ) &&
      typeof student.active === "boolean" &&
      (student.status === "active" || student.status === "inactive" || student.status === "suspended")
    );
  });
}

function parseResponse(value: unknown, errorMessage: string): StaffFamilyProjection | GuardianFamilyProjection {
  if (isStaffProjection(value) || isGuardianProjection(value)) return value;
  throw new Error(errorMessage);
}

export async function createFamily(input: CreateFamilyClientInput): Promise<StaffFamilyProjection> {
  try {
    const callable = httpsCallable<CreateFamilyClientInput, unknown>(
      getFirebaseFunctions(),
      "createFamily",
    );
    const result = await callable(cleanCreateInput(input));
    const projection = parseResponse(result.data, safeCreateError);
    if (!isStaffProjection(projection)) throw new Error(safeCreateError);
    return projection;
  } catch {
    throw new Error(safeCreateError);
  }
}

export async function getFamily(
  familyId?: string,
): Promise<StaffFamilyProjection | GuardianFamilyProjection | undefined> {
  try {
    const callable = httpsCallable<string | null | { familyId: string }, unknown>(
      getFirebaseFunctions(),
      "getFamily",
    );
    const payload = familyId === undefined ? null : isSafeId(familyId) ? { familyId } : undefined;
    if (payload === undefined) throw new Error(safeLoadError);
    const result = await callable(payload);
    if (result.data === null || result.data === undefined) return undefined;
    return parseResponse(result.data, safeLoadError);
  } catch {
    throw new Error(safeLoadError);
  }
}

export async function updateFamily(
  input: UpdateFamilyClientInput,
): Promise<StaffFamilyProjection> {
  try {
    const callable = httpsCallable<UpdateFamilyClientInput, unknown>(
      getFirebaseFunctions(),
      "updateFamily",
    );
    const result = await callable(cleanUpdateInput(input));
    const projection = parseResponse(result.data, safeUpdateError);
    if (!isStaffProjection(projection)) throw new Error(safeUpdateError);
    return projection;
  } catch {
    throw new Error(safeUpdateError);
  }
}
