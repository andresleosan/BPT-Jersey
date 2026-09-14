import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildFinancialDashboard } from "@bpt-jersey/domain/finance/dashboard";

const api = vi.hoisted(() => ({
  httpsCallable: vi.fn(),
  invoke: vi.fn(),
}));

vi.mock("firebase/functions", () => ({ httpsCallable: api.httpsCallable }));
vi.mock("./firebase-client", () => ({ getFirebaseFunctions: () => ({}) }));

import { getFinancialDashboard, getFamilyFinancialAccount, listRecentPayments } from "./finance-client";

const dashboard = buildFinancialDashboard({
  generatedAt: "2026-08-24T12:00:00.000Z",
  memberships: [],
  invoices: [],
  payments: [],
});

describe("finance client", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.httpsCallable.mockReturnValue(api.invoke);
    api.invoke.mockResolvedValue({ data: { dashboard } });
  });

  it("calls the exact no-payload financial dashboard contract", async () => {
    await expect(getFinancialDashboard()).resolves.toEqual(dashboard);
    expect(api.httpsCallable).toHaveBeenCalledWith({}, "getFinancialDashboard");
    expect(api.invoke).toHaveBeenCalledWith(null);
  });

  it("rejects expanded, incoherent, and failed responses with one safe error", async () => {
    for (const response of [
      { ...dashboard, familyIds: ["family-private"] },
      { ...dashboard, metrics: { ...dashboard.metrics, outstandingMinor: 1 } },
      null,
    ]) {
      api.invoke.mockResolvedValueOnce({ data: { dashboard: response } });
      await expect(getFinancialDashboard()).rejects.toThrow(
        "Unable to load the financial dashboard. Please try again.",
      );
    }

    api.invoke.mockRejectedValueOnce(new Error("invoice-private-id failed"));
    await expect(getFinancialDashboard()).rejects.toThrow(
      "Unable to load the financial dashboard. Please try again.",
    );
  });
});

const validRecentPaymentRow = {
  paymentId: "p1",
  occurredAt: "2026-09-01T10:00:00.000Z",
  amountMinor: 7500,
  method: "cash",
  manualReference: "CASH-1",
  invoiceReference: "INV-1",
  description: "September",
  familyId: "f1",
  memberName: "Ana Coelho",
};

describe("listRecentPayments", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.httpsCallable.mockReturnValue(api.invoke);
  });

  it("lists recent payments and rejects a malformed row", async () => {
    api.invoke.mockResolvedValueOnce({ data: { payments: [validRecentPaymentRow] } });
    await expect(listRecentPayments()).resolves.toEqual([validRecentPaymentRow]);

    api.invoke.mockResolvedValueOnce({
      data: { payments: [{ ...validRecentPaymentRow, amountMinor: -1 }] },
    });
    await expect(listRecentPayments()).rejects.toThrow(
      "Unable to load recent payments. Please try again.",
    );
  });
});

describe("getFamilyFinancialAccount", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.httpsCallable.mockReturnValue(api.invoke);
  });

  it("reads a family account by id", async () => {
    api.invoke.mockResolvedValueOnce({
      data: { invoices: [], balanceMinor: 0, paygDebtMinor: 0, paymentInstructions: null },
    });
    await expect(getFamilyFinancialAccount("family-1")).resolves.toEqual({
      invoices: [],
      balanceMinor: 0,
      paygDebtMinor: 0,
      paymentInstructions: null,
    });
    expect(api.invoke).toHaveBeenLastCalledWith({ familyId: "family-1" });

    await expect(getFamilyFinancialAccount("bad id")).rejects.toThrow(
      "Unable to load this family's account. Please try again.",
    );
  });
});
