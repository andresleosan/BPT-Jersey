import { describe, expect, it } from "vitest";

import {
  createInMemoryNotificationPreferenceStore,
  NotificationPreferenceStoreError,
} from "./notification-preference-service";

const input = {
  academyId: "academy-a",
  actorId: "owner-a",
  audienceId: "audience-a",
  purpose: "class_reminder" as const,
  channel: "email" as const,
  enabled: true,
  consentState: "granted" as const,
  updatedAt: "2026-09-01T12:00:00.000Z",
};

describe("notification preference store", () => {
  it("persists preferences under their academy and audience scope", async () => {
    const store = createInMemoryNotificationPreferenceStore();

    const saved = await store.savePreference(input);

    expect(saved).toMatchObject({
      academyId: input.academyId,
      audienceId: input.audienceId,
      purpose: input.purpose,
      channel: input.channel,
      enabled: input.enabled,
      consentState: input.consentState,
      updatedAt: input.updatedAt,
    });
    expect(saved.preferenceId).toMatch(/^notification-preference-/u);
    await expect(store.listPreferences("academy-a", "audience-a")).resolves.toEqual([saved]);
    await expect(store.listPreferences("academy-b", "audience-a")).resolves.toEqual([]);
    await expect(store.listPreferences("academy-a", "audience-b")).resolves.toEqual([]);
  });

  it("updates the deterministic preference without creating a duplicate", async () => {
    const store = createInMemoryNotificationPreferenceStore();

    const first = await store.savePreference(input);
    const second = await store.savePreference({
      ...input,
      enabled: false,
      updatedAt: "2026-09-01T12:05:00.000Z",
    });

    expect(second.preferenceId).toBe(first.preferenceId);
    expect(second.enabled).toBe(false);
    await expect(store.listPreferences("academy-a", "audience-a")).resolves.toHaveLength(1);
  });

  it("rejects a preference whose academy identity is invalid", async () => {
    const store = createInMemoryNotificationPreferenceStore();

    await expect(store.savePreference({ ...input, academyId: "../other" })).rejects.toBeInstanceOf(
      NotificationPreferenceStoreError,
    );
  });
});
