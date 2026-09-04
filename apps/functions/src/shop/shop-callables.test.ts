import { describe, expect, it, vi } from "vitest";
import type { CallableRequest } from "firebase-functions/v2/https";

import type { ShopOrderRecord, ShopProductRecord } from "@bpt-jersey/domain/shop";
import {
  listManagedShopProductsHandler,
  listMyShopOrdersHandler,
  listShopCatalogHandler,
  listShopOrdersHandler,
  placeShopOrderHandler,
  saveShopProductHandler,
  setShopProductActiveHandler,
  updateShopOrderHandler,
  type ShopCallableServices,
} from "./shop-callables.js";
import { ShopStoreError } from "./shop-service.js";

const now = "2026-09-04T10:00:00.000Z";

const product: ShopProductRecord = {
  productId: "bpt-gi-blue",
  name: "BPT competition gi",
  category: "gi",
  description: null,
  priceMinor: 9500,
  currency: "GBP",
  sizes: ["A1", "A2"],
  imageUrl: null,
  stockStatus: "in-stock",
  sortOrder: 10,
  academyId: "academy-1",
  active: true,
  schemaVersion: "1",
  createdAt: now,
  createdBy: "admin-1",
  updatedAt: now,
  updatedBy: "admin-1",
};
const hiddenProduct: ShopProductRecord = { ...product, productId: "bpt-hidden", active: false };
const order: ShopOrderRecord = {
  orderId: "order-req-1",
  academyId: "academy-1",
  requestId: "req-1",
  customerUserId: "client-1",
  productId: "bpt-gi-blue",
  productName: "BPT competition gi",
  category: "gi",
  size: "A2",
  quantity: 1,
  unitPriceMinor: 9500,
  totalMinor: 9500,
  currency: "GBP",
  contactName: "Sam Client",
  contactPhone: null,
  note: null,
  status: "requested",
  paymentStatus: "unpaid",
  staffNote: null,
  schemaVersion: "1",
  createdAt: now,
  createdBy: "client-1",
  updatedAt: now,
  updatedBy: "client-1",
};

function request(
  data: unknown,
  role: string | undefined = undefined,
  uid = "actor-1",
  academyId = "academy-1",
): CallableRequest<unknown> {
  return {
    data,
    auth: role === undefined ? undefined : { uid, token: { academyId, role } },
  } as unknown as CallableRequest<unknown>;
}

function services() {
  const store = {
    listProducts: vi.fn(async () => [product, hiddenProduct]),
    saveProduct: vi.fn(async () => product),
    setProductActive: vi.fn(async () => hiddenProduct),
    placeOrder: vi.fn(async () => order),
    listOrders: vi.fn(async () => [order]),
    listCustomerOrders: vi.fn(async () => [order, { ...order, customerUserId: "other" }]),
    updateOrder: vi.fn(async () => ({ ...order, status: "confirmed" as const })),
  };
  const current: ShopCallableServices & { store: typeof store } = { store, now: () => now };
  return current;
}

const draft = {
  productId: "bpt-gi-blue",
  name: "BPT competition gi",
  category: "gi",
  description: null,
  priceMinor: 9500,
  currency: "GBP",
  sizes: ["A1", "A2"],
  imageUrl: null,
  stockStatus: "in-stock",
  sortOrder: 10,
};

