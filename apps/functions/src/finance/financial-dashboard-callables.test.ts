import { describe, expect, it, vi } from "vitest";
import { buildFinancialDashboard } from "@bpt-jersey/domain/finance/dashboard";
import {
  createGetFinancialDashboardHandler,
  type FinancialDashboardCallableServices,
} from "./financial-dashboard-callables";
import { FinancialDashboardStoreError } from "./financial-dashboard-service";

const dashboard = buildFinancialDashboard({
  generatedAt: "2026-08-24T12:00:00.000Z",
  month: "2026-08",
  memberships: [],
  invoices: [],
  payments: [],
  voidedPayments: [],
  shopPayments: [],
  studentByInvoiceId: new Map(),
  planNames: new Map(),
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
      expect(current.store.getFinancialDashboard).toHaveBeenCalledWith("academy-1", undefined);
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

  it("passes a requested month to the store and accepts an empty object", async () => {
    const current = services();
    const handler = createGetFinancialDashboardHandler(current);

    await expect(handler(request({ month: "2026-09" }))).resolves.toEqual({ dashboard });
    await expect(handler(request({}))).resolves.toEqual({ dashboard });
    expect(current.store.getFinancialDashboard).toHaveBeenNthCalledWith(1, "academy-1", "2026-09");
    expect(current.store.getFinancialDashboard).toHaveBeenNthCalledWith(2, "academy-1", undefined);
  });

  it("rejects a malformed month or unknown fields as invalid-argument", async () => {
    for (const data of [{ month: "Sept" }, { month: "2026-13" }, { extra: 1 }, "2026-09"]) {
      const current = services();
      await expect(
        createGetFinancialDashboardHandler(current)(request(data)),
      ).rejects.toMatchObject({ code: "invalid-argument" });
      expect(current.store.getFinancialDashboard).not.toHaveBeenCalled();
    }
  });

  it("maps a month that has not started to invalid-argument", async () => {
    const current = services({
      store: {
        getFinancialDashboard: vi.fn(async () => {
          throw new FinancialDashboardStoreError("month", "The month has not started yet");
        }),
      },
    });
    await expect(
      createGetFinancialDashboardHandler(current)(request({ month: "2026-12" })),
    ).rejects.toMatchObject({
      code: "invalid-argument",
      message: "That month has not started yet",
    });
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
