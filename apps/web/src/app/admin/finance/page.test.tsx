import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FinancialDashboard } from "@bpt-jersey/domain/finance/dashboard";

const api = vi.hoisted(() => ({ getFinancialDashboard: vi.fn() }));

vi.mock("../../../lib/finance-client", () => ({
  getFinancialDashboard: api.getFinancialDashboard,
}));

import { FinancePage } from "./page";

const dashboard = {
  currency: "GBP",
  generatedAt: "2026-08-24T12:00:00.000Z",
  period: { from: "2026-08-01T00:00:00.000Z", to: "2026-08-24T12:00:00.000Z" },
  renewalWindow: { from: "2026-08-24T12:00:00.000Z", to: "2026-09-23T12:00:00.000Z" },
  metrics: {
    collectedMinor: 9_000,
    activeMemberships: 2,
    outstandingMinor: 8_000,
    paymentsReceived: 2,
    overdueBalances: 1,
    renewalsDue: 1,
  },
  recentPayments: [
    { invoiceReference: "INV-002", amountMinor: 5_000, occurredAt: "2026-08-10T00:00:00.000Z" },
  ],
  balanceAttention: [
    {
      invoiceReference: "INV-001",
      balanceMinor: 6_000,
      dueAt: "2026-08-10T00:00:00.000Z",
      status: "partially_paid",
      overdue: true,
    },
    {
      invoiceReference: "INV-003",
      balanceMinor: 2_000,
      dueAt: "2026-09-01T00:00:00.000Z",
      status: "open",
      overdue: false,
    },
  ],
  upcomingRenewals: [
    { planId: "bpt-jersey-adult", nextBillingAt: "2026-08-30T00:00:00.000Z", status: "active" },
  ],
} satisfies FinancialDashboard;

describe("finance page", () => {
  afterEach(() => cleanup());

  beforeEach(() => {
    vi.clearAllMocks();
    api.getFinancialDashboard.mockResolvedValue(dashboard);
  });

  it("renders connected finance, balances, and renewals without identity or card data", async () => {
    render(<FinancePage />);

    expect(screen.getByRole("status")).toHaveTextContent("Preparing the finance ledger");
    expect(await screen.findByRole("heading", { name: "Next financial actions" })).toBeVisible();
    expect(screen.getByText("£90.00")).toBeVisible();
    expect(screen.getByText("£80.00")).toBeVisible();
    expect(screen.getByRole("table", { name: "Outstanding invoice balances" })).toBeVisible();
    expect(screen.getByRole("table", { name: "Upcoming membership renewals" })).toBeVisible();
    expect(screen.getByRole("table", { name: "Recent recorded payments" })).toBeVisible();
    expect(screen.getByText("INV-001")).toBeVisible();
    expect(screen.getByText("bpt-jersey-adult")).toBeVisible();
    expect(document.body.textContent).not.toMatch(/family|student|card number|cvv|cvc|provider/iu);
  });

  it("filters balance attention without changing the connected source", async () => {
    render(<FinancePage />);
    const table = await screen.findByRole("table", { name: "Outstanding invoice balances" });

    fireEvent.change(screen.getByLabelText("Balance status"), { target: { value: "Due later" } });

    expect(within(table).getByText("INV-003")).toBeVisible();
    expect(within(table).queryByText("INV-001")).not.toBeInTheDocument();
    expect(api.getFinancialDashboard).toHaveBeenCalledTimes(1);
  });

  it("fails closed and allows a deliberate retry", async () => {
    api.getFinancialDashboard
      .mockRejectedValueOnce(new Error("private invoice detail"))
      .mockResolvedValueOnce(dashboard);
    render(<FinancePage />);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Financial dashboard could not be loaded");
    expect(alert).not.toHaveTextContent("private invoice detail");
    fireEvent.click(within(alert).getByRole("button", { name: "Try again" }));

    expect(await screen.findByText("INV-001")).toBeVisible();
    expect(api.getFinancialDashboard).toHaveBeenCalledTimes(2);
  });

  it("renders explicit empty states for a valid empty dashboard", async () => {
    api.getFinancialDashboard.mockResolvedValueOnce({
      ...dashboard,
      metrics: {
        collectedMinor: 0,
        activeMemberships: 0,
        outstandingMinor: 0,
        paymentsReceived: 0,
        overdueBalances: 0,
        renewalsDue: 0,
      },
      recentPayments: [],
      balanceAttention: [],
      upcomingRenewals: [],
    });
    render(<FinancePage />);

    expect(await screen.findByText("No balances match this filter.")).toBeVisible();
    expect(screen.getByText("No renewals are due in the next 30 days.")).toBeVisible();
    expect(screen.getByText("No manual payments have been recorded yet.")).toBeVisible();
  });
});