describe("shop callables", () => {
  it("serves only published products to clients and administrators", async () => {
    for (const role of ["owner", "administrator", "guardian", "adultStudent"]) {
      const current = services();
      const catalog = await listShopCatalogHandler(request(null, role), current);
      expect(catalog.map((item) => item.productId)).toEqual(["bpt-gi-blue"]);
      expect(catalog[0]).not.toHaveProperty("academyId");
    }
    await expect(listShopCatalogHandler(request(null, "coach"), services())).rejects.toMatchObject({
      code: "permission-denied",
    });
    await expect(listShopCatalogHandler(request(null), services())).rejects.toMatchObject({
      code: "unauthenticated",
    });
    await expect(
      listShopCatalogHandler(request({ extra: true }, "guardian"), services()),
    ).rejects.toMatchObject({ code: "invalid-argument" });
  });

  it("restricts product administration to owner and administrator", async () => {
    const current = services();
    const managed = await listManagedShopProductsHandler(request(null, "administrator"), current);
    expect(managed.map((item) => item.productId)).toEqual(["bpt-gi-blue", "bpt-hidden"]);
    await expect(
      listManagedShopProductsHandler(request(null, "guardian"), current),
    ).rejects.toMatchObject({ code: "permission-denied" });
    await expect(
      saveShopProductHandler(request(draft, "adultStudent"), current),
    ).rejects.toMatchObject({ code: "permission-denied" });
    await expect(
      saveShopProductHandler(request({ ...draft, priceMinor: -5 }, "owner"), current),
    ).rejects.toMatchObject({ code: "invalid-argument" });
    const saved = await saveShopProductHandler(request(draft, "owner", "admin-1"), current);
    expect(saved.productId).toBe("bpt-gi-blue");
    expect(current.store.saveProduct).toHaveBeenCalledWith({
      academyId: "academy-1",
      actorId: "admin-1",
      now,
      draft,
    });
    const hidden = await setShopProductActiveHandler(
      request({ productId: "bpt-hidden", active: false }, "administrator"),
      current,
    );
    expect(hidden.active).toBe(false);
  });

  it("places orders only for client roles and validates the payload", async () => {
    const current = services();
    const payload = {
      requestId: "req-1",
      productId: "bpt-gi-blue",
      size: "A2",
      quantity: 1,
      contactName: "Sam Client",
      contactPhone: null,
      note: null,
    };
    const placed = await placeShopOrderHandler(
      request(payload, "adultStudent", "client-1"),
      current,
    );
    expect(placed).toMatchObject({ orderId: "order-req-1", status: "requested" });
    expect(placed).not.toHaveProperty("academyId");
    expect(current.store.placeOrder).toHaveBeenCalledWith({
      academyId: "academy-1",
      actorId: "client-1",
      now,
      request: payload,
    });
    await expect(
      placeShopOrderHandler(request(payload, "administrator"), current),
    ).rejects.toMatchObject({ code: "permission-denied" });
    await expect(
      placeShopOrderHandler(request({ ...payload, quantity: 99 }, "guardian"), current),
    ).rejects.toMatchObject({ code: "invalid-argument" });
  });

  it("maps store failures to callable error codes", async () => {
    const current = services();
    current.store.placeOrder.mockRejectedValueOnce(
      new ShopStoreError("precondition", "Product is sold out"),
    );
    await expect(
      placeShopOrderHandler(
        request(
          {
            requestId: "req-1",
            productId: "bpt-gi-blue",
            size: "A2",
            quantity: 1,
            contactName: "Sam Client",
            contactPhone: null,
            note: null,
          },
          "guardian",
        ),
        current,
      ),
    ).rejects.toMatchObject({ code: "failed-precondition", message: "Product is sold out" });
    current.store.updateOrder.mockRejectedValueOnce(new ShopStoreError("not-found", "missing"));
    await expect(
      updateShopOrderHandler(
        request({ orderId: "order-x", status: "confirmed" }, "owner"),
        current,
      ),
    ).rejects.toMatchObject({ code: "not-found" });
    current.store.listOrders.mockRejectedValueOnce(new Error("boom"));
    await expect(listShopOrdersHandler(request(null, "owner"), current)).rejects.toMatchObject({
      code: "internal",
    });
  });

  it("returns only the caller's own orders and lets administrators manage all orders", async () => {
    const current = services();
    const mine = await listMyShopOrdersHandler(request(null, "guardian", "client-1"), current);
    expect(mine).toHaveLength(1);
    expect(mine[0]?.customerUserId).toBe("client-1");
    expect(current.store.listCustomerOrders).toHaveBeenCalledWith("academy-1", "client-1");
    await expect(listMyShopOrdersHandler(request(null, "owner"), current)).rejects.toMatchObject({
      code: "permission-denied",
    });
    const all = await listShopOrdersHandler(request(null, "administrator"), current);
    expect(all).toHaveLength(1);
    const updated = await updateShopOrderHandler(
      request({ orderId: "order-req-1", status: "confirmed" }, "owner", "admin-1"),
      current,
    );
    expect(updated.status).toBe("confirmed");
    await expect(
      updateShopOrderHandler(request({ orderId: "order-req-1" }, "owner"), current),
    ).rejects.toMatchObject({ code: "invalid-argument" });
    await expect(
      updateShopOrderHandler(
        request({ orderId: "order-req-1", status: "ready" }, "guardian"),
        current,
      ),
    ).rejects.toMatchObject({ code: "permission-denied" });
  });
});
