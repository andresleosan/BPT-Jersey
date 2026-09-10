import { describe, expect, it } from "vitest";

import { parseMembershipDraft } from "../memberships/membership-contracts";
import { planIds } from "../memberships/plan-contracts";
import {
  calculateAccountBalance,
  calculateInvoiceBalance,
  calculatePaygDebt,
  parseInvoiceRecord,
  parseManualPaymentRecord,
  type InvoiceRecord,
  type ManualPaymentRecord,
} from "./finance-contracts";

const invoiceBase: InvoiceRecord = {
  invoiceId: "invoice-1",
  academyId: "academy-1",
  familyId: "family-1",
  membershipId: "membership-1",
  status: "open",
  totalMinor: 1000,
  currency: "GBP",
  dueAt: "2026-08-19T10:00:00Z",
  paidAt: null,
  schemaVersion: 1,
  createdAt: "2026-08-19T10:00:00Z",
  createdBy: "admin-1",
  updatedAt: "2026-08-19T10:00:00Z",
  updatedBy: "admin-1",
  chargeKind: "membership",
  sourceRef: null,
  invoiceReference: "invoice-reference-1",
  description: "Manual membership invoice",
};

const paymentBase: ManualPaymentRecord = {
  paymentId: "payment-1",
  academyId: "academy-1",
  familyId: "family-1",
  invoiceId: "invoice-1",
  status: "recorded",
  amountMinor: 400,
  currency: "GBP",
  method: "cash",
  manualReference: "cash-reference-1",
  providerReference: null,
  occurredAt: "2026-08-19T11:00:00Z",
  schemaVersion: 1,
  createdAt: "2026-08-19T11:00:00Z",
  createdBy: "admin-1",
  updatedAt: "2026-08-19T11:00:00Z",
  updatedBy: "admin-1",
};

function invoice(overrides: Partial<InvoiceRecord> = {}): InvoiceRecord {
  return { ...invoiceBase, ...overrides };
}

function payment(overrides: Partial<ManualPaymentRecord> = {}): ManualPaymentRecord {
  return { ...paymentBase, ...overrides };
}

describe("finance contracts", () => {
  it("parses a valid invoice and manual payment with exact fields", () => {
    expect(parseInvoiceRecord(invoice())).toEqual({ ok: true, value: invoice() });
    expect(parseManualPaymentRecord(payment())).toEqual({ ok: true, value: payment() });
  });

  it("requires a source reference for PAYG invoices", () => {
    expect(parseInvoiceRecord(invoice({ chargeKind: "payg_session", sourceRef: null })).ok).toBe(
      false,
    );
    expect(
      parseInvoiceRecord(invoice({ chargeKind: "payg_session", sourceRef: "sessions/session-1" }))
        .ok,
    ).toBe(true);
  });

  it("rejects non-positive, fractional, non-GBP, and overdue stored values", () => {
    expect(parseInvoiceRecord(invoice({ totalMinor: 0 })).ok).toBe(false);
    expect(parseInvoiceRecord(invoice({ totalMinor: 10.5 })).ok).toBe(false);
    expect(parseInvoiceRecord(invoice({ currency: "EUR" as "GBP" })).ok).toBe(false);
    expect(parseInvoiceRecord(invoice({ status: "overdue" as InvoiceRecord["status"] })).ok).toBe(
      false,
    );
  });

  it("rejects hostile properties and provider fields", () => {
    const hostile = { ...invoiceBase, provider: "stripe" };
    Object.defineProperty(hostile, "description", {
      enumerable: true,
      get: () => {
        throw new Error("hostile getter");
      },
    });
    expect(() => parseInvoiceRecord(hostile)).not.toThrow();
    expect(parseInvoiceRecord(hostile).ok).toBe(false);
    expect(parseManualPaymentRecord({ ...paymentBase, cardNumber: "4111111111111111" }).ok).toBe(
      false,
    );
  });

  it("rejects finance fields added to membership drafts", () => {
    expect(
      parseMembershipDraft({
        familyId: "family-1",
        studentId: "student-1",
        planId: planIds[0],
        status: "trial",
        startsAt: "2026-08-19T10:00:00Z",
        endsAt: null,
        nextBillingAt: null,
        invoiceId: "invoice-1",
      }),
    ).toMatchObject({ ok: false });
  });

  it("derives invoice, account, and PAYG balances from recorded payments", () => {
    const membershipInvoice = invoice({ totalMinor: 1000 });
    const paygInvoice = invoice({
      invoiceId: "invoice-payg",
      totalMinor: 1000,
      chargeKind: "payg_session",
      sourceRef: "sessions/session-1",
    });
    const payments = [payment(), payment({ paymentId: "payment-2", invoiceId: "invoice-payg" })];

    expect(calculateInvoiceBalance(membershipInvoice, payments)).toBe(600);
    expect(calculateAccountBalance([membershipInvoice, paygInvoice], payments)).toBe(1200);
    expect(calculatePaygDebt([membershipInvoice, paygInvoice], payments)).toBe(600);
  });

  it("excludes void invoices and payments from derived balances", () => {
    const voidInvoice = invoice({ status: "void", totalMinor: 1000 });
    expect(calculateInvoiceBalance(voidInvoice, [payment()])).toBe(0);
    expect(calculateAccountBalance([voidInvoice], [payment()])).toBe(0);
    expect(calculatePaygDebt([voidInvoice], [payment()])).toBe(0);
  });
});
