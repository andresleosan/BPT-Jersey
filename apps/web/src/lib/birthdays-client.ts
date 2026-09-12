import { httpsCallable as firebaseHttpsCallable } from "firebase/functions";

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
 * This callable is deployed with `consumeAppCheckToken: true`, so its App Check token is single-use
 * and the client has to ask for a limited-use one. Sending the ordinary cached token gets the call
 * rejected, and an App Check rejection surfaces as `401` — indistinguishable from "not signed in"
 * unless you already know to look here. Observed in production 2026-09-08 against a real
 * administrator session.
 */
const upcomingBirthdayCallableClientOptions = Object.freeze({ limitedUseAppCheckTokens: true });

function httpsCallable<RequestData, ResponseData>(
  functions: ReturnType<typeof getFirebaseFunctions>,
  name: string,
) {
  return firebaseHttpsCallable<RequestData, ResponseData>(
    functions,
    name,
    upcomingBirthdayCallableClientOptions,
  );
}

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
    Number.isSafeInteger(value.turningAge) &&
    (value.turningAge as number) >= 0 &&
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

const weekdayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const monthLabels = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;
const jerseyDay = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Jersey",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/**
 * "Sun 20 Sep": the day of the birthday, counted from today's civil date in Jersey. The backend
 * only says how many days away it is; the year of birth still never reaches the browser.
 * ponytail: fixed weekday/month tables because en-GB Intl prints "Sept", and the office asked
 * for "Sep".
 */
export function birthdayDateLabel(daysAway: number, nowMs: number = Date.now()): string {
  const [year, month, day] = jerseyDay.format(new Date(nowMs)).split("-").map(Number);
  const target = new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, (day ?? 1) + daysAway));
  return `${weekdayLabels[target.getUTCDay()]} ${target.getUTCDate()} ${monthLabels[target.getUTCMonth()]}`;
}
