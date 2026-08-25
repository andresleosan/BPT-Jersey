import { httpsCallable } from "firebase/functions";

import type { InAppReminderRecord } from "@bpt-jersey/domain/reminders";
import { getFirebaseFunctions } from "./firebase-client";

const safeListRemindersError = "Unable to load reminders. Please try again.";

function isReminderRecord(value: unknown): value is InAppReminderRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.reminderId === "string" &&
    (record.kind === "payment" || record.kind === "attendance") &&
    record.severity === "warning" &&
    typeof record.title === "string" &&
    typeof record.message === "string" &&
    (record.amountMinor === null ||
      (typeof record.amountMinor === "number" && Number.isSafeInteger(record.amountMinor))) &&
    (record.count === null ||
      (typeof record.count === "number" && Number.isSafeInteger(record.count))) &&
    typeof record.createdAt === "string" &&
    record.schemaVersion === "1"
  );
}

export async function listClientReminders(): Promise<readonly InAppReminderRecord[]> {
  const functions = getFirebaseFunctions();
  const callable = httpsCallable<null, { reminders: readonly InAppReminderRecord[] }>(
    functions,
    "listClientReminders",
  );

  try {
    const response = await callable(null);
    if (
      !response.data ||
      !Array.isArray(response.data.reminders) ||
      !response.data.reminders.every(isReminderRecord)
    ) {
      throw new Error("Invalid reminders response");
    }
    return response.data.reminders;
  } catch (error) {
    if (error instanceof Error && error.message === safeListRemindersError) {
      throw error;
    }
    throw new Error(safeListRemindersError);
  }
}