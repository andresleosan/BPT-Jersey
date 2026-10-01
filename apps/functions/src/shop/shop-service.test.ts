import { describe, expect, it } from "vitest";

import type { ShopOrderRecord, ShopProductDraft } from "@bpt-jersey/domain/shop";
import {
  createShopStore,
  ShopStoreError,
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

const productRecord = (
  productId: string,
  name: string,
  overrides: Partial<ShopDocumentData> = {},
): ShopDocumentData => ({
  productId,
  academyId: "academy-1",
  name,
  category: "gi",
  description: null,
  priceMinor: 9500,
  currency: "GBP",
  sizes: [],
  imageUrl: null,
  stockStatus: "in-stock",
  sortOrder: 10,
  active: true,
  schemaVersion: "1",
  createdAt: now,
  createdBy: "admin-1",
  updatedAt: now,
  updatedBy: "admin-1",
  ...overrides,
});

function seededStore() {
  const shop = "academies/academy-1/shopProducts";
  return fakeFirestore({
    [`${shop}/bpt-gi`]: productRecord("bpt-gi", "BPT gi", { sizes: ["A1", "A2"] }),
    [`${shop}/bpt-backpack`]: productRecord("bpt-backpack", "BPT backpack", {
      category: "backpack",
      priceMinor: 5500,
      stockStatus: "made-to-order",
    }),
    [`${shop}/bpt-hidden`]: productRecord("bpt-hidden", "BPT hidden", { active: false }),
    [`${shop}/bpt-sold`]: productRecord("bpt-sold", "BPT sold", { stockStatus: "sold-out" }),
  });
}

const giLine = { productId: "bpt-gi", size: "A2", quantity: 2 };
const checkout = {
  requestId: "req-1",
  lines: [giLine, { productId: "bpt-backpack", size: null, quantity: 1 }],
  pickupLocationId: "west" as const,
  paymentMethod: "at_collection" as const,
  proofId: null,
  contactName: "Sam Client",
  contactPhone: null,
  note: null,
};

const orderV2: ShopOrderRecord = {
  orderId: "order-req-1",
  academyId: "academy-1",
  requestId: "req-1",
  customerUserId: "client-1",
  lines: [
    {
      productId: "bpt-gi",
      productName: "BPT gi",
      category: "gi",
      size: "A2",
      quantity: 1,
      unitPriceMinor: 9500,
      lineTotalMinor: 9500,
    },
    {
      productId: "bpt-backpack",
      productName: "BPT backpack",
      category: "backpack",
      size: null,
      quantity: 2,
      unitPriceMinor: 5500,
      lineTotalMinor: 11000,
    },
  ],
  totalMinor: 20500,
  currency: "GBP",
  pickupLocationId: "town",
  paymentMethod: "bank_transfer",
  proofId: "a".repeat(64),
  contactName: "Sam Client",
  contactPhone: null,
  contactEmail: "sam@example.com",
  note: null,
  status: "requested",
  paymentStatus: "unpaid",
  staffNote: null,
  schemaVersion: "2",
  createdAt: now,
  createdBy: "client-1",
  updatedAt: now,
  updatedBy: "client-1",
};

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

  it("stores a made-to-order lead time and still reads a product saved without one", async () => {
    const { store } = fakeFirestore();
    await store.saveProduct({ ...base, draft: gi });
    await store.saveProduct({
      ...base,
      draft: { ...backpack, stockStatus: "made-to-order", leadTimeWeeks: 6 },
    });
    const products = await store.listProducts("academy-1");
    expect(products.find((item) => item.productId === gi.productId)?.leadTimeWeeks).toBeUndefined();
    expect(products.find((item) => item.productId === backpack.productId)?.leadTimeWeeks).toBe(6);
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

  it("freezes names and prices from Firestore and sums the lines", async () => {
    const { store } = seededStore();
    const order = await store.placeOrder({
      contactEmail: "sam@example.com",
      academyId: "academy-1",
      actorId: "client-1",
      now,
      request: checkout,
    });
    expect(
      order.lines.map((line) => [line.productName, line.unitPriceMinor, line.lineTotalMinor]),
    ).toEqual([
      ["BPT gi", 9500, 19000],
      ["BPT backpack", 5500, 5500],
    ]);
    expect(order.totalMinor).toBe(24500);
    expect(order.pickupLocationId).toBe("west");
    expect(order.schemaVersion).toBe("2");
  });

  it("returns the stored order when the same request is retried", async () => {
    const { store, records } = seededStore();
    const first = await store.placeOrder({
      contactEmail: "sam@example.com",
      academyId: "academy-1",
      actorId: "client-1",
      now,
      request: checkout,
    });
    const second = await store.placeOrder({
      contactEmail: "sam@example.com",
      academyId: "academy-1",
      actorId: "client-1",
      now,
      request: checkout,
    });
    expect(second).toEqual(first);
    expect([...records.keys()].filter((path) => path.includes("/shopOrders/"))).toHaveLength(1);
  });

  it("keeps the buyer's email from the input on the order", async () => {
    const { store } = seededStore();
    const placed = await store.placeOrder({
      academyId: "academy-1",
      actorId: "client-1",
      now,
      contactEmail: null,
      request: checkout,
    });
    expect(placed.contactEmail).toBeNull();
    const withEmail = await store.placeOrder({
      academyId: "academy-1",
      actorId: "client-1",
      now,
      contactEmail: "sam@example.com",
      request: { ...checkout, requestId: "req-2" },
    });
    expect(withEmail.contactEmail).toBe("sam@example.com");
  });

  it.each([
    ["lines", { lines: [giLine] }],
    ["quantity", { lines: [{ ...giLine, quantity: 3 }, checkout.lines[1]!] }],
    ["size", { lines: [{ ...giLine, size: "A1" }, checkout.lines[1]!] }],
    ["line order", { lines: [checkout.lines[1]!, giLine] }],
    ["centre", { pickupLocationId: "town" as const }],
    ["payment method", { paymentMethod: "bank_transfer" as const, proofId: "b".repeat(64) }],
  ])("refuses a reused request id with a different %s", async (_label, change) => {
    const { store, records } = seededStore();
    const input = { academyId: "academy-1", actorId: "client-1", now, contactEmail: null };
    await store.placeOrder({ ...input, request: checkout });
    await expect(
      store.placeOrder({ ...input, request: { ...checkout, ...change } }),
    ).rejects.toMatchObject({ code: "conflict" });
    expect([...records.keys()].filter((path) => path.includes("/shopOrders/"))).toHaveLength(1);
  });

  it("refuses a reused request id with a different screenshot", async () => {
    const { store } = seededStore();
    const input = { academyId: "academy-1", actorId: "client-1", now, contactEmail: null };
    const transfer = {
      ...checkout,
      paymentMethod: "bank_transfer" as const,
      proofId: "a".repeat(64),
    };
    await store.placeOrder({ ...input, request: transfer });
    await expect(
      store.placeOrder({ ...input, request: { ...transfer, proofId: "c".repeat(64) } }),
    ).rejects.toMatchObject({ code: "conflict" });
  });

  it("refuses a request id used by another customer", async () => {
    const { store } = seededStore();
    await store.placeOrder({
      contactEmail: "sam@example.com",
      academyId: "academy-1",
      actorId: "client-1",
      now,
      request: checkout,
    });
    await expect(
      store.placeOrder({
        contactEmail: "sam@example.com",
        academyId: "academy-1",
        actorId: "client-2",
        now,
        request: checkout,
      }),
    ).rejects.toMatchObject({ code: "conflict" });
  });

  it.each([
    ["bpt-hidden", "is no longer available"],
    ["bpt-sold", "is no longer available"],
    ["bpt-missing", "no longer available"],
  ])("refuses %s with a message naming the problem", async (productId, message) => {
    const { store } = seededStore();
    const request = { ...checkout, lines: [{ productId, size: null, quantity: 1 }] };
    await expect(
      store.placeOrder({
        contactEmail: "sam@example.com",
        academyId: "academy-1",
        actorId: "client-1",
        now,
        request,
      }),
    ).rejects.toMatchObject({ code: "precondition", message: expect.stringContaining(message) });
  });

  it("refuses a size the product does not offer", async () => {
    const { store } = seededStore();
    const request = { ...checkout, lines: [{ productId: "bpt-gi", size: "XXL", quantity: 1 }] };
    await expect(
      store.placeOrder({
        contactEmail: "sam@example.com",
        academyId: "academy-1",
        actorId: "client-1",
        now,
        request,
      }),
    ).rejects.toMatchObject({ code: "precondition", message: "Choose a size offered for BPT gi" });
  });

  it("writes nothing when one line fails", async () => {
    const { store, records, audits } = seededStore();
    const request = {
      ...checkout,
      lines: [giLine, { productId: "bpt-sold", size: null, quantity: 1 }],
    };
    await expect(
      store.placeOrder({
        contactEmail: "sam@example.com",
        academyId: "academy-1",
        actorId: "client-1",
        now,
        request,
      }),
    ).rejects.toThrow();
    expect([...records.keys()].some((path) => path.includes("/shopOrders/"))).toBe(false);
    expect(audits).toEqual([]);
  });

  it("reads one order and reports a missing one", async () => {
    const { store } = seededStore();
    const placed = await store.placeOrder({
      contactEmail: "sam@example.com",
      academyId: "academy-1",
      actorId: "client-1",
      now,
      request: checkout,
    });
    await expect(store.getOrder("academy-1", placed.orderId)).resolves.toEqual(placed);
    await expect(store.getOrder("academy-1", "order-nope")).rejects.toMatchObject({
      code: "not-found",
    });
  });

  it("lists orders per tenant and per customer, newest first", async () => {
    const { store } = seededStore();
    await store.placeOrder({
      contactEmail: "sam@example.com",
      ...base,
      actorId: "client-1",
      request: { ...checkout, requestId: "a" },
    });
    await store.placeOrder({
      contactEmail: "sam@example.com",
      ...base,
      actorId: "client-2",
      now: later,
      request: { ...checkout, requestId: "b" },
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
    const { store, audits } = fakeFirestore({
      "academies/academy-1/shopOrders/order-req-1": orderV2,
    });
    const confirmed = await store.updateOrder({
      ...base,
      now: later,
      update: { orderId: "order-req-1", status: "confirmed", staffNote: "Ordered from supplier" },
    });
    expect(confirmed).toMatchObject({
      status: "confirmed",
      staffNote: "Ordered from supplier",
      updatedBy: "admin-1",
      lines: orderV2.lines,
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

  it("records when an order was marked paid and clears it when unpaid", async () => {
    const { store } = fakeFirestore({
      "academies/academy-1/shopOrders/order-req-1": orderV2,
    });
    const orderId = "order-req-1";
    const third = "2026-09-04T12:00:00.000Z";
    const paid = await store.updateOrder({
      ...base,
      update: { orderId, paymentStatus: "paid" },
    });
    expect(paid.paidAt).toBe(now);
    const statusOnly = await store.updateOrder({
      ...base,
      now: later,
      update: { orderId, status: "confirmed" },
    });
    expect(statusOnly.paidAt).toBe(now);
    const unpaid = await store.updateOrder({
      ...base,
      now: later,
      update: { orderId, paymentStatus: "unpaid" },
    });
    expect(unpaid.paidAt).toBeNull();
    const repaid = await store.updateOrder({
      ...base,
      now: third,
      update: { orderId, paymentStatus: "paid" },
    });
    expect(repaid.paidAt).toBe(third);
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
