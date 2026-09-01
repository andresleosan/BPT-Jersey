import { httpsCallable } from "firebase/functions";

import {
  parseFamilyAchievementSummary,
  type FamilyAchievementSummary,
} from "@bpt-jersey/domain";

import { getFirebaseFunctions } from "./firebase-client";

const safeLoadError = "Unable to load family achievements. Please try again.";
const safeIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

function isSafeId(value: unknown): value is string {
  return typeof value === "string" && safeIdPattern.test(value);
}

export async function getFamilyAchievementSummary(
  familyId: string,
): Promise<FamilyAchievementSummary> {
  if (!isSafeId(familyId)) throw new Error(safeLoadError);

  try {
    const callable = httpsCallable<{ familyId: string }, unknown>(
      getFirebaseFunctions(),
      "getFamilyAchievementSummary",
    );
    const result = await callable({ familyId });
    const parsed = parseFamilyAchievementSummary(result.data);
    if (!parsed.ok) throw new Error(safeLoadError);
    return parsed.value;
  } catch (error) {
    if (error instanceof Error && error.message === safeLoadError) throw error;
    throw new Error(safeLoadError);
  }
}
