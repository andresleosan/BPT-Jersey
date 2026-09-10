import type { ValidationIssue } from "../errors";
import { err, ok, type Result } from "../result";

export const notificationPurposes = Object.freeze([
  "class_reminder",
  "attendance_follow_up",
  "payment_follow_up",
] as const);
export type NotificationPurpose = (typeof notificationPurposes)[number];

export const notificationChannels = Object.freeze(["in_app", "email", "sms"] as const);
export type NotificationChannel = (typeof notificationChannels)[number];

export const notificationConsentStates = Object.freeze([
  "not_required",
  "granted",
  "withdrawn",
] as const);
export type NotificationConsentState = (typeof notificationConsentStates)[number];

export type NotificationPreference = Readonly<{
  preferenceId: string;
  academyId: string;
  audienceId: string;
  purpose: NotificationPurpose;
  channel: NotificationChannel;
  enabled: boolean;
  consentState: NotificationConsentState;
  updatedAt: string;
}>;

export type NotificationIntent = Readonly<{
  intentId: string;
  academyId: string;
  audienceId: string;
  purpose: NotificationPurpose;
  channels: readonly NotificationChannel[];
  createdAt: string;
}>;

export type NotificationDispatchCandidate = Readonly<{
  intentId: string;
  preferenceId: string;
  channel: NotificationChannel;
}>;

export type NotificationDispatchSkip = Readonly<{
  intentId: string;
  channel: NotificationChannel;
  reason: "missing_preference" | "disabled" | "consent_required" | "consent_withdrawn";
}>;

export type NotificationDispatchPlan = Readonly<{
  eligible: readonly NotificationDispatchCandidate[];
  skipped: readonly NotificationDispatchSkip[];
}>;

const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const dateTimePattern =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:?\d{2})$/u;

