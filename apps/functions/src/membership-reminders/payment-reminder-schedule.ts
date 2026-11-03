import { dateKeyInJersey } from "@bpt-jersey/domain/schedule/member-calendar";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import * as logger from "firebase-functions/logger";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { coursesAcademyId } from "../courses/course-public-http.js";
import {
  createDeliveryDispatcher,
  createFirestoreDeliveryHistoryStore,
  type GenericDeliveryFirestore,
} from "../delivery/delivery-service.js";
import {
  parseReminderMode,
  reminderFrom,
  reminderMode,
  reminderReplyTo,
  reminderStartDate,
  reminderTestRecipient,
  sesRegion,
  type ReminderMode,
} from "./payment-reminder-params.js";
import { createPaymentReminderPorts } from "./payment-reminder-firestore.js";
import { runPaymentReminders, sendPaymentReminderSamples } from "./payment-reminder-service.js";
import {
  createSesDeliveryProvider,
  createSesSendFromEnvironment,
  sesSecrets,
} from "./ses-provider.js";

const dateKeyPattern = /^\d{4}-\d{2}-\d{2}$/u;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
const reminderCap = 30;

function errorNameOf(err: unknown): string {
  const name = (err as { name?: unknown } | null)?.name;
  return typeof name === "string" ? name : "UnknownError";
}

/** Logs the error name only, never `err.message`, and gives Cloud Scheduler a generic failure. */
function runFailed(mode: ReminderMode, err: unknown): Error {
  logger.error("Payment reminder run failed", { mode, errorName: errorNameOf(err) });
  return new Error("Payment reminder run failed");
}

/** The SES dispatcher, or null (logged) when email sending is not configured: fail closed. */
function createSesDispatcher(mode: ReminderMode) {
  let send: ReturnType<typeof createSesSendFromEnvironment>;
  try {
    send = createSesSendFromEnvironment(sesRegion.value());
  } catch {
    logger.error("Payment reminders: email sending is not configured", { mode });
    return null;
  }
  return createDeliveryDispatcher({
    provider: createSesDeliveryProvider({
      send,
      from: reminderFrom.value(),
      replyTo: reminderReplyTo.value(),
    }),
    history: createFirestoreDeliveryHistoryStore({
      firestore: getFirestore() as unknown as GenericDeliveryFirestore,
    }),
  });
}

/** Daily membership payment reminders. No retryCount: the step windows catch up a failed day. */
export const membershipPaymentRemindersSchedule = onSchedule(
  {
    schedule: "0 9 * * *",
    timeZone: "Europe/Jersey",
    timeoutSeconds: 540,
    memory: "512MiB",
    maxInstances: 1,
    secrets: sesSecrets,
  },
  async () => {
    const academyId = coursesAcademyId.value();
    if (!academyId) return;
    const mode = parseReminderMode(reminderMode.value());
    if (mode === "off") {
      logger.info("Payment reminders are off", { mode });
      return;
    }
    const now = new Date();

    if (mode === "test") {
      // Samples only: no ports, no member data, one recipient.
      const recipient = reminderTestRecipient.value();
      if (!emailPattern.test(recipient)) {
        logger.error("Payment reminders: test recipient is missing or invalid", { mode });
        return;
      }
      const dispatcher = createSesDispatcher(mode);
      if (!dispatcher) return;
      let samplesAccepted: number;
      try {
        samplesAccepted = await sendPaymentReminderSamples(dispatcher.dispatch, {
          academyId,
          recipient,
          now,
        });
      } catch (err) {
        throw runFailed(mode, err);
      }
      logger.info("Payment reminder run", { mode, samplesAccepted });
      return;
    }

    const startDate = reminderStartDate.value();
    const startDateKey = mode === "dry-run" && startDate === "" ? dateKeyInJersey(now) : startDate;
    if (!dateKeyPattern.test(startDateKey)) {
      logger.error("Payment reminders: REMINDER_START_DATE must be YYYY-MM-DD", { mode });
      return;
    }

    // dry-run never builds the SES client: its ports get no dispatcher.
    let dispatcher: ReturnType<typeof createSesDispatcher> = null;
    if (mode === "live") {
      dispatcher = createSesDispatcher(mode);
      if (!dispatcher) return;
    }
    let summary: Awaited<ReturnType<typeof runPaymentReminders>>;
    try {
      summary = await runPaymentReminders(
        createPaymentReminderPorts(getFirestore(), getAuth(), academyId, dispatcher),
        { academyId, now, mode, startDateKey, cap: reminderCap },
      );
    } catch (err) {
      throw runFailed(mode, err);
    }
    logger.info("Payment reminder run", { mode, startDateKey, ...summary });
  },
);
