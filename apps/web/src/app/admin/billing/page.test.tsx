import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  issueManualInvoice: vi.fn(),
  listFinancialAccount: vi.fn(),
  recordManualPayment: vi.fn(),
  voidManualInvoice: vi.fn(),
}));

vi.mock("../../../lib/billing-client", () => api);

import { BillingPage } from "./page";

const account = {
  balanceMinor: 7_500,
  paygDebtMinor: 1_500,
  invoices: [
    {
      balanceMinor: 7_500,
      invoice: {
        invoiceId: "invoice-1",
        academyId: "academy-1",
        familyId: "family-1",
        membershipId: "membership-1",
        status: "open",
        totalMinor: 7_500,
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
  ],
};

describe("billing page", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    api.listFinancialAccount.mockResolvedValue(account);
    api.issueManualInvoice.mockResolvedValue(account.invoices[0]!.invoice);
    api.recordManualPayment.mockResolvedValue({ paymentId: "payment-1" });
    api.voidManualInvoice.mockResolvedValue({ ...account.invoices[0]!.invoice, status: "void" });
  });

  it("operates invoice, payment and void actions against the connected account", async () => {
    render(<BillingPage />);

    expect(await screen.findByText("INV-001")).toBeVisible();
    fireEvent.change(screen.getByLabelText("Family ID"), { target: { value: "family-1" } });
    fireEvent.change(screen.getByLabelText("Membership ID"), {
      target: { value: "membership-1" },
    });
    fireEvent.change(screen.getByLabelText("Invoice amount (GBP)"), {
      target: { value: "75.00" },
    });
    fireEvent.change(screen.getByLabelText("Due at"), {
      target: { value: "2026-09-20T12:00" },
    });
    fireEvent.change(screen.getByLabelText("Invoice reference"), {
      target: { value: "INV-002" },
    });
    fireEvent.change(screen.getByLabelText("Description"), {
      target: { value: "October membership" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Issue invoice" }));
    expect(api.issueManualInvoice).toHaveBeenCalledWith(
      expect.objectContaining({ totalMinor: 7_500, invoiceReference: "INV-002" }),
    );
    expect(await screen.findByText("Invoice issued and added to the ledger.")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Record payment for INV-001" }));
    fireEvent.change(screen.getByLabelText("Payment amount (GBP)"), {
      target: { value: "75.00" },
    });
    fireEvent.change(screen.getByLabelText("Manual payment reference"), {
      target: { value: "BANK-001" },
    });
    fireEvent.change(screen.getByLabelText("Payment occurred at"), {
      target: { value: "2026-09-03T12:00" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save payment" }));
    expect(api.recordManualPayment).toHaveBeenCalledWith(
      expect.objectContaining({ invoiceId: "invoice-1", amountMinor: 7_500 }),
    );
    expect(await screen.findByText("Payment recorded in the manual ledger.")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Void INV-001" }));
    expect(api.voidManualInvoice).toHaveBeenCalledWith("invoice-1");
  });
});
