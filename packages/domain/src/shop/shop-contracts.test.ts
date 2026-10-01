import { describe, expect, it } from "vitest";

import {
  canTransitionShopOrder,
  formatShopPrice,
  isShopProductPurchasable,
  parseShopCheckoutRequest,
  parseShopOrderRecord,
  parseShopOrderStatusUpdate,
  parseShopProductDraft,
  parseShopProductRecord,
  shopMadeToOrderLabel,
  shopOrderReference,
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
    expect(toShopProductProjection(productRecord)).toEqual({
      ...draft,
      leadTimeWeeks: null,
      active: true,
    });
  });

  it("keeps products without a lead time valid and bounds the lead time to 1-26 whole weeks", () => {
    expect(parseShopProductRecord(productRecord).ok).toBe(true);
    expect(parseShopProductDraft({ ...draft, leadTimeWeeks: null }).ok).toBe(true);
    expect(parseShopProductDraft({ ...draft, leadTimeWeeks: 1 }).ok).toBe(true);
    expect(parseShopProductDraft({ ...draft, leadTimeWeeks: 26 }).ok).toBe(true);
    expect(parseShopProductDraft({ ...draft, leadTimeWeeks: 0 }).ok).toBe(false);
    expect(parseShopProductDraft({ ...draft, leadTimeWeeks: 27 }).ok).toBe(false);
    expect(parseShopProductDraft({ ...draft, leadTimeWeeks: 2.5 }).ok).toBe(false);
    expect(toShopProductProjection({ ...productRecord, leadTimeWeeks: 4 }).leadTimeWeeks).toBe(4);
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

const checkout = {
  requestId: "6f1c2a7e-1111-4222-8333-944445555666",
  lines: [
    { productId: "bpt-gi", size: "A2", quantity: 1 },
    { productId: "bpt-backpack", size: null, quantity: 2 },
  ],
  pickupLocationId: "town",
  paymentMethod: "bank_transfer",
  proofId: "a".repeat(64),
  contactName: "Sam Client",
  contactPhone: null,
  note: null,
};

const orderV2: ShopOrderRecord = {
  orderId: "order-6f1c2a7e-1111-4222-8333-944445555666",
  academyId: "academy-1",
  requestId: "6f1c2a7e-1111-4222-8333-944445555666",
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
  createdAt: "2026-10-01T10:00:00.000Z",
  createdBy: "client-1",
  updatedAt: "2026-10-01T10:00:00.000Z",
  updatedBy: "client-1",
};

describe("shop checkout request", () => {
  it("accepts a transfer checkout with a proof", () => {
    expect(parseShopCheckoutRequest(checkout).ok).toBe(true);
  });
  it("requires a proof for a bank transfer", () => {
    expect(parseShopCheckoutRequest({ ...checkout, proofId: null }).ok).toBe(false);
  });
  it("forbids a proof when paying on collection", () => {
    expect(parseShopCheckoutRequest({ ...checkout, paymentMethod: "at_collection" }).ok).toBe(
      false,
    );
    expect(
      parseShopCheckoutRequest({ ...checkout, paymentMethod: "at_collection", proofId: null }).ok,
    ).toBe(true);
  });
  it("rejects the same product and size twice", () => {
    const lines = [checkout.lines[0], { ...checkout.lines[0], quantity: 3 }];
    expect(parseShopCheckoutRequest({ ...checkout, lines }).ok).toBe(false);
  });
  it("allows the same product in two sizes", () => {
    const lines = [checkout.lines[0], { ...checkout.lines[0], size: "A3" }];
    expect(parseShopCheckoutRequest({ ...checkout, lines }).ok).toBe(true);
  });
  it("rejects an empty basket, more than 10 lines and an unknown centre", () => {
    expect(parseShopCheckoutRequest({ ...checkout, lines: [] }).ok).toBe(false);
    const many = Array.from({ length: 11 }, (_, index) => ({
      productId: `p-${index}0`,
      size: null,
      quantity: 1,
    }));
    expect(parseShopCheckoutRequest({ ...checkout, lines: many }).ok).toBe(false);
    expect(parseShopCheckoutRequest({ ...checkout, pickupLocationId: "north" }).ok).toBe(false);
  });
  it("never takes the contact email from the client", () => {
    expect(parseShopCheckoutRequest({ ...checkout, contactEmail: "sam@example.com" }).ok).toBe(
      false,
    );
  });
  it("rejects client-supplied prices", () => {
    const lines = [{ ...checkout.lines[0], unitPriceMinor: 1 }];
    expect(parseShopCheckoutRequest({ ...checkout, lines }).ok).toBe(false);
  });
});

describe("shop order v2", () => {
  it("accepts consistent totals", () => {
    expect(parseShopOrderRecord(orderV2).ok).toBe(true);
  });
  it("rejects a line total that does not match", () => {
    const lines = [{ ...orderV2.lines[0], lineTotalMinor: 1 }, orderV2.lines[1]];
    expect(parseShopOrderRecord({ ...orderV2, lines }).ok).toBe(false);
  });
  it("rejects an order total that is not the sum of lines", () => {
    expect(parseShopOrderRecord({ ...orderV2, totalMinor: 9500 }).ok).toBe(false);
  });
  it("rejects schema version 1", () => {
    expect(parseShopOrderRecord({ ...orderV2, schemaVersion: "1" }).ok).toBe(false);
  });
  it("projects lines, centre and payment without tenant fields", () => {
    const projection = toShopOrderProjection(orderV2);
    expect(projection.lines).toHaveLength(2);
    expect(projection.pickupLocationId).toBe("town");
    expect(projection.paymentMethod).toBe("bank_transfer");
    expect(projection).not.toHaveProperty("academyId");
    expect(projection).not.toHaveProperty("requestId");
  });
  it("keeps the buyer's email on the record and the projection", () => {
    expect(toShopOrderProjection(orderV2).contactEmail).toBe("sam@example.com");
    expect(parseShopOrderRecord({ ...orderV2, contactEmail: null }).ok).toBe(true);
    expect(parseShopOrderRecord({ ...orderV2, contactEmail: "not-an-email" }).ok).toBe(false);
    const withoutEmail: Record<string, unknown> = { ...orderV2 };
    delete withoutEmail.contactEmail;
    expect(parseShopOrderRecord(withoutEmail).ok).toBe(false);
  });
});

describe("shop helpers", () => {
  it("only active, not sold-out products are purchasable", () => {
    expect(isShopProductPurchasable({ active: true, stockStatus: "made-to-order" })).toBe(true);
    expect(isShopProductPurchasable({ active: true, stockStatus: "sold-out" })).toBe(false);
    expect(isShopProductPurchasable({ active: false, stockStatus: "in-stock" })).toBe(false);
  });
  it("labels made-to-order products with their lead time", () => {
    expect(shopMadeToOrderLabel(null)).toBe("Made to order");
    expect(shopMadeToOrderLabel(undefined)).toBe("Made to order");
    expect(shopMadeToOrderLabel(1)).toBe("Made to order · about 1 week");
    expect(shopMadeToOrderLabel(6)).toBe("Made to order · about 6 weeks");
  });
  it("derives the same reference from the order id or the request id", () => {
    expect(shopOrderReference("order-6f1c2a7e-1111")).toBe("SHOP-6F1C2A7E");
    expect(shopOrderReference("6f1c2a7e-1111")).toBe("SHOP-6F1C2A7E");
  });
});
