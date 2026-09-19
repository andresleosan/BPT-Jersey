import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
const client = vi.hoisted(() => ({ getMemberSubscriptionBilling: vi.fn() }));
vi.mock("../../../../lib/subscription-admin-client", () => client);
import { PaymentsTab } from "./payments-tab";
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
it("shows a safe failure then a successful empty membership-linked account on retry", async () => {
  client.getMemberSubscriptionBilling
    .mockRejectedValueOnce(new Error("private"))
    .mockResolvedValueOnce([]);
  render(<PaymentsTab onUnavailable={vi.fn()} studentId="student-1" />);
  expect((await screen.findByRole("alert")).textContent).toBe(
    "Unable to load recorded invoices and payments. Refresh to try again.",
  );
  expect(screen.queryByText(/No invoices/)).toBeNull();
  await userEvent.setup().click(screen.getByRole("button", { name: "Refresh" }));
  expect((await screen.findByText(/No invoices or payments recorded/)).textContent).toBe(
    "No invoices or payments recorded for this member's memberships.",
  );
  expect(screen.queryByRole("alert")).toBeNull();
  expect(client.getMemberSubscriptionBilling.mock.calls).toEqual([["student-1"], ["student-1"]]);
});
it("distinguishes invoice states, receipt amounts and complimentary access without inventing payment", async () => {
  client.getMemberSubscriptionBilling.mockResolvedValue([
    {
      membershipId: "m",
      complimentary: true,
      currentInvoiceId: null,
      reason: "Scholarship",
      invoices: ["open", "partially_paid", "paid", "void"].map((status) => ({
        invoiceId: status,
        status,
        totalMinor: 6000,
        dueAt: "2026-09-01T23:30:00.000Z",
        paidAt: null,
        description: `Period ${status}`,
        payments:
          status === "partially_paid"
            ? [
                {
                  paymentId: "p1",
                  amountMinor: 1000,
                  method: "cash",
                  reference: "CASH-1",
                  occurredAt: "2026-09-02T00:00:00.000Z",
                },
                {
                  paymentId: "p2",
                  amountMinor: 2000,
                  method: "bank_transfer",
                  reference: "BANK-2",
                  occurredAt: "2026-09-03T00:00:00.000Z",
                },
              ]
            : [],
      })),
    },
  ]);
  render(<PaymentsTab onUnavailable={vi.fn()} studentId="student-1" />);
  expect((await screen.findByText(/Complimentary access/)).textContent).toContain("not a payment");
  for (const state of ["Unpaid", "Partly paid", "Paid", "Void"])
    expect(screen.getByText(`${state} · £60.00`).textContent).toBe(`${state} · £60.00`);
  expect(screen.getAllByText("Due 02/09/2026")).toHaveLength(4);
  expect(screen.getByText(/£10.00 received/).textContent).toContain("Cash");
  expect(screen.getByText(/£20.00 received/).textContent).toContain("Bank transfer");
  expect(screen.getByText("Reference: BANK-2").textContent).toBe("Reference: BANK-2");
});
