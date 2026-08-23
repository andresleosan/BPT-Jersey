import { httpsCallable } from "firebase/functions";

import { getFirebaseFunctions } from "./firebase-client";

export type StaffProfileProjection = Readonly<{
  staffKey: string;
  role: "headCoach" | "coach";
  active: boolean;
  status: "active" | "inactive";
  schemaVersion: "1";
}>;

export type CreateStaffProfileInput = Readonly<{
  userId: string;
  role: StaffProfileProjection["role"];
  requestId: string;
}>;

export type UpdateStaffProfileInput = Readonly<{
  staffKey: string;
  role: StaffProfileProjection["role"];
}>;

export type SetStaffActiveInput = Readonly<{
  staffKey: string;
  active: boolean;
}>;

export type StaffAvailabilityWindowInput = Readonly<{
  weekday: number;
  startLocal: string;
  endLocal: string;
  timezone: string;
}>;

export type StaffAssignmentInput = Readonly<{
  targetType: "location" | "program" | "class";
  targetId: string;
}>;

const staffRoles = ["headCoach", "coach"] as const;
const assignmentTypes = ["location", "program", "class"] as const;
const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const localTimePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/u;
const profileFields = ["staffKey", "role", "active", "status", "schemaVersion"] as const;
const availabilityFields = ["weekday", "startLocal", "endLocal", "timezone"] as const;
const assignmentFields = ["targetType", "targetId"] as const;

const safeListError = "Unable to load staff profiles. Please try again.";
const safeCreateError = "Unable to create staff profile. Please try again.";
const safeUpdateError = "Unable to update staff profile. Please try again.";
const safeStatusError = "Unable to update staff status. Please try again.";
const safeAvailabilityError = "Unable to replace staff availability. Please try again.";
const safeAssignmentsError = "Unable to replace staff assignments. Please try again.";

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
    keys.every((key) => {
      if (typeof key !== "string" || !fields.includes(key)) return false;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return (
        descriptor?.enumerable === true &&
        descriptor.get === undefined &&
        descriptor.set === undefined &&
        Object.hasOwn(descriptor, "value")
      );
    })
  );
}

function isSafeId(value: unknown): value is string {
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

function isStaffProfileProjection(value: unknown): value is StaffProfileProjection {
  return (
    isPlainRecord(value) &&
    hasExactFields(value, profileFields) &&
    isSafeId(value.staffKey) &&
    staffRoles.includes(value.role as StaffProfileProjection["role"]) &&
    typeof value.active === "boolean" &&
    (value.status === "active" || value.status === "inactive") &&
    value.active === (value.status === "active") &&
    value.schemaVersion === "1"
  );
}

function isAvailabilityWindow(value: unknown): value is StaffAvailabilityWindowInput {
  if (
    !isPlainRecord(value) ||
    !hasExactFields(value, availabilityFields) ||
    typeof value.weekday !== "number" ||
    !Number.isInteger(value.weekday) ||
    value.weekday < 0 ||
    value.weekday > 6 ||
    typeof value.startLocal !== "string" ||
    !localTimePattern.test(value.startLocal) ||
    typeof value.endLocal !== "string" ||
    !localTimePattern.test(value.endLocal) ||
    value.startLocal >= value.endLocal ||
    typeof value.timezone !== "string" ||
    value.timezone.trim() === "" ||
    value.timezone !== value.timezone.trim() ||
    value.timezone.length > 128 ||
    /[\u0000-\u001f\u007f]/u.test(value.timezone)
  ) {
    return false;
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value.timezone }).format();
    return true;
  } catch {
    return false;
  }
}

function isAssignment(value: unknown): value is StaffAssignmentInput {
  return (
    isPlainRecord(value) &&
    hasExactFields(value, assignmentFields) &&
    assignmentTypes.includes(value.targetType as StaffAssignmentInput["targetType"]) &&
    isSafeId(value.targetId)
  );
}

function profileResponse(value: unknown, message: string): StaffProfileProjection {
  if (!isStaffProfileProjection(value)) throw new Error(message);
  return value;
}

function profileListResponse(value: unknown): readonly StaffProfileProjection[] {
  if (!isDenseArray(value) || !value.every(isStaffProfileProjection)) {
    throw new Error(safeListError);
  }
  return Object.freeze([...value]);
}

function availabilityResponse(value: unknown): readonly StaffAvailabilityWindowInput[] {
  if (!isDenseArray(value) || !value.every(isAvailabilityWindow)) {
    throw new Error(safeAvailabilityError);
  }
  return Object.freeze([...value]);
}

function assignmentsResponse(value: unknown): readonly StaffAssignmentInput[] {
  if (!isDenseArray(value) || !value.every(isAssignment)) throw new Error(safeAssignmentsError);
  return Object.freeze([...value]);
}

