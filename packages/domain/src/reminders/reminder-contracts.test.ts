import { describe, expect, it } from "vitest";

import { buildInAppReminders } from "./reminder-contracts";

describe("In-app reminders (T048)", () => {
  it("builds a payment reminder from the canonical balance", () => {
    const reminders = buildInAppReminders({
      now: "2026-08-23T12:00:00.000Z",
      financialAccount: { balanceMinor: 1250, paygDebtMinor: 0 },
      attendance: [],
    });

    expect(reminders).toHaveLength(1);
    expect(reminders[0]).toMatchObject({
      kind: "payment",
      amountMinor: 1250,
      message: "Your account has an outstanding balance of £12.50.",
    });
  });

  it("builds recent attendance follow-up without exposing internal IDs", () => {
    const reminders = buildInAppReminders({
      now: "2026-08-23T12:00:00.000Z",
      financialAccount: { balanceMinor: 0, paygDebtMinor: 0 },
      attendance: [
        {
          label: "Jordan",
          records: [
            { state: "no_show", occurredAt: "2026-08-20T12:00:00.000Z" },
            { state: "attended", occurredAt: "2026-08-19T12:00:00.000Z" },
            { state: "absent", occurredAt: "2026-01-01T12:00:00.000Z" },
          ],
        },
      ],
    });

    expect(reminders).toHaveLength(1);
    expect(reminders[0]).toMatchObject({
      kind: "attendance",
      count: 1,
      message: expect.stringContaining("Jordan has 1 attendance record"),
    });
    expect(JSON.stringify(reminders)).not.toContain("student-secret");
  });

  it("combines payment and multiple student follow-ups", () => {
    const reminders = buildInAppReminders({
      now: "2026-08-23T12:00:00.000Z",
      financialAccount: { balanceMinor: 2000, paygDebtMinor: 500 },
      attendance: [
        { label: "Jordan", records: [{ state: "absent", occurredAt: "2026-08-22T12:00:00.000Z" }] },
        {
          label: "Taylor",
          records: [{ state: "no_show", occurredAt: "2026-08-21T12:00:00.000Z" }],
        },
      ],
    });

    expect(reminders.map((reminder) => reminder.kind)).toEqual([
      "payment",
      "attendance",
      "attendance",
    ]);
  });

  it("uses a bounded lookback and fails closed for invalid input", () => {
    const old = buildInAppReminders({
      now: "2026-08-23T12:00:00.000Z",
      financialAccount: { balanceMinor: 0, paygDebtMinor: 0 },
      attendance: [
        { label: "Jordan", records: [{ state: "absent", occurredAt: "2026-07-01T12:00:00.000Z" }] },
      ],
    });
    const invalid = buildInAppReminders({
      now: "not-a-date",
      financialAccount: { balanceMinor: 100, paygDebtMinor: 0 },
      attendance: [],
    });

    expect(old).toEqual([]);
    expect(invalid).toEqual([]);
  });
});
