import { describe, expect, it } from "vitest";

import {
  canTransitionShopOrder,
  formatShopPrice,
  parseShopOrderRecord,
  parseShopOrderRequest,
  parseShopOrderStatusUpdate,
  parseShopProductDraft,
  parseShopProductRecord,
  sortShopProducts,
  toShopOrderProjection,
  toShopProductProjection,
  type ShopOrderRecord,
  type ShopProductDraft,
  type ShopProductRecord,
} from "./shop-contracts";

const now = "2026-09-04T10:00:00.000Z";

const draft: ShopProductDraft = {
  productId: "bpt-gi-blue",
  name: "BPT competition gi",
  category: "gi",
  description: "Blue ripstop gi with embroidered BPT lettering.",
  priceMinor: 9500,
  currency: "GBP",
  sizes: ["A1", "A2", "A3"],
  imageUrl: "/shop/gis.jpg",
  stockStatus: "in-stock",
  sortOrder: 10,
};

const productRecord: ShopProductRecord = {
  ...draft,
  academyId: "academy-1",
  active: true,
  schemaVersion: "1",
  createdAt: now,
  createdBy: "admin-1",
  updatedAt: now,
  updatedBy: "admin-1",
};

const orderRecord: ShopOrderRecord = {
  orderId: "order-req-1",
  academyId: "academy-1",
  requestId: "req-1",
  customerUserId: "client-1",
  productId: "bpt-gi-blue",
  productName: "BPT competition gi",
  category: "gi",
  size: "A2",
  quantity: 2,
  unitPriceMinor: 9500,
  totalMinor: 19000,
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

describe("shop product contracts", () => {
  it("accepts a well-formed product draft with local or https images", () => {
    expect(parseShopProductDraft(draft).ok).toBe(true);
    expect(parseShopProductDraft({ ...draft, imageUrl: "https://example.com/gi.jpg" }).ok).toBe(
      true,
    );
    expect(parseShopProductDraft({ ...draft, imageUrl: null }).ok).toBe(true);
  });

  it("rejects insecure images, bad slugs, negative prices and duplicate sizes", () => {
    expect(parseShopProductDraft({ ...draft, imageUrl: "http://example.com/gi.jpg" }).ok).toBe(
      false,
    );
    expect(parseShopProductDraft({ ...draft, productId: "Bad Slug" }).ok).toBe(false);
    expect(parseShopProductDraft({ ...draft, priceMinor: -1 }).ok).toBe(false);
    expect(parseShopProductDraft({ ...draft, sizes: ["A1", "A1"] }).ok).toBe(false);
    expect(parseShopProductDraft({ ...draft, extra: true }).ok).toBe(false);
    expect(parseShopProductDraft(Object.create({ ...draft })).ok).toBe(false);
  });

  it("projects records without tenant or authorship fields", () => {
    expect(parseShopProductRecord(productRecord).ok).toBe(true);
    expect(toShopProductProjection(productRecord)).toEqual({ ...draft, active: true });
  });

  it("sorts products by sort order then name", () => {
    const sorted = sortShopProducts([
      { sortOrder: 20, name: "Zeta" },
      { sortOrder: 10, name: "Beta" },
      { sortOrder: 10, name: "Alpha" },
    ]);
    expect(sorted.map((product) => product.name)).toEqual(["Alpha", "Beta", "Zeta"]);
  });

  it("formats GBP prices from minor units", () => {
    expect(formatShopPrice(9500)).toBe("£95.00");
  });
});

describe("shop order contracts", () => {
  it("accepts a bounded order request and rejects quantities above the limit", () => {
    const request = {
      requestId: "req-1",
      productId: "bpt-gi-blue",
      size: "A2",
      quantity: 2,
      contactName: "Sam Client",
      contactPhone: null,
      note: null,
    };
    expect(parseShopOrderRequest(request).ok).toBe(true);
    expect(parseShopOrderRequest({ ...request, quantity: 11 }).ok).toBe(false);
    expect(parseShopOrderRequest({ ...request, quantity: 0 }).ok).toBe(false);
    expect(parseShopOrderRequest({ ...request, contactName: " padded " }).ok).toBe(false);
  });

  it("requires the stored total to match unit price and quantity", () => {
    expect(parseShopOrderRecord(orderRecord).ok).toBe(true);
    expect(parseShopOrderRecord({ ...orderRecord, totalMinor: 9500 }).ok).toBe(false);
  });

  it("projects orders with customer id but without tenant or authorship", () => {
    const projection = toShopOrderProjection(orderRecord);
    expect(projection.customerUserId).toBe("client-1");
    expect(projection).not.toHaveProperty("academyId");
    expect(projection).not.toHaveProperty("createdBy");
  });

  it("only allows forward lifecycle transitions", () => {
    expect(canTransitionShopOrder("requested", "confirmed")).toBe(true);
    expect(canTransitionShopOrder("confirmed", "ready")).toBe(true);
    expect(canTransitionShopOrder("ready", "collected")).toBe(true);
    expect(canTransitionShopOrder("requested", "collected")).toBe(false);
    expect(canTransitionShopOrder("collected", "cancelled")).toBe(false);
    expect(canTransitionShopOrder("cancelled", "requested")).toBe(false);
  });

  it("requires at least one change in a status update", () => {
    expect(parseShopOrderStatusUpdate({ orderId: "order-1" }).ok).toBe(false);
    expect(parseShopOrderStatusUpdate({ orderId: "order-1", paymentStatus: "paid" }).ok).toBe(true);
    expect(parseShopOrderStatusUpdate({ orderId: "order-1", status: "lost" }).ok).toBe(false);
  });
});
