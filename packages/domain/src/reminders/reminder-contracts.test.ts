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

describe("cancelled-class notices (T110)", () => {
  const base = {
    now: "2026-09-05T12:00:00.000Z",
    financialAccount: { balanceMinor: 0, paygDebtMinor: 0 },
    attendance: [],
  };

  it("names the class and the reason without any identifier", () => {
    const reminders = buildInAppReminders({
      ...base,
      cancelledSessions: [
        {
          label: "Jordan",
          title: "Kids BJJ - West",
          startAt: "2026-09-10T17:30:00.000Z",
          reason: "Cancelled automatically: the minimum was not reached.",
        },
      ],
    });

    expect(reminders).toHaveLength(1);
    expect(reminders[0]).toMatchObject({
      reminderId: "session-cancelled-0",
      kind: "sessionCancelled",
      severity: "warning",
      title: "Class cancelled",
      amountMinor: null,
      count: null,
    });
    expect(reminders[0]?.message).toContain("Jordan was booked into Kids BJJ - West");
    expect(reminders[0]?.message).toContain("Thursday");
    expect(reminders[0]?.message).toContain("Cancelled automatically");
  });

  it("addresses the member directly when no child is named", () => {
    const reminders = buildInAppReminders({
      ...base,
      cancelledSessions: [
        {
          label: "  ",
          title: "Adults Gi - Town",
          startAt: "2026-09-11T18:00:00.000Z",
          reason: "Off.",
        },
      ],
    });
    expect(reminders[0]?.message).toContain("You were booked into Adults Gi - Town");
  });

  it("skips a notice with no class name or an unusable time", () => {
    const reminders = buildInAppReminders({
      ...base,
      cancelledSessions: [
        { label: "Jordan", title: "   ", startAt: "2026-09-11T18:00:00.000Z", reason: "Off." },
        { label: "Jordan", title: "Kids BJJ", startAt: "not-a-time", reason: "Off." },
      ],
    });
    expect(reminders).toEqual([]);
  });

  it("keeps payment and attendance reminders ahead of the class notices", () => {
    const reminders = buildInAppReminders({
      now: "2026-09-05T12:00:00.000Z",
      financialAccount: { balanceMinor: 1000, paygDebtMinor: 0 },
      attendance: [
        {
          label: "Jordan",
          records: [{ state: "no_show", occurredAt: "2026-09-03T18:00:00.000Z" }],
        },
      ],
      cancelledSessions: [
        { label: "Jordan", title: "Kids BJJ", startAt: "2026-09-10T17:30:00.000Z", reason: "Off." },
      ],
    });
    expect(reminders.map((reminder) => reminder.kind)).toEqual([
      "payment",
      "attendance",
      "sessionCancelled",
    ]);
  });
});
