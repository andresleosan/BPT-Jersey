import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FinancialDashboard } from "@bpt-jersey/domain/finance/dashboard";

const financeApi = vi.hoisted(() => ({
  getFinancialDashboard: vi.fn(),
  listRecentPayments: vi.fn(),
  getFamilyFinancialAccount: vi.fn(),
}));
const billingApi = vi.hoisted(() => ({
  listFinancialAccount: vi.fn(),
  issueManualInvoice: vi.fn(),
  recordManualPayment: vi.fn(),
  voidManualInvoice: vi.fn(),
}));
const membershipApi = vi.hoisted(() => ({ listMemberships: vi.fn() }));
const membersApi = vi.hoisted(() => ({ listMemberNames: vi.fn() }));

vi.mock("../../../lib/finance-client", () => financeApi);
vi.mock("../../../lib/billing-client", () => billingApi);
vi.mock("../../../lib/membership-admin-client", () => membershipApi);
vi.mock("../../../lib/members-client", () => membersApi);
vi.mock("./no-show-penalty-queue", () => ({ NoShowPenaltyQueue: () => null }));
vi.mock("./payment-instructions-panel", () => ({ PaymentInstructionsPanel: () => null }));

import { BillingPage } from "./page";

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
  ],
  upcomingRenewals: [
    { planId: "bpt-jersey-adult", nextBillingAt: "2026-08-30T00:00:00.000Z", status: "active" },
  ],
} satisfies FinancialDashboard;

function makePayment(index: number) {
  return {
    paymentId: `payment-${index}`,
    occurredAt: new Date(2026, 7, 1 + index).toISOString(),
    amountMinor: 1_000 + index,
    method: index === 0 ? ("cash" as const) : ("bank_transfer" as const),
    manualReference: `REF-${index}`,
    invoiceReference: `INV-${index}`,
    description: "September membership",
    familyId: "family-1",
    memberName: index === 0 ? "Ana Coelho" : null,
  };
}

const twentyOnePayments = Array.from({ length: 21 }, (_, index) => makePayment(index));

const members = [
  { studentId: "s1", fullName: "Ana Coelho", familyId: "f1" },
  { studentId: "s2", fullName: "Bruno Silva", familyId: "f2" },
];

const familyAccount = {
  invoices: [
    {
      balanceMinor: 5_000,
      invoice: {
        invoiceId: "invoice-1",
        academyId: "academy-1",
        familyId: "f1",
        membershipId: "membership-1",
        status: "open",
        totalMinor: 5_000,
        currency: "GBP",
        dueAt: "2026-09-20T12:00:00.000Z",
        paidAt: null,
        schemaVersion: 1,
        createdAt: "2026-09-03T12:00:00.000Z",
        createdBy: "owner-1",
        updatedAt: "2026-09-03T12:00:00.000Z",
        updatedBy: "owner-1",
        chargeKind: "membership",
        sourceRef: null,
        invoiceReference: "INV-001",
        description: "September membership",
      },
      payments: [
        {
          paymentId: "payment-1",
          invoiceId: "invoice-1",
          familyId: "f1",
          amountMinor: 2_500,
          method: "cash",
          manualReference: "CASH-1",
          occurredAt: "2026-09-05T09:00:00.000Z",
          recordedBy: "owner-1",
          recordedAt: "2026-09-05T09:00:00.000Z",
        },
      ],
    },
  ],
  balanceMinor: 2_500,
  paygDebtMinor: 0,
  paymentInstructions: null,
};

