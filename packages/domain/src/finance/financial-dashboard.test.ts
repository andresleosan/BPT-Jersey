import { describe, expect, it } from "vitest";
import type { InvoiceRecord, ManualPaymentRecord, VoidedPaymentRecord } from "./finance-contracts";
import type { MembershipRecord } from "../memberships/membership-contracts";
import {
  buildFinancialDashboard,
  currentFinancialMonth,
  financialDashboardSchema,
  shiftFinancialMonth,
  type FinancialDashboardSource,
} from "./financial-dashboard";

const academyId = "academy-a";
const now = "2026-10-15T12:00:00.000Z";
const audit = {
  createdAt: "2026-09-01T00:00:00.000Z",
  createdBy: "owner-1",
  updatedAt: "2026-09-01T00:00:00.000Z",
  updatedBy: "owner-1",
};

function membership(overrides: Partial<MembershipRecord> = {}): MembershipRecord {
  return {
    membershipId: "m-1",
    academyId,
    familyId: "fam-1",
    studentId: "stu-1",
    planId: "bpt-jersey-adult",
    status: "active",
    startsAt: "2026-01-01T00:00:00.000Z",
    endsAt: null,
    nextBillingAt: "2026-10-20T00:00:00.000Z",
    schemaVersion: "1",
    ...audit,
    ...overrides,
  } as MembershipRecord;
}
function invoice(overrides: Partial<InvoiceRecord> = {}): InvoiceRecord {
  return {
    invoiceId: "inv-1",
    academyId,
    familyId: "fam-1",
    membershipId: "m-1",
    status: "paid",
    totalMinor: 9500,
    currency: "GBP",
    dueAt: "2026-10-01T00:00:00.000Z",
    paidAt: "2026-10-02T00:00:00.000Z",
    schemaVersion: 1,
    chargeKind: "membership",
    sourceRef: null,
    invoiceReference: "INV-1",
    description: "Monthly membership",
    ...audit,
    ...overrides,
  } as InvoiceRecord;
}
function payment(overrides: Partial<ManualPaymentRecord> = {}): ManualPaymentRecord {
  return {
    paymentId: "pay-1",
    academyId,
    familyId: "fam-1",
    invoiceId: "inv-1",
    status: "recorded",
    amountMinor: 9500,
    currency: "GBP",
    method: "bank_transfer",
    manualReference: "REF-1",
    providerReference: null,
    occurredAt: "2026-10-02T00:00:00.000Z",
    schemaVersion: 1,
    ...audit,
    ...overrides,
  } as ManualPaymentRecord;
}
function source(overrides: Partial<FinancialDashboardSource> = {}): FinancialDashboardSource {
  return {
    generatedAt: now,
    month: "2026-10",
    memberships: [membership()],
    invoices: [invoice()],
    payments: [payment()],
    voidedPayments: [],
    shopPayments: [],
    studentByInvoiceId: new Map(),
    planNames: new Map([["bpt-jersey-adult", "Adult unlimited"]]),
    ...overrides,
  };
}

describe("month helpers", () => {
  it("reads and shifts UTC months", () => {
    expect(currentFinancialMonth(now)).toBe("2026-10");
    expect(shiftFinancialMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftFinancialMonth("2026-12", 1)).toBe("2027-01");
  });
});

