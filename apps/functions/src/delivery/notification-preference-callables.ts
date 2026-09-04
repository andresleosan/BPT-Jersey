import { getFirestore } from "firebase-admin/firestore";
import { HttpsError, onCall, type CallableRequest } from "firebase-functions/v2/https";

import {
  notificationChannels,
  notificationConsentStates,
  notificationPurposes,
  type NotificationChannel,
  type NotificationConsentState,
  type NotificationPurpose,
} from "@bpt-jersey/domain/delivery/notification-policy";
import { requireUserActor } from "../auth/user-authorization.js";
import {
  createFirestoreNotificationPreferenceStore,
  NotificationPreferenceStoreError,
  type NotificationPreferenceStore,
} from "./notification-preference-service.js";

const preferenceRoles = new Set(["owner", "administrator"]);
const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

type SavePreferencePayload = Readonly<{
  audienceId: string;
  purpose: NotificationPurpose;
  channel: NotificationChannel;
  enabled: boolean;
  consentState: NotificationConsentState;
}>;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseAudiencePayload(value: unknown): string {
  if (
    !isPlainRecord(value) ||
    Reflect.ownKeys(value).length !== 1 ||
    !Object.hasOwn(value, "audienceId")
  ) {
    throw new HttpsError("invalid-argument", "The notification preference payload is invalid.");
  }
  const audienceId = value.audienceId;
  if (typeof audienceId !== "string" || !identifierPattern.test(audienceId)) {
    throw new HttpsError("invalid-argument", "audienceId is invalid.");
  }
  return audienceId;
}

function parseSavePayload(value: unknown): SavePreferencePayload {
  if (
    !isPlainRecord(value) ||
    Reflect.ownKeys(value).length !== 5 ||
    !["audienceId", "purpose", "channel", "enabled", "consentState"].every((key) =>
      Object.hasOwn(value, key),
    )
  ) {
    throw new HttpsError("invalid-argument", "The notification preference payload is invalid.");
  }
  if (
    typeof value.audienceId !== "string" ||
    !identifierPattern.test(value.audienceId) ||
    !notificationPurposes.includes(value.purpose as NotificationPurpose) ||
    !notificationChannels.includes(value.channel as NotificationChannel) ||
    typeof value.enabled !== "boolean" ||
    !notificationConsentStates.includes(value.consentState as NotificationConsentState)
  ) {
    throw new HttpsError("invalid-argument", "The notification preference payload is invalid.");
  }
  return {
    audienceId: value.audienceId,
    purpose: value.purpose as NotificationPurpose,
    channel: value.channel as NotificationChannel,
    enabled: value.enabled,
    consentState: value.consentState as NotificationConsentState,
  };
}

function requirePreferenceRole(request: CallableRequest<unknown>) {
  const actor = requireUserActor(request);
  if (!preferenceRoles.has(actor.role)) {
    throw new HttpsError("permission-denied", "Notification preference access is not permitted");
  }
  return actor;
}

function mapStoreError(error: unknown, action: string): never {
  if (error instanceof NotificationPreferenceStoreError) {
    if (error.code === "invalid" || error.code === "tenant") {
      throw new HttpsError("permission-denied", "Notification preference scope is invalid");
    }
  }
  throw new HttpsError("internal", `Unable to ${action} notification preferences`);
}

export function createListNotificationPreferencesHandler({
  store,
}: {
  store: NotificationPreferenceStore;
}) {
  return async (request: CallableRequest<unknown>) => {
    const actor = requirePreferenceRole(request);
    const audienceId = parseAudiencePayload(request.data);
    try {
      return { preferences: await store.listPreferences(actor.academyId, audienceId) };
    } catch (error) {
      return mapStoreError(error, "list");
    }
  };
}

export function createSaveNotificationPreferenceHandler({
  store,
  now = () => new Date().toISOString(),
}: {
  store: NotificationPreferenceStore;
  now?: () => string;
}) {
  return async (request: CallableRequest<unknown>) => {
    const actor = requirePreferenceRole(request);
    const payload = parseSavePayload(request.data);
    try {
      return {
        preference: await store.savePreference({
          academyId: actor.academyId,
          actorId: actor.userId,
          ...payload,
          updatedAt: now(),
        }),
      };
    } catch (error) {
      return mapStoreError(error, "save");
    }
  };
}

let defaultStore: NotificationPreferenceStore | undefined;

function getStore(): NotificationPreferenceStore {
  defaultStore ??= createFirestoreNotificationPreferenceStore({
    firestore: getFirestore() as never,
  });
  return defaultStore;
}

export const notificationPreferenceCallableOptions = { enforceAppCheck: true };

export const listNotificationPreferences = onCall(
  notificationPreferenceCallableOptions,
  async (request) => createListNotificationPreferencesHandler({ store: getStore() })(request),
);

export const saveNotificationPreference = onCall(
  notificationPreferenceCallableOptions,
  async (request) => createSaveNotificationPreferenceHandler({ store: getStore() })(request),
);
