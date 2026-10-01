import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { CallableRequest } from "firebase-functions/v2/https";

import type { ShopOrderRecord, ShopProductRecord } from "@bpt-jersey/domain/shop";
import {
  getShopOrderProofUrlHandler,
  listManagedShopProductsHandler,
  listMyShopOrdersHandler,
  listPublicShopCatalogHandler,
  listShopCatalogHandler,
  listShopOrdersHandler,
  placeShopOrderHandler,
  saveShopProductHandler,
  setShopProductActiveHandler,
  updateShopOrderHandler,
  uploadShopOrderProofHandler,
  type ShopCallableServices,
} from "./shop-callables.js";
import { shopProofKey } from "./shop-proof.js";
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

const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.from("pixels")]);
const pngProofId = createHash("sha256").update(png).digest("hex");

function fakeStorage() {
  const objects = new Map<string, Uint8Array>();
  return {
    objects,
    putObject: vi.fn(async (key: string, body: Uint8Array) => void objects.set(key, body)),
    readObject: vi.fn(async (key: string) => {
      const value = objects.get(key);
      if (!value) throw new Error("missing");
      return value;
    }),
    createPrivateImageUrl: vi.fn(
      async ({ objectKey }: { objectKey: string }) => `https://signed.test/${objectKey}`,
    ),
  };
}

const collectionCheckout = {
  requestId: "req-1",
  lines: [{ productId: "bpt-gi-blue", size: "A2", quantity: 1 }],
  pickupLocationId: "town",
  paymentMethod: "at_collection",
  proofId: null,
  contactName: "Sam Client",
  contactPhone: null,
  note: null,
};
const transferCheckout = {
  ...collectionCheckout,
  requestId: "req-2",
  paymentMethod: "bank_transfer",
};

