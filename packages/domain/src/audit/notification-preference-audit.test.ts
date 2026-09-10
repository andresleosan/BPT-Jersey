import { describe, expect, it } from "vitest";

import { auditActions, parseAuditEventDraft } from "./audit-event";

describe("notification preference audit contract", () => {
  it("accepts a tenant-scoped persisted preference update", () => {
    const draft = {
      academyId: "academy-a",
      actorId: "owner-a",
      action: "notification.preference.updated" as const,
      targetRef: "academies/academy-a/notificationPreferences/preference-a",
      purpose: "notification preference administration",
      correlationId: "notification-preference:preference-a",
    };

    expect(auditActions).toContain("notification.preference.updated");
    expect(parseAuditEventDraft(draft)).toEqual({ ok: true, value: draft });
  });
});
