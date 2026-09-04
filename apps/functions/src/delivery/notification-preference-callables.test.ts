import { describe, expect, it } from "vitest";

import {
  createListNotificationPreferencesHandler,
  createSaveNotificationPreferenceHandler,
} from "./notification-preference-callables";
import { createInMemoryNotificationPreferenceStore } from "./notification-preference-service";

function request(data: unknown, role: string, academyId = "academy-a") {
  return {
    auth: { uid: `${role}-1`, token: { academyId, role } },
    data,
  } as never;
}

const preference = {
  audienceId: "audience-a",
  purpose: "class_reminder",
  channel: "email",
  enabled: true,
  consentState: "granted",
};

describe("notification preference callables", () => {
  it("allows an administrator to save and list only the actor academy audience", async () => {
    const store = createInMemoryNotificationPreferenceStore();
    const save = createSaveNotificationPreferenceHandler({ store });
    const list = createListNotificationPreferencesHandler({ store });

    const saved = await save(request(preference, "administrator"));
    const result = await list(request({ audienceId: "audience-a" }, "administrator"));

    expect(saved.preference.academyId).toBe("academy-a");
    expect(result.preferences).toEqual([saved.preference]);
  });

  it.each(["owner", "administrator"])(
    "derives the academy from the authenticated %s actor",
    async (role) => {
      const store = createInMemoryNotificationPreferenceStore();
      const save = createSaveNotificationPreferenceHandler({ store });

      const result = await save(request(preference, role, "academy-a"));

      expect(result.preference.academyId).toBe("academy-a");
    },
  );

  it.each(["headCoach", "coach", "guardian", "adultStudent"])(
    "denies the %s role",
    async (role) => {
      const store = createInMemoryNotificationPreferenceStore();
      const handler = createSaveNotificationPreferenceHandler({ store });

      await expect(handler(request(preference, role))).rejects.toMatchObject({
        code: "permission-denied",
      });
    },
  );

  it("rejects extra fields and unauthenticated access", async () => {
    const store = createInMemoryNotificationPreferenceStore();
    const save = createSaveNotificationPreferenceHandler({ store });
    const list = createListNotificationPreferencesHandler({ store });

    await expect(save(request({ ...preference, extra: true }, "owner"))).rejects.toMatchObject({
      code: "invalid-argument",
    });
    await expect(
      list({ auth: undefined, data: { audienceId: "audience-a" } } as never),
    ).rejects.toMatchObject({
      code: "unauthenticated",
    });
  });
});
