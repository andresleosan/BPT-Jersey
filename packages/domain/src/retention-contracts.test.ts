import { describe, expect, it } from "vitest";

import { buildRetentionAlerts, type BuildRetentionAlertsInput } from "./retention-contracts";

const policy = {
  inactivityDays: 14,
  lookbackDays: 30,
  noShowThreshold: 2,
  membershipExpiryDays: 14,
} as const;

const baseInput: BuildRetentionAlertsInput = {
  academyId: "academy-1",
  now: "2026-08-27T12:00:00Z",
  policy,
  students: [],
};

function student(overrides: Partial<BuildRetentionAlertsInput["students"][number]> = {}) {
  return {
    academyId: "academy-1",
    studentId: "student-1",
    active: true,
    hasActiveMembership: true,
    membershipStartsAt: "2026-01-01T00:00:00Z",
    membershipEndsAt: null,
    attendance: [],
    ...overrides,
  } as const;
}

describe("retention contracts", () => {
  it("builds explainable deterministic alerts for the three supported triggers", () => {
    const result = buildRetentionAlerts({
      ...baseInput,
      students: [
        student({
          studentId: "student-gap",
          attendance: [{ state: "attended", occurredAt: "2026-08-01T10:00:00Z" }],
        }),
        student({
          studentId: "student-no-show",
          attendance: [
            { state: "attended", occurredAt: "2026-08-25T10:00:00Z" },
            { state: "no_show", occurredAt: "2026-08-20T10:00:00Z" },
            { state: "no_show", occurredAt: "2026-08-21T10:00:00Z" },
          ],
        }),
        student({
          studentId: "student-expiry",
          membershipEndsAt: "2026-09-05T00:00:00Z",
          attendance: [{ state: "attended", occurredAt: "2026-08-25T10:00:00Z" }],
        }),
      ],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.map((alert) => [alert.studentId, alert.kind])).toEqual([
      ["student-expiry", "membership_expiring"],
      ["student-gap", "attendance_gap"],
      ["student-no-show", "repeated_no_show"],
    ]);
    expect(result.value[1]?.evidence.lastAttendedAt).toBe("2026-08-01T10:00:00Z");
    expect(result.value[2]?.evidence.noShowCount).toBe(2);
    expect(result.value[0]?.deduplicationKey).toBe(
      "v2:19:membership_expiring:14:student-expiry:2026-08-27",
    );
    expect(result.value[0]?.alertId).toBe(
      "retention-v2__9_academy-1__19_membership_expiring__14_student-expiry__2026-08-27",
    );
  });

  it("is idempotent for the same input and does not mutate snapshots", () => {
    const input = { ...baseInput, students: [student()] };
    const before = structuredClone(input);
    const first = buildRetentionAlerts(input);
    const second = buildRetentionAlerts(input);

    expect(first).toEqual(second);
    expect(input).toEqual(before);
    expect(first.ok && Object.isFrozen(first.value)).toBe(true);
    expect(first.ok && Object.isFrozen(first.value[0]?.evidence)).toBe(true);
  });

  it("does not create alerts for inactive students or students without active membership", () => {
    const result = buildRetentionAlerts({
      ...baseInput,
      students: [
        student({ studentId: "inactive", active: false }),
        student({ studentId: "no-membership", hasActiveMembership: false }),
      ],
    });

    expect(result).toEqual({ ok: true, value: [] });
  });

  it("uses only the configured windows and ignores future attendance", () => {
    const result = buildRetentionAlerts({
      ...baseInput,
      students: [
        student({
          attendance: [
            { state: "attended", occurredAt: "2026-07-01T10:00:00Z" },
            { state: "attended", occurredAt: "2026-08-20T10:00:00Z" },
            { state: "attended", occurredAt: "2026-08-28T10:00:00Z" },
            { state: "no_show", occurredAt: "2026-07-01T10:00:00Z" },
            { state: "no_show", occurredAt: "2026-08-28T11:00:00Z" },
          ],
        }),
      ],
    });

    expect(result).toEqual({ ok: true, value: [] });
  });

  it("uses one canonical UTC instant for every replay on the same run date", () => {
    const students = [
      student({
        attendance: [{ state: "attended", occurredAt: "2026-08-01T10:00:00Z" }],
      }),
    ];

    const early = buildRetentionAlerts({
      ...baseInput,
      now: "2026-08-27T00:01:00Z",
      students,
    });
    const late = buildRetentionAlerts({
      ...baseInput,
      now: "2026-08-27T23:59:59Z",
      students,
    });

    expect(early).toEqual(late);
    expect(early.ok && early.value[0]?.createdAt).toBe("2026-08-27T00:00:00.000Z");
  });

  it("anchors a missing attendance history to membership start", () => {
    const result = buildRetentionAlerts({
      ...baseInput,
      students: [
        student({
          studentId: "recent-member",
          membershipStartsAt: "2026-08-20T00:00:00Z",
        }),
        student({
          studentId: "established-member",
          membershipStartsAt: "2026-08-01T00:00:00Z",
        }),
      ],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.map((alert) => [alert.studentId, alert.kind])).toEqual([
      ["established-member", "attendance_gap"],
    ]);
  });

  it("ignores attendance from before the current membership started", () => {
    const result = buildRetentionAlerts({
      ...baseInput,
      students: [
        student({
          membershipStartsAt: "2026-08-01T00:00:00Z",
          attendance: [
            { state: "no_show", occurredAt: "2026-07-29T10:00:00Z" },
            { state: "no_show", occurredAt: "2026-07-30T10:00:00Z" },
          ],
        }),
      ],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.map((alert) => alert.kind)).toEqual(["attendance_gap"]);
    expect(result.value[0]?.evidence.noShowCount).toBe(0);
  });

  it("uses a collision-free v2 identity for delimiter-bearing student IDs", () => {
    const result = buildRetentionAlerts({
      ...baseInput,
      students: [student({ studentId: "a:b" }), student({ studentId: "a__b" })],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(new Set(result.value.map((alert) => alert.alertId)).size).toBe(2);
    expect(
      Object.fromEntries(result.value.map((alert) => [alert.studentId, alert.alertId])),
    ).toEqual({
      "a:b": "retention-v2__9_academy-1__14_attendance_gap__3_a:b__2026-08-27",
      a__b: "retention-v2__9_academy-1__14_attendance_gap__4_a__b__2026-08-27",
    });
  });

  it("rejects invalid policies, cross-tenant snapshots, duplicate students, and malformed dates", () => {
    expect(
      buildRetentionAlerts({
        ...baseInput,
        policy: { ...policy, inactivityDays: 0 },
      }).ok,
    ).toBe(false);
    expect(
      buildRetentionAlerts({
        ...baseInput,
        students: [student({ academyId: "academy-2" })],
      }).ok,
    ).toBe(false);
    expect(
      buildRetentionAlerts({
        ...baseInput,
        students: [student(), student()],
      }).ok,
    ).toBe(false);
    expect(
      buildRetentionAlerts({
        ...baseInput,
        students: [student({ membershipEndsAt: "2026-02-30T00:00:00Z" })],
      }).ok,
    ).toBe(false);
    expect(
      buildRetentionAlerts({
        ...baseInput,
        students: [student({ membershipStartsAt: null })],
      }).ok,
    ).toBe(false);
  });

  it("keeps output free of contact details and internal membership fields", () => {
    const result = buildRetentionAlerts({
      ...baseInput,
      students: [student({ membershipEndsAt: "2026-09-05T00:00:00Z" })],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value[0]).not.toHaveProperty("email");
    expect(result.value[0]).not.toHaveProperty("membershipId");
    expect(result.value[0]).not.toHaveProperty("message");
  });
});
