import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listClientReminders: vi.fn(),
}));

vi.mock("../../lib/reminders-client", () => mocks);

import { ClientRemindersPanel } from "./client-reminders";

const reminders = [
  {
    reminderId: "payment-balance",
    kind: "payment" as const,
    severity: "warning" as const,
    title: "Payment follow-up",
    message: "Your account has an outstanding balance of £12.50.",
    amountMinor: 1250,
    count: null,
    createdAt: "2026-08-23T10:00:00Z",
    schemaVersion: "1" as const,
  },
  {
    reminderId: "attendance-follow-up-0",
    kind: "attendance" as const,
    severity: "warning" as const,
    title: "Attendance follow-up",
    message: "Jordan has 1 attendance record to follow up in the last 30 days.",
    amountMinor: null,
    count: 1,
    createdAt: "2026-08-23T10:00:00Z",
    schemaVersion: "1" as const,
  },
];

describe("ClientRemindersPanel (T048)", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders safe payment and attendance reminders without internal IDs", async () => {
    mocks.listClientReminders.mockResolvedValue(reminders);
    render(<ClientRemindersPanel />);

    expect(await screen.findByRole("heading", { name: "Account reminders" })).toBeVisible();
    expect(screen.getByText(reminders[0]!.message)).toBeVisible();
    expect(screen.getByText(reminders[1]!.message)).toBeVisible();
    expect(screen.queryByText(/student|invoice|attendance-follow-up-0/i)).not.toBeInTheDocument();
  });

  it("renders a safe empty state", async () => {
    mocks.listClientReminders.mockResolvedValue([]);
    render(<ClientRemindersPanel />);

    expect(await screen.findByText("No follow-up reminders right now.")).toBeVisible();
  });
});