describe("billing page", () => {
  afterEach(() => cleanup());

  beforeEach(() => {
    vi.clearAllMocks();
    financeApi.getFinancialDashboard.mockResolvedValue(dashboard);
    financeApi.listRecentPayments.mockResolvedValue([]);
    billingApi.listFinancialAccount.mockResolvedValue({
      invoices: [],
      balanceMinor: 0,
      paygDebtMinor: 0,
      paymentInstructions: null,
    });
    membershipApi.listMemberships.mockResolvedValue([]);
    membersApi.listMemberNames.mockResolvedValue(members);
  });

  it("opens on the finance dashboard with the latest twenty payments", async () => {
    financeApi.getFinancialDashboard.mockResolvedValue(dashboard);
    financeApi.listRecentPayments.mockResolvedValue(twentyOnePayments.slice(0, 20));
    render(<BillingPage />);
    expect(await screen.findByRole("heading", { name: "Billing" })).toBeInTheDocument();
    expect(screen.getByRole("article", { name: /Collected this month/u })).toBeInTheDocument();
    // The section and the table share the name "Latest payments", and the table's scroll wrapper
    // is now a named region too, so scope to the table itself rather than to a role+name pair
    // that matches more than one element.
    const latest = screen.getByRole("table", { name: "Latest payments" });
    expect(within(latest).getAllByRole("row")).toHaveLength(21); // header + 20
    expect(within(latest).getByText("Ana Coelho")).toBeInTheDocument();
    expect(within(latest).getAllByText("Cash").length).toBeGreaterThan(0);
    expect(screen.getByRole("group", { name: "Outstanding invoices" })).not.toHaveAttribute("open");
  });

  it("shows a member's family payments after picking them", async () => {
    membersApi.listMemberNames.mockResolvedValue(members);
    financeApi.getFamilyFinancialAccount.mockResolvedValue(familyAccount);
    render(<BillingPage />);
    fireEvent.change(await screen.findByRole("searchbox", { name: "Find a member" }), {
      target: { value: "ana c" },
    });
    fireEvent.click(screen.getByRole("option", { name: "Ana Coelho" }));
    await waitFor(() => expect(financeApi.getFamilyFinancialAccount).toHaveBeenCalledWith("f1"));
    const panel = await screen.findByRole("region", { name: "Ana Coelho's account" });
    expect(within(panel).getByRole("table", { name: "All payments" })).toBeInTheDocument();
    const payments = familyAccount.invoices.flatMap((v) => v.payments);
    expect(within(panel).getAllByRole("row")).toHaveLength(
      2 + payments.length + familyAccount.invoices.length,
    );
  });

  it("resolves the member's name in the All invoices table, falling back to the description", async () => {
    membershipApi.listMemberships.mockResolvedValue([
      {
        membershipId: "membership-1",
        familyId: "f1",
        studentId: "s1",
        planId: "town-adult",
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
            invoiceId: "invoice-1",
            academyId: "academy-1",
            familyId: "f1",
            membershipId: "membership-1",
            status: "open",
            totalMinor: 5_000,
            currency: "GBP",
            dueAt: "2026-09-20T12:00:00.000Z",
            paidAt: null,
            schemaVersion: 1,
            createdAt: "2026-09-03T12:00:00.000Z",
            createdBy: "owner-1",
            updatedAt: "2026-09-03T12:00:00.000Z",
            updatedBy: "owner-1",
            chargeKind: "membership",
            sourceRef: null,
            invoiceReference: "INV-001",
            description: "September membership",
          },
          payments: [],
        },
        {
          balanceMinor: 2_000,
          invoice: {
            invoiceId: "invoice-2",
            academyId: "academy-1",
            familyId: "f2",
            membershipId: null,
            status: "open",
            totalMinor: 2_000,
            currency: "GBP",
            dueAt: "2026-09-21T12:00:00.000Z",
            paidAt: null,
            schemaVersion: 1,
            createdAt: "2026-09-03T12:00:00.000Z",
            createdBy: "owner-1",
            updatedAt: "2026-09-03T12:00:00.000Z",
            updatedBy: "owner-1",
            chargeKind: "manual_adjustment",
            sourceRef: null,
            invoiceReference: "INV-002",
            description: "One-off gi replacement charge",
          },
          payments: [],
        },
      ],
      balanceMinor: 7_000,
      paygDebtMinor: 0,
      paymentInstructions: null,
    });
    render(<BillingPage />);
    await screen.findByRole("group", { name: "All invoices" });
    fireEvent.click(screen.getByText("All invoices", { selector: "summary" }));
    const table = await screen.findByRole("table", { name: "All invoices" });
    expect(within(table).getByText("Ana Coelho")).toBeInTheDocument();
    expect(within(table).getByText("One-off gi replacement charge")).toBeInTheDocument();
  });

  it("keeps the page usable when the member list fails", async () => {
    membersApi.listMemberNames.mockRejectedValue(
      new Error("The member list is unavailable. Please try again."),
    );
    render(<BillingPage />);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The member list is unavailable. Please try again.",
    );
    expect(screen.getByRole("button", { name: "Issue invoice" })).toBeInTheDocument();
  });
});