describe("buildFinancialDashboard", () => {
  it("lists the month's payments with member, source and edit/void flags", () => {
    const dashboard = buildFinancialDashboard(source());
    expect(financialDashboardSchema.safeParse(dashboard).success).toBe(true);
    expect(dashboard.metrics.collectedMinor).toBe(9500);
    expect(dashboard.metrics.paymentsReceived).toBe(1);
    expect(dashboard.payments).toEqual([
      expect.objectContaining({
        rowId: "payment:pay-1",
        source: "membership",
        studentId: "stu-1",
        label: "Monthly membership",
        paymentId: "pay-1",
        invoiceId: "inv-1",
        shopOrderId: null,
        reference: "REF-1",
        editable: true,
        voidable: true,
        voided: null,
      }),
    ]);
  });

  it("filters by the requested month only", () => {
    const dashboard = buildFinancialDashboard(source({ month: "2026-09" }));
    expect(dashboard.metrics.collectedMinor).toBe(0);
    expect(dashboard.payments).toEqual([]);
  });

  it("empty month: zero metrics, empty lists, still schema-valid", () => {
    const dashboard = buildFinancialDashboard(
      source({ month: "2025-01", memberships: [], invoices: [], payments: [] }),
    );
    expect(dashboard.metrics).toMatchObject({
      collectedMinor: 0,
      paymentsReceived: 0,
      outstandingMinor: 0,
    });
    expect(financialDashboardSchema.safeParse(dashboard).success).toBe(true);
  });

  it("refuses a month after the current one", () => {
    expect(() => buildFinancialDashboard(source({ month: "2026-11" }))).toThrow(RangeError);
  });

  it("shows a voided payment struck out and never sums it", () => {
    const voided: VoidedPaymentRecord = {
      payment: payment(),
      voidedAt: "2026-10-03T00:00:00.000Z",
      voidedBy: "owner-1",
      voidedByName: "Owner",
      reason: "Recorded twice by mistake",
      requestId: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
    };
    const dashboard = buildFinancialDashboard(
      source({
        invoices: [invoice({ status: "open", paidAt: null })],
        payments: [],
        voidedPayments: [voided],
      }),
    );
    expect(dashboard.metrics.collectedMinor).toBe(0);
    expect(dashboard.metrics.paymentsReceived).toBe(0);
    expect(dashboard.payments[0]).toMatchObject({
      rowId: "voided:pay-1",
      editable: false,
      voidable: false,
      voided: {
        voidedAt: "2026-10-03T00:00:00.000Z",
        voidedByName: "Owner",
        reason: "Recorded twice by mistake",
      },
    });
    expect(dashboard.balances).toEqual([
      expect.objectContaining({ invoiceId: "inv-1", balanceMinor: 9500, studentId: "stu-1" }),
    ]);
  });

  it("counts a paid shop order on its paidAt month", () => {
    const dashboard = buildFinancialDashboard(
      source({
        shopPayments: [
          {
            orderId: "order-1",
            orderNumber: 7,
            contactName: "Ana Coelho",
            totalMinor: 3500,
            paidAt: "2026-10-05T10:00:00.000Z",
            paymentMethod: "at_collection",
          },
        ],
      }),
    );
    expect(dashboard.metrics.collectedMinor).toBe(13000);
    expect(dashboard.payments[0]).toMatchObject({
      rowId: "shop:order-1",
      source: "shop",
      label: "SHOP-000007 · Ana Coelho",
      method: "at_collection",
      shopOrderId: "order-1",
      paymentId: null,
      editable: false,
      voidable: false,
    });
  });

  it("flags PAYG as neither editable nor voidable and private lessons as editable only", () => {
    const dashboard = buildFinancialDashboard(
      source({
        memberships: [],
        invoices: [
          invoice({
            invoiceId: "inv-p",
            membershipId: null,
            chargeKind: "payg_session",
            sourceRef: "s-1",
            totalMinor: 1000,
          }),
          invoice({
            invoiceId: "inv-l",
            membershipId: null,
            chargeKind: "private-lesson",
            sourceRef: "p-1",
            totalMinor: 6500,
          }),
        ],
        payments: [
          payment({ paymentId: "pay-p", invoiceId: "inv-p", amountMinor: 1000, method: "cash" }),
          payment({ paymentId: "pay-l", invoiceId: "inv-l", amountMinor: 6500 }),
        ],
        studentByInvoiceId: new Map([["inv-l", "stu-9"]]),
      }),
    );
    const byId = new Map(dashboard.payments.map((row) => [row.paymentId, row]));
    expect(byId.get("pay-p")).toMatchObject({
      source: "payg",
      editable: false,
      voidable: false,
      studentId: null,
    });
    expect(byId.get("pay-l")).toMatchObject({
      source: "private_lesson",
      editable: true,
      voidable: false,
      studentId: "stu-9",
    });
  });

  it("splits renewals into overdue and due soon, with plan names", () => {
    const dashboard = buildFinancialDashboard(
      source({
        memberships: [
          membership({ membershipId: "m-1", nextBillingAt: "2026-10-20T00:00:00.000Z" }),
          membership({
            membershipId: "m-2",
            studentId: "stu-2",
            nextBillingAt: "2026-10-01T00:00:00.000Z",
          }),
          membership({
            membershipId: "m-3",
            studentId: "stu-3",
            status: "overdue",
            nextBillingAt: null,
          }),
          membership({ membershipId: "m-4", studentId: "stu-4", nextBillingAt: null }),
          membership({
            membershipId: "m-5",
            studentId: "stu-5",
            nextBillingAt: "2026-12-30T00:00:00.000Z",
          }),
        ],
        invoices: [],
        payments: [],
      }),
    );
    expect(dashboard.renewals.dueSoon.map((row) => row.membershipId)).toEqual(["m-1"]);
    expect(dashboard.renewals.overdue.map((row) => row.membershipId)).toEqual(["m-3", "m-2"]);
    expect(dashboard.renewals.dueSoon[0]).toMatchObject({
      planName: "Adult unlimited",
      studentId: "stu-1",
    });
    expect(dashboard.metrics).toMatchObject({ renewalsDue: 1, renewalsOverdue: 2 });
  });

  it("keeps every balance row (no cap of 10)", () => {
    const invoices = Array.from({ length: 12 }, (_, index) =>
      invoice({
        invoiceId: `inv-${index}`,
        invoiceReference: `INV-${index}`,
        status: "open",
        paidAt: null,
      }),
    );
    const dashboard = buildFinancialDashboard(source({ invoices, payments: [] }));
    expect(dashboard.balances).toHaveLength(12);
    expect(dashboard.metrics.outstandingMinor).toBe(12 * 9500);
  });

  it("accepts an offset without a colon, as the record parsers do", () => {
    const dashboard = buildFinancialDashboard(
      source({
        invoices: [invoice({ status: "open", paidAt: null, dueAt: "2026-10-01T10:00:00+0100" })],
        payments: [],
      }),
    );
    expect(dashboard.balances[0]?.dueAt).toBe("2026-10-01T10:00:00+0100");
    expect(financialDashboardSchema.safeParse(dashboard).success).toBe(true);
  });

  it("still refuses an orphan payment", () => {
    expect(() => buildFinancialDashboard(source({ invoices: [] }))).toThrow(/orphan/u);
  });
});
