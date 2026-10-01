import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildFinancialDashboard } from "@bpt-jersey/domain/finance/dashboard";

const api = vi.hoisted(() => ({
  httpsCallable: vi.fn(),
  invoke: vi.fn(),
}));

vi.mock("firebase/functions", () => ({ httpsCallable: api.httpsCallable }));
vi.mock("./firebase-client", () => ({ getFirebaseFunctions: () => ({}) }));

import { getFinancialDashboard, getFamilyFinancialAccount } from "./finance-client";

const dashboard = buildFinancialDashboard({
  generatedAt: "2026-09-24T12:00:00.000Z",
  month: "2026-09",
  memberships: [],
  invoices: [],
  payments: [],
  voidedPayments: [],
  shopPayments: [],
  studentByInvoiceId: new Map(),
  planNames: new Map(),
});

describe("finance client", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.httpsCallable.mockReturnValue(api.invoke);
    api.invoke.mockResolvedValue({ data: { dashboard } });
  });

  it("calls the exact no-payload financial dashboard contract", async () => {
    await expect(getFinancialDashboard()).resolves.toEqual(dashboard);
    expect(api.httpsCallable).toHaveBeenCalledWith({}, "getFinancialDashboard", undefined);
    expect(api.invoke).toHaveBeenCalledWith(null);
  });

  it("asks for a chosen month", async () => {
    await expect(getFinancialDashboard("2026-09")).resolves.toEqual(dashboard);
    expect(api.invoke).toHaveBeenCalledWith({ month: "2026-09" });
  });

  it("rejects expanded, incoherent, and failed responses with one safe error", async () => {
    for (const response of [
      { ...dashboard, familyIds: ["family-private"] },
      { ...dashboard, metrics: { ...dashboard.metrics, outstandingMinor: -1 } },
      { ...dashboard, month: "September" },
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
