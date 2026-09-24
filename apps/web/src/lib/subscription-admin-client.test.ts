import { expect, it, vi } from "vitest";
const callable = vi.hoisted(() => vi.fn());
vi.mock("firebase/functions", () => ({ httpsCallable: () => callable }));
vi.mock("./firebase-client", () => ({ getFirebaseFunctions: () => ({}) }));
import { getMemberSubscriptionBilling, getMemberSubscriptions } from "./subscription-admin-client";
it("rejects a valid response for the wrong student", async () => {
  callable.mockResolvedValue({
    data: { studentId: "sibling", fullName: "Fixture", eligiblePlanIds: [], memberships: [] },
  });
  await expect(getMemberSubscriptions("student-1")).rejects.toThrow(
    "Unable to load membership history. Please try again.",
  );
});

const billing = (payment: Record<string, unknown>) => [
  {
    membershipId: "m",
    complimentary: false,
    currentInvoiceId: "i",
    reason: null,
    invoices: [
      {
        invoiceId: "i",
        status: "paid",
        totalMinor: 5000,
        dueAt: "2026-09-01T00:00:00.000Z",
        paidAt: null,
        description: "Monthly fee",
        payments: [
          {
            paymentId: "p",
            amountMinor: 5000,
            method: "cash",
            reference: "CASH-1",
            occurredAt: "2026-09-01T00:00:00.000Z",
            ...payment,
          },
        ],
      },
    ],
  },
];

it("reads a payment's edit trail and defaults it for a backend that does not send one yet", async () => {
  const entry = {
    editedAt: "2026-09-25T13:05:00.000Z",
    editedBy: "owner-1",
    editedByName: "Ana Office",
    reason: "Cash was miscounted at the desk",
    previousValues: { amountMinor: 6000 },
  };
  callable.mockResolvedValueOnce({
    data: billing({
      invoiceId: "i",
      lastEdit: { editedAt: entry.editedAt, editedByName: "Ana Office", reason: entry.reason },
      auditHistory: [entry],
    }),
  });
  const [edited] = await getMemberSubscriptionBilling("student-1");
  expect(edited!.invoices[0]!.payments[0]).toMatchObject({ auditHistory: [entry] });
  callable.mockResolvedValueOnce({ data: billing({}) });
  const [legacy] = await getMemberSubscriptionBilling("student-1");
  expect(legacy!.invoices[0]!.payments[0]).toMatchObject({ lastEdit: null, auditHistory: [] });
});

it("refuses a payment listed under an invoice it does not belong to", async () => {
  callable.mockResolvedValue({ data: billing({ invoiceId: "other" }) });
  await expect(getMemberSubscriptionBilling("student-1")).rejects.toThrow(
    "Unable to complete this request. Please try again.",
  );
});