function issue(path: readonly (string | number)[], code: string): ValidationIssue {
  return Object.freeze({ path: Object.freeze([...path]), code });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isIdentifier(value: unknown): value is string {
  return typeof value === "string" && identifierPattern.test(value);
}

function isDateTime(value: unknown): value is string {
  return (
    typeof value === "string" && dateTimePattern.test(value) && !Number.isNaN(Date.parse(value))
  );
}

function isPurpose(value: unknown): value is NotificationPurpose {
  return notificationPurposes.includes(value as NotificationPurpose);
}

function isChannel(value: unknown): value is NotificationChannel {
  return notificationChannels.includes(value as NotificationChannel);
}

function isConsentState(value: unknown): value is NotificationConsentState {
  return notificationConsentStates.includes(value as NotificationConsentState);
}

function hasOnlyKeys(record: Record<string, unknown>, keys: readonly string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(record).every((key) => allowed.has(key));
}

export function parseNotificationPreference(
  value: unknown,
): Result<NotificationPreference, readonly ValidationIssue[]> {
  if (!isRecord(value)) return err(Object.freeze([issue([], "invalid_type")]));
  const valid =
    hasOnlyKeys(value, [
      "preferenceId",
      "academyId",
      "audienceId",
      "purpose",
      "channel",
      "enabled",
      "consentState",
      "updatedAt",
    ]) &&
    isIdentifier(value.preferenceId) &&
    isIdentifier(value.academyId) &&
    isIdentifier(value.audienceId) &&
    isPurpose(value.purpose) &&
    isChannel(value.channel) &&
    typeof value.enabled === "boolean" &&
    isConsentState(value.consentState) &&
    isDateTime(value.updatedAt);
  if (!valid) return err(Object.freeze([issue([], "invalid_notification_preference")]));
  return ok(
    Object.freeze({
      preferenceId: value.preferenceId as string,
      academyId: value.academyId as string,
      audienceId: value.audienceId as string,
      purpose: value.purpose as NotificationPurpose,
      channel: value.channel as NotificationChannel,
      enabled: value.enabled as boolean,
      consentState: value.consentState as NotificationConsentState,
      updatedAt: value.updatedAt as string,
    }),
  );
}

export function parseNotificationIntent(
  value: unknown,
): Result<NotificationIntent, readonly ValidationIssue[]> {
  if (!isRecord(value)) return err(Object.freeze([issue([], "invalid_type")]));
  const channelsValid =
    Array.isArray(value.channels) &&
    value.channels.length > 0 &&
    value.channels.length <= notificationChannels.length &&
    new Set(value.channels).size === value.channels.length &&
    value.channels.every((channel) => isChannel(channel));
  const valid =
    hasOnlyKeys(value, [
      "intentId",
      "academyId",
      "audienceId",
      "purpose",
      "channels",
      "createdAt",
    ]) &&
    isIdentifier(value.intentId) &&
    isIdentifier(value.academyId) &&
    isIdentifier(value.audienceId) &&
    isPurpose(value.purpose) &&
    channelsValid &&
    isDateTime(value.createdAt);
  if (!valid) return err(Object.freeze([issue([], "invalid_notification_intent")]));
  return ok(
    Object.freeze({
      intentId: value.intentId as string,
      academyId: value.academyId as string,
      audienceId: value.audienceId as string,
      purpose: value.purpose as NotificationPurpose,
      channels: Object.freeze([...(value.channels as NotificationChannel[])]),
      createdAt: value.createdAt as string,
    }),
  );
}

function preferenceKey(preference: NotificationPreference): string {
  return [preference.academyId, preference.audienceId, preference.purpose, preference.channel].join(
    "|",
  );
}

export function buildNotificationDispatchPlan(input: {
  intents: readonly NotificationIntent[];
  preferences: readonly NotificationPreference[];
}): Result<NotificationDispatchPlan, readonly ValidationIssue[]> {
  const issues: ValidationIssue[] = [];
  if (!Array.isArray(input.intents)) issues.push(issue(["intents"], "invalid_type"));
  if (!Array.isArray(input.preferences)) issues.push(issue(["preferences"], "invalid_type"));
  if (issues.length > 0) return err(Object.freeze(issues));

  const intents: NotificationIntent[] = [];
  const preferences: NotificationPreference[] = [];
  for (const [index, value] of input.intents.entries()) {
    const parsed = parseNotificationIntent(value);
    if (!parsed.ok) issues.push(issue(["intents", index], "invalid_notification_intent"));
    else intents.push(parsed.value);
  }
  for (const [index, value] of input.preferences.entries()) {
    const parsed = parseNotificationPreference(value);
    if (!parsed.ok) issues.push(issue(["preferences", index], "invalid_notification_preference"));
    else preferences.push(parsed.value);
  }
  if (issues.length > 0) return err(Object.freeze(issues));

  const seenIntentIds = new Set<string>();
  const seenPreferenceKeys = new Set<string>();
  for (const [index, intent] of intents.entries()) {
    if (seenIntentIds.has(intent.intentId))
      issues.push(issue(["intents", index, "intentId"], "duplicate_intent"));
    seenIntentIds.add(intent.intentId);
  }
  for (const [index, preference] of preferences.entries()) {
    const key = preferenceKey(preference);
    if (seenPreferenceKeys.has(key))
      issues.push(issue(["preferences", index], "duplicate_preference"));
    seenPreferenceKeys.add(key);
  }
  if (issues.length > 0) return err(Object.freeze(issues));

  const byKey = new Map(preferences.map((preference) => [preferenceKey(preference), preference]));
  const eligible: NotificationDispatchCandidate[] = [];
  const skipped: NotificationDispatchSkip[] = [];
  for (const intent of intents) {
    for (const channel of intent.channels) {
      const preference = byKey.get(
        [intent.academyId, intent.audienceId, intent.purpose, channel].join("|"),
      );
      if (!preference) {
        skipped.push(
          Object.freeze({ intentId: intent.intentId, channel, reason: "missing_preference" }),
        );
      } else if (!preference.enabled) {
        skipped.push(Object.freeze({ intentId: intent.intentId, channel, reason: "disabled" }));
      } else if (preference.consentState === "withdrawn") {
        skipped.push(
          Object.freeze({ intentId: intent.intentId, channel, reason: "consent_withdrawn" }),
        );
      } else if (channel !== "in_app" && preference.consentState !== "granted") {
        skipped.push(
          Object.freeze({ intentId: intent.intentId, channel, reason: "consent_required" }),
        );
      } else {
        eligible.push(
          Object.freeze({
            intentId: intent.intentId,
            preferenceId: preference.preferenceId,
            channel,
          }),
        );
      }
    }
  }

  return ok(
    Object.freeze({
      eligible: Object.freeze(eligible),
      skipped: Object.freeze(skipped),
    }),
  );
}
