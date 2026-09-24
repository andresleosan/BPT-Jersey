import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
const client = vi.hoisted(() => ({ getMemberSubscriptionBilling: vi.fn() }));
vi.mock("../../../../lib/subscription-admin-client", () => client);
const billingClient = vi.hoisted(() => ({
  recordManualPayment: vi.fn(),
  editManualPayment: vi.fn(),
}));
vi.mock("../../../../lib/billing-client", () => billingClient);
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

const firstEdit = {
  editedAt: "2026-09-20T09:00:00.000Z",
  editedBy: "owner-1",
  editedByName: "Ben Desk",
  reason: "Wrong amount typed at the desk",
  previousValues: { amountMinor: 6000 },
};
const lastEdit = {
  editedAt: "2026-09-25T13:05:00.000Z",
  editedBy: "owner-1",
  editedByName: "Ana Office",
  reason: "Paid by transfer, not cash",
  previousValues: { method: "cash" },
};
function account(options: { edited?: boolean; open?: boolean } = {}) {
  return [
    {
      membershipId: "m",
      complimentary: false,
      currentInvoiceId: "invoice-1",
      reason: null,
      invoices: [
        {
          invoiceId: "invoice-1",
          invoiceReference: "SUB-SEPT",
          status: options.open === false ? "paid" : "partially_paid",
          totalMinor: 6000,
          balanceMinor: options.open === false ? 0 : 3000,
          dueAt: "2026-09-01T09:00:00.000Z",
          paidAt: null,
          description: "September training",
          payments: [
            {
              paymentId: "payment-1",
              invoiceId: "invoice-1",
              amountMinor: options.open === false ? 6000 : 3000,
              method: "bank_transfer",
              reference: "BANK-1",
              occurredAt: "2026-09-02T09:00:00.000Z",
              lastEdit: options.edited
                ? {
                    editedAt: lastEdit.editedAt,
                    editedByName: lastEdit.editedByName,
                    reason: lastEdit.reason,
                  }
                : null,
              auditHistory: options.edited ? [firstEdit, lastEdit] : [],
            },
          ],
        },
      ],
    },
  ];
}

it("records a payment against an open invoice chosen by reference and balance", async () => {
  const user = userEvent.setup();
  client.getMemberSubscriptionBilling.mockResolvedValue(account());
  billingClient.recordManualPayment.mockResolvedValue({ paymentId: "payment-2" });
  render(<PaymentsTab onUnavailable={vi.fn()} studentId="student-1" />);
  await user.click(await screen.findByRole("button", { name: "Record payment" }));
  const dialog = screen.getByRole("dialog", { name: "Record payment" });
  expect(within(dialog).getByRole("radio", { name: "SUB-SEPT · balance £30.00" })).toBeChecked();
  expect(within(dialog).getByLabelText("Payment amount (GBP)")).toHaveValue("30.00");
  await user.type(within(dialog).getByLabelText("Payment reference"), "CASH-9");
  await user.click(within(dialog).getByRole("button", { name: "Save payment" }));
  await waitFor(() => expect(billingClient.recordManualPayment).toHaveBeenCalledOnce());
  expect(billingClient.recordManualPayment.mock.calls[0]![0]).toMatchObject({
    invoiceId: "invoice-1",
    amountMinor: 3000,
    method: "cash",
    manualReference: "CASH-9",
  });
  await waitFor(() => expect(client.getMemberSubscriptionBilling).toHaveBeenCalledTimes(2));
});

it("explains that an invoice comes first when none is open", async () => {
  const user = userEvent.setup();
  client.getMemberSubscriptionBilling.mockResolvedValue(account({ open: false }));
  render(<PaymentsTab onUnavailable={vi.fn()} studentId="student-1" />);
  await user.click(await screen.findByRole("button", { name: "Record payment" }));
  const dialog = screen.getByRole("dialog", { name: "Record payment" });
  expect(within(dialog).getByText("Issue an invoice first to record a payment.")).toBeVisible();
  expect(within(dialog).queryByLabelText("Payment amount (GBP)")).toBeNull();
  expect(within(dialog).queryByRole("button", { name: "Save payment" })).toBeNull();
});

