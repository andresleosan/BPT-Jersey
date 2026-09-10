import { describe, expect, it } from "vitest";

import type { ShopProductDraft } from "@bpt-jersey/domain/shop";
import {
  createShopStore,
  ShopStoreError,
  shopOrderId,
  type ShopAuditDraft,
  type ShopDocumentData,
  type ShopFirestore,
} from "./shop-service.js";

type Ref = Readonly<{ id: string; path: string }>;
type Query = Readonly<{ path: string; field: string; value: unknown; limit: number }>;

function fakeFirestore(initial: Record<string, ShopDocumentData> = {}) {
  const records = new Map(Object.entries(initial));
  const audits: ShopAuditDraft[] = [];
  let generated = 0;
  const ref = (path: string): Ref => ({ id: path.split("/").at(-1) ?? "", path });
  const firestore: ShopFirestore = {
    doc: ref,
    collection: (path) => ({
      doc: (id?: string) => ref(`${path}/${id ?? `generated-${(generated += 1)}`}`),
      where: (field, _operator, value) => ({
        limit: (limit) => ({ path, field, value, limit }),
      }),
    }),
    runTransaction: async (callback) => {
      const before = new Map(records);
      const transaction = {
        get: async (target: Ref | Query) => {
          if ("field" in target) {
            return {
              docs: [...records.entries()]
                .filter(
                  ([path, data]) =>
                    path.startsWith(`${target.path}/`) && data[target.field] === target.value,
                )
                .slice(0, target.limit)
                .map(([path, data]) => ({ ...ref(path), exists: true, data: () => data })),
            };
          }
          const data = records.get(target.path);
          return { ...target, exists: data !== undefined, data: () => data };
        },
        create: (target: Ref, data: ShopDocumentData) => {
          if (records.has(target.path)) throw new Error("already exists");
          records.set(target.path, data);
          return transaction;
        },
        set: (target: Ref, data: ShopDocumentData) => {
          records.set(target.path, data);
          return transaction;
        },
      };
      try {
        return await callback(transaction);
      } catch (error) {
        records.clear();
        for (const [path, data] of before) records.set(path, data);
        throw error;
      }
    },
  };
  const store = createShopStore({
    firestore,
    appendAudit: (transaction, reference, draft) => {
      audits.push(draft);
      transaction.create(reference, { ...draft });
    },
  });
  return { store, records, audits };
}

const now = "2026-09-04T10:00:00.000Z";
const later = "2026-09-04T11:00:00.000Z";
const base = { academyId: "academy-1", actorId: "admin-1", now } as const;

