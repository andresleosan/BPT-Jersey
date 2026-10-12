import { describe, expect, it, vi } from "vitest";

const syntheticAuthUsers = vi.hoisted(() => new Map<string, Record<string, unknown>>());
vi.mock("firebase-admin/auth", () => ({
  getAuth: () => ({
    getUser: async (uid: string) => syntheticAuthUsers.get(uid),
  }),
}));

import { buildRetentionAlerts } from "@bpt-jersey/domain/retention";
import { createListRetentionAlertsHandler } from "./retention-alert-callables";
import { createInMemoryRetentionAlertStore } from "./retention-alert-service";

function request(data: unknown, role: string, academyId = "academy-a") {
  // The inbox re-reads the caller from Auth (N-03); register the matching live account.
  syntheticAuthUsers.set(role + "-1", {
    uid: role + "-1",
    disabled: false,
    customClaims: { academyId, role },
    tokensValidAfterTime: "2020-01-01T00:00:00.000Z",
  });
  return {
    auth: { uid: role + "-1", token: { academyId, role, auth_time: 1_700_000_000 } },
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
          membershipStartsAt: "2026-01-01T00:00:00Z",
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

  it("refuses a token issued before a demotion or a session revocation (N-03)", async () => {
    const handler = createListRetentionAlertsHandler({
      store: createInMemoryRetentionAlertStore(),
    });
    const demoted = request(null, "owner");
    syntheticAuthUsers.set("owner-1", {
      uid: "owner-1",
      disabled: false,
      customClaims: { academyId: "academy-a", role: "coach" },
      tokensValidAfterTime: "2020-01-01T00:00:00.000Z",
    });
    await expect(handler(demoted)).rejects.toMatchObject({ code: "permission-denied" });
    const revoked = request(null, "administrator");
    syntheticAuthUsers.set("administrator-1", {
      uid: "administrator-1",
      disabled: false,
      customClaims: { academyId: "academy-a", role: "administrator" },
      tokensValidAfterTime: "2030-01-01T00:00:00.000Z",
    });
    await expect(handler(revoked)).rejects.toMatchObject({ code: "unauthenticated" });
  });

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
