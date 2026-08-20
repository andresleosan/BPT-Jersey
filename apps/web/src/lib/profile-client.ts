import { httpsCallable } from "firebase/functions";

import {
  parseStudentProfile,
  parseUserProfile,
  type ClientProfileProjection,
  type TrainingCenter,
  type TrainingTimePreference,
} from "@bpt-jersey/domain";

import { getFirebaseFunctions } from "./firebase-client";

export type ProfileFormInput = Readonly<{
  fullName: string;
  dateOfBirth: string;
  phoneNumber: string;
  trainingCenter: TrainingCenter;
  trainingTimePreferences: readonly TrainingTimePreference[];
}>;

const safeLoadError = "Unable to load your profile. Please try again.";
const safeSaveError = "Unable to save your profile. Please try again.";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isProjection(value: unknown): value is ClientProfileProjection {
  if (!isRecord(value)) return false;
  const keys = Reflect.ownKeys(value);
  if (keys.length !== 2 || !keys.includes("user") || !keys.includes("student")) return false;
  return parseUserProfile(value.user).ok && parseStudentProfile(value.student).ok;
}

function editablePayload(input: ProfileFormInput): ProfileFormInput {
  return {
    fullName: input.fullName,
    dateOfBirth: input.dateOfBirth,
    phoneNumber: input.phoneNumber,
    trainingCenter: input.trainingCenter,
    trainingTimePreferences: [...input.trainingTimePreferences],
  };
}

export async function getClientProfile(): Promise<ClientProfileProjection | undefined> {
  try {
    const callable = httpsCallable<null, unknown>(getFirebaseFunctions(), "getClientProfile");
    const result = await callable(null);
    if (result.data === null || result.data === undefined) return undefined;
    if (!isProjection(result.data)) throw new Error(safeLoadError);
    return result.data;
  } catch {
    throw new Error(safeLoadError);
  }
}

export async function saveClientProfile(input: ProfileFormInput): Promise<ClientProfileProjection> {
  try {
    const callable = httpsCallable<ProfileFormInput, unknown>(
      getFirebaseFunctions(),
      "saveClientProfile",
    );
    const result = await callable(editablePayload(input));
    if (!isProjection(result.data)) throw new Error(safeSaveError);
    return result.data;
  } catch {
    throw new Error(safeSaveError);
  }
}
