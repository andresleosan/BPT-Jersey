import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildFinancialDashboard } from "@bpt-jersey/domain/finance/dashboard";

const api = vi.hoisted(() => ({
  httpsCallable: vi.fn(),
  invoke: vi.fn(),
}));

vi.mock("firebase/functions", () => ({ httpsCallable: api.httpsCallable }));
vi.mock("./firebase-client", () => ({ getFirebaseFunctions: () => ({}) }));

import { getFinancialDashboard } from "./finance-client";

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
