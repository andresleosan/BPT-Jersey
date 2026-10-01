import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FinancialDashboard } from "@bpt-jersey/domain/finance/dashboard";

const financeApi = vi.hoisted(() => ({
  getFinancialDashboard: vi.fn(),
  getFamilyFinancialAccount: vi.fn(),
}));
const billingApi = vi.hoisted(() => ({
  listFinancialAccount: vi.fn(),
  issueManualInvoice: vi.fn(),
  recordManualPayment: vi.fn(),
  voidManualInvoice: vi.fn(),
  voidManualPayment: vi.fn(),
  editManualPayment: vi.fn(),
  getInvoice: vi.fn(),
}));
const membershipApi = vi.hoisted(() => ({ listMemberships: vi.fn() }));
const membersApi = vi.hoisted(() => ({ listMemberNames: vi.fn() }));

vi.mock("../../../lib/finance-client", () => financeApi);
vi.mock("../../../lib/billing-client", () => billingApi);
vi.mock("../../../lib/membership-admin-client", () => membershipApi);
vi.mock("../../../lib/members-client", () => membersApi);
vi.mock("../billing/payment-instructions-panel", () => ({ PaymentInstructionsPanel: () => null }));
vi.mock("../billing/private-lessons-panel", () => ({ PrivateLessonsPanel: () => null }));

import { FinancePage } from "./page";

const dashboard = {
  currency: "GBP",
  generatedAt: "2026-10-15T12:00:00.000Z",
  month: "2026-10",
  period: { from: "2026-10-01T00:00:00.000Z", to: "2026-11-01T00:00:00.000Z" },
  metrics: {
    collectedMinor: 9_000,
    paymentsReceived: 2,
    outstandingMinor: 8_000,
    overdueBalances: 1,
    renewalsDue: 1,
    renewalsOverdue: 1,
    activeMemberships: 2,
  },
  payments: [
    {
      rowId: "payment:pay-1",
      source: "membership",
      occurredAt: "2026-10-10T10:00:00.000Z",
      amountMinor: 5_000,
      method: "cash",
      reference: "CASH-1",
      studentId: "stu-1",
      label: "October membership",
      paymentId: "pay-1",
      invoiceId: "inv-1",
      shopOrderId: null,
      editable: true,
      voidable: true,
      voided: null,
    },
    {
      rowId: "shop:order-7",
      source: "shop",
      occurredAt: "2026-10-09T10:00:00.000Z",
      amountMinor: 4_000,
      method: "bank_transfer",
      reference: null,
      studentId: null,
      label: "SHOP-000007 · Ana Coelho",
      paymentId: null,
      invoiceId: null,
      shopOrderId: "order-7",
      editable: false,
      voidable: false,
      voided: null,
    },
    {
      rowId: "voided:pay-2",
      source: "membership",
      occurredAt: "2026-10-05T10:00:00.000Z",
      amountMinor: 3_000,
      method: "bank_transfer",
      reference: "BT-2",
      studentId: "stu-2",
      label: "October membership",
      paymentId: "pay-2",
      invoiceId: "inv-2",
      shopOrderId: null,
      editable: false,
      voidable: false,
      voided: {
        voidedAt: "2026-10-06T10:00:00.000Z",
        voidedByName: "Owner",
        reason: "Recorded twice by mistake",
      },
    },
  ],
  balances: [
    {
      invoiceId: "inv-9",
      invoiceReference: "INV-009",
      studentId: "stu-unknown",
      label: "Gi replacement charge",
      dueAt: "2026-10-01T00:00:00.000Z",
      balanceMinor: 8_000,
      overdue: true,
      status: "open",
    },
  ],
  renewals: {
    overdue: [
      {
        membershipId: "mem-1",
        studentId: "stu-1",
        planId: "adult",
        planName: "Adult unlimited",
        nextBillingAt: "2026-10-02T00:00:00.000Z",
        // The membership is still active; only its renewal date has passed.
        status: "active",
      },
    ],
    dueSoon: [
      {
        membershipId: "mem-2",
        studentId: "stu-2",
        planId: "kids",
        planName: "Kids twice weekly",
        nextBillingAt: "2026-10-20T00:00:00.000Z",
        status: "active",
      },
    ],
  },
} satisfies FinancialDashboard;

