import { describe, expect, it } from "vitest";
import type { MembershipRecord } from "../memberships/membership-contracts";
import type { InvoiceRecord, ManualPaymentRecord } from "./finance-contracts";
import {
  buildFinancialDashboard,
  financialDashboardListLimit,
  isFinancialDashboard,
} from "./financial-dashboard";

const generatedAt = "2026-08-24T12:00:00.000Z";

function membership(
  membershipId: string,
  overrides: Partial<MembershipRecord> = {},
): MembershipRecord {
  return {
    membershipId,
    academyId: "academy-a",
    familyId: "family-a",
    studentId: `student-${membershipId}`,
    planId: "bpt-jersey-adult",
    status: "active",
    startsAt: "2026-01-01T00:00:00.000Z",
    endsAt: null,
    nextBillingAt: "2026-08-30T00:00:00.000Z",
    schemaVersion: "1",
    createdAt: "2026-01-01T00:00:00.000Z",
    createdBy: "owner-a",
    updatedAt: "2026-08-01T00:00:00.000Z",
    updatedBy: "owner-a",
    ...overrides,
  };
}

function invoice(
  invoiceId: string,
  membershipId: string,
  overrides: Partial<InvoiceRecord> = {},
): InvoiceRecord {
  return {
    invoiceId,
    academyId: "academy-a",
    familyId: "family-a",
    membershipId,
    status: "open",
    totalMinor: 10_000,
    currency: "GBP",
    dueAt: "2026-08-10T00:00:00.000Z",
    paidAt: null,
    schemaVersion: 1,
    createdAt: "2026-08-01T00:00:00.000Z",
    createdBy: "owner-a",
    updatedAt: "2026-08-01T00:00:00.000Z",
    updatedBy: "owner-a",
    chargeKind: "membership",
    sourceRef: null,
    invoiceReference: `INV-${invoiceId}`,
    description: "Monthly membership",
    ...overrides,
  };
}

function payment(
  paymentId: string,
  invoiceId: string,
  amountMinor: number,
  occurredAt: string,
): ManualPaymentRecord {
  return {
    paymentId,
    academyId: "academy-a",
    familyId: "family-a",
    invoiceId,
    status: "recorded",
    amountMinor,
    currency: "GBP",
    method: "bank_transfer",
    manualReference: `PAY-${paymentId}`,
    providerReference: null,
    occurredAt,
    schemaVersion: 1,
    createdAt: occurredAt,
    createdBy: "owner-a",
    updatedAt: occurredAt,
    updatedBy: "owner-a",
  };
}

function dashboardFixture() {
  const memberships = [
    membership("membership-1"),
    membership("membership-2", { nextBillingAt: "2026-10-01T00:00:00.000Z" }),
    membership("membership-3", {
      status: "trial",
      nextBillingAt: "2026-09-10T00:00:00.000Z",
    }),
    membership("membership-4", {
      status: "paused",
      nextBillingAt: "2026-08-28T00:00:00.000Z",
    }),
  ];
  const invoices = [
    invoice("invoice-1", "membership-1", { status: "partially_paid" }),
    invoice("invoice-2", "membership-2", {
      status: "paid",
      totalMinor: 5_000,
      paidAt: "2026-08-10T00:00:00.000Z",
    }),
    invoice("invoice-3", "membership-3", {
      totalMinor: 2_000,
      dueAt: "2026-09-01T00:00:00.000Z",
    }),
    invoice("invoice-4", "membership-4", { status: "void", totalMinor: 3_000 }),
  ];
  const payments = [
    payment("payment-1", "invoice-1", 4_000, "2026-08-05T00:00:00.000Z"),
    payment("payment-2", "invoice-2", 5_000, "2026-08-10T00:00:00.000Z"),
  ];
  return buildFinancialDashboard({ generatedAt, memberships, invoices, payments });
}