function services() {
  const store = {
    listProducts: vi.fn(async () => [product, hiddenProduct]),
    saveProduct: vi.fn(async () => product),
    setProductActive: vi.fn(async () => hiddenProduct),
    placeOrder: vi.fn(async () => order),
    listOrders: vi.fn(async () => [order]),
    listCustomerOrders: vi.fn(async () => [order, { ...order, customerUserId: "other" }]),
    updateOrder: vi.fn(async () => ({ ...order, status: "confirmed" as const })),
    getOrder: vi.fn().mockResolvedValue(order),
  };
  const storage = fakeStorage();
  const current: ShopCallableServices & { store: typeof store } = {
    store,
    storage: () => storage,
    now: () => now,
  };
  return { services: current, store, storage };
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
  it("serves only published products to signed-in accounts", async () => {
    for (const role of ["owner", "administrator", "guardian", "adultStudent", "shopper"]) {
      const { services: current } = services();
      const catalog = await listShopCatalogHandler(request(null, role), current);
      expect(catalog.map((item) => item.productId)).toEqual(["bpt-gi-blue"]);
      expect(catalog[0]).not.toHaveProperty("academyId");
    }
    await expect(listShopCatalogHandler(request(null), services().services)).rejects.toMatchObject({
      code: "unauthenticated",
    });
    await expect(
      listShopCatalogHandler(request({ extra: true }, "guardian"), services().services),
    ).rejects.toMatchObject({ code: "invalid-argument" });
  });

  it("lets a shopper buy without giving it anything a student has", async () => {
    const { services: current } = services();

    const placed = await placeShopOrderHandler(
      request({ ...collectionCheckout, contactName: "Sam Shopper" }, "shopper", "buyer-1"),
      current,
    );

    expect(placed.orderId).toBe("order-req-1");
    expect(current.store.placeOrder).toHaveBeenCalledWith(
      expect.objectContaining({ academyId: "academy-1", actorId: "buyer-1" }),
    );
    await expect(listMyShopOrdersHandler(request(null, "shopper"), current)).resolves.toHaveLength(
      0,
    );
    for (const denied of [
      listManagedShopProductsHandler(request(null, "shopper"), current),
      saveShopProductHandler(request(draft, "shopper"), current),
      listShopOrdersHandler(request(null, "shopper"), current),
    ]) {
      await expect(denied).rejects.toMatchObject({ code: "permission-denied" });
    }
  });

  it("serves published products to a visitor with no account and hides the rest", async () => {
    const { services: current } = services();

    const catalog = await listPublicShopCatalogHandler(
      request({ academyId: "demo-academy" }),
      current,
    );

    expect(catalog.map((item) => item.productId)).toEqual(["bpt-gi-blue"]);
    expect(catalog[0]).not.toHaveProperty("academyId");
    expect(catalog[0]).not.toHaveProperty("createdBy");
    expect(current.store.listProducts).toHaveBeenCalledWith("demo-academy");
  });

  it("keeps the public catalogue to a single validated academy and nothing else", async () => {
    for (const payload of [
      null,
      undefined,
      {},
      { academyId: "demo-academy", extra: true },
      { academyId: "" },
      { academyId: "Demo-Academy" },
      { academyId: "../demo-academy" },
      { academyId: "demo academy" },
      { academyId: 7 },
      [{ academyId: "demo-academy" }],
    ]) {
      await expect(
        listPublicShopCatalogHandler(request(payload), services().services),
      ).rejects.toMatchObject({ code: "invalid-argument" });
    }
  });

  it("restricts product administration to owner and administrator", async () => {
    const { services: current } = services();
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

  it("places a v2 checkout and validates the payload", async () => {
    const { services: current } = services();
    const placed = await placeShopOrderHandler(
      request(collectionCheckout, "adultStudent", "client-1"),
      current,
    );
    expect(placed).toMatchObject({ orderId: "order-req-1", status: "requested" });
    expect(placed).not.toHaveProperty("academyId");
    expect(current.store.placeOrder).toHaveBeenCalledWith({
      academyId: "academy-1",
      actorId: "client-1",
      now,
      request: collectionCheckout,
    });
    await expect(
      placeShopOrderHandler(
        request(
          {
            ...collectionCheckout,
            lines: [{ productId: "bpt-gi-blue", size: "A2", quantity: 99 }],
          },
          "guardian",
        ),
        current,
      ),
    ).rejects.toMatchObject({ code: "invalid-argument" });
    await expect(
      placeShopOrderHandler(request({ ...transferCheckout, proofId: null }, "guardian"), current),
    ).rejects.toMatchObject({ code: "invalid-argument" });
  });

  it("maps store failures to callable error codes", async () => {
    const { services: current } = services();
    current.store.placeOrder.mockRejectedValueOnce(
      new ShopStoreError("precondition", "Product is sold out"),
    );
    await expect(
      placeShopOrderHandler(request(collectionCheckout, "guardian"), current),
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
    const { services: current } = services();
    const mine = await listMyShopOrdersHandler(request(null, "guardian", "client-1"), current);
    expect(mine).toHaveLength(1);
    expect(mine[0]?.customerUserId).toBe("client-1");
    expect(current.store.listCustomerOrders).toHaveBeenCalledWith("academy-1", "client-1");
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

  const allAccountRoles = [
    "owner",
    "administrator",
    "headCoach",
    "coach",
    "guardian",
    "adultStudent",
    "teenStudent",
    "shopper",
  ];

  it.each(allAccountRoles)("%s can read the catalogue and place an order", async (role) => {
    const { services: s } = services();
    await expect(listShopCatalogHandler(request(null, role), s)).resolves.toBeDefined();
    await expect(
      placeShopOrderHandler(request(collectionCheckout, role), s),
    ).resolves.toBeDefined();
  });

  it.each(["headCoach", "coach", "guardian", "adultStudent", "teenStudent", "shopper"])(
    "%s cannot administer the shop or view screenshots",
    async (role) => {
      const { services: s } = services();
      await expect(listShopOrdersHandler(request(null, role), s)).rejects.toMatchObject({
        code: "permission-denied",
      });
      await expect(
        getShopOrderProofUrlHandler(request({ orderId: order.orderId }, role), s),
      ).rejects.toMatchObject({ code: "permission-denied" });
    },
  );

  it("stores a valid screenshot under the buyer's key", async () => {
    const { services: s, storage } = services();
    const result = await uploadShopOrderProofHandler(
      request(
        { requestId: "req-1", contentType: "image/png", base64: png.toString("base64") },
        "shopper",
        "client-1",
      ),
      s,
    );
    expect(result).toEqual({ proofId: pngProofId });
    expect(storage.objects.has(shopProofKey("academy-1", "client-1", "req-1", pngProofId))).toBe(
      true,
    );
  });

  it("rejects a file that is not really a PNG", async () => {
    const { services: s } = services();
    await expect(
      uploadShopOrderProofHandler(
        request(
          {
            requestId: "req-1",
            contentType: "image/png",
            base64: Buffer.from("<svg/>").toString("base64"),
          },
          "shopper",
        ),
        s,
      ),
    ).rejects.toMatchObject({ code: "invalid-argument" });
  });

  it("rejects a transfer order whose screenshot was never uploaded", async () => {
    const { services: s } = services();
    await expect(
      placeShopOrderHandler(
        request({ ...transferCheckout, proofId: pngProofId }, "shopper", "client-1"),
        s,
      ),
    ).rejects.toMatchObject({ code: "failed-precondition" });
  });

  it("rejects a proof uploaded by another account", async () => {
    const { services: s, storage } = services();
    storage.objects.set(
      shopProofKey("academy-1", "client-2", transferCheckout.requestId, pngProofId),
      png,
    );
    await expect(
      placeShopOrderHandler(
        request({ ...transferCheckout, proofId: pngProofId }, "shopper", "client-1"),
        s,
      ),
    ).rejects.toMatchObject({ code: "failed-precondition" });
  });

  it("accepts a transfer order with the buyer's own screenshot", async () => {
    const { services: s, storage, store } = services();
    storage.objects.set(
      shopProofKey("academy-1", "client-1", transferCheckout.requestId, pngProofId),
      png,
    );
    await placeShopOrderHandler(
      request({ ...transferCheckout, proofId: pngProofId }, "shopper", "client-1"),
      s,
    );
    expect(store.placeOrder).toHaveBeenCalled();
  });

  it("gives the owner a 60-second signed view of the screenshot", async () => {
    const { services: s, storage, store } = services();
    const transferOrder = {
      ...order,
      paymentMethod: "bank_transfer" as const,
      proofId: pngProofId,
    };
    store.getOrder.mockResolvedValue(transferOrder);
    storage.objects.set(
      shopProofKey("academy-1", transferOrder.customerUserId, transferOrder.requestId, pngProofId),
      png,
    );
    const result = await getShopOrderProofUrlHandler(
      request({ orderId: transferOrder.orderId }, "owner"),
      s,
    );
    expect(result.url).toContain("https://signed.test/");
    expect(storage.createPrivateImageUrl).toHaveBeenCalledWith(
      expect.objectContaining({ expiresInSeconds: 60, contentType: "image/png" }),
    );
  });

  it("reports no screenshot for a pay-on-collection order", async () => {
    const { services: s, store } = services();
    store.getOrder.mockResolvedValue({ ...order, paymentMethod: "at_collection", proofId: null });
    await expect(
      getShopOrderProofUrlHandler(request({ orderId: order.orderId }, "owner"), s),
    ).rejects.toMatchObject({ code: "failed-precondition" });
  });
});
