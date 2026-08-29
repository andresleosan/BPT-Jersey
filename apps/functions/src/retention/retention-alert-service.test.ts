import { describe, expect, it } from "vitest";

import { buildRetentionAlerts, type RetentionAlert } from "@bpt-jersey/domain/retention";
import {
  createInMemoryRetentionAlertStore,
  RetentionAlertStoreError,
} from "./retention-alert-service";

function alert(academyId = "academy-a"): RetentionAlert {
  const result = buildRetentionAlerts({
    academyId,
    now: "2026-08-28T12:00:00Z",
    policy: {
      inactivityDays: 14,
      lookbackDays: 30,
      noShowThreshold: 2,
      membershipExpiryDays: 14,
    },
    students: [
      {
        academyId,
        studentId: "student-a",
        active: true,
        hasActiveMembership: true,
        membershipEndsAt: null,
        attendance: [],
      },
    ],
  });
  if (!result.ok || result.value[0] === undefined) throw new Error("Invalid test alert");
  return result.value[0];
}

describe("retention alert store", () => {
  it("persists a deterministic alert once and lists only its tenant", async () => {
    const store = createInMemoryRetentionAlertStore();
    await expect(
      store.upsertAlerts({ academyId: "academy-a", alerts: [alert()] }),
    ).resolves.toEqual({
      created: 1,
      unchanged: 0,
    });
    await expect(
      store.upsertAlerts({ academyId: "academy-a", alerts: [alert()] }),
    ).resolves.toEqual({
      created: 0,
      unchanged: 1,
    });
    await expect(store.listAlerts("academy-a")).resolves.toHaveLength(1);
    await expect(store.listAlerts("academy-b")).resolves.toEqual([]);
  });

  it("rejects cross-tenant, duplicate, changed, and non-minimal alerts", async () => {
    const store = createInMemoryRetentionAlertStore();
    const first = alert();
    await expect(
      store.upsertAlerts({ academyId: "academy-b", alerts: [first] }),
    ).rejects.toMatchObject({ code: "tenant" });
    await expect(
      store.upsertAlerts({ academyId: "academy-a", alerts: [first, first] }),
    ).rejects.toMatchObject({ code: "conflict" });

    const oversized = Array.from({ length: 201 }, (_, index) => {
      const studentId = "student-" + index;
      const deduplicationKey = "attendance_gap:" + studentId + ":2026-08-28";
      return {
        ...first,
        studentId,
        deduplicationKey,
        alertId: "academy-a__" + deduplicationKey.replaceAll(":", "__"),
      };
    });
    await expect(
      store.upsertAlerts({ academyId: "academy-a", alerts: oversized }),
    ).rejects.toMatchObject({ code: "invalid" });

    await store.upsertAlerts({ academyId: "academy-a", alerts: [first] });
    await expect(
      store.upsertAlerts({
        academyId: "academy-a",
        alerts: [{ ...first, createdAt: "2026-08-28T13:00:00Z" }],
      }),
    ).rejects.toMatchObject({ code: "conflict" });
    await expect(
      store.upsertAlerts({
        academyId: "academy-a",
        alerts: [{ ...alert(), email: "private@example.test" } as RetentionAlert],
      }),
    ).rejects.toBeInstanceOf(RetentionAlertStoreError);
    await expect(
      store.upsertAlerts({
        academyId: "academy-a",
        alerts: [{ ...alert(), createdAt: "2026-02-30T12:00:00Z" }],
      }),
    ).rejects.toMatchObject({ code: "invalid" });
  });
});
