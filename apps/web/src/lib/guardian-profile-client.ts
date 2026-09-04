import { httpsCallable } from "firebase/functions";

import { parseUserProfile, type UserProfile } from "@bpt-jersey/domain/profiles";

import { getFirebaseFunctions } from "./firebase-client";

export type GuardianProfileFormInput = Readonly<{
  displayName: string;
  phoneNumber: string;
}>;

export type SaveGuardianProfileRequest = Readonly<
  GuardianProfileFormInput & {
    requestId: string;
  }
>;

const safeLoadError = "Unable to load your guardian profile. Please try again.";
const safeSaveError = "Unable to save your guardian profile. Please try again.";
const safeIdentifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const controlCharacterPattern = /[\u0000-\u001f\u007f]/u;

function validText(value: unknown, maxLength: number): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maxLength &&
    value === value.trim() &&
    !controlCharacterPattern.test(value)
  );
}

function strictRequest(input: SaveGuardianProfileRequest): SaveGuardianProfileRequest {
  const keys = Reflect.ownKeys(input);
  if (
    keys.length !== 3 ||
    !keys.every(
      (key) =>
        typeof key === "string" && ["requestId", "displayName", "phoneNumber"].includes(key),
    ) ||
    !safeIdentifierPattern.test(input.requestId) ||
    !validText(input.displayName, 160) ||
    !validText(input.phoneNumber, 64)
  ) {
    throw new Error(safeSaveError);
  }
  return {
    requestId: input.requestId,
    displayName: input.displayName,
    phoneNumber: input.phoneNumber,
  };
}

function strictProfile(value: unknown): UserProfile {
  const parsed = parseUserProfile(value);
  if (
    !parsed.ok ||
    parsed.value.accountType !== "client" ||
    parsed.value.active !== true ||
    parsed.value.status !== "active"
  ) {
    throw new Error(safeLoadError);
  }
  return parsed.value;
}

export function createGuardianProfileRequestId(): string {
  return globalThis.crypto.randomUUID();
}

export async function getGuardianProfile(): Promise<UserProfile | undefined> {
  try {
    const callable = httpsCallable<null, unknown>(
      getFirebaseFunctions(),
      "getGuardianProfile",
      { limitedUseAppCheckTokens: true },
    );
    const result = await callable(null);
    if (result.data === null || result.data === undefined) return undefined;
    return strictProfile(result.data);
  } catch {
    throw new Error(safeLoadError);
  }
}

export async function saveGuardianProfile(
  input: SaveGuardianProfileRequest,
): Promise<UserProfile> {
  try {
    const callable = httpsCallable<SaveGuardianProfileRequest, unknown>(
      getFirebaseFunctions(),
      "saveGuardianProfile",
      { limitedUseAppCheckTokens: true },
    );
    const result = await callable(strictRequest(input));
    return strictProfile(result.data);
  } catch {
    throw new Error(safeSaveError);
  }
}
