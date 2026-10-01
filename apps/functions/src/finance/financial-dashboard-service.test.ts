import { describe, expect, it, vi } from "vitest";
import type {
  InvoiceRecord,
  ManualPaymentRecord,
  VoidedPaymentRecord,
} from "@bpt-jersey/domain/finance";
import type { ShopOrderRecord } from "@bpt-jersey/domain/shop";
import type { MembershipRecord } from "@bpt-jersey/domain/memberships/lifecycle";
import {
  createFirestoreFinancialDashboardStore,
  FinancialDashboardStoreError,
  financialDashboardSourceLimit,
  type FinancialDashboardFirestore,
} from "./financial-dashboard-service";

const academyId = "academy-a";
const now = "2026-08-24T12:00:00.000Z";

function membership(overrides: Partial<MembershipRecord> = {}): MembershipRecord {
  return {
    membershipId: "membership-1",
    academyId,
    familyId: "family-1",
    studentId: "student-1",
    planId: "bpt-jersey-adult",
    status: "active",
    startsAt: "2026-01-01T00:00:00.000Z",
    endsAt: null,
    nextBillingAt: "2026-08-30T00:00:00.000Z",
    schemaVersion: "1",
    createdAt: "2026-01-01T00:00:00.000Z",
    createdBy: "owner-1",
    updatedAt: "2026-08-01T00:00:00.000Z",
    updatedBy: "owner-1",
    ...overrides,
  };
}

function invoice(overrides: Partial<InvoiceRecord> = {}): InvoiceRecord {
  return {
    invoiceId: "invoice-1",
    academyId,
    familyId: "family-1",
    membershipId: "membership-1",
    status: "partially_paid",
    totalMinor: 10_000,
    currency: "GBP",
    dueAt: "2026-08-10T00:00:00.000Z",
    paidAt: null,
    schemaVersion: 1,
    createdAt: "2026-08-01T00:00:00.000Z",
    createdBy: "owner-1",
    updatedAt: "2026-08-05T00:00:00.000Z",
    updatedBy: "owner-1",
    chargeKind: "membership",
    sourceRef: null,
    invoiceReference: "INV-001",
    description: "Monthly membership",
    ...overrides,
  } as InvoiceRecord;
}

function payment(overrides: Partial<ManualPaymentRecord> = {}): ManualPaymentRecord {
  return {
    paymentId: "payment-1",
    academyId,
    familyId: "family-1",
    invoiceId: "invoice-1",
    status: "recorded",
    amountMinor: 4_000,
    currency: "GBP",
    method: "bank_transfer",
    manualReference: "PAY-001",
    providerReference: null,
    occurredAt: "2026-08-05T00:00:00.000Z",
    schemaVersion: 1,
    createdAt: "2026-08-05T00:00:00.000Z",
    createdBy: "owner-1",
    updatedAt: "2026-08-05T00:00:00.000Z",
    updatedBy: "owner-1",
    ...overrides,
  } as ManualPaymentRecord;
}

function voided(overrides: Partial<ManualPaymentRecord> = {}): VoidedPaymentRecord {
  return {
    payment: payment({ paymentId: "pay-x", amountMinor: 1_000, ...overrides }),
    voidedAt: "2026-08-20T00:00:00.000Z",
    voidedBy: "owner-1",
    voidedByName: "Owner One",
    reason: "Recorded against the wrong invoice",
    requestId: "8f0c9a52-3c1b-4b8e-9a4e-1d2c3b4a5e6f",
  };
}