it("edits only the changed fields once a reason of ten characters is given", async () => {
  const user = userEvent.setup();
  client.getMemberSubscriptionBilling.mockResolvedValue(account());
  billingClient.editManualPayment.mockResolvedValue({ ok: true, invoiceStatus: "paid" });
  render(<PaymentsTab onUnavailable={vi.fn()} studentId="student-1" />);
  await user.click(await screen.findByRole("button", { name: "Edit payment BANK-1" }));
  const dialog = screen.getByRole("dialog", { name: "Edit payment" });
  expect(within(dialog).getByLabelText("Amount (GBP)")).toHaveValue("30.00");
  expect(within(dialog).getByLabelText("Method")).toHaveValue("bank_transfer");
  expect(within(dialog).getByLabelText("Reference")).toHaveValue("BANK-1");
  const save = within(dialog).getByRole("button", { name: "Save changes" });
  expect(save).toBeDisabled();
  await user.clear(within(dialog).getByLabelText("Amount (GBP)"));
  await user.type(within(dialog).getByLabelText("Amount (GBP)"), "60");
  await user.type(within(dialog).getByLabelText("Reason for the change"), "too short");
  expect(within(dialog).getByText("9/280")).toBeVisible();
  expect(save).toBeDisabled();
  await user.type(within(dialog).getByLabelText("Reason for the change"), "!");
  expect(within(dialog).getByText("10/280")).toBeVisible();
  expect(save).toBeEnabled();
  await user.click(save);
  await waitFor(() => expect(billingClient.editManualPayment).toHaveBeenCalledOnce());
  const sent = billingClient.editManualPayment.mock.calls[0]![0] as Record<string, unknown>;
  expect(Object.keys(sent).sort()).toEqual(["amountMinor", "paymentId", "reason", "requestId"]);
  expect(sent).toMatchObject({ paymentId: "payment-1", amountMinor: 6000, reason: "too short!" });
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Edit payment" })).toBeNull());
});

it("keeps the dialog open and shows the backend refusal in a red band", async () => {
  const user = userEvent.setup();
  client.getMemberSubscriptionBilling.mockResolvedValue(account());
  billingClient.editManualPayment.mockResolvedValue({
    ok: false,
    message: "This change would overpay the invoice",
  });
  render(<PaymentsTab onUnavailable={vi.fn()} studentId="student-1" />);
  await user.click(await screen.findByRole("button", { name: "Edit payment BANK-1" }));
  const dialog = screen.getByRole("dialog", { name: "Edit payment" });
  await user.clear(within(dialog).getByLabelText("Amount (GBP)"));
  await user.type(within(dialog).getByLabelText("Amount (GBP)"), "90");
  await user.type(
    within(dialog).getByLabelText("Reason for the change"),
    "Counted twice by mistake",
  );
  await user.click(within(dialog).getByRole("button", { name: "Save changes" }));
  const alert = await within(dialog).findByRole("alert");
  expect(alert.textContent).toBe("This change would overpay the invoice");
  expect(alert).toHaveClass("member-record-notice");
});

it("shows who last edited a payment, why, and the full edit history", async () => {
  client.getMemberSubscriptionBilling.mockResolvedValue(account({ edited: true }));
  render(<PaymentsTab onUnavailable={vi.fn()} studentId="student-1" />);
  expect((await screen.findByText(/^Edited on/)).textContent).toBe(
    "Edited on 25 Sep 2026, 14:05 by Ana Office — Reason: Paid by transfer, not cash",
  );
  const history = screen.getByText("Edit history").closest("details")!;
  const entries = within(history).getAllByRole("listitem");
  expect(entries).toHaveLength(2);
  expect(entries[0]!.textContent).toContain("Ben Desk");
  expect(entries[0]!.textContent).toContain("Wrong amount typed at the desk");
  expect(entries[0]!.textContent).toContain("£60.00");
  expect(entries[1]!.textContent).toContain("Ana Office");
});

it("offers no Edit for a receipt under a void invoice", async () => {
  const [membership] = account();
  const invoice = membership!.invoices[0]!;
  client.getMemberSubscriptionBilling.mockResolvedValue([
    {
      ...membership!,
      invoices: [
        invoice,
        {
          ...invoice,
          invoiceId: "invoice-void",
          status: "void",
          payments: [{ ...invoice.payments[0]!, paymentId: "payment-void", reference: "VOID-1" }],
        },
      ],
    },
  ]);
  render(<PaymentsTab onUnavailable={vi.fn()} studentId="student-1" />);
  expect(await screen.findByRole("button", { name: "Edit payment BANK-1" })).toBeVisible();
  expect(screen.getByText("Reference: VOID-1")).toBeVisible();
  expect(screen.queryByRole("button", { name: "Edit payment VOID-1" })).toBeNull();
});