const members = [
  { studentId: "stu-1", fullName: "Ana Coelho", familyId: "f1" },
  { studentId: "stu-2", fullName: "Bruno Silva", familyId: "f2" },
];

describe("finance page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-15T12:00:00.000Z"));
    window.history.replaceState(null, "", "/admin/finance");
    financeApi.getFinancialDashboard.mockResolvedValue(dashboard);
    billingApi.listFinancialAccount.mockResolvedValue({
      invoices: [],
      balanceMinor: 0,
      paygDebtMinor: 0,
      paymentInstructions: null,
    });
    membershipApi.listMemberships.mockResolvedValue([]);
    membersApi.listMemberNames.mockResolvedValue(members);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("shows the month's KPIs with the month selector on the current month", async () => {
    render(<FinancePage />);
    expect(await screen.findByRole("heading", { name: "Financial dashboard" })).toBeInTheDocument();
    expect(await screen.findByRole("article", { name: /Collected$/u })).toBeInTheDocument();
    expect(screen.getByRole("article", { name: /Outstanding$/u })).toBeInTheDocument();
    expect(screen.getByRole("article", { name: /Overdue invoices$/u })).toBeInTheDocument();
    expect(screen.getByRole("article", { name: /Renewals$/u })).toBeInTheDocument();
    expect(screen.getByText("October 2026")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next month" })).toBeDisabled();
  });

  it("lists the month's payments with names, sources and the row actions", async () => {
    render(<FinancePage />);
    const table = await screen.findByRole("table", { name: "Payments in October 2026" });
    const planRow = within(table).getByText("Ana Coelho").closest("tr")!;
    expect(within(planRow).getByText("Plan")).toBeInTheDocument();
    expect(within(planRow).getByRole("button", { name: "Edit" })).toBeInTheDocument();
    expect(within(planRow).getByRole("button", { name: "Void" })).toBeInTheDocument();
    const shopRow = within(table).getByText("SHOP-000007 · Ana Coelho").closest("tr")!;
    expect(within(shopRow).queryByRole("button")).toBeNull();
    const voidedRow = within(table)
      .getByText(/Recorded twice by mistake/u)
      .closest("tr")!;
    expect(within(voidedRow).getByText(/Voided/u)).toBeInTheDocument();
    expect(within(voidedRow).queryByRole("button")).toBeNull();
  });

  it("asks for the previous month", async () => {
    render(<FinancePage />);
    await screen.findByRole("table", { name: "Payments in October 2026" });
    expect(financeApi.getFinancialDashboard).toHaveBeenCalledWith(undefined);
    fireEvent.click(screen.getByRole("button", { name: "Previous month" }));
    await waitFor(() => expect(financeApi.getFinancialDashboard).toHaveBeenCalledWith("2026-09"));
    expect(screen.getByText("September 2026")).toBeInTheDocument();
  });

  it("voids a payment and refreshes the dashboard", async () => {
    billingApi.voidManualPayment.mockResolvedValue({ ok: true });
    render(<FinancePage />);
    const table = await screen.findByRole("table", { name: "Payments in October 2026" });
    const planRow = within(table).getByText("Ana Coelho").closest("tr")!;
    fireEvent.click(within(planRow).getByRole("button", { name: "Void" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByRole("textbox", { name: /Reason for voiding/u }), {
      target: { value: "Recorded against the wrong member" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Void payment" }));
    expect(await screen.findByText("Payment voided.")).toHaveAttribute("role", "status");
    expect(billingApi.voidManualPayment).toHaveBeenCalledWith(
      expect.objectContaining({ paymentId: "pay-1", reason: "Recorded against the wrong member" }),
    );
    await waitFor(() => expect(financeApi.getFinancialDashboard).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("opens the Owed tab from the address and names unknown members by the invoice label", async () => {
    window.history.replaceState(null, "", "/admin/finance?tab=owed");
    render(<FinancePage />);
    const table = await screen.findByRole("table", { name: "Invoices with a balance" });
    expect(within(table).getByText("Gi replacement charge")).toBeInTheDocument();
    expect(within(table).queryByText("stu-unknown")).toBeNull();
    expect(screen.getByRole("tab", { name: "Owed" })).toHaveAttribute("aria-selected", "true");
  });

  it("lists overdue renewals first with a link to the member's plan", async () => {
    render(<FinancePage />);
    await screen.findByRole("table", { name: "Payments in October 2026" });
    fireEvent.click(screen.getByRole("tab", { name: "Renewals" }));
    expect(window.location.search).toBe("?tab=renewals");
    const tables = screen.getAllByRole("table");
    expect(tables[0]).toHaveAccessibleName("Overdue");
    expect(tables[1]).toHaveAccessibleName("Due in the next 30 days");
    const overdueRow = within(tables[0]!).getByText("Ana Coelho").closest("tr")!;
    expect(within(overdueRow).getByRole("link", { name: "Open plan" })).toHaveAttribute(
      "href",
      "/admin/members/profile?id=stu-1&tab=plan",
    );
    expect(within(overdueRow).getByText("Overdue")).toBeInTheDocument();
    expect(within(overdueRow).queryByText("Active")).toBeNull();
    const dueSoonRow = within(tables[1]!).getByText("Bruno Silva").closest("tr")!;
    expect(within(dueSoonRow).getByText("Active")).toBeInTheDocument();
  });

  it("counts a single payment in the singular", async () => {
    financeApi.getFinancialDashboard.mockResolvedValue({
      ...dashboard,
      metrics: { ...dashboard.metrics, paymentsReceived: 1 },
    });
    render(<FinancePage />);
    expect(await screen.findByText("1 payment in October 2026")).toBeInTheDocument();
  });

  it("loads only the dashboard and the member names on first render", async () => {
    render(<FinancePage />);
    await screen.findByRole("table", { name: "Payments in October 2026" });
    expect(financeApi.getFinancialDashboard).toHaveBeenCalledTimes(1);
    expect(membersApi.listMemberNames).toHaveBeenCalledTimes(1);
    expect(billingApi.listFinancialAccount).not.toHaveBeenCalled();
    expect(membershipApi.listMemberships).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("tab", { name: "Invoices" }));
    await waitFor(() => expect(billingApi.listFinancialAccount).toHaveBeenCalledTimes(1));
    expect(membershipApi.listMemberships).toHaveBeenCalledTimes(1);
  });

  it("names an invoice by its description when the member has no known name", async () => {
    membershipApi.listMemberships.mockResolvedValue([
      {
        membershipId: "membership-9",
        familyId: "f9",
        studentId: "stu-nameless",
        planId: "adult",
        status: "active",
        startsAt: "2026-09-01T00:00:00.000Z",
        endsAt: null,
        nextBillingAt: null,
      },
    ]);
    billingApi.listFinancialAccount.mockResolvedValue({
      invoices: [
        {
          balanceMinor: 5_000,
          invoice: {
            invoiceId: "invoice-9",
            academyId: "academy-1",
            familyId: "f9",
            membershipId: "membership-9",
            status: "open",
            totalMinor: 5_000,
            currency: "GBP",
            dueAt: "2026-10-20T12:00:00.000Z",
            paidAt: null,
            schemaVersion: 1,
            createdAt: "2026-10-03T12:00:00.000Z",
            createdBy: "owner-1",
            updatedAt: "2026-10-03T12:00:00.000Z",
            updatedBy: "owner-1",
            chargeKind: "membership",
            sourceRef: null,
            invoiceReference: "INV-009",
            description: "October membership",
          },
          payments: [],
        },
      ],
      balanceMinor: 5_000,
      paygDebtMinor: 0,
      paymentInstructions: null,
    });
    window.history.replaceState(null, "", "/admin/finance?tab=invoices");
    render(<FinancePage />);
    const table = await screen.findByRole("table", { name: "All invoices" });
    await waitFor(() => expect(within(table).getByText("October membership")).toBeInTheDocument());
    expect(within(table).queryByText("stu-nameless")).toBeNull();
  });

  it("offers a retry when the dashboard fails", async () => {
    financeApi.getFinancialDashboard.mockRejectedValueOnce(new Error("down"));
    render(<FinancePage />);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The finance summary is unavailable. Try again.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(financeApi.getFinancialDashboard).toHaveBeenCalledTimes(2));
    expect(
      await screen.findByRole("table", { name: "Payments in October 2026" }),
    ).toBeInTheDocument();
  });
});
