import { httpsCallable } from "firebase/functions";

import {
  upcomingBirthdayParticipantTypes,
  upcomingBirthdayTrainingCenters,
  type UpcomingBirthday,
  type UpcomingBirthdayParticipantType,
  type UpcomingBirthdayQuery,
  type UpcomingBirthdayTrainingCenter,
} from "@bpt-jersey/domain/birthdays";

import { getFirebaseFunctions } from "./firebase-client";

/**
 * T112: the upcoming birthdays of the canonical students, for the coach panel. The response never
 * carries a date of birth, so nothing here can leak one either.
 */
const safeListError = "Unable to load upcoming birthdays. Please try again.";

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isBirthday(value: unknown): value is UpcomingBirthday {
  return (
    isPlainRecord(value) &&
    typeof value.studentId === "string" &&
    typeof value.displayName === "string" &&
    Number.isSafeInteger(value.daysAway) &&
    (value.daysAway as number) >= 0 &&
    typeof value.participantType === "string" &&
    upcomingBirthdayParticipantTypes.includes(
      value.participantType as UpcomingBirthdayParticipantType,
    ) &&
    typeof value.trainingCenter === "string" &&
    upcomingBirthdayTrainingCenters.includes(
      value.trainingCenter as UpcomingBirthdayTrainingCenter,
    )
  );
}

export async function listUpcomingBirthdays(
  query: UpcomingBirthdayQuery,
): Promise<readonly UpcomingBirthday[]> {
  try {
    const callable = httpsCallable<UpcomingBirthdayQuery, unknown>(
      getFirebaseFunctions(),
      "listUpcomingBirthdays",
    );
    const result = await callable(query);
    const data = result.data;
    if (!isPlainRecord(data) || !Array.isArray(data.birthdays)) throw new Error(safeListError);
    if (!data.birthdays.every(isBirthday)) throw new Error(safeListError);
    return Object.freeze([...data.birthdays]);
  } catch {
    throw new Error(safeListError);
  }
}

/** "Today", "Tomorrow", then "In N days": the panel never prints a calendar date. */
export function birthdayWhenLabel(daysAway: number): string {
  if (daysAway === 0) return "Today";
  if (daysAway === 1) return "Tomorrow";
  return `In ${daysAway} days`;
}