describe("financial dashboard projection", () => {
  it("derives current-month receipts, balances, and a fixed renewal horizon", () => {
    const dashboard = dashboardFixture();

    expect(dashboard.period).toEqual({
      from: "2026-08-01T00:00:00.000Z",
      to: generatedAt,
    });
    expect(dashboard.renewalWindow).toEqual({
      from: generatedAt,
      to: "2026-09-23T12:00:00.000Z",
    });
    expect(dashboard.metrics).toEqual({
      collectedMinor: 9_000,
      activeMemberships: 2,
      outstandingMinor: 8_000,
      paymentsReceived: 2,
      overdueBalances: 1,
      renewalsDue: 2,
    });
    expect(dashboard.balanceAttention).toEqual([
      expect.objectContaining({
        invoiceReference: "INV-invoice-1",
        balanceMinor: 6_000,
        overdue: true,
      }),
      expect.objectContaining({
        invoiceReference: "INV-invoice-3",
        balanceMinor: 2_000,
        overdue: false,
      }),
    ]);
    expect(dashboard.upcomingRenewals.map((row) => row.planId)).toEqual([
      "bpt-jersey-adult",
      "bpt-jersey-adult",
    ]);
    expect(dashboard.recentPayments.map((row) => row.amountMinor)).toEqual([5_000, 4_000]);
    expect(isFinancialDashboard(dashboard)).toBe(true);
  });

  it("keeps lists deterministic and capped while preserving aggregate counts", () => {
    const memberships = Array.from({ length: financialDashboardListLimit + 2 }, (_, index) =>
      membership(`membership-${index}`, {
        nextBillingAt: new Date(Date.UTC(2026, 7, 25 + index)).toISOString(),
      }),
    );
    const dashboard = buildFinancialDashboard({
      generatedAt,
      memberships,
      invoices: [],
      payments: [],
    });

    expect(dashboard.metrics.renewalsDue).toBe(financialDashboardListLimit + 2);
    expect(dashboard.upcomingRenewals).toHaveLength(financialDashboardListLimit);
  });

  it("rejects duplicate or orphan source records", () => {
    const current = membership("membership-1");
    expect(() =>
      buildFinancialDashboard({
        generatedAt,
        memberships: [current, current],
        invoices: [],
        payments: [],
      }),
    ).toThrow(/duplicate/u);
    expect(() =>
      buildFinancialDashboard({
        generatedAt,
        memberships: [current],
        invoices: [],
        payments: [payment("payment-1", "missing-invoice", 100, generatedAt)],
      }),
    ).toThrow(/orphan/u);
  });

  it("strictly rejects expanded, incoherent, accessor, and prototype responses", () => {
    const dashboard = dashboardFixture();
    expect(isFinancialDashboard({ ...dashboard, studentIds: ["private-student"] })).toBe(false);
    expect(
      isFinancialDashboard({
        ...dashboard,
        metrics: { ...dashboard.metrics, outstandingMinor: 1 },
      }),
    ).toBe(false);
    expect(
      isFinancialDashboard({
        ...dashboard,
        upcomingRenewals: [{ ...dashboard.upcomingRenewals[0], planId: "unapproved-plan" }],
      }),
    ).toBe(false);
    expect(
      isFinancialDashboard({
        ...dashboard,
        metrics: { ...dashboard.metrics, outstandingMinor: Number.MAX_SAFE_INTEGER },
        balanceAttention: [
          { ...dashboard.balanceAttention[0], balanceMinor: Number.MAX_SAFE_INTEGER },
          { ...dashboard.balanceAttention[1], balanceMinor: Number.MAX_SAFE_INTEGER },
        ],
      }),
    ).toBe(false);
    expect(isFinancialDashboard(Object.assign(Object.create(null), dashboard))).toBe(false);
    expect(
      isFinancialDashboard(
        Object.defineProperty({ ...dashboard }, "generatedAt", {
          enumerable: true,
          get: () => generatedAt,
        }),
      ),
    ).toBe(false);
  });

  it("returns an immutable least-data projection", () => {
    const dashboard = dashboardFixture();
    expect(Object.isFrozen(dashboard)).toBe(true);
    expect(Object.isFrozen(dashboard.metrics)).toBe(true);
    expect(Object.isFrozen(dashboard.balanceAttention)).toBe(true);
    expect(JSON.stringify(dashboard)).not.toMatch(
      /familyId|studentId|membershipId|description|manualReference|providerReference|createdBy|updatedBy|card|cvv|cvc/u,
    );
  });
});
