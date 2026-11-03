import { defineString } from "firebase-functions/params";

/**
 * Deployment parameters for the membership payment reminder job. They are `defineString` so each
 * value travels with the deployment and shows in the function's configuration. Every default is
 * safe: `REMINDER_MODE` starts in `dry-run`, which never sends an email or writes a notice.
 */
export const sesRegion = defineString("SES_REGION", {
  default: "eu-west-3",
  description: "AWS region of the SES account that sends membership payment reminders.",
});

export const reminderMode = defineString("REMINDER_MODE", {
  default: "dry-run",
  description:
    "Membership payment reminders: 'off', 'dry-run', 'test' or 'live'. Anything else means 'off'.",
});

export const reminderFrom = defineString("REMINDER_FROM", {
  default: "BPT Jersey <membership@mail.bptjersey.com>",
  description: "From address of membership payment reminder emails.",
});

export const reminderReplyTo = defineString("REMINDER_REPLY_TO", {
  default: "bptjersey@gmail.com",
  description: "Reply-To address of membership payment reminder emails.",
});

export const reminderTestRecipient = defineString("REMINDER_TEST_RECIPIENT", {
  default: "",
  description: "In 'test' mode, the only address that receives reminder emails.",
});

export const reminderStartDate = defineString("REMINDER_START_DATE", {
  default: "",
  description:
    "Go-live date (YYYY-MM-DD): only memberships whose Jersey end date is on or after it get reminders.",
});

export type ReminderMode = "off" | "dry-run" | "test" | "live";

/** Exact match only, so a typo has one meaning: `off`. */
export function parseReminderMode(value: string): ReminderMode {
  return value === "dry-run" || value === "test" || value === "live" ? value : "off";
}
