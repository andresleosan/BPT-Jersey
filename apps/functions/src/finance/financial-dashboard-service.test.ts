import { describe, expect, it, vi } from "vitest";
import type { InvoiceRecord, ManualPaymentRecord } from "@bpt-jersey/domain/finance";
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
  };
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
  };
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
  };
}

describe("financial dashboard Firestore store", () => {
  it("reads capped canonical sources and returns the least-data projection", async () => {
    const current = firestore(validFixtures());
    const store = createFirestoreFinancialDashboardStore({
      firestore: current.firestore,
      now: () => now,
    });

    const dashboard = await store.getFinancialDashboard(academyId);

    expect(current.collection).toHaveBeenCalledTimes(3);
    expect(current.limit).toHaveBeenCalledTimes(3);
    expect(
      current.limit.mock.calls.every((call) => call[1] === financialDashboardSourceLimit + 1),
    ).toBe(true);
    expect(dashboard.metrics).toMatchObject({
      collectedMinor: 4_000,
      outstandingMinor: 6_000,
      overdueBalances: 1,
      renewalsDue: 1,
    });
    expect(JSON.stringify(dashboard)).not.toMatch(/family-1|student-1|membership-1|PAY-001/u);
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
