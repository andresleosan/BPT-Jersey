import { describe, expect, it } from "vitest";

import { buildRetentionAlerts } from "@bpt-jersey/domain/retention";
import { createListRetentionAlertsHandler } from "./retention-alert-callables";
import { createInMemoryRetentionAlertStore } from "./retention-alert-service";

function request(data: unknown, role: string, academyId = "academy-a") {
  return {
    auth: { uid: role + "-1", token: { academyId, role } },
    data,
  } as never;
}

describe("retention alert callable", () => {
  it.each(["owner", "administrator"])("lists only the actor tenant for %s", async (role) => {
    const store = createInMemoryRetentionAlertStore();
    const result = buildRetentionAlerts({
      academyId: "academy-a",
      now: "2026-08-28T12:00:00Z",
      policy: {
        inactivityDays: 14,
        lookbackDays: 30,
        noShowThreshold: 2,
        membershipExpiryDays: 14,
      },
      students: [
        {
          academyId: "academy-a",
          studentId: "student-a",
          active: true,
          hasActiveMembership: true,
          membershipEndsAt: null,
          attendance: [],
        },
      ],
    });
    if (!result.ok) throw new Error("Invalid test fixture");
    await store.upsertAlerts({ academyId: "academy-a", alerts: result.value });

    const response = await createListRetentionAlertsHandler({ store })(request(null, role));
    expect(response.alerts).toHaveLength(1);
    expect(response.alerts[0]?.studentReference).toBe("student-a");
    expect(response.alerts[0]).not.toHaveProperty("academyId");
    expect(response.alerts[0]).not.toHaveProperty("alertId");
    expect(response.alerts[0]).not.toHaveProperty("deduplicationKey");
  });

  it.each(["headCoach", "coach", "guardian", "adultStudent"])(
    "denies the %s role",
    async (role) => {
      const handler = createListRetentionAlertsHandler({
        store: createInMemoryRetentionAlertStore(),
      });
      await expect(handler(request(null, role))).rejects.toMatchObject({
        code: "permission-denied",
      });
    },
  );

  it("rejects filters and unauthenticated requests", async () => {
    const handler = createListRetentionAlertsHandler({
      store: createInMemoryRetentionAlertStore(),
    });
    await expect(handler(request({}, "owner"))).rejects.toMatchObject({
      code: "invalid-argument",
    });
    await expect(handler({ auth: undefined, data: null } as never)).rejects.toMatchObject({
      code: "unauthenticated",
    });
  });
});