function shopOrder(overrides: Partial<ShopOrderRecord> = {}): ShopOrderRecord {
  return {
    orderId: "order-1",
    orderNumber: 7,
    academyId,
    requestId: "request-1",
    customerUserId: "client-1",
    lines: [
      {
        productId: "bpt-gi",
        productName: "BPT gi",
        category: "gi",
        size: "A2",
        quantity: 1,
        unitPriceMinor: 9_500,
        lineTotalMinor: 9_500,
      },
    ],
    totalMinor: 9_500,
    currency: "GBP",
    pickupLocationId: "town",
    paymentMethod: "at_collection",
    proofId: null,
    contactName: "Sam Client",
    contactPhone: null,
    contactEmail: null,
    note: null,
    status: "collected",
    paymentStatus: "paid",
    paidAt: "2026-08-12T00:00:00.000Z",
    staffNote: null,
    schemaVersion: "2",
    createdAt: "2026-08-10T00:00:00.000Z",
    createdBy: "client-1",
    updatedAt: "2026-08-14T00:00:00.000Z",
    updatedBy: "owner-1",
    ...overrides,
  };
}

// Orders paid before 2026-10 carry no paidAt key at all.
function withoutPaidAt(order: ShopOrderRecord): Omit<ShopOrderRecord, "paidAt"> {
  const rest: Partial<ShopOrderRecord> = { ...order };
  delete rest.paidAt;
  return rest as Omit<ShopOrderRecord, "paidAt">;
}

function document(id: string, value: unknown) {
  return { id, data: () => value };
}

function firestore(fixtures: Record<string, readonly ReturnType<typeof document>[]>) {
  const limit = vi.fn((path: string, value: number) => ({
    get: async () => ({ docs: fixtures[path] ?? [] }),
    path,
    value,
  }));
  const collection = vi.fn((path: string) => ({
    limit: (value: number) => limit(path, value),
  }));
  return { firestore: { collection } as FinancialDashboardFirestore, collection, limit };
}

function validFixtures() {
  return {
    [`academies/${academyId}/memberships`]: [document("membership-1", membership())],
    [`academies/${academyId}/invoices`]: [document("invoice-1", invoice())],
    [`academies/${academyId}/payments`]: [document("payment-1", payment())],
    [`academies/${academyId}/voidedPayments`]: [],
    [`academies/${academyId}/shopOrders`]: [],
    [`academies/${academyId}/plans`]: [],
    [`academies/${academyId}/privateLessonPurchases`]: [],
  } as Record<string, readonly ReturnType<typeof document>[]>;
}

function storeFor(
  fixtures: Record<string, readonly ReturnType<typeof document>[]>,
  at: string = now,
) {
  return createFirestoreFinancialDashboardStore({
    firestore: firestore(fixtures).firestore,
    now: () => at,
  });
}

describe("financial dashboard Firestore store", () => {
  it("reads capped canonical sources and returns the least-data projection", async () => {
    const current = firestore(validFixtures());
    const store = createFirestoreFinancialDashboardStore({
      firestore: current.firestore,
      now: () => now,
    });

    const dashboard = await store.getFinancialDashboard(academyId);

    expect(current.collection).toHaveBeenCalledTimes(7);
    expect(current.limit).toHaveBeenCalledTimes(7);
    expect(
      current.limit.mock.calls.every((call) => call[1] === financialDashboardSourceLimit + 1),
    ).toBe(true);
    expect(dashboard.month).toBe("2026-08");
    expect(dashboard.metrics).toMatchObject({
      collectedMinor: 4_000,
      paymentsReceived: 1,
      outstandingMinor: 6_000,
      overdueBalances: 1,
      renewalsDue: 1,
    });
    expect(dashboard.payments).toEqual([
      expect.objectContaining({
        rowId: "payment:payment-1",
        source: "membership",
        studentId: "student-1",
        voided: null,
      }),
    ]);
    expect(JSON.stringify(dashboard)).not.toMatch(/family-1/u);
  });

  it("shows a month's payments only for that month", async () => {
    const fixtures = {
      ...validFixtures(),
      [`academies/${academyId}/payments`]: [
        document("payment-1", payment({ occurredAt: "2026-09-15T00:00:00.000Z" })),
      ],
    };
    const at = "2026-10-01T10:00:00.000Z";

    const current = await storeFor(fixtures, at).getFinancialDashboard(academyId);
    const september = await storeFor(fixtures, at).getFinancialDashboard(academyId, "2026-09");

    expect(current.month).toBe("2026-10");
    expect(current.payments).toEqual([]);
    expect(september.month).toBe("2026-09");
    expect(september.payments.map((row) => row.rowId)).toEqual(["payment:payment-1"]);
  });

  it("rejects a month that has not started yet", async () => {
    await expect(
      storeFor(validFixtures()).getFinancialDashboard(academyId, "2026-09"),
    ).rejects.toMatchObject({ name: "FinancialDashboardStoreError", code: "month" });
  });

  it("shows a stored voided payment as a voided row outside the totals", async () => {
    const dashboard = await storeFor({
      ...validFixtures(),
      [`academies/${academyId}/voidedPayments`]: [document("pay-x", voided())],
    }).getFinancialDashboard(academyId);

    expect(dashboard.metrics.collectedMinor).toBe(4_000);
    expect(dashboard.payments.find((row) => row.rowId === "voided:pay-x")).toMatchObject({
      amountMinor: 1_000,
      voidable: false,
      voided: {
        voidedByName: "Owner One",
        reason: "Recorded against the wrong invoice",
      },
    });
  });

  it("fails closed on a malformed, mismatched or cross-tenant voided payment", async () => {
    for (const [doc, code] of [
      [document("pay-x", { payment: payment(), reason: "short" }), "invalid"],
      [document("pay-other", voided()), "invalid"],
      [document("pay-x", voided({ academyId: "academy-b" })), "tenant"],
    ] as const) {
      await expect(
        storeFor({
          ...validFixtures(),
          [`academies/${academyId}/voidedPayments`]: [doc],
        }).getFinancialDashboard(academyId),
      ).rejects.toMatchObject({ code });
    }
  });

  it("counts paid, non-cancelled shop orders dated by paidAt or updatedAt", async () => {
    const dashboard = await storeFor({
      ...validFixtures(),
      [`academies/${academyId}/shopOrders`]: [
        document("order-1", shopOrder()),
        document("order-2", shopOrder({ orderId: "order-2", status: "cancelled" })),
        document("order-3", withoutPaidAt(shopOrder({ orderId: "order-3" }))),
        document("order-4", shopOrder({ orderId: "order-4", paymentStatus: "unpaid" })),
        document(
          "order-5",
          shopOrder({
            orderId: "order-5",
            lines: [
              {
                productId: "bpt-gi",
                productName: "BPT gi",
                category: "gi",
                size: "A2",
                quantity: 1,
                unitPriceMinor: 0,
                lineTotalMinor: 0,
              },
            ],
            totalMinor: 0,
          }),
        ),
      ],
    }).getFinancialDashboard(academyId);

    const shopRows = dashboard.payments.filter((row) => row.source === "shop");
    expect(shopRows.map((row) => [row.shopOrderId, row.occurredAt])).toEqual([
      ["order-3", "2026-08-14T00:00:00.000Z"],
      ["order-1", "2026-08-12T00:00:00.000Z"],
    ]);
    expect(shopRows[1]).toMatchObject({
      amountMinor: 9_500,
      method: "at_collection",
      label: "SHOP-000007 · Sam Client",
    });
    expect(dashboard.metrics.collectedMinor).toBe(4_000 + 9_500 + 9_500);
  });

  it("fails closed on a malformed, mismatched or cross-tenant shop order", async () => {
    for (const [doc, code] of [
      [document("order-1", { ...shopOrder(), totalMinor: 1 }), "invalid"],
      [document("order-other", shopOrder()), "invalid"],
      [document("order-1", shopOrder({ academyId: "academy-b" })), "tenant"],
    ] as const) {
      await expect(
        storeFor({
          ...validFixtures(),
          [`academies/${academyId}/shopOrders`]: [doc],
        }).getFinancialDashboard(academyId),
      ).rejects.toMatchObject({ code });
    }
  });

  it("names plans from plan documents and falls back to the plan id", async () => {
    const named = await storeFor({
      ...validFixtures(),
      [`academies/${academyId}/plans`]: [
        document("bpt-jersey-adult", { displayName: "Adult unlimited" }),
      ],
    }).getFinancialDashboard(academyId);
    const unnamed = await storeFor({
      ...validFixtures(),
      [`academies/${academyId}/plans`]: [document("bpt-jersey-adult", { price: 1 })],
    }).getFinancialDashboard(academyId);

    expect(named.renewals.dueSoon[0]?.planName).toBe("Adult unlimited");
    expect(unnamed.renewals.dueSoon[0]?.planName).toBe("bpt-jersey-adult");
  });

  it("maps a private lesson invoice to its student through the purchase", async () => {
    const dashboard = await storeFor({
      ...validFixtures(),
      [`academies/${academyId}/invoices`]: [
        document("invoice-1", invoice()),
        document(
          "inv-l",
          invoice({
            invoiceId: "inv-l",
            membershipId: null,
            chargeKind: "private-lesson",
            status: "open",
            invoiceReference: "INV-L",
          }),
        ),
      ],
      [`academies/${academyId}/privateLessonPurchases`]: [
        document("p-1", { invoiceId: "inv-l", studentId: "stu-9" }),
      ],
    }).getFinancialDashboard(academyId);

    expect(dashboard.balances.find((row) => row.invoiceId === "inv-l")?.studentId).toBe("stu-9");
  });

  it("fails closed on cross-tenant records and relationship mismatches", async () => {
    for (const fixtures of [
      {
        ...validFixtures(),
        [`academies/${academyId}/memberships`]: [
          document("membership-1", membership({ academyId: "academy-b" })),
        ],
      },
      {
        ...validFixtures(),
        [`academies/${academyId}/invoices`]: [
          document("invoice-1", invoice({ familyId: "family-other" })),
        ],
      },
      {
        ...validFixtures(),
        [`academies/${academyId}/payments`]: [
          document("payment-1", payment({ invoiceId: "invoice-other" })),
        ],
      },
    ]) {
      const current = firestore(fixtures);
      const store = createFirestoreFinancialDashboardStore({
        firestore: current.firestore,
        now: () => now,
      });
      await expect(store.getFinancialDashboard(academyId)).rejects.toMatchObject({
        code: "tenant",
      });
    }
  });

  it("rejects malformed identity, duplicate IDs, over-allocation, and incoherent status", async () => {
    const cases = [
      {
        ...validFixtures(),
        [`academies/${academyId}/invoices`]: [document("other-id", invoice())],
      },
      {
        ...validFixtures(),
        [`academies/${academyId}/payments`]: [
          document("payment-1", payment()),
          document("payment-1", payment()),
        ],
      },
      {
        ...validFixtures(),
        [`academies/${academyId}/payments`]: [
          document("payment-1", payment({ amountMinor: 11_000 })),
        ],
      },
      {
        ...validFixtures(),
        [`academies/${academyId}/invoices`]: [document("invoice-1", invoice({ status: "open" }))],
      },
    ];
    for (const fixtures of cases) {
      const current = firestore(fixtures);
      const store = createFirestoreFinancialDashboardStore({
        firestore: current.firestore,
        now: () => now,
      });
      await expect(store.getFinancialDashboard(academyId)).rejects.toBeInstanceOf(
        FinancialDashboardStoreError,
      );
    }
  });

  it("rejects a collection beyond the explicit source cap", async () => {
    const fixtures = validFixtures();
    fixtures[`academies/${academyId}/memberships`] = Array.from(
      { length: financialDashboardSourceLimit + 1 },
      (_, index) =>
        document(`membership-${index}`, membership({ membershipId: `membership-${index}` })),
    );
    const current = firestore(fixtures);
    const store = createFirestoreFinancialDashboardStore({
      firestore: current.firestore,
      now: () => now,
    });

    await expect(store.getFinancialDashboard(academyId)).rejects.toMatchObject({
      code: "source-limit",
    });
  });
});
