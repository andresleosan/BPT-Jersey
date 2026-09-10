import { describe, expect, it, vi } from "vitest";

import { listClientReminders } from "./reminders-client";

let mockCallableResult: unknown = {
  data: {
    reminders: [
      {
        reminderId: "payment-balance",
        kind: "payment",
        severity: "warning",
        title: "Payment follow-up",
        message: "Your account has an outstanding balance of £12.50.",
        amountMinor: 1250,
        count: null,
        createdAt: "2026-08-23T10:00:00Z",
        schemaVersion: "1",
      },
    ],
  },
};

vi.mock("firebase/functions", () => ({
  httpsCallable: () => async () => mockCallableResult,
}));

vi.mock("./firebase-client", () => ({
  getFirebaseFunctions: () => ({}),
}));

describe("Reminders Web Client (T048)", () => {
  it("lists and validates reminders", async () => {
    const reminders = await listClientReminders();
    expect(reminders).toHaveLength(1);
    expect(reminders[0]?.kind).toBe("payment");
  });

  it("rejects an unsafe response with a generic error", async () => {
    mockCallableResult = { data: { reminders: [{ reminderId: "invoice-123" }] } };

    await expect(listClientReminders()).rejects.toThrow(/Unable to load reminders/);
  });


});