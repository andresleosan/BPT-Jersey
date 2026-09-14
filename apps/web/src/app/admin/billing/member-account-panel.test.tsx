import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { FinancialAccount, InvoiceView } from "../../../lib/billing-client";
import { MemberAccountPanel } from "./member-account-panel";

const member = { studentId: "s1", fullName: "Ana Coelho", familyId: "f1" };

const invoiceOpen: InvoiceView = {
  balanceMinor: 5_000,
  invoice: {
    invoiceId: "invoice-1",
    academyId: "academy-1",
    familyId: "f1",
    membershipId: "membership-1",
    status: "open" as const,
    totalMinor: 5_000,
    currency: "GBP" as const,
    dueAt: "2026-09-20T12:00:00.000Z",
    paidAt: null,
    schemaVersion: 1,
    createdAt: "2026-09-03T12:00:00.000Z",
    createdBy: "owner-1",
    updatedAt: "2026-09-03T12:00:00.000Z",
    updatedBy: "owner-1",
    chargeKind: "membership" as const,
    sourceRef: null,
    invoiceReference: "INV-001",
    description: "September membership",
  },
  payments: [],
};

const invoicePaid: InvoiceView = {
  balanceMinor: 0,
  invoice: {
    ...invoiceOpen.invoice,
    invoiceId: "invoice-2",
    invoiceReference: "INV-002",
    status: "paid",
    totalMinor: 3_000,
  },
  payments: [
    {
      paymentId: "payment-1",
      academyId: "academy-1",
      invoiceId: "invoice-2",
      familyId: "f1",
      status: "recorded" as const,
      amountMinor: 3_000,
      currency: "GBP" as const,
      method: "cash" as const,
      manualReference: "CASH-1",
      providerReference: null,
      occurredAt: "2026-09-05T09:00:00.000Z",
      schemaVersion: 1 as const,
      createdAt: "2026-09-05T09:00:00.000Z",
      createdBy: "owner-1",
      updatedAt: "2026-09-05T09:00:00.000Z",
      updatedBy: "owner-1",
    },
  ],
};

const account = {
  invoices: [invoiceOpen, invoicePaid],
  balanceMinor: 5_000,
  paygDebtMinor: 0,
  paymentInstructions: null,
} satisfies FinancialAccount;

describe("MemberAccountPanel", () => {
  afterEach(() => cleanup());

  it("renders the member's balance, payments and invoices", () => {
    render(
      <MemberAccountPanel
        account={account}
        busy={false}
        member={member}
        onRecordPayment={vi.fn()}
        onVoid={vi.fn()}
        status="ready"
      />,
    );
    const panel = screen.getByRole("region", { name: "Ana Coelho's account" });
    expect(within(panel).getByText("Balance £50.00")).toBeInTheDocument();
    const paymentsTable = within(panel).getByRole("table", { name: "All payments" });
    expect(within(paymentsTable).getByText("INV-002")).toBeInTheDocument();
    expect(within(paymentsTable).getByText("Cash")).toBeInTheDocument();
    const invoicesTable = within(panel).getByRole("table", { name: "Invoices" });
    expect(within(invoicesTable).getByText("INV-001")).toBeInTheDocument();
    expect(within(invoicesTable).getByText("INV-002")).toBeInTheDocument();
  });

  it("calls onRecordPayment and onVoid from the invoice row actions", () => {
    const onRecordPayment = vi.fn();
    const onVoid = vi.fn();
    render(
      <MemberAccountPanel
        account={account}
        busy={false}
        member={member}
        onRecordPayment={onRecordPayment}
        onVoid={onVoid}
        status="ready"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Record payment for INV-001" }));
    expect(onRecordPayment).toHaveBeenCalledWith(invoiceOpen);
    fireEvent.click(screen.getByRole("button", { name: "Void INV-001" }));
    expect(onVoid).toHaveBeenCalledWith(invoiceOpen);
  });

  it("shows a family-scoped error and a no-billing-family notice", () => {
    const { rerender } = render(
      <MemberAccountPanel
        account={undefined}
        busy={false}
        member={member}
        onRecordPayment={vi.fn()}
        onVoid={vi.fn()}
        status="error"
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Unable to load this family's account. Please try again.",
    );
    rerender(
      <MemberAccountPanel
        account={undefined}
        busy={false}
        member={{ ...member, familyId: null }}
        onRecordPayment={vi.fn()}
        onVoid={vi.fn()}
        status="ready"
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "This member has no billing family yet, so there is no account to show.",
    );
  });
});