const gi: ShopProductDraft = {
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
const backpack: ShopProductDraft = {
  productId: "bpt-backpack",
  name: "BPT backpack",
  category: "backpack",
  description: null,
  priceMinor: 4500,
  currency: "GBP",
  sizes: [],
  imageUrl: null,
  stockStatus: "made-to-order",
  sortOrder: 5,
};

const orderRequest = {
  requestId: "req-1",
  productId: "bpt-gi-blue",
  size: "A2",
  quantity: 2,
  contactName: "Sam Client",
  contactPhone: null,
  note: null,
} as const;

describe("shop Firestore store", () => {
  it("creates a product, keeps creation authorship on update and audits both writes", async () => {
    const { store, audits } = fakeFirestore();
    const created = await store.saveProduct({ ...base, draft: gi });
    expect(created).toMatchObject({
      productId: "bpt-gi-blue",
      academyId: "academy-1",
      active: true,
      createdBy: "admin-1",
    });
    const updated = await store.saveProduct({
      ...base,
      actorId: "admin-2",
      now: later,
      draft: { ...gi, priceMinor: 9900 },
    });
    expect(updated).toMatchObject({
      priceMinor: 9900,
      createdAt: now,
      createdBy: "admin-1",
      updatedAt: later,
      updatedBy: "admin-2",
      active: true,
    });
    expect(audits.map((audit) => audit.action)).toEqual([
      "shop.product.saved",
      "shop.product.saved",
    ]);
    expect(audits[0]?.targetRef).toBe("academies/academy-1/shopProducts/bpt-gi-blue");
  });

  it("lists tenant products in catalog order and toggles publication", async () => {
    const { store } = fakeFirestore();
    await store.saveProduct({ ...base, draft: gi });
    await store.saveProduct({ ...base, draft: backpack });
    expect((await store.listProducts("academy-1")).map((product) => product.productId)).toEqual([
      "bpt-backpack",
      "bpt-gi-blue",
    ]);
    const hidden = await store.setProductActive({
      ...base,
      now: later,
      productId: "bpt-gi-blue",
      active: false,
    });
    expect(hidden.active).toBe(false);
    await expect(
      store.setProductActive({ ...base, productId: "missing", active: false }),
    ).rejects.toMatchObject({ code: "not-found" });
  });

  it("places an idempotent order snapshotting price and validating size and stock", async () => {
    const { store, audits } = fakeFirestore();
    await store.saveProduct({ ...base, draft: gi });
    const order = await store.placeOrder({
      ...base,
      actorId: "client-1",
      request: orderRequest,
    });
    expect(order).toMatchObject({
      orderId: shopOrderId("req-1"),
      customerUserId: "client-1",
      productName: "BPT competition gi",
      unitPriceMinor: 9500,
      totalMinor: 19000,
      status: "requested",
      paymentStatus: "unpaid",
    });
    const replay = await store.placeOrder({
      ...base,
      actorId: "client-1",
      request: orderRequest,
    });
    expect(replay).toEqual(order);
    await expect(
      store.placeOrder({ ...base, actorId: "client-2", request: orderRequest }),
    ).rejects.toMatchObject({ code: "conflict" });
    await expect(
      store.placeOrder({
        ...base,
        actorId: "client-1",
        request: { ...orderRequest, requestId: "req-2", size: "A9" },
      }),
    ).rejects.toMatchObject({ code: "precondition" });
    await store.saveProduct({ ...base, draft: { ...gi, stockStatus: "sold-out" } });
    await expect(
      store.placeOrder({
        ...base,
        actorId: "client-1",
        request: { ...orderRequest, requestId: "req-3" },
      }),
    ).rejects.toMatchObject({ code: "precondition" });
    expect(audits.filter((audit) => audit.action === "shop.order.placed")).toHaveLength(1);
  });

  it("rejects orders for unpublished products or unknown products", async () => {
    const { store } = fakeFirestore();
    await store.saveProduct({ ...base, draft: backpack });
    await store.setProductActive({ ...base, productId: "bpt-backpack", active: false });
    await expect(
      store.placeOrder({
        ...base,
        actorId: "client-1",
        request: { ...orderRequest, productId: "bpt-backpack", size: null },
      }),
    ).rejects.toMatchObject({ code: "precondition" });
    await expect(
      store.placeOrder({
        ...base,
        actorId: "client-1",
        request: { ...orderRequest, productId: "nope" },
      }),
    ).rejects.toMatchObject({ code: "not-found" });
  });

  it("lists orders per tenant and per customer, newest first", async () => {
    const { store } = fakeFirestore();
    await store.saveProduct({ ...base, draft: backpack });
    await store.placeOrder({
      ...base,
      actorId: "client-1",
      request: { ...orderRequest, requestId: "a", productId: "bpt-backpack", size: null },
    });
    await store.placeOrder({
      ...base,
      actorId: "client-2",
      now: later,
      request: { ...orderRequest, requestId: "b", productId: "bpt-backpack", size: null },
    });
    expect((await store.listOrders("academy-1")).map((order) => order.orderId)).toEqual([
      "order-b",
      "order-a",
    ]);
    expect(
      (await store.listCustomerOrders("academy-1", "client-1")).map((order) => order.orderId),
    ).toEqual(["order-a"]);
    expect(await store.listCustomerOrders("academy-1", "client-9")).toEqual([]);
  });

  it("moves orders forward through the lifecycle and blocks invalid transitions", async () => {
    const { store, audits } = fakeFirestore();
    await store.saveProduct({ ...base, draft: gi });
    await store.placeOrder({ ...base, actorId: "client-1", request: orderRequest });
    const confirmed = await store.updateOrder({
      ...base,
      now: later,
      update: { orderId: "order-req-1", status: "confirmed", staffNote: "Ordered from supplier" },
    });
    expect(confirmed).toMatchObject({
      status: "confirmed",
      staffNote: "Ordered from supplier",
      updatedBy: "admin-1",
    });
    await expect(
      store.updateOrder({ ...base, update: { orderId: "order-req-1", status: "collected" } }),
    ).rejects.toBeInstanceOf(ShopStoreError);
    const paid = await store.updateOrder({
      ...base,
      update: { orderId: "order-req-1", paymentStatus: "paid" },
    });
    expect(paid).toMatchObject({ status: "confirmed", paymentStatus: "paid" });
    await expect(
      store.updateOrder({ ...base, update: { orderId: "missing", status: "cancelled" } }),
    ).rejects.toMatchObject({ code: "not-found" });
    expect(audits.filter((audit) => audit.action === "shop.order.status.changed")).toHaveLength(2);
  });

  it("refuses records from another tenant", async () => {
    const { store } = fakeFirestore({
      "academies/academy-1/shopProducts/foreign": {
        ...gi,
        productId: "foreign",
        academyId: "academy-2",
        active: true,
        schemaVersion: "1",
        createdAt: now,
        createdBy: "x",
        updatedAt: now,
        updatedBy: "x",
      },
    });
    await expect(store.listProducts("academy-1")).resolves.toEqual([]);
    await expect(
      store.setProductActive({ ...base, productId: "foreign", active: false }),
    ).rejects.toMatchObject({ code: "tenant" });
  });
});
