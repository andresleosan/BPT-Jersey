import { describe, expect, it, vi } from "vitest";
import { buildFinancialDashboard } from "@bpt-jersey/domain/finance/dashboard";
import {
  createGetFinancialDashboardHandler,
  type FinancialDashboardCallableServices,
} from "./financial-dashboard-callables";
import { FinancialDashboardStoreError } from "./financial-dashboard-service";

const dashboard = buildFinancialDashboard({
  generatedAt: "2026-08-24T12:00:00.000Z",
  memberships: [],
  invoices: [],
  payments: [],
});

function request(
  data: unknown,
  role = "owner",
  uid: string | null = "owner-1",
  academyId = "academy-1",
) {
  return {
    auth: uid ? { uid, token: { academyId, role } } : undefined,
    data,
  } as never;
}

function services(overrides: Partial<FinancialDashboardCallableServices> = {}) {
  return {
    store: {
      getFinancialDashboard: vi.fn(async () => dashboard),
    },
    isActorActive: vi.fn(async () => true),
    ...overrides,
  } satisfies FinancialDashboardCallableServices;
}

describe("financial dashboard callable", () => {
  it("allows active owner and administrator actors with actor-derived tenant scope", async () => {
    for (const role of ["owner", "administrator"]) {
      const current = services();
      const handler = createGetFinancialDashboardHandler(current);

      await expect(handler(request(null, role))).resolves.toEqual({ dashboard });
      expect(current.store.getFinancialDashboard).toHaveBeenCalledWith("academy-1");
      expect(current.isActorActive).toHaveBeenCalledWith(
        expect.objectContaining({ userId: "owner-1", academyId: "academy-1", role }),
      );
    }
  });

  it("rejects unauthenticated, non-financial, inactive, and expanded requests", async () => {
    for (const candidate of [
      request(null, "coach"),
      request(null, "guardian"),
      request(null, "owner", null),
      request({}),
      request({ academyId: "academy-other" }),
    ]) {
      const current = services();
      await expect(createGetFinancialDashboardHandler(current)(candidate)).rejects.toBeDefined();
      expect(current.store.getFinancialDashboard).not.toHaveBeenCalled();
    }

    const inactive = services({ isActorActive: vi.fn(async () => false) });
    await expect(createGetFinancialDashboardHandler(inactive)(request(null))).rejects.toMatchObject(
      {
        code: "permission-denied",
      },
    );
    expect(inactive.store.getFinancialDashboard).not.toHaveBeenCalled();
  });

  it("maps tenant mismatches to denial and hides invalid source details", async () => {
    const tenant = services({
      store: {
        getFinancialDashboard: vi.fn(async () => {
          throw new FinancialDashboardStoreError("tenant", "academy-private mismatch");
        }),
      },
    });
    await expect(createGetFinancialDashboardHandler(tenant)(request(null))).rejects.toMatchObject({
      code: "permission-denied",
    });

    const invalid = services({
      store: {
        getFinancialDashboard: vi.fn(async () => {
          throw new FinancialDashboardStoreError("invalid", "invoice-private-id is corrupt");
        }),
      },
    });
    await expect(createGetFinancialDashboardHandler(invalid)(request(null))).rejects.toMatchObject({
      code: "internal",
      message: "Unable to retrieve financial dashboard",
    });
  });

  it("fails safely when active-account verification is unavailable", async () => {
    const current = services({
      isActorActive: vi.fn(async () => {
        throw new Error("private auth provider detail");
      }),
    });
    await expect(createGetFinancialDashboardHandler(current)(request(null))).rejects.toMatchObject({
      code: "internal",
      message: "Unable to retrieve financial dashboard",
    });
  });
});