function createPayload(input: CreateStaffProfileInput): CreateStaffProfileInput {
  if (
    !isPlainRecord(input) ||
    !hasExactFields(input, ["userId", "role", "requestId"]) ||
    !isSafeId(input.userId) ||
    !staffRoles.includes(input.role) ||
    !isSafeId(input.requestId)
  ) {
    throw new Error(safeCreateError);
  }
  return Object.freeze({ userId: input.userId, role: input.role, requestId: input.requestId });
}

function updatePayload(input: UpdateStaffProfileInput): UpdateStaffProfileInput {
  if (
    !isPlainRecord(input) ||
    !hasExactFields(input, ["staffKey", "role"]) ||
    !isSafeId(input.staffKey) ||
    !staffRoles.includes(input.role)
  ) {
    throw new Error(safeUpdateError);
  }
  return Object.freeze({ staffKey: input.staffKey, role: input.role });
}

function activePayload(input: SetStaffActiveInput): SetStaffActiveInput {
  if (
    !isPlainRecord(input) ||
    !hasExactFields(input, ["staffKey", "active"]) ||
    !isSafeId(input.staffKey) ||
    typeof input.active !== "boolean"
  ) {
    throw new Error(safeStatusError);
  }
  return Object.freeze({ staffKey: input.staffKey, active: input.active });
}

function availabilityPayload(input: {
  staffKey: string;
  windows: readonly StaffAvailabilityWindowInput[];
}): { staffKey: string; windows: readonly StaffAvailabilityWindowInput[] } {
  if (
    !isPlainRecord(input) ||
    !hasExactFields(input, ["staffKey", "windows"]) ||
    !isSafeId(input.staffKey) ||
    !isDenseArray(input.windows) ||
    !input.windows.every(isAvailabilityWindow)
  ) {
    throw new Error(safeAvailabilityError);
  }
  return Object.freeze({ staffKey: input.staffKey, windows: Object.freeze([...input.windows]) });
}

function assignmentsPayload(input: {
  staffKey: string;
  assignments: readonly StaffAssignmentInput[];
}): { staffKey: string; assignments: readonly StaffAssignmentInput[] } {
  if (
    !isPlainRecord(input) ||
    !hasExactFields(input, ["staffKey", "assignments"]) ||
    !isSafeId(input.staffKey) ||
    !isDenseArray(input.assignments) ||
    !input.assignments.every(isAssignment)
  ) {
    throw new Error(safeAssignmentsError);
  }
  return Object.freeze({ staffKey: input.staffKey, assignments: Object.freeze([...input.assignments]) });
}

export async function listStaffProfiles(): Promise<readonly StaffProfileProjection[]> {
  try {
    const callable = httpsCallable<Record<string, never>, unknown>(
      getFirebaseFunctions(),
      "listStaffProfiles",
    );
    return profileListResponse((await callable({})).data);
  } catch {
    throw new Error(safeListError);
  }
}

export async function createStaffProfile(
  input: CreateStaffProfileInput,
): Promise<StaffProfileProjection> {
  try {
    const callable = httpsCallable<CreateStaffProfileInput, unknown>(
      getFirebaseFunctions(),
      "createStaffProfile",
    );
    return profileResponse((await callable(createPayload(input))).data, safeCreateError);
  } catch {
    throw new Error(safeCreateError);
  }
}

export async function updateStaffProfile(
  input: UpdateStaffProfileInput,
): Promise<StaffProfileProjection> {
  try {
    const callable = httpsCallable<UpdateStaffProfileInput, unknown>(
      getFirebaseFunctions(),
      "updateStaffProfile",
    );
    return profileResponse((await callable(updatePayload(input))).data, safeUpdateError);
  } catch {
    throw new Error(safeUpdateError);
  }
}

export async function setStaffActive(input: SetStaffActiveInput): Promise<StaffProfileProjection> {
  try {
    const callable = httpsCallable<SetStaffActiveInput, unknown>(
      getFirebaseFunctions(),
      "setStaffActive",
    );
    return profileResponse((await callable(activePayload(input))).data, safeStatusError);
  } catch {
    throw new Error(safeStatusError);
  }
}

export async function replaceStaffAvailability(input: {
  staffKey: string;
  windows: readonly StaffAvailabilityWindowInput[];
}): Promise<readonly StaffAvailabilityWindowInput[]> {
  try {
    const callable = httpsCallable<
      { staffKey: string; windows: readonly StaffAvailabilityWindowInput[] },
      unknown
    >(getFirebaseFunctions(), "replaceStaffAvailability");
    return availabilityResponse((await callable(availabilityPayload(input))).data);
  } catch {
    throw new Error(safeAvailabilityError);
  }
}

export async function replaceStaffAssignments(input: {
  staffKey: string;
  assignments: readonly StaffAssignmentInput[];
}): Promise<readonly StaffAssignmentInput[]> {
  try {
    const callable = httpsCallable<
      { staffKey: string; assignments: readonly StaffAssignmentInput[] },
      unknown
    >(getFirebaseFunctions(), "replaceStaffAssignments");
    return assignmentsResponse((await callable(assignmentsPayload(input))).data);
  } catch {
    throw new Error(safeAssignmentsError);
  }
}
