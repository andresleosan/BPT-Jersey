import { createHash } from "node:crypto";

import { appendAuditEventInTransaction } from "../audit/audit-writer.js";
import type { AcademyId, CorrelationId, UserId } from "@bpt-jersey/domain";
import type { AuditEventDraft } from "@bpt-jersey/domain/audit";
import {
  parseNotificationPreference,
  type NotificationChannel,
  type NotificationConsentState,
  type NotificationPreference,
  type NotificationPurpose,
} from "@bpt-jersey/domain/delivery/notification-policy";

export type SaveNotificationPreferenceInput = Readonly<{
  academyId: string;
  actorId: string;
  audienceId: string;
  purpose: NotificationPurpose;
  channel: NotificationChannel;
  enabled: boolean;
  consentState: NotificationConsentState;
  updatedAt: string;
}>;

export class NotificationPreferenceStoreError extends Error {
  public readonly code: "invalid" | "tenant";

  public constructor(code: "invalid" | "tenant", message: string) {
    super(message);
    this.name = "NotificationPreferenceStoreError";
    this.code = code;
  }
}

export type NotificationPreferenceStore = Readonly<{
  savePreference: (input: SaveNotificationPreferenceInput) => Promise<NotificationPreference>;
  listPreferences: (
    academyId: string,
    audienceId: string,
  ) => Promise<readonly NotificationPreference[]>;
}>;

const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

function assertIdentifier(value: string, label: string): void {
  if (!identifierPattern.test(value)) {
    throw new NotificationPreferenceStoreError("invalid", `${label} is invalid`);
  }
}

function preferenceIdFor(
  input: Pick<SaveNotificationPreferenceInput, "academyId" | "audienceId" | "purpose" | "channel">,
): string {
  const key = [input.academyId, input.audienceId, input.purpose, input.channel].join("\u001f");
  return `notification-preference-${createHash("sha256").update(key).digest("hex").slice(0, 40)}`;
}

function normalize(input: SaveNotificationPreferenceInput): NotificationPreference {
  assertIdentifier(input.academyId, "academyId");
  assertIdentifier(input.audienceId, "audienceId");
  const parsed = parseNotificationPreference({
    preferenceId: preferenceIdFor(input),
    academyId: input.academyId,
    audienceId: input.audienceId,
    purpose: input.purpose,
    channel: input.channel,
    enabled: input.enabled,
    consentState: input.consentState,
    updatedAt: input.updatedAt,
  });
  if (!parsed.ok) {
    throw new NotificationPreferenceStoreError("invalid", "Notification preference is invalid");
  }
  return parsed.value;
}

function preferencePath(academyId: string, preferenceId: string): string {
  return `academies/${academyId}/notificationPreferences/${preferenceId}`;
}

export function createInMemoryNotificationPreferenceStore(): NotificationPreferenceStore {
  const records = new Map<string, NotificationPreference>();

  return {
    async savePreference(input) {
      const preference = normalize(input);
      records.set(`${preference.academyId}/${preference.preferenceId}`, preference);
      return preference;
    },
    async listPreferences(academyId, audienceId) {
      assertIdentifier(academyId, "academyId");
      assertIdentifier(audienceId, "audienceId");
      return Object.freeze(
        [...records.values()]
          .filter(
            (preference) =>
              preference.academyId === academyId && preference.audienceId === audienceId,
          )
          .sort((left, right) =>
            `${left.purpose}:${left.channel}`.localeCompare(`${right.purpose}:${right.channel}`),
          ),
      );
    },
  };
}

type GenericPreferenceReference = Readonly<{
  id: string;
  path: string;
  set: (data: Readonly<Record<string, unknown>>) => Promise<unknown>;
}>;

type GenericPreferenceTransaction = Readonly<{
  set: (ref: GenericPreferenceReference, data: Readonly<Record<string, unknown>>) => unknown;
  create: (ref: GenericPreferenceReference, data: Readonly<Record<string, unknown>>) => unknown;
}>;

type NotificationPreferenceAppendAudit = (
  transaction: GenericPreferenceTransaction,
  reference: GenericPreferenceReference,
  draft: AuditEventDraft,
) => void;

export type GenericNotificationPreferenceFirestore = Readonly<{
  doc: (path: string) => GenericPreferenceReference;
  collection: (path: string) => Readonly<{
    doc: (id?: string) => GenericPreferenceReference;
    get: () => Promise<{
      docs: readonly { data: () => Record<string, unknown> }[];
    }>;
  }>;
  runTransaction: <T>(
    callback: (transaction: GenericPreferenceTransaction) => Promise<T>,
  ) => Promise<T>;
}>;

export function createFirestoreNotificationPreferenceStore({
  firestore,
  appendAudit = appendAuditEventInTransaction,
}: {
  firestore: GenericNotificationPreferenceFirestore;
  appendAudit?: NotificationPreferenceAppendAudit;
}): NotificationPreferenceStore {
  return {
    async savePreference(input) {
      const preference = normalize(input);
      await firestore.runTransaction(async (transaction) => {
        const preferenceReference = firestore.doc(
          preferencePath(preference.academyId, preference.preferenceId),
        );
        transaction.set(preferenceReference, preference);
        const auditReference = firestore
          .collection(`academies/${preference.academyId}/auditEvents`)
          .doc();
        appendAudit(transaction, auditReference, {
          academyId: preference.academyId as AcademyId,
          actorId: input.actorId as UserId,
          action: "notification.preference.updated",
          targetRef: preferenceReference.path,
          purpose: "notification preference administration",
          correlationId: `notification-preference:${preference.preferenceId}` as CorrelationId,
        });
      });
      return preference;
    },
    async listPreferences(academyId, audienceId) {
      assertIdentifier(academyId, "academyId");
      assertIdentifier(audienceId, "audienceId");
      const snapshot = await firestore
        .collection(`academies/${academyId}/notificationPreferences`)
        .get();
      return Object.freeze(
        snapshot.docs
          .map((document) => {
            const parsed = parseNotificationPreference(document.data());
            if (!parsed.ok || parsed.value.academyId !== academyId) {
              throw new NotificationPreferenceStoreError(
                "invalid",
                "Persisted notification preference is invalid",
              );
            }
            return parsed.value;
          })
          .filter((preference) => preference.audienceId === audienceId)
          .sort((left, right) =>
            `${left.purpose}:${left.channel}`.localeCompare(`${right.purpose}:${right.channel}`),
          ),
      );
    },
  };
}
