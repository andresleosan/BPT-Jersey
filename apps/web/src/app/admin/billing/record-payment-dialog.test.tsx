import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { InvoiceRecord } from "@bpt-jersey/domain/finance";

import type { InvoiceView } from "../../../lib/billing-client";
import { RecordPaymentDialog } from "./record-payment-dialog";

const members = [
  { studentId: "s1", fullName: "Ana Coelho", familyId: "f1" },
  { studentId: "s2", fullName: "Zé Pinto", familyId: null },
  { studentId: "s3", fullName: "Ana Maria Costa", familyId: "f3" },
] as const;

function invoice(overrides: Partial<InvoiceRecord> = {}): InvoiceRecord {
  return {
    invoiceId: "invoice-1",
    academyId: "academy-1",
    familyId: "f1",
    membershipId: "m1",
    status: "open",
    totalMinor: 7500,
    currency: "GBP",
    dueAt: "2026-10-01T23:59:59.000Z",
    paidAt: null,
    schemaVersion: 1,
    createdAt: "2026-09-01T00:00:00.000Z",
    createdBy: "admin-1",
    updatedAt: "2026-09-01T00:00:00.000Z",
    updatedBy: "admin-1",
    chargeKind: "membership",
    sourceRef: null,
    invoiceReference: "INV-1",
    description: "Membership fee",
    ...overrides,
  };
}

const openInvoiceView: InvoiceView = {
  invoice: invoice(),
  payments: [],
  balanceMinor: 7500,
};

const paidInvoiceView: InvoiceView = {
  invoice: invoice({
    invoiceId: "invoice-2",
    invoiceReference: "INV-2",
    status: "paid",
  }),
  payments: [],
  balanceMinor: 0,
};

describe("record payment dialog", () => {
  afterEach(cleanup);

  it("records a cash payment against a preselected invoice", async () => {
    const record = vi.fn().mockResolvedValue({ paymentId: "p1" });
    const onRecorded = vi.fn();
    render(
      <RecordPaymentDialog
        invoice={openInvoiceView}
        members={null}
        onClose={vi.fn()}
        onRecorded={onRecorded}
        record={record}
      />,
    );
    expect(screen.getByLabelText("Payment amount (GBP)")).toHaveValue("75.00");
    fireEvent.click(screen.getByRole("radio", { name: "Cash" }));
    fireEvent.change(screen.getByLabelText("Payment reference"), { target: { value: "CASH-1" } });
    fireEvent.change(screen.getByLabelText("Paid on"), { target: { value: "2026-09-13T10:00" } });
    fireEvent.click(screen.getByRole("button", { name: "Save payment" }));
    await waitFor(() =>
      expect(record).toHaveBeenCalledWith(
        expect.objectContaining({
          invoiceId: "invoice-1",
          amountMinor: 7500,
          method: "cash",
          manualReference: "CASH-1",
        }),
      ),
    );
    expect(onRecorded).toHaveBeenCalledWith({ paymentId: "p1" });
  });

  it("finds the member's open invoices when none is preselected", async () => {
    const loadFamilyAccount = vi.fn().mockResolvedValue({
      invoices: [openInvoiceView, paidInvoiceView],
      balanceMinor: 7500,
      paygDebtMinor: 0,
      paymentInstructions: null,
    });
    render(
      <RecordPaymentDialog
        invoice={null}
        loadFamilyAccount={loadFamilyAccount}
        members={members}
        onClose={vi.fn()}
        onRecorded={vi.fn()}
        record={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByRole("searchbox", { name: "Find a member" }), {
      target: { value: "ana c" },
    });
    fireEvent.click(screen.getByRole("option", { name: "Ana Coelho" }));
    await waitFor(() => expect(loadFamilyAccount).toHaveBeenCalledWith("f1"));
    expect(screen.getAllByRole("radio", { name: /INV-/u })).toHaveLength(1); // paid invoice is not offered
  });
});
