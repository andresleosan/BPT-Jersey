import { describe, expect, it } from "vitest";

import {
  createFirestoreNotificationPreferenceStore,
  type GenericNotificationPreferenceFirestore,
} from "./notification-preference-service.js";

describe("notification preference persisted audit", () => {
  it("writes the preference and append-only audit event in one transaction", async () => {
    const writes: Array<{ path: string; data: Readonly<Record<string, unknown>> }> = [];
    const auditDrafts: Readonly<Record<string, unknown>>[] = [];
    const transaction = {
      set(ref: { path: string }, data: Readonly<Record<string, unknown>>) {
        writes.push({ path: ref.path, data });
        return transaction;
      },
      create(ref: { path: string; id: string }, data: Readonly<Record<string, unknown>>) {
        writes.push({ path: ref.path, data });
        return transaction;
      },
    };
    const firestore = {
      doc(path: string) {
        return { id: path.split("/").at(-1) ?? "", path, set: async () => undefined };
      },
      collection(path: string) {
        return {
          doc(id = "audit-1") {
            return { id, path: `${path}/${id}` };
          },
          get: async () => ({ docs: [] }),
        };
      },
      runTransaction: async <T>(callback: (value: typeof transaction) => Promise<T>) =>
        callback(transaction),
    } as unknown as GenericNotificationPreferenceFirestore;

    const store = createFirestoreNotificationPreferenceStore({
      firestore,
      appendAudit: (tx, ref, draft) => {
        auditDrafts.push(draft);
        tx.create(ref, {
          ...draft,
          auditEventId: ref.id,
          occurredAt: "server-timestamp",
          result: "completed",
          schemaVersion: 1,
        });
      },
    });

    const preference = await store.savePreference({
      academyId: "academy-a",
      actorId: "owner-a",
      audienceId: "audience-a",
      purpose: "class_reminder",
      channel: "email",
      enabled: true,
      consentState: "granted",
      updatedAt: "2026-09-01T12:00:00.000Z",
    });

    expect(writes).toHaveLength(2);
    expect(writes[0]?.path).toBe(
      `academies/academy-a/notificationPreferences/${preference.preferenceId}`,
    );
    expect(writes[1]?.path).toBe("academies/academy-a/auditEvents/audit-1");
    expect(auditDrafts).toEqual([
      {
        academyId: "academy-a",
        actorId: "owner-a",
        action: "notification.preference.updated",
        targetRef: `academies/academy-a/notificationPreferences/${preference.preferenceId}`,
        purpose: "notification preference administration",
        correlationId: `notification-preference:${preference.preferenceId}`,
      },
    ]);
  });
});
