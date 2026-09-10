import { describe, expect, it } from "vitest";

import {
  buildNotificationDispatchPlan,
  parseNotificationIntent,
  parseNotificationPreference,
  type NotificationIntent,
  type NotificationPreference,
} from "./notification-policy";

const intent: NotificationIntent = {
  intentId: "intent-1",
  academyId: "academy-1",
  audienceId: "audience-1",
  purpose: "class_reminder",
  channels: ["in_app", "email", "sms"],
  createdAt: "2026-08-27T12:00:00Z",
};

const preferences: NotificationPreference[] = [
  {
    preferenceId: "pref-app",
    academyId: "academy-1",
    audienceId: "audience-1",
    purpose: "class_reminder",
    channel: "in_app",
    enabled: true,
    consentState: "not_required",
    updatedAt: "2026-08-27T12:00:00Z",
  },
  {
    preferenceId: "pref-email",
    academyId: "academy-1",
    audienceId: "audience-1",
    purpose: "class_reminder",
    channel: "email",
    enabled: true,
    consentState: "granted",
    updatedAt: "2026-08-27T12:00:00Z",
  },
];

const inAppPreference = preferences[0]!;
const emailPreference = preferences[1]!;

describe("notification policy contracts", () => {
  it("allows in-app and consented external channels", () => {
    const result = buildNotificationDispatchPlan({ intents: [intent], preferences });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.eligible).toHaveLength(2);
    expect(result.value.skipped).toEqual([
      { intentId: "intent-1", channel: "sms", reason: "missing_preference" },
    ]);
  });

  it("requires consent for email and sms", () => {
    const parsed = parseNotificationPreference({
      ...emailPreference,
      consentState: "not_required",
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const result = buildNotificationDispatchPlan({
      intents: [{ ...intent, channels: ["email"] }],
      preferences: [parsed.value],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.eligible).toEqual([]);
    expect(result.value.skipped[0]?.reason).toBe("consent_required");
  });

  it("respects disabled and withdrawn preferences", () => {
    const result = buildNotificationDispatchPlan({
      intents: [
        { ...intent, intentId: "intent-disabled", channels: ["in_app"] },
        { ...intent, intentId: "intent-withdrawn", channels: ["email"] },
      ],
      preferences: [
        { ...inAppPreference, enabled: false },
        { ...emailPreference, consentState: "withdrawn" },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.eligible).toEqual([]);
    expect(result.value.skipped.map((item) => item.reason)).toEqual([
      "disabled",
      "consent_withdrawn",
    ]);
  });

  it("rejects duplicate preference keys, duplicate intents, and extra fields", () => {
    expect(parseNotificationIntent({ ...intent, extra: true }).ok).toBe(false);
    expect(
      buildNotificationDispatchPlan({
        intents: [intent, intent],
        preferences,
      }).ok,
    ).toBe(false);
    expect(
      buildNotificationDispatchPlan({
        intents: [intent],
        preferences: [inAppPreference, inAppPreference],
      }).ok,
    ).toBe(false);
  });

  it("keeps tenant and audience matching explicit", () => {
    const result = buildNotificationDispatchPlan({
      intents: [intent],
      preferences: [{ ...inAppPreference, academyId: "academy-2" }],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.eligible).toEqual([]);
    expect(result.value.skipped[0]?.reason).toBe("missing_preference");
  });

  it("returns deterministic frozen output without contacts or provider fields", () => {
    const first = buildNotificationDispatchPlan({ intents: [intent], preferences });
    const second = buildNotificationDispatchPlan({ intents: [intent], preferences });
    expect(first).toEqual(second);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(Object.isFrozen(first.value)).toBe(true);
    expect(Object.isFrozen(first.value.eligible)).toBe(true);
    expect(JSON.stringify(first.value)).not.toContain("recipient");
    expect(JSON.stringify(first.value)).not.toContain("provider");
  });
});
