# Shop basket checkout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Published products are visible and purchasable by every signed-in account (and by new buyers via quick registration) through a multi-item basket with a payment step (bank transfer + screenshot, or pay on collection) and a pickup centre (Town / West); `/admin/shop` is reorganised around orders.

**Architecture:** The shop order contract moves to `schemaVersion "2"` with `lines[]`, `pickupLocationId`, `paymentMethod` and `proofId` (0 orders exist in production, no migration). The basket lives in the browser (`localStorage`, ids and quantities only); the server re-reads every product inside one Firestore transaction and freezes names and prices. Transfer screenshots reuse the intro/PAYG proof pattern: base64 → `validateIntroProof` → private R2 keyed by the buyer's uid hash, read back by owner/administrator through a 60-second signed URL.

**Tech Stack:** pnpm monorepo, TypeScript strict, zod 4, Firebase Functions v2 `onCall`, Next.js 16 static export, React 19, Vitest + Testing Library, Playwright MCP.

**Spec:** `docs/superpowers/specs/2026-10-01-shop-checkout-design.md`

## Global Constraints

- Work and commit directly on local `main`; no branch, worktree or PR. Push and functions deploy only after the operator confirms in chat.
- Commands always via Corepack from the repo root: `corepack pnpm …`. Node `>=22.13 <25`.
- `packages/domain` never imports Firebase.
- Before running functions tests that import the domain, build it: `corepack pnpm --filter @bpt-jersey/domain build:runtime`.
- Run only the test files touched by a task, plus `corepack pnpm --filter <pkg> typecheck` for touched packages. No full-workspace suite, no CI dispatch.
- UI copy is UK English, plain academy voice; no "Elevate/Seamless/Unleash", no emojis.
- DESIGN.md: radius 0; status = text + coloured left rule, never a pill alone; no blur shadows, no gradients; BPT Purple `#2F2483` only accent, lime never as text on white; Barlow Condensed headings via `var(--font-display)`; eyebrow on every screen; money in `font-variant-numeric: tabular-nums`; labels above inputs, controls ≥ 16px font; buttons `min-height: 3.15rem`; touch targets ≥ 44px; grids with `minmax(0, …)`; one column below `48rem`; `100dvh`; no spinners (skeleton or plain status text).
- Callables return safe user-facing strings; the web layer never shows raw Firebase errors.
- No `dangerouslySetInnerHTML`; `localStorage` holds only `{productId,size,quantity}`.
- Purchasable rule (verbatim from spec): se compra si `active && stockStatus !== "sold-out"`.
- Account roles that may buy (verbatim): `owner`, `administrator`, `headCoach`, `coach`, `guardian`, `adultStudent`, `teenStudent`, `shopper`. Administration and screenshots: only `owner`/`administrator`.
- Commit message trailer: `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.

## Review Focus

1. **Two tabs / stale basket:** a product hidden or sold out after it was added must be removed from the basket on next load with a visible notice naming it, and the server must refuse it with a message naming the product (Task 2 + Task 6 tests).
2. **Double click on "Place order":** the same `requestId` must yield one order, never two; a retry after a network failure must return the stored order (Task 2 idempotency test + Task 6 disabled-while-busy test).
3. **Screenshot uploaded but order never placed / proof from another user:** an order citing a `proofId` the caller did not upload under that `requestId` must be rejected (Task 3 test "rejects a proof uploaded by another account").
4. **Staff account opening `/shop`:** an owner or coach signed in must see the checkout, not "Sign in to order" or an error (Task 5 test + Task 3 role matrix).
5. **Corrupt `localStorage`:** malformed JSON, wrong shapes, or storage that throws must give an empty basket, never a crash (Task 4 tests).

---

## File map

| File | Responsibility |
|---|---|
| `packages/domain/src/shop/shop-contracts.ts` | v2 order contract, checkout request, pickup/payment enums, purchasable rule, order reference |
| `apps/functions/src/shop/shop-service.ts` | `placeOrder` v2 (multi-line, frozen prices), `getOrder` |
| `apps/functions/src/shop/shop-proof.ts` (new) | proof key, upload, verification, content type |
| `apps/functions/src/shop/shop-callables.ts` | role sets, checkout handler with proof check, upload + signed-URL callables |
| `apps/functions/src/index.ts` | export the two new callables |
| `apps/functions/src/members/enrolment-payment-proof.ts` | `getEnrolmentPaymentInstructions` opened to every account role |
| `apps/web/src/lib/shop-client.ts` | `placeShopOrder(checkout)`, `uploadShopOrderProof`, `getShopOrderProofUrl` |
| `apps/web/src/lib/shop-basket.ts` (new) | pure basket operations + guarded storage |
| `apps/web/src/lib/client-auth.tsx` | `ClientAuthProvider acceptStaff` |
| `apps/web/src/app/shop/product-card.tsx` (new) | card with size/quantity/"Add to basket" |
| `apps/web/src/app/shop/shop-checkout.tsx` (new) | basket list + details + centre + payment + submit |
| `apps/web/src/app/shop/shop-orders.tsx` (new) | order history |
| `apps/web/src/app/shop/page.tsx` | orchestration, layout, confirmation |
| `apps/web/src/app/shop/shop.css` | basket/checkout layout |
| `apps/web/src/app/account/calendar/calendar-header.tsx` | "Club shop" link |
| `apps/web/src/app/admin/shop/page.tsx` + `admin.css` | orders first, visibility wording, order detail, proof viewer |

---

### Task 1: Domain — v2 order and checkout contracts

**Files:**
- Modify: `packages/domain/src/shop/shop-contracts.ts`
- Test: `packages/domain/src/shop/shop-contracts.test.ts`

**Interfaces:**
- Produces (exported from `@bpt-jersey/domain/shop`):
  - `shopPaymentMethods: readonly ["bank_transfer","at_collection"]`, `type ShopPaymentMethod`
  - `shopPaymentMethodLabels: Record<ShopPaymentMethod,string>` = `{bank_transfer:"Bank transfer", at_collection:"Pay on collection"}`
  - `shopPickupLocationIds` (= `locationIds` from schedule), `type ShopPickupLocationId = "town" | "west"`
  - `shopCheckoutMaximumLines = 10`
  - `shopCheckoutLineSchema`, `type ShopCheckoutLine = {productId:string; size:string|null; quantity:number}`
  - `shopCheckoutRequestSchema`, `type ShopCheckoutRequest`, `parseShopCheckoutRequest(value)`
  - `type ShopOrderLine = {productId; productName; category; size; quantity; unitPriceMinor; lineTotalMinor}`
  - `ShopOrderRecord` / `ShopOrderProjection` now carry `lines`, `pickupLocationId`, `paymentMethod`, `proofId: string|null`, `schemaVersion: "2"` (record only)
  - `isShopProductPurchasable(product: Pick<ShopProductDraft,"stockStatus"> & {active:boolean}): boolean`
  - `shopOrderReference(orderOrRequestId: string): string` → `"SHOP-" + first 8 chars of the id without "order-" prefix, uppercased`
- Removes: `shopOrderRequestSchema`, `ShopOrderRequest`, `parseShopOrderRequest`, `shopPaymentMethodNote`, single-product fields on orders (`productId`, `productName`, `category`, `size`, `quantity`, `unitPriceMinor`).

- [ ] **Step 1: Replace the order tests with v2 failing tests**

In `shop-contracts.test.ts`, delete every test that builds a v1 order or calls `parseShopOrderRequest`, then add:

```ts
import {
  isShopProductPurchasable,
  parseShopCheckoutRequest,
  parseShopOrderRecord,
  shopOrderReference,
  toShopOrderProjection,
  type ShopOrderRecord,
} from "./shop-contracts";

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
    { productId: "bpt-gi", productName: "BPT gi", category: "gi", size: "A2", quantity: 1, unitPriceMinor: 9500, lineTotalMinor: 9500 },
    { productId: "bpt-backpack", productName: "BPT backpack", category: "backpack", size: null, quantity: 2, unitPriceMinor: 5500, lineTotalMinor: 11000 },
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
    expect(parseShopCheckoutRequest({ ...checkout, paymentMethod: "at_collection" }).ok).toBe(false);
    expect(parseShopCheckoutRequest({ ...checkout, paymentMethod: "at_collection", proofId: null }).ok).toBe(true);
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
    const many = Array.from({ length: 11 }, (_, index) => ({ productId: `p-${index}0`, size: null, quantity: 1 }));
    expect(parseShopCheckoutRequest({ ...checkout, lines: many }).ok).toBe(false);
    expect(parseShopCheckoutRequest({ ...checkout, pickupLocationId: "north" }).ok).toBe(false);
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
});

describe("shop helpers", () => {
  it("only active, not sold-out products are purchasable", () => {
    expect(isShopProductPurchasable({ active: true, stockStatus: "made-to-order" })).toBe(true);
    expect(isShopProductPurchasable({ active: true, stockStatus: "sold-out" })).toBe(false);
    expect(isShopProductPurchasable({ active: false, stockStatus: "in-stock" })).toBe(false);
  });
  it("derives the same reference from the order id or the request id", () => {
    expect(shopOrderReference("order-6f1c2a7e-1111")).toBe("SHOP-6F1C2A7E");
    expect(shopOrderReference("6f1c2a7e-1111")).toBe("SHOP-6F1C2A7E");
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `corepack pnpm vitest run --project node packages/domain/src/shop/shop-contracts.test.ts`
Expected: FAIL (missing exports `parseShopCheckoutRequest`, `isShopProductPurchasable`, `shopOrderReference`).

- [ ] **Step 3: Implement the contract changes**

In `shop-contracts.ts`:

1. Add the import at the top: `import { locationIds } from "../schedule/schedule-contracts";`
2. Delete `shopPaymentMethodNote`.
3. After `shopOrderMaximumQuantity`, add:

```ts
export const shopCheckoutMaximumLines = 10;
export const shopPaymentMethods = Object.freeze(["bank_transfer", "at_collection"] as const);
export type ShopPaymentMethod = (typeof shopPaymentMethods)[number];
export const shopPaymentMethodLabels: Readonly<Record<ShopPaymentMethod, string>> = Object.freeze({
  bank_transfer: "Bank transfer",
  at_collection: "Pay on collection",
});
// The pickup centres are the academy's two venues; the schedule owns the list.
export const shopPickupLocationIds = locationIds;
export type ShopPickupLocationId = (typeof shopPickupLocationIds)[number];
```

4. After `shopPaymentStatusSchema`, add:

```ts
export const shopPaymentMethodSchema = z.enum(shopPaymentMethods);
export const shopPickupLocationSchema = z.enum(shopPickupLocationIds);
const proofIdSchema = z.string().regex(/^[a-f0-9]{64}$/u);
const quantitySchema = z.number().int().min(1).max(shopOrderMaximumQuantity);
```

5. Replace `shopOrderRequestSchema` with:

```ts
export const shopCheckoutLineSchema = z.strictObject({
  productId: productIdSchema,
  size: boundedText(16).nullable(),
  quantity: quantitySchema,
});

export const shopCheckoutRequestSchema = z
  .strictObject({
    requestId: safeIdSchema,
    lines: z.array(shopCheckoutLineSchema).min(1).max(shopCheckoutMaximumLines),
    pickupLocationId: shopPickupLocationSchema,
    paymentMethod: shopPaymentMethodSchema,
    proofId: proofIdSchema.nullable(),
    contactName: boundedText(160),
    contactPhone: boundedText(64).nullable(),
    note: boundedText(500).nullable(),
  })
  .superRefine((value, context) => {
    const keys = value.lines.map((line) => `${line.productId}\u0000${line.size ?? ""}`);
    if (new Set(keys).size !== keys.length)
      context.addIssue({ code: "custom", message: "Basket lines must not repeat", path: ["lines"] });
    if ((value.paymentMethod === "bank_transfer") !== (value.proofId !== null))
      context.addIssue({ code: "custom", message: "A transfer needs its screenshot", path: ["proofId"] });
  });
```

6. Replace `shopOrderBaseSchema` with:

```ts
const shopOrderLineSchema = z.strictObject({
  productId: productIdSchema,
  productName: boundedText(120),
  category: shopProductCategorySchema,
  size: boundedText(16).nullable(),
  quantity: quantitySchema,
  unitPriceMinor: minorAmountSchema,
  lineTotalMinor: minorAmountSchema,
});

const shopOrderBaseSchema = z.strictObject({
  orderId: safeIdSchema,
  academyId: safeIdSchema,
  requestId: safeIdSchema,
  customerUserId: safeIdSchema,
  lines: z.array(shopOrderLineSchema).min(1).max(shopCheckoutMaximumLines),
  totalMinor: minorAmountSchema,
  currency: z.literal("GBP"),
  pickupLocationId: shopPickupLocationSchema,
  paymentMethod: shopPaymentMethodSchema,
  proofId: proofIdSchema.nullable(),
  contactName: boundedText(160),
  contactPhone: boundedText(64).nullable(),
  note: boundedText(500).nullable(),
  status: shopOrderStatusSchema,
  paymentStatus: shopPaymentStatusSchema,
  staffNote: boundedText(500).nullable(),
  schemaVersion: z.literal("2"),
  createdAt: dateTimeSchema,
  createdBy: safeIdSchema,
  updatedAt: dateTimeSchema,
  updatedBy: safeIdSchema,
});

function orderTotalsIssue(
  value: z.infer<typeof shopOrderBaseSchema>,
  context: z.RefinementCtx,
): void {
  value.lines.forEach((line, index) => {
    if (line.lineTotalMinor !== line.unitPriceMinor * line.quantity)
      context.addIssue({ code: "custom", message: "Line total mismatch", path: ["lines", index, "lineTotalMinor"] });
  });
  const sum = value.lines.reduce((total, line) => total + line.lineTotalMinor, 0);
  if (value.totalMinor !== sum)
    context.addIssue({ code: "custom", message: "Order total must equal the sum of its lines", path: ["totalMinor"] });
}

export const shopOrderRecordSchema = shopOrderBaseSchema.superRefine(orderTotalsIssue);
```

7. Replace `shopOrderProjectionSchema` with:

```ts
export const shopOrderProjectionSchema = shopOrderBaseSchema
  .omit({ academyId: true, requestId: true, createdBy: true, updatedBy: true, schemaVersion: true })
  .superRefine((value, context) => orderTotalsIssue(value as z.infer<typeof shopOrderBaseSchema>, context));
```

8. Types: remove `ShopOrderRequest`; add

```ts
export type ShopCheckoutLine = z.infer<typeof shopCheckoutLineSchema>;
export type ShopCheckoutRequest = z.infer<typeof shopCheckoutRequestSchema>;
export type ShopOrderLine = z.infer<typeof shopOrderLineSchema>;
```

9. Parsers: replace `parseShopOrderRequest` with `export const parseShopCheckoutRequest = (value: unknown) => parseWithSchema(shopCheckoutRequestSchema, value);`
10. Replace `toShopOrderProjection` body:

```ts
export function toShopOrderProjection(record: ShopOrderRecord): ShopOrderProjection {
  const { academyId: _academy, requestId: _request, createdBy: _created, updatedBy: _updated, schemaVersion: _version, ...projection } = record;
  return shopOrderProjectionSchema.parse(projection);
}
```

11. Add at the end:

```ts
export function isShopProductPurchasable(
  product: Readonly<{ active: boolean; stockStatus: ShopStockStatus }>,
): boolean {
  return product.active && product.stockStatus !== "sold-out";
}

/** Short, human reference shared by the bank transfer and the office. */
export function shopOrderReference(orderOrRequestId: string): string {
  return `SHOP-${orderOrRequestId.replace(/^order-/u, "").slice(0, 8).toUpperCase()}`;
}
```

If ESLint flags the `_academy` style unused destructuring, replace step 10 with an explicit object listing every projected field.

- [ ] **Step 4: Run and confirm pass**

Run: `corepack pnpm vitest run --project node packages/domain/src/shop/shop-contracts.test.ts && corepack pnpm --filter @bpt-jersey/domain typecheck && corepack pnpm --filter @bpt-jersey/domain build:runtime`
Expected: all PASS; typecheck clean (functions/web will fail typecheck until Tasks 2–8; that is expected).

- [ ] **Step 5: Commit**

```bash
git add packages/domain/src/shop/shop-contracts.ts packages/domain/src/shop/shop-contracts.test.ts
git commit -m "feat(shop): v2 order contract with lines, pickup centre and payment method"
```

---

### Task 2: Service — multi-line order with frozen prices

**Files:**
- Modify: `apps/functions/src/shop/shop-service.ts`
- Test: `apps/functions/src/shop/shop-service.test.ts`

**Interfaces:**
- Consumes: `ShopCheckoutRequest`, `ShopOrderLine`, `isShopProductPurchasable`, `parseShopOrderRecord` (Task 1).
- Produces: `PlaceShopOrderInput = {academyId; actorId; now; request: ShopCheckoutRequest}`; `ShopStore.getOrder(academyId: string, orderId: string): Promise<ShopOrderRecord>` (throws `ShopStoreError("not-found")`).

- [ ] **Step 1: Write failing tests**

Replace the existing `placeOrder` tests in `shop-service.test.ts` (keep `fakeFirestore`). Use the file's existing product draft helper / seeding pattern to seed two products under `academies/academy-1/shopProducts/`: `bpt-gi` (active, `in-stock`, sizes `["A1","A2"]`, price 9500) and `bpt-backpack` (active, `made-to-order`, sizes `[]`, price 5500); plus `bpt-hidden` (active false) and `bpt-sold` (sold-out). Add:

```ts
const checkout = {
  requestId: "req-1",
  lines: [
    { productId: "bpt-gi", size: "A2", quantity: 2 },
    { productId: "bpt-backpack", size: null, quantity: 1 },
  ],
  pickupLocationId: "west" as const,
  paymentMethod: "at_collection" as const,
  proofId: null,
  contactName: "Sam Client",
  contactPhone: null,
  note: null,
};

it("freezes names and prices from Firestore and sums the lines", async () => {
  const { store } = seededStore();
  const order = await store.placeOrder({ academyId: "academy-1", actorId: "client-1", now, request: checkout });
  expect(order.lines.map((line) => [line.productName, line.unitPriceMinor, line.lineTotalMinor])).toEqual([
    ["BPT gi", 9500, 19000],
    ["BPT backpack", 5500, 5500],
  ]);
  expect(order.totalMinor).toBe(24500);
  expect(order.pickupLocationId).toBe("west");
  expect(order.schemaVersion).toBe("2");
});

it("returns the stored order when the same request is retried", async () => {
  const { store, records } = seededStore();
  const first = await store.placeOrder({ academyId: "academy-1", actorId: "client-1", now, request: checkout });
  const second = await store.placeOrder({ academyId: "academy-1", actorId: "client-1", now, request: checkout });
  expect(second).toEqual(first);
  expect([...records.keys()].filter((path) => path.includes("/shopOrders/"))).toHaveLength(1);
});

it("refuses a request id used by another customer", async () => {
  const { store } = seededStore();
  await store.placeOrder({ academyId: "academy-1", actorId: "client-1", now, request: checkout });
  await expect(store.placeOrder({ academyId: "academy-1", actorId: "client-2", now, request: checkout })).rejects.toMatchObject({ code: "conflict" });
});

it.each([
  ["bpt-hidden", "is no longer available"],
  ["bpt-sold", "is no longer available"],
  ["bpt-missing", "no longer available"],
])("refuses %s with a message naming the problem", async (productId, message) => {
  const { store } = seededStore();
  const request = { ...checkout, lines: [{ productId, size: null, quantity: 1 }] };
  await expect(store.placeOrder({ academyId: "academy-1", actorId: "client-1", now, request })).rejects.toMatchObject({ code: "precondition", message: expect.stringContaining(message) });
});

it("refuses a size the product does not offer", async () => {
  const { store } = seededStore();
  const request = { ...checkout, lines: [{ productId: "bpt-gi", size: "XXL", quantity: 1 }] };
  await expect(store.placeOrder({ academyId: "academy-1", actorId: "client-1", now, request })).rejects.toMatchObject({ code: "precondition", message: "Choose a size offered for BPT gi" });
});

it("writes nothing when one line fails", async () => {
  const { store, records } = seededStore();
  const request = { ...checkout, lines: [checkout.lines[0], { productId: "bpt-sold", size: null, quantity: 1 }] };
  await expect(store.placeOrder({ academyId: "academy-1", actorId: "client-1", now, request })).rejects.toThrow();
  expect([...records.keys()].some((path) => path.includes("/shopOrders/"))).toBe(false);
});

it("reads one order and reports a missing one", async () => {
  const { store } = seededStore();
  const placed = await store.placeOrder({ academyId: "academy-1", actorId: "client-1", now, request: checkout });
  await expect(store.getOrder("academy-1", placed.orderId)).resolves.toEqual(placed);
  await expect(store.getOrder("academy-1", "order-nope")).rejects.toMatchObject({ code: "not-found" });
});
```

`seededStore()` is a local helper: build `fakeFirestore` with the four products (as product records with `schemaVersion: "1"`), call `createShopStore({ firestore, appendAudit: (_t, _r, draft) => audits.push(draft) })`, and return `{ store, records }` (expose the fake's `records` map from `fakeFirestore`'s return value if not already returned). Update `updateOrder` tests to seed a v2 order (copy `orderV2` shape from Task 1 with `academyId: "academy-1"`).

- [ ] **Step 2: Run and confirm failure**

Run: `corepack pnpm vitest run --project node apps/functions/src/shop/shop-service.test.ts`
Expected: FAIL (old single-product `placeOrder`, no `getOrder`).

- [ ] **Step 3: Implement**

In `shop-service.ts`:

- Imports: replace `type ShopOrderRequest` with `type ShopCheckoutRequest, type ShopOrderLine, isShopProductPurchasable`.
- `PlaceShopOrderInput.request: ShopCheckoutRequest`.
- Add to `ShopStore`: `getOrder: (academyId: string, orderId: string) => Promise<ShopOrderRecord>;`
- Replace the body of `placeOrder`:

```ts
    async placeOrder(input) {
      const academyId = id(input.academyId, "academy");
      const actorId = id(input.actorId, "actor");
      const now = timestamp(input.now);
      const { request } = input;
      const orderReference = firestore.doc(
        `${collectionPath(academyId, "shopOrders")}/${shopOrderId(id(request.requestId, "request"))}`,
      );
      const productIds = [...new Set(request.lines.map((line) => id(line.productId, "product")))];
      return firestore.runTransaction(async (transaction) => {
        const existingOrder = asDocument(await transaction.get(orderReference));
        if (existingOrder.exists) {
          const stored = storedOrder(existingOrder, academyId);
          if (stored.customerUserId !== actorId)
            throw new ShopStoreError("conflict", "Order request id already used");
          return stored;
        }
        // Every read happens before the single write, as Firestore transactions require.
        const products = new Map<string, ShopProductRecord>();
        for (const productId of productIds) {
          const snapshot = asDocument(
            await transaction.get(firestore.doc(`${collectionPath(academyId, "shopProducts")}/${productId}`)),
          );
          if (!snapshot.exists)
            throw new ShopStoreError("precondition", "An item in your basket is no longer available");
          products.set(productId, storedProduct(snapshot, academyId));
        }
        const lines: ShopOrderLine[] = request.lines.map((line) => {
          const product = products.get(line.productId)!;
          if (!isShopProductPurchasable(product))
            throw new ShopStoreError("precondition", `${product.name} is no longer available`);
          const sizeOk =
            product.sizes.length > 0
              ? line.size !== null && product.sizes.includes(line.size)
              : line.size === null;
          if (!sizeOk)
            throw new ShopStoreError("precondition", `Choose a size offered for ${product.name}`);
          return {
            productId: product.productId,
            productName: product.name,
            category: product.category,
            size: line.size,
            quantity: line.quantity,
            unitPriceMinor: product.priceMinor,
            lineTotalMinor: product.priceMinor * line.quantity,
          };
        });
        const candidate = parseShopOrderRecord({
          orderId: orderReference.id,
          academyId,
          requestId: request.requestId,
          customerUserId: actorId,
          lines,
          totalMinor: lines.reduce((total, line) => total + line.lineTotalMinor, 0),
          currency: "GBP",
          pickupLocationId: request.pickupLocationId,
          paymentMethod: request.paymentMethod,
          proofId: request.proofId,
          contactName: request.contactName,
          contactPhone: request.contactPhone,
          note: request.note,
          status: "requested",
          paymentStatus: "unpaid",
          staffNote: null,
          schemaVersion: "2",
          createdAt: now,
          createdBy: actorId,
          updatedAt: now,
          updatedBy: actorId,
        });
        if (!candidate.ok) throw new ShopStoreError("invalid", "Order contract rejected");
        transaction.create(orderReference, candidate.value);
        appendAudit(dependencies, transaction, academyId, actorId, "shop.order.placed", orderReference.path);
        return candidate.value;
      });
    },

    async getOrder(academyId, orderId) {
      const academy = id(academyId, "academy");
      const reference = firestore.doc(`${collectionPath(academy, "shopOrders")}/${id(orderId, "order")}`);
      return firestore.runTransaction(async (transaction) => {
        const snapshot = asDocument(await transaction.get(reference));
        if (!snapshot.exists) throw new ShopStoreError("not-found", "Order not found");
        return storedOrder(snapshot, academy);
      });
    },
```

- [ ] **Step 4: Guard check, then run**

Temporarily change `isShopProductPurchasable(product)` to `true` in `placeOrder`, run the test file, confirm the hidden/sold-out cases FAIL, restore it.
Run: `corepack pnpm vitest run --project node apps/functions/src/shop/shop-service.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/functions/src/shop/shop-service.ts apps/functions/src/shop/shop-service.test.ts
git commit -m "feat(shop): place multi-line orders with prices frozen server side"
```

---

### Task 3: Callables — roles, proof upload/verification, signed view, bank details

**Files:**
- Create: `apps/functions/src/shop/shop-proof.ts`
- Modify: `apps/functions/src/shop/shop-callables.ts`, `apps/functions/src/index.ts:243-252`, `apps/functions/src/members/enrolment-payment-proof.ts:77`
- Test: `apps/functions/src/shop/shop-callables.test.ts`

**Interfaces:**
- Consumes: `ShopStore.placeOrder`, `ShopStore.getOrder` (Task 2); `validateIntroProof` from `../memberships/intro-payment-proof.js`; `enrolmentStorageSecrets` from `../members/enrolment-payment-proof.js`; `R2Client` from `../storage/r2-client.js`.
- Produces:
  - `shopProofKey(academyId, userId, requestId, proofId): string` → `academies/${academyId}/shop-proofs/${sha256(userId)}/${requestId}/${proofId}`
  - `type ShopProofStorage = Pick<R2Client, "putObject" | "readObject" | "createPrivateImageUrl">`
  - `ShopCallableServices = { store; storage?: () => ShopProofStorage; now? }`
  - handlers `uploadShopOrderProofHandler(request, services) → {proofId}`, `getShopOrderProofUrlHandler(request, services) → {url, expiresAt}`
  - callables `uploadShopOrderProof`, `getShopOrderProofUrl` exported from `index.ts`
  - `getEnrolmentPaymentInstructions` accepts every account role.

- [ ] **Step 1: Write failing tests**

In `shop-callables.test.ts`: update the `order` fixture to the v2 shape (copy `orderV2` from Task 1, `academyId: "academy-1"`, `customerUserId: "client-1"`), replace every `placeShopOrderHandler` payload with a v2 checkout, extend `services()` with a fake storage, and add:

```ts
import { createHash } from "node:crypto";
import { getShopOrderProofUrlHandler, uploadShopOrderProofHandler } from "./shop-callables.js";
import { shopProofKey } from "./shop-proof.js";

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
    createPrivateImageUrl: vi.fn(async ({ objectKey }: { objectKey: string }) => `https://signed.test/${objectKey}`),
  };
}

const allAccountRoles = ["owner", "administrator", "headCoach", "coach", "guardian", "adultStudent", "teenStudent", "shopper"];

it.each(allAccountRoles)("%s can read the catalogue and place an order", async (role) => {
  const { services: s } = services();
  await expect(listShopCatalogHandler(request(null, role), s)).resolves.toBeDefined();
  await expect(placeShopOrderHandler(request(collectionCheckout, role), s)).resolves.toBeDefined();
});

it.each(["headCoach", "coach", "guardian", "adultStudent", "teenStudent", "shopper"])(
  "%s cannot administer the shop or view screenshots",
  async (role) => {
    const { services: s } = services();
    await expect(listShopOrdersHandler(request(null, role), s)).rejects.toMatchObject({ code: "permission-denied" });
    await expect(getShopOrderProofUrlHandler(request({ orderId: order.orderId }, role), s)).rejects.toMatchObject({ code: "permission-denied" });
  },
);

it("stores a valid screenshot under the buyer's key", async () => {
  const { services: s, storage } = services();
  const result = await uploadShopOrderProofHandler(
    request({ requestId: "req-1", contentType: "image/png", base64: png.toString("base64") }, "shopper", "client-1"),
    s,
  );
  expect(result).toEqual({ proofId: pngProofId });
  expect(storage.objects.has(shopProofKey("academy-1", "client-1", "req-1", pngProofId))).toBe(true);
});

it("rejects a file that is not really a PNG", async () => {
  const { services: s } = services();
  await expect(
    uploadShopOrderProofHandler(request({ requestId: "req-1", contentType: "image/png", base64: Buffer.from("<svg/>").toString("base64") }, "shopper"), s),
  ).rejects.toMatchObject({ code: "invalid-argument" });
});

it("rejects a transfer order whose screenshot was never uploaded", async () => {
  const { services: s } = services();
  await expect(placeShopOrderHandler(request({ ...transferCheckout, proofId: pngProofId }, "shopper", "client-1"), s)).rejects.toMatchObject({ code: "failed-precondition" });
});

it("rejects a proof uploaded by another account", async () => {
  const { services: s, storage } = services();
  storage.objects.set(shopProofKey("academy-1", "client-2", transferCheckout.requestId, pngProofId), png);
  await expect(placeShopOrderHandler(request({ ...transferCheckout, proofId: pngProofId }, "shopper", "client-1"), s)).rejects.toMatchObject({ code: "failed-precondition" });
});

it("accepts a transfer order with the buyer's own screenshot", async () => {
  const { services: s, storage, store } = services();
  storage.objects.set(shopProofKey("academy-1", "client-1", transferCheckout.requestId, pngProofId), png);
  await placeShopOrderHandler(request({ ...transferCheckout, proofId: pngProofId }, "shopper", "client-1"), s);
  expect(store.placeOrder).toHaveBeenCalled();
});

it("gives the owner a 60-second signed view of the screenshot", async () => {
  const { services: s, storage, store } = services();
  const transferOrder = { ...order, paymentMethod: "bank_transfer" as const, proofId: pngProofId };
  store.getOrder.mockResolvedValue(transferOrder);
  storage.objects.set(shopProofKey("academy-1", transferOrder.customerUserId, transferOrder.requestId, pngProofId), png);
  const result = await getShopOrderProofUrlHandler(request({ orderId: transferOrder.orderId }, "owner"), s);
  expect(result.url).toContain("https://signed.test/");
  expect(storage.createPrivateImageUrl).toHaveBeenCalledWith(expect.objectContaining({ expiresInSeconds: 60, contentType: "image/png" }));
});

it("reports no screenshot for a pay-on-collection order", async () => {
  const { services: s, store } = services();
  store.getOrder.mockResolvedValue({ ...order, paymentMethod: "at_collection", proofId: null });
  await expect(getShopOrderProofUrlHandler(request({ orderId: order.orderId }, "owner"), s)).rejects.toMatchObject({ code: "failed-precondition" });
});
```

with fixtures

```ts
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
const transferCheckout = { ...collectionCheckout, requestId: "req-2", paymentMethod: "bank_transfer" };
```

and `services()` returning `{ services: { store, storage: () => storage, now: () => now }, store, storage }` where `store` gains `getOrder: vi.fn().mockResolvedValue(order)` and `storage = fakeStorage()`. Delete the old test asserting `teenStudent`/coach are refused.

- [ ] **Step 2: Run and confirm failure**

Run: `corepack pnpm vitest run --project node apps/functions/src/shop/shop-callables.test.ts`
Expected: FAIL (missing exports, roles refused).

- [ ] **Step 3: Create `shop-proof.ts`**

```ts
import { createHash } from "node:crypto";

import type { R2Client } from "../storage/r2-client.js";

export type ShopProofStorage = Pick<R2Client, "putObject" | "readObject" | "createPrivateImageUrl">;

/** The uid is hashed so object keys never carry an account id in clear. */
export function shopProofKey(academyId: string, userId: string, requestId: string, proofId: string): string {
  const owner = createHash("sha256").update(userId).digest("hex");
  return `academies/${academyId}/shop-proofs/${owner}/${requestId}/${proofId}`;
}

/** The stored screenshot's bytes, only when they hash to the declared proof id. */
export async function readShopProof(
  storage: ShopProofStorage,
  key: string,
  proofId: string,
): Promise<Buffer | undefined> {
  const bytes = await storage.readObject(key).then((value) => Buffer.from(value)).catch(() => undefined);
  if (!bytes?.length || createHash("sha256").update(bytes).digest("hex") !== proofId) return undefined;
  return bytes;
}

export function shopProofContentType(bytes: Buffer): "image/png" | "image/jpeg" | undefined {
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "image/png";
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return "image/jpeg";
  return undefined;
}
```

- [ ] **Step 4: Update `shop-callables.ts`**

1. Imports: replace `parseShopOrderRequest` with `parseShopCheckoutRequest`; add

```ts
import { z } from "zod";
import { enrolmentStorageSecrets } from "../members/enrolment-payment-proof.js";
import { validateIntroProof } from "../memberships/intro-payment-proof.js";
import { createPrivateStorageR2Client } from "../storage/r2-client.js";
import { readShopProof, shopProofContentType, shopProofKey, type ShopProofStorage } from "./shop-proof.js";
```

2. Services type:

```ts
export type ShopCallableServices = Readonly<{
  store: ShopStore;
  /** Private screenshot storage; resolved lazily so catalogue reads never touch R2. */
  storage?: () => ShopProofStorage;
  now?: () => string;
}>;
```

3. Replace the role sets and their comment:

```ts
// Every signed-in account may buy: a shopper (buyer with no student record), members, coaches and
// the office. Administration and payment screenshots stay with owner and administrator.
const accountRoles = new Set([
  "owner", "administrator", "headCoach", "coach", "guardian", "adultStudent", "teenStudent", "shopper",
]);
const catalogRoles = accountRoles;
const customerRoles = accountRoles;
const adminRoles = new Set(["owner", "administrator"]);
const evidenceUnavailable = "Payment evidence is unavailable.";

function storageOf(services: ShopCallableServices): ShopProofStorage {
  if (!services.storage) throw new HttpsError("failed-precondition", evidenceUnavailable);
  return services.storage();
}
```

4. In `placeShopOrderHandler`, parse with `parseShopCheckoutRequest`; message for wrong role `"Sign in to order"`; before `services.store.placeOrder`, add:

```ts
    if (parsed.value.paymentMethod === "bank_transfer") {
      const key = shopProofKey(actor.academyId, actor.userId, parsed.value.requestId, parsed.value.proofId!);
      if (!(await readShopProof(storageOf(services), key, parsed.value.proofId!)))
        throw new HttpsError("failed-precondition", "Upload the transfer screenshot again before placing the order.");
    }
```

(keep it inside the existing `try`; `mapError` rethrows `HttpsError` unchanged).

5. Add handlers:

```ts
const proofUploadSchema = z.strictObject({
  requestId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u),
  contentType: z.enum(["image/png", "image/jpeg"]),
  base64: z.string().min(4).max(Math.ceil((2 * 1024 * 1024) / 3) * 4),
});

export async function uploadShopOrderProofHandler(
  request: CallableRequest<unknown>,
  services: ShopCallableServices,
): Promise<{ proofId: string }> {
  const actor = actorWithRole(request, customerRoles, "Sign in to order");
  const input = proofUploadSchema.safeParse(request.data);
  if (!input.success) throw new HttpsError("invalid-argument", "Choose a PNG or JPEG screenshot up to 2 MB.");
  const validated = validateIntroProof(input.data.contentType, input.data.base64);
  await storageOf(services).putObject(
    shopProofKey(actor.academyId, actor.userId, input.data.requestId, validated.proofId),
    validated.bytes,
    input.data.contentType,
  );
  return { proofId: validated.proofId };
}

export async function getShopOrderProofUrlHandler(
  request: CallableRequest<unknown>,
  services: ShopCallableServices,
): Promise<{ url: string; expiresAt: string }> {
  const actor = actorWithRole(request, adminRoles, "Shop administration is not permitted");
  const input = z.strictObject({ orderId: z.string().regex(/^order-[A-Za-z0-9._:-]{1,128}$/u) }).safeParse(request.data);
  if (!input.success) invalid();
  let order;
  try {
    order = await services.store.getOrder(actor.academyId, input.data.orderId);
  } catch (error) {
    return mapError(error, "read");
  }
  if (order.paymentMethod !== "bank_transfer" || !order.proofId)
    throw new HttpsError("failed-precondition", evidenceUnavailable);
  const storage = storageOf(services);
  const objectKey = shopProofKey(actor.academyId, order.customerUserId, order.requestId, order.proofId);
  const bytes = await readShopProof(storage, objectKey, order.proofId);
  const contentType = bytes ? shopProofContentType(bytes) : undefined;
  if (!contentType || !storage.createPrivateImageUrl)
    throw new HttpsError("failed-precondition", evidenceUnavailable);
  return {
    url: await storage.createPrivateImageUrl({ objectKey, expiresInSeconds: 60, contentType }),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  };
}
```

6. `callableServices()` adds `storage: () => createPrivateStorageR2Client()`.
7. Exports: `placeShopOrder` now needs the R2 secrets; add the two new callables:

```ts
const shopProofCallableOptions = { ...shopCallableOptions, secrets: enrolmentStorageSecrets };
export const placeShopOrder = onCall(shopProofCallableOptions, (request) =>
  placeShopOrderHandler(request, callableServices()),
);
export const uploadShopOrderProof = onCall(shopProofCallableOptions, (request) =>
  uploadShopOrderProofHandler(request, callableServices()),
);
export const getShopOrderProofUrl = onCall(shopProofCallableOptions, (request) =>
  getShopOrderProofUrlHandler(request, callableServices()),
);
```

8. `index.ts`: add `getShopOrderProofUrl,` and `uploadShopOrderProof,` to the `./shop/shop-callables.js` export list (alphabetical).
9. `enrolment-payment-proof.ts` line 77 only (inside `getEnrolmentPaymentInstructions`): replace `["shopper", "adultStudent", "guardian"]` with `["owner", "administrator", "headCoach", "coach", "guardian", "adultStudent", "teenStudent", "shopper"]` and add above it `// Bank details are shown to every account: enrolment and the club shop checkout share them.` Leave line 43 untouched.

- [ ] **Step 5: Guard check, then run**

Temporarily replace the `readShopProof` check in `placeShopOrderHandler` with `if (false)`; run the file; confirm the two "rejects … screenshot" tests FAIL; restore.
Run: `corepack pnpm vitest run --project node apps/functions/src/shop/shop-callables.test.ts apps/functions/src/members/enrolment-payment-proof.test.ts && corepack pnpm --filter @bpt-jersey/functions typecheck`
Expected: PASS. If `enrolment-payment-proof.test.ts` asserts the old roles for `getEnrolmentPaymentInstructions`, update that assertion to the new list.

- [ ] **Step 6: Commit**

```bash
git add apps/functions/src/shop apps/functions/src/index.ts apps/functions/src/members/enrolment-payment-proof.ts apps/functions/src/members/enrolment-payment-proof.test.ts
git commit -m "feat(shop): every account can buy; transfer screenshot upload and signed office view"
```

---

### Task 4: Web — shop client and basket module

**Files:**
- Modify: `apps/web/src/lib/shop-client.ts`
- Create: `apps/web/src/lib/shop-basket.ts`, `apps/web/src/lib/shop-basket.test.ts`

**Interfaces:**
- Consumes: Task 1 exports.
- Produces:
  - `placeShopOrder(input: ShopCheckoutRequest): Promise<ShopOrderProjection>` (failed-precondition messages pass through, otherwise `"Unable to place the order."`)
  - `uploadShopOrderProof(requestId: string, file: File): Promise<string>`
  - `getShopOrderProofUrl(orderId: string): Promise<string>`
  - from `shop-basket.ts`: `type BasketLine = ShopCheckoutLine`; `basketLineKey(line)`, `addToBasket(lines, line) → {lines, full: boolean}`, `setBasketQuantity(lines, key, quantity)`, `reconcileBasket(lines, products) → {lines, removed: string[]}`, `basketTotalMinor(lines, products)`, `readBasket(storage?)`, `writeBasket(lines, storage?)`, `basketStorageKey = "bpt-shop-basket"`.

- [ ] **Step 1: Write failing basket tests**

```ts
import { describe, expect, it } from "vitest";

import {
  addToBasket,
  basketStorageKey,
  basketTotalMinor,
  readBasket,
  reconcileBasket,
  setBasketQuantity,
  writeBasket,
} from "./shop-basket";

const gi = { productId: "bpt-gi", name: "BPT gi", category: "gi" as const, description: null, priceMinor: 9500, currency: "GBP" as const, sizes: ["A1", "A2"], imageUrl: null, stockStatus: "in-stock" as const, sortOrder: 10, active: true };
const bag = { ...gi, productId: "bpt-bag", name: "BPT bag", category: "backpack" as const, priceMinor: 5500, sizes: [] };

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => void values.set(key, value), removeItem: (key: string) => void values.delete(key), values };
}

describe("shop basket", () => {
  it("merges the same product and size and caps the quantity at 10", () => {
    let { lines } = addToBasket([], { productId: "bpt-gi", size: "A2", quantity: 6 });
    ({ lines } = addToBasket(lines, { productId: "bpt-gi", size: "A2", quantity: 6 }));
    expect(lines).toEqual([{ productId: "bpt-gi", size: "A2", quantity: 10 }]);
  });
  it("keeps two sizes as two lines and refuses an 11th line", () => {
    let lines = Array.from({ length: 10 }, (_, index) => ({ productId: `p-${index}0`, size: null, quantity: 1 }));
    const result = addToBasket(lines, { productId: "bpt-gi", size: "A1", quantity: 1 });
    expect(result.full).toBe(true);
    expect(result.lines).toHaveLength(10);
    lines = addToBasket([], { productId: "bpt-gi", size: "A1", quantity: 1 }).lines;
    expect(addToBasket(lines, { productId: "bpt-gi", size: "A2", quantity: 1 }).lines).toHaveLength(2);
  });
  it("removes a line when its quantity drops to zero", () => {
    const lines = [{ productId: "bpt-gi", size: "A2", quantity: 2 }];
    expect(setBasketQuantity(lines, "bpt-gi|A2", 0)).toEqual([]);
    expect(setBasketQuantity(lines, "bpt-gi|A2", 3)).toEqual([{ productId: "bpt-gi", size: "A2", quantity: 3 }]);
  });
  it("drops hidden, sold-out, missing and wrong-size lines and names them", () => {
    const lines = [
      { productId: "bpt-gi", size: "A2", quantity: 1 },
      { productId: "bpt-gi", size: "XXL", quantity: 1 },
      { productId: "bpt-bag", size: null, quantity: 1 },
      { productId: "gone", size: null, quantity: 1 },
    ];
    const result = reconcileBasket(lines, [gi, { ...bag, stockStatus: "sold-out" as const }]);
    expect(result.lines).toEqual([{ productId: "bpt-gi", size: "A2", quantity: 1 }]);
    expect(result.removed).toEqual(["BPT gi (XXL)", "BPT bag", "An item"]);
  });
  it("totals with catalogue prices", () => {
    expect(basketTotalMinor([{ productId: "bpt-gi", size: "A2", quantity: 2 }, { productId: "bpt-bag", size: null, quantity: 1 }], [gi, bag])).toBe(24500);
  });
  it("round-trips through storage and ignores corrupt or throwing storage", () => {
    const storage = memoryStorage();
    writeBasket([{ productId: "bpt-gi", size: "A2", quantity: 2 }], storage);
    expect(readBasket(storage)).toEqual([{ productId: "bpt-gi", size: "A2", quantity: 2 }]);
    expect(readBasket(memoryStorage({ [basketStorageKey]: "{not json" }))).toEqual([]);
    expect(readBasket(memoryStorage({ [basketStorageKey]: JSON.stringify([{ productId: "x", quantity: 99 }]) }))).toEqual([]);
    const throwing = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); }, removeItem: () => undefined };
    expect(readBasket(throwing)).toEqual([]);
    expect(() => writeBasket([], throwing)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `corepack pnpm vitest run --project web apps/web/src/lib/shop-basket.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `shop-basket.ts`**

```ts
import { z } from "zod";

import {
  isShopProductPurchasable,
  shopCheckoutLineSchema,
  shopCheckoutMaximumLines,
  shopOrderMaximumQuantity,
  type ShopCheckoutLine,
  type ShopProductProjection,
} from "@bpt-jersey/domain/shop";

export type BasketLine = ShopCheckoutLine;
type BasketStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

// ponytail: ids and quantities only; names and prices always come from the live catalogue.
export const basketStorageKey = "bpt-shop-basket";
const storedBasketSchema = z.array(shopCheckoutLineSchema).max(shopCheckoutMaximumLines);

export function basketLineKey(line: Pick<BasketLine, "productId" | "size">): string {
  return `${line.productId}|${line.size ?? ""}`;
}

export function addToBasket(
  lines: readonly BasketLine[],
  line: BasketLine,
): { lines: readonly BasketLine[]; full: boolean } {
  const key = basketLineKey(line);
  if (lines.some((item) => basketLineKey(item) === key))
    return {
      full: false,
      lines: lines.map((item) =>
        basketLineKey(item) === key
          ? { ...item, quantity: Math.min(shopOrderMaximumQuantity, item.quantity + line.quantity) }
          : item,
      ),
    };
  if (lines.length >= shopCheckoutMaximumLines) return { lines, full: true };
  return { full: false, lines: [...lines, line] };
}

export function setBasketQuantity(
  lines: readonly BasketLine[],
  key: string,
  quantity: number,
): readonly BasketLine[] {
  if (quantity < 1) return lines.filter((item) => basketLineKey(item) !== key);
  const capped = Math.min(shopOrderMaximumQuantity, Math.trunc(quantity));
  return lines.map((item) => (basketLineKey(item) === key ? { ...item, quantity: capped } : item));
}

export function reconcileBasket(
  lines: readonly BasketLine[],
  products: readonly ShopProductProjection[],
): { lines: readonly BasketLine[]; removed: string[] } {
  const byId = new Map(products.map((product) => [product.productId, product]));
  const removed: string[] = [];
  const kept = lines.filter((line) => {
    const product = byId.get(line.productId);
    if (!product) return void removed.push("An item"), false;
    const sizeOk = product.sizes.length > 0 ? line.size !== null && product.sizes.includes(line.size) : line.size === null;
    if (isShopProductPurchasable(product) && sizeOk) return true;
    removed.push(sizeOk || line.size === null ? product.name : `${product.name} (${line.size})`);
    return false;
  });
  return { lines: kept, removed };
}

export function basketTotalMinor(
  lines: readonly BasketLine[],
  products: readonly ShopProductProjection[],
): number {
  const prices = new Map(products.map((product) => [product.productId, product.priceMinor]));
  return lines.reduce((total, line) => total + (prices.get(line.productId) ?? 0) * line.quantity, 0);
}

function defaultStorage(): BasketStorage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

export function readBasket(storage: BasketStorage | undefined = defaultStorage()): BasketLine[] {
  try {
    const parsed = storedBasketSchema.safeParse(JSON.parse(storage?.getItem(basketStorageKey) ?? "[]"));
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

export function writeBasket(
  lines: readonly BasketLine[],
  storage: BasketStorage | undefined = defaultStorage(),
): void {
  try {
    if (lines.length === 0) storage?.removeItem(basketStorageKey);
    else storage?.setItem(basketStorageKey, JSON.stringify(lines));
  } catch {
    // Private mode or blocked storage: the basket simply lives in memory for this visit.
  }
}
```

If ESLint rejects the comma expression in `reconcileBasket`, rewrite that branch as `{ removed.push("An item"); return false; }`.

- [ ] **Step 4: Update `shop-client.ts`**

- Imports: replace `parseShopOrderRequest`/`ShopOrderRequest` with `parseShopCheckoutRequest`/`ShopCheckoutRequest`; add `import { z } from "zod";`.
- `placeShopOrder(input: ShopCheckoutRequest)` parses with `parseShopCheckoutRequest`; rest unchanged.
- Add:

```ts
const proofError = "The payment screenshot could not be uploaded.";

/** Same base64 hand-off as the PAYG and intro receipts; the server re-checks the bytes. */
export async function uploadShopOrderProof(requestId: string, file: File): Promise<string> {
  if (!["image/png", "image/jpeg"].includes(file.type) || file.size < 1 || file.size > 2 * 1024 * 1024)
    throw new Error("Choose a PNG or JPEG screenshot up to 2 MB.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  try {
    const data = await call("uploadShopOrderProof", { requestId, contentType: file.type, base64: btoa(binary) });
    return z.strictObject({ proofId: z.string().regex(/^[a-f0-9]{64}$/u) }).parse(data).proofId;
  } catch {
    throw new Error(proofError);
  }
}

export async function getShopOrderProofUrl(orderId: string): Promise<string> {
  try {
    const data = await call("getShopOrderProofUrl", { orderId });
    return z.object({ url: z.url() }).parse(data).url;
  } catch {
    throw new Error("The transfer screenshot is unavailable.");
  }
}
```

- [ ] **Step 5: Run**

Run: `corepack pnpm vitest run --project web apps/web/src/lib/shop-basket.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/shop-basket.ts apps/web/src/lib/shop-basket.test.ts apps/web/src/lib/shop-client.ts
git commit -m "feat(shop): browser basket and checkout client calls"
```

---

### Task 5: Web — staff accounts recognised on the shop

**Files:**
- Modify: `apps/web/src/lib/client-auth.tsx`
- Test: `apps/web/src/lib/client-auth.test.tsx` (existing file; if absent create it beside the source)

**Interfaces:**
- Produces: `ClientAuthProvider({ children, acceptStaff?: boolean })`. With `acceptStaff`, a token whose `role` is `owner|administrator|headCoach|coach` yields a signed-in session with `role` undefined and `staffRole` set. `ClientSession` gains `staffRole?: "owner" | "administrator" | "headCoach" | "coach"`.

- [ ] **Step 1: Write the failing test**

Follow the existing mocking in `client-auth.test.tsx` (it mocks `./auth-client` `subscribeToIdTokenChanges`). Add:

```tsx
it("treats a staff token as signed in only when the surface accepts staff", async () => {
  const staffUser = { uid: "owner-1", email: "owner@example.test", displayName: "Owner", getIdTokenResult: async () => ({ claims: { role: "owner", academyId: "academy-1" } }) };
  emitUser(staffUser); // use the file's existing helper that drives the subscribed callback

  render(<ClientAuthProvider acceptStaff><Probe /></ClientAuthProvider>);
  expect(await screen.findByText("signed-in:owner")).toBeVisible();

  cleanup();
  render(<ClientAuthProvider><Probe /></ClientAuthProvider>);
  expect(await screen.findByText("signed-out:")).toBeVisible();
});
```

with `function Probe() { const { status, session } = useClientSession(); return <p>{`${status}:${session?.staffRole ?? ""}`}</p>; }`. If the file has no `emitUser` helper, mock `./auth-client` with `subscribeToIdTokenChanges: (callback) => { queueMicrotask(() => callback(currentUser)); return () => undefined; }` and set `currentUser` before rendering.

- [ ] **Step 2: Run and confirm failure**

Run: `corepack pnpm vitest run --project web apps/web/src/lib/client-auth.test.tsx`
Expected: FAIL (`acceptStaff` ignored, no `staffRole`).

- [ ] **Step 3: Implement**

```ts
export type StaffAccountRole = "owner" | "administrator" | "headCoach" | "coach";
const staffAccountRoles: readonly string[] = ["owner", "administrator", "headCoach", "coach"];
```

Add `staffRole?: StaffAccountRole;` to `ClientSession`. Change `sessionFromUser(user: User, acceptStaff: boolean)`; right after reading `token`:

```ts
    const claimed = token.claims?.role;
    // The club shop also serves the office and coaches; they keep their staff role, never a client one.
    if (acceptStaff && typeof claimed === "string" && staffAccountRoles.includes(claimed))
      return Object.freeze({ ...baseSession, staffRole: claimed as StaffAccountRole });
```

`ClientAuthProvider({ children, acceptStaff = false }: Readonly<{ children: React.ReactNode; acceptStaff?: boolean }>)` and call `sessionFromUser(user, acceptStaff)`; add `acceptStaff` to the effect dependency array.

- [ ] **Step 4: Run**

Run: `corepack pnpm vitest run --project web apps/web/src/lib/client-auth.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/client-auth.tsx apps/web/src/lib/client-auth.test.tsx
git commit -m "feat(auth): let the club shop recognise staff sessions"
```

---

### Task 6: Web — `/shop` catalogue, basket, checkout and confirmation

**Files:**
- Create: `apps/web/src/app/shop/product-card.tsx`, `apps/web/src/app/shop/shop-checkout.tsx`, `apps/web/src/app/shop/shop-orders.tsx`
- Modify: `apps/web/src/app/shop/page.tsx`, `apps/web/src/app/shop/shop.css`, `apps/web/src/app/globals.css:1647-1653` (delete `.shop-payment-note`)
- Test: `apps/web/src/app/shop/page.test.tsx`

**Interfaces:**
- Consumes: Task 4 (`shop-basket`, `uploadShopOrderProof`, `placeShopOrder`), Task 5 (`acceptStaff`), `useEnrolmentBankDetails`/`EnrolmentBankDetails` from `../enrol/payment-instructions`, `academyContent.locations` (`{key,name,address,locality,postcode}`), Task 1 (`shopOrderReference`, `shopPaymentMethodLabels`, `isShopProductPurchasable`).
- Produces: `ProductCard({product, onAdd(line: BasketLine)})`, `ShopCheckout({products, lines, onLinesChange, session, signedIn, onPlaced(order)})`, `ShopOrders({orders})`.

- [ ] **Step 1: Rewrite the page tests (failing)**

In `page.test.tsx`: extend the hoisted `shopApi` with `uploadShopOrderProof: vi.fn()`; mock `../enrol/payment-instructions`:

```ts
vi.mock("../enrol/payment-instructions", () => ({
  useEnrolmentBankDetails: () => ({ details: { accountName: "BPT Jersey", sortCode: "123456", accountNumber: "12345678", bankName: null, referenceHint: "Your name", acceptsCash: true }, error: false, onRetry: vi.fn() }),
  EnrolmentBankDetails: () => <dl><dt>Account name</dt><dd>BPT Jersey</dd></dl>,
}));
```

Update `placedOrder` to the v2 projection (lines, `pickupLocationId: "west"`, `paymentMethod: "bank_transfer"`, `proofId: "a".repeat(64)`). Add `beforeEach(() => localStorage.clear())`. Replace the old order tests with:

```tsx
it("lets a visitor fill the basket and asks them to sign in to check out", async () => {
  authState.status = "signed-out";
  shopApi.listPublicShopCatalog.mockResolvedValue([gi, backpack]);
  render(<ShopPage />);
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Add BPT competition gi to basket" }));
  expect(screen.getByRole("region", { name: "Your basket" })).toHaveTextContent("£95.00");
  expect(screen.getByRole("link", { name: "Sign in or create a buyer account" })).toHaveAttribute("href", "/login?returnTo=%2Fshop");
  expect(JSON.parse(localStorage.getItem("bpt-shop-basket")!)).toEqual([{ productId: "bpt-gi-blue", size: "A1", quantity: 1 }]);
});

it("keeps a sold-out product visible but not addable", async () => {
  authState.status = "signed-out";
  shopApi.listPublicShopCatalog.mockResolvedValue([gi, backpack]);
  render(<ShopPage />);
  expect(await screen.findByRole("button", { name: "BPT backpack is sold out" })).toBeDisabled();
});

it("removes a basket item that is no longer available and says so", async () => {
  localStorage.setItem("bpt-shop-basket", JSON.stringify([{ productId: "bpt-backpack", size: null, quantity: 1 }]));
  authState.status = "signed-out";
  shopApi.listPublicShopCatalog.mockResolvedValue([gi, backpack]);
  render(<ShopPage />);
  expect(await screen.findByText(/BPT backpack was removed from your basket/)).toBeVisible();
  expect(localStorage.getItem("bpt-shop-basket")).toBeNull();
});

it("checks out with a bank transfer, centre and screenshot", async () => {
  authState.status = "signed-in";
  authState.session = { uid: "client-1", email: "sam@example.test", displayName: "Sam Client", role: "adultStudent" };
  shopApi.listShopCatalog.mockResolvedValue([gi, backpack]);
  shopApi.listMyShopOrders.mockResolvedValue([]);
  shopApi.uploadShopOrderProof.mockResolvedValue("a".repeat(64));
  shopApi.placeShopOrder.mockResolvedValue(placedOrder);
  render(<ShopPage />);
  const user = userEvent.setup();
  await user.selectOptions(await screen.findByLabelText("Size for BPT competition gi"), "A2");
  await user.click(screen.getByRole("button", { name: "Add BPT competition gi to basket" }));
  expect(screen.getByLabelText("Name for the order")).toHaveValue("Sam Client");
  await user.click(screen.getByRole("radio", { name: /West/ }));
  await user.click(screen.getByRole("radio", { name: "Bank transfer now" }));
  const place = screen.getByRole("button", { name: /Place order/ });
  expect(place).toBeDisabled();
  await user.upload(screen.getByLabelText("Transfer screenshot"), new File([new Uint8Array([137, 80, 78, 71])], "proof.png", { type: "image/png" }));
  await user.click(place);
  expect(shopApi.placeShopOrder).toHaveBeenCalledWith(expect.objectContaining({
    lines: [{ productId: "bpt-gi-blue", size: "A2", quantity: 1 }],
    pickupLocationId: "west",
    paymentMethod: "bank_transfer",
    proofId: "a".repeat(64),
    contactName: "Sam Client",
  }));
  expect(await screen.findByRole("status", { name: "Order placed" })).toHaveTextContent("West");
  expect(localStorage.getItem("bpt-shop-basket")).toBeNull();
});

it("pays on collection without a screenshot and blocks a double submit", async () => {
  authState.status = "signed-in";
  authState.session = { uid: "client-1", email: "sam@example.test", displayName: "Sam Client", role: "guardian" };
  shopApi.listShopCatalog.mockResolvedValue([gi]);
  shopApi.listMyShopOrders.mockResolvedValue([]);
  let resolve!: (value: unknown) => void;
  shopApi.placeShopOrder.mockReturnValue(new Promise((done) => (resolve = done)));
  render(<ShopPage />);
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Add BPT competition gi to basket" }));
  await user.click(screen.getByRole("radio", { name: /Town/ }));
  await user.click(screen.getByRole("radio", { name: "Pay when you collect" }));
  const place = screen.getByRole("button", { name: /Place order/ });
  await user.click(place);
  expect(place).toBeDisabled();
  await user.click(place);
  expect(shopApi.placeShopOrder).toHaveBeenCalledTimes(1);
  expect(shopApi.uploadShopOrderProof).not.toHaveBeenCalled();
  resolve({ ...placedOrder, paymentMethod: "at_collection", proofId: null, pickupLocationId: "town" });
  expect(await screen.findByRole("status", { name: "Order placed" })).toHaveTextContent("Town");
});

it("shows the server's reason when an item became unavailable", async () => {
  authState.status = "signed-in";
  authState.session = { uid: "client-1", email: "sam@example.test", displayName: "Sam Client", role: "shopper" };
  shopApi.listShopCatalog.mockResolvedValue([gi]);
  shopApi.listMyShopOrders.mockResolvedValue([]);
  shopApi.placeShopOrder.mockRejectedValue(new Error("BPT competition gi is no longer available"));
  render(<ShopPage />);
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Add BPT competition gi to basket" }));
  await user.click(screen.getByRole("radio", { name: /Town/ }));
  await user.click(screen.getByRole("radio", { name: "Pay when you collect" }));
  await user.click(screen.getByRole("button", { name: /Place order/ }));
  expect(await screen.findByRole("alert")).toHaveTextContent("BPT competition gi is no longer available");
});
```

Keep the existing tests for loading, error + Retry and category filter, updating any changed button names.

- [ ] **Step 2: Run and confirm failure**

Run: `corepack pnpm vitest run --project web apps/web/src/app/shop/page.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Create `product-card.tsx`**

```tsx
"use client";

import { useState, type FormEvent } from "react";

import {
  formatShopPrice,
  isShopProductPurchasable,
  shopOrderMaximumQuantity,
  shopProductCategoryLabels,
  type ShopProductProjection,
} from "@bpt-jersey/domain/shop";
import type { BasketLine } from "../../lib/shop-basket";

const stockLabels = { "in-stock": "In stock", "made-to-order": "Made to order", "sold-out": "Sold out" } as const;

export function ProductCard({
  product,
  onAdd,
}: {
  product: ShopProductProjection;
  onAdd: (line: BasketLine) => void;
}) {
  const [size, setSize] = useState(product.sizes[0] ?? "");
  const [quantity, setQuantity] = useState("1");
  const purchasable = isShopProductPurchasable(product);

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const parsed = Math.min(shopOrderMaximumQuantity, Math.max(1, Math.trunc(Number(quantity)) || 1));
    setQuantity("1");
    onAdd({ productId: product.productId, size: product.sizes.length > 0 ? size : null, quantity: parsed });
  }

  return (
    <li className="shop-product-card">
      <figure className="shop-product-figure">
        {product.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- admin-managed catalog images are external URLs
          <img alt={product.name} decoding="async" height={600} loading="lazy" src={product.imageUrl} width={800} />
        ) : (
          <span className="shop-product-placeholder" aria-hidden="true">BPT</span>
        )}
      </figure>
      <div className="shop-product-body">
        <p className="card-label">{shopProductCategoryLabels[product.category]}</p>
        <h3>{product.name}</h3>
        <p className="shop-product-price">{formatShopPrice(product.priceMinor, product.currency)}</p>
        <span className={`shop-stock-badge shop-stock-${product.stockStatus}`}>{stockLabels[product.stockStatus]}</span>
        {product.description ? <p className="shop-product-description">{product.description}</p> : null}
        <form className="shop-order-form" onSubmit={submit}>
          {product.sizes.length > 0 ? (
            <label className="shop-field">
              Size
              <select aria-label={`Size for ${product.name}`} disabled={!purchasable} onChange={(event) => setSize(event.target.value)} value={size}>
                {product.sizes.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            </label>
          ) : null}
          <label className="shop-field">
            Quantity
            <input aria-label={`Quantity of ${product.name}`} disabled={!purchasable} inputMode="numeric" max={shopOrderMaximumQuantity} min={1} onChange={(event) => setQuantity(event.target.value)} type="number" value={quantity} />
          </label>
          <button
            aria-label={purchasable ? `Add ${product.name} to basket` : `${product.name} is sold out`}
            className="button button-primary"
            disabled={!purchasable}
            type="submit"
          >
            {purchasable ? "Add to basket" : "Sold out"}
          </button>
        </form>
      </div>
    </li>
  );
}
```

- [ ] **Step 4: Create `shop-orders.tsx`**

```tsx
import { formatShopPrice, shopOrderReference, shopPaymentMethodLabels, type ShopOrderProjection } from "@bpt-jersey/domain/shop";
import { academyContent } from "../../content/academy";

const statusLabels = { requested: "Requested", confirmed: "Confirmed", ready: "Ready to collect", collected: "Collected", cancelled: "Cancelled" } as const;
export const pickupNames: Readonly<Record<string, string>> = Object.fromEntries(academyContent.locations.map((location) => [location.key, location.name]));

export function ShopOrders({ orders }: { orders: readonly ShopOrderProjection[] }) {
  return (
    <section className="shop-section" aria-labelledby="shop-orders-title">
      <p className="account-eyebrow">Your orders</p>
      <h2 id="shop-orders-title">Order history</h2>
      {orders.length === 0 ? (
        <div className="shop-empty">
          <strong>No orders yet.</strong>
          <p>Orders appear here with their collection status.</p>
        </div>
      ) : (
        <ol className="shop-order-list">
          {orders.map((order) => (
            <li className="shop-order-item" key={order.orderId}>
              <div className="shop-order-item-head">
                <strong>{shopOrderReference(order.orderId)}</strong>
                <span className={`shop-status-badge shop-status-${order.status}`}>{statusLabels[order.status]}</span>
              </div>
              <ul className="shop-order-lines">
                {order.lines.map((line) => (
                  <li key={`${line.productId}|${line.size ?? ""}`}>
                    {line.quantity} × {line.productName}{line.size ? ` (${line.size})` : ""}
                    <span>{formatShopPrice(line.lineTotalMinor)}</span>
                  </li>
                ))}
              </ul>
              <p className="shop-order-meta">
                {new Date(order.createdAt).toLocaleDateString("en-GB")} · Collect from {pickupNames[order.pickupLocationId]} · {shopPaymentMethodLabels[order.paymentMethod]} · {order.paymentStatus === "paid" ? "Paid" : "Not paid yet"} · <strong>{formatShopPrice(order.totalMinor, order.currency)}</strong>
              </p>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
```

- [ ] **Step 5: Create `shop-checkout.tsx`**

```tsx
"use client";

import { useEffect, useState, type FormEvent } from "react";

import {
  formatShopPrice,
  shopOrderMaximumQuantity,
  shopOrderReference,
  type ShopOrderProjection,
  type ShopPaymentMethod,
  type ShopPickupLocationId,
  type ShopProductProjection,
} from "@bpt-jersey/domain/shop";
import { academyContent } from "../../content/academy";
import type { ClientSession } from "../../lib/client-auth";
import { basketLineKey, basketTotalMinor, setBasketQuantity, type BasketLine } from "../../lib/shop-basket";
import { placeShopOrder, uploadShopOrderProof } from "../../lib/shop-client";
import { EnrolmentBankDetails, useEnrolmentBankDetails } from "../enrol/payment-instructions";

function optionalText(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

export function ShopCheckout({
  products,
  lines,
  onLinesChange,
  session,
  signedIn,
  onPlaced,
}: {
  products: readonly ShopProductProjection[];
  lines: readonly BasketLine[];
  onLinesChange: (lines: readonly BasketLine[]) => void;
  session: ClientSession | undefined;
  signedIn: boolean;
  onPlaced: (order: ShopOrderProjection) => void;
}) {
  const byId = new Map(products.map((product) => [product.productId, product]));
  const [requestId, setRequestId] = useState(() => globalThis.crypto.randomUUID());
  const [contactName, setContactName] = useState(session?.displayName ?? "");
  const [contactPhone, setContactPhone] = useState("");
  const [note, setNote] = useState("");
  const [pickup, setPickup] = useState<ShopPickupLocationId>();
  const [method, setMethod] = useState<ShopPaymentMethod>();
  const [file, setFile] = useState<File>();
  const [preview, setPreview] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const bank = useEnrolmentBankDetails(signedIn && method === "bank_transfer" ? requestId : undefined);
  const total = basketTotalMinor(lines, products);

  useEffect(() => {
    if (session?.displayName && contactName.length === 0) setContactName(session.displayName);
  }, [session?.displayName, contactName.length]);

  useEffect(() => {
    if (!file) return setPreview(undefined);
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const ready =
    lines.length > 0 && contactName.trim().length > 0 && pickup !== undefined && method !== undefined && (method === "at_collection" || file !== undefined);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      const proofId = method === "bank_transfer" ? await uploadShopOrderProof(requestId, file!) : null;
      const placed = await placeShopOrder({
        requestId,
        lines: [...lines],
        pickupLocationId: pickup!,
        paymentMethod: method!,
        proofId,
        contactName: contactName.trim(),
        contactPhone: optionalText(contactPhone),
        note: optionalText(note),
      });
      setRequestId(globalThis.crypto.randomUUID());
      setFile(undefined);
      onPlaced(placed);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to place the order.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <aside className="shop-basket" aria-label="Basket and checkout">
      <section aria-labelledby="shop-basket-title">
        <p className="account-eyebrow">Basket</p>
        <h2 id="shop-basket-title">Your basket</h2>
        {lines.length === 0 ? (
          <p className="shop-basket-empty">Your basket is empty. Add an item to start an order.</p>
        ) : (
          <ul className="shop-basket-lines">
            {lines.map((line) => {
              const product = byId.get(line.productId);
              const key = basketLineKey(line);
              if (!product) return null;
              return (
                <li key={key}>
                  <span>{product.name}{line.size ? ` (${line.size})` : ""}</span>
                  <label className="visually-hidden" htmlFor={`basket-${key}`}>Quantity of {product.name}{line.size ? ` ${line.size}` : ""}</label>
                  <input id={`basket-${key}`} inputMode="numeric" max={shopOrderMaximumQuantity} min={0} onChange={(event) => onLinesChange(setBasketQuantity(lines, key, Number(event.target.value)))} type="number" value={line.quantity} />
                  <span className="shop-money">{formatShopPrice(product.priceMinor * line.quantity)}</span>
                  <button className="shop-text-button" onClick={() => onLinesChange(setBasketQuantity(lines, key, 0))} type="button">Remove<span className="visually-hidden"> {product.name}</span></button>
                </li>
              );
            })}
          </ul>
        )}
        <p className="shop-basket-total"><span>Total</span><strong className="shop-money">{formatShopPrice(total)}</strong></p>
      </section>

      {!signedIn ? (
        <div className="shop-checkout-signin">
          <p>Sign in to check out. New here? A buyer account takes a minute.</p>
          <a className="button button-primary" href="/login?returnTo=%2Fshop">Sign in or create a buyer account</a>
        </div>
      ) : lines.length > 0 ? (
        <form className="shop-checkout" onSubmit={(event) => void submit(event)}>
          <fieldset disabled={busy}>
            <legend>Your details</legend>
            <label className="shop-field" htmlFor="shop-contact-name">Name for the order
              <input autoComplete="name" id="shop-contact-name" maxLength={160} onChange={(event) => setContactName(event.target.value)} value={contactName} />
            </label>
            <p className="shop-field-hint">We will contact you at {session?.email}.</p>
            <label className="shop-field" htmlFor="shop-contact-phone">Phone (optional)
              <input autoComplete="tel" id="shop-contact-phone" maxLength={64} onChange={(event) => setContactPhone(event.target.value)} type="tel" value={contactPhone} />
            </label>
            <label className="shop-field" htmlFor="shop-order-note">Note for the academy (optional)
              <input id="shop-order-note" maxLength={500} onChange={(event) => setNote(event.target.value)} value={note} />
            </label>
          </fieldset>

          <fieldset disabled={busy}>
            <legend>Collect from</legend>
            {academyContent.locations.map((location) => (
              <label className="shop-choice" key={location.key}>
                <input checked={pickup === location.key} name="shop-pickup" onChange={() => setPickup(location.key as ShopPickupLocationId)} type="radio" value={location.key} />
                <span><strong>{location.name}</strong> {location.address}, {location.locality}</span>
              </label>
            ))}
          </fieldset>

          <fieldset disabled={busy}>
            <legend>Payment</legend>
            <label className="shop-choice">
              <input checked={method === "bank_transfer"} name="shop-payment" onChange={() => setMethod("bank_transfer")} type="radio" />
              <span>Bank transfer now</span>
            </label>
            <label className="shop-choice">
              <input checked={method === "at_collection"} name="shop-payment" onChange={() => { setMethod("at_collection"); setFile(undefined); }} type="radio" />
              <span>Pay when you collect</span>
            </label>
            {method === "bank_transfer" ? (
              <div className="shop-transfer">
                <EnrolmentBankDetails {...bank} />
                <p>Use the reference <strong>{shopOrderReference(requestId)}</strong> and transfer {formatShopPrice(total)}.</p>
                <label className="shop-field" htmlFor="shop-proof">Transfer screenshot
                  <input accept="image/png,image/jpeg" id="shop-proof" onChange={(event) => setFile(event.target.files?.[0])} type="file" />
                </label>
                <p className="shop-field-hint">PNG or JPEG, up to 2 MB.</p>
                {/* eslint-disable-next-line @next/next/no-img-element -- local object URL preview */}
                {preview ? <img alt="Transfer screenshot preview" className="shop-proof-preview" src={preview} /> : null}
              </div>
            ) : null}
            {method === "at_collection" ? <p className="shop-field-hint">Pay at the academy when you collect.</p> : null}
          </fieldset>

          {error ? <p className="shop-message shop-message-error" role="alert">{error}</p> : null}
          <button className="button button-primary shop-place-order" disabled={!ready || busy} type="submit">
            {busy ? "Placing order…" : `Place order · ${formatShopPrice(total)}`}
          </button>
        </form>
      ) : null}
    </aside>
  );
}
```

- [ ] **Step 6: Rewrite `page.tsx`**

Keep the existing load effect, category filter, error/Retry and loading blocks. Changes:

- `ClientAuthProvider acceptStaff` in the default export.
- State: `const [lines, setLines] = useState<readonly BasketLine[]>([]);` `const [placed, setPlaced] = useState<ShopOrderProjection>();`
- Phone: the spec allowed prefilling from an existing profile read; none exists for every role (a `shopper` has no profile), so the phone field starts empty and optional. Do not add a profile call.
- On load success: `const reconciled = reconcileBasket(readBasket(), products); setLines(reconciled.lines); writeBasket(reconciled.lines); if (reconciled.removed.length) setNotice({ tone: "success", text: `${reconciled.removed.join(", ")} ${reconciled.removed.length === 1 ? "was" : "were"} removed from your basket because ${reconciled.removed.length === 1 ? "it is" : "they are"} no longer available.` });`
- `function changeLines(next) { setLines(next); writeBasket(next); setPlaced(undefined); }`
- `function add(line) { const result = addToBasket(lines, line); if (result.full) setNotice({ tone: "error", text: "Your basket holds up to 10 different items." }); else changeLines(result.lines); }`
- `function handlePlaced(order) { changeLines([]); setPlaced(order); setState(s => s.status === "ready" ? { ...s, orders: [order, ...s.orders] } : s); }`
- Delete the "Collection details" section, the `shopPaymentMethodNote` paragraph, and the old `order` function; replace intro copy with: "Official Brazilian Power Team gis, rashguards, shorts, backpacks and casual wear. Pay by bank transfer or when you collect at Town or West."
- Ready layout:

```tsx
{placed ? (
  <section aria-label="Order placed" className="shop-confirmation" role="status">
    <p className="account-eyebrow">Order placed</p>
    <h2>{shopOrderReference(placed.orderId)}</h2>
    <p>{formatShopPrice(placed.totalMinor)} · collect from {pickupNames[placed.pickupLocationId]}. {placed.paymentMethod === "bank_transfer" ? "We will check your transfer and tell you when it is ready." : "Pay when you collect; we will tell you when it is ready."}</p>
  </section>
) : null}
<div className="shop-layout">
  <section className="shop-section" aria-labelledby="shop-catalog-title">
    {/* existing eyebrow, h2, empty state, filter bar */}
    <ul className="shop-product-grid" aria-label="Products">
      {visibleProducts.map((product) => <ProductCard key={product.productId} onAdd={add} product={product} />)}
    </ul>
  </section>
  <ShopCheckout lines={lines} onLinesChange={changeLines} onPlaced={handlePlaced} products={state.products} session={session} signedIn={signedIn} />
</div>
{lines.length > 0 ? (
  <a className="shop-basket-bar" href="#shop-basket-title">
    Basket · {lines.reduce((count, line) => count + line.quantity, 0)} items · {formatShopPrice(basketTotalMinor(lines, state.products))}
  </a>
) : null}
{signedIn ? <ShopOrders orders={state.orders} /> : null}
```

Import `pickupNames` from `./shop-orders`. Remove now-unused imports (`statusLabels`, `optionalText`, `placeShopOrder`, `shopPaymentMethodNote`, `shopOrderMaximumQuantity`).

- [ ] **Step 7: Styles in `shop.css`** (append; delete `.shop-payment-note` in `globals.css`)

```css
.shop-page {
  max-width: 90rem;
}

.shop-layout {
  display: grid;
  gap: clamp(1.5rem, 3vw, 2.5rem);
  grid-template-columns: minmax(0, 1fr);
}

.shop-basket {
  align-self: start;
  background: var(--gi-white);
  border-top: 0.35rem solid var(--bpt-purple);
  display: grid;
  gap: 1.5rem;
  margin-top: 3rem;
  padding: 1.25rem;
}

.shop-basket h2 {
  font-family: var(--font-display), Impact, sans-serif;
  margin: 0;
  text-transform: uppercase;
}

.shop-basket-lines {
  display: grid;
  gap: 0.75rem;
  list-style: none;
  margin: 1rem 0 0;
  padding: 0;
}

.shop-basket-lines li {
  align-items: center;
  border-bottom: 1px solid var(--line, #8a8880);
  display: grid;
  gap: 0.5rem;
  grid-template-columns: minmax(0, 1fr) 4.5rem auto;
  padding-bottom: 0.75rem;
}

.shop-basket-lines input {
  font-size: 1rem;
  min-height: 2.75rem;
  width: 100%;
}

.shop-basket-lines .shop-text-button {
  grid-column: 1 / -1;
  justify-self: start;
}

.shop-money,
.shop-basket-total strong {
  font-variant-numeric: tabular-nums;
}

.shop-basket-total {
  display: flex;
  font-size: 1.15rem;
  justify-content: space-between;
  margin: 1rem 0 0;
}

.shop-text-button {
  background: none;
  border: 0;
  color: var(--bpt-purple);
  cursor: pointer;
  font-weight: 700;
  min-height: 2.75rem;
  padding: 0;
  text-decoration: underline;
  text-underline-offset: 0.2em;
}

.shop-checkout {
  display: grid;
  gap: 1.5rem;
}

.shop-checkout fieldset {
  border: 0;
  display: grid;
  gap: 0.75rem;
  margin: 0;
  min-width: 0;
  padding: 0;
}

.shop-checkout legend {
  color: var(--bpt-purple);
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.15em;
  margin-bottom: 0.5rem;
  text-transform: uppercase;
}

.shop-choice {
  align-items: start;
  border: 1px solid var(--line, #8a8880);
  cursor: pointer;
  display: grid;
  gap: 0.75rem;
  grid-template-columns: auto minmax(0, 1fr);
  min-height: 3rem;
  padding: 0.75rem;
}

.shop-choice:has(input:checked) {
  background: #f0efff;
  border-color: var(--bpt-purple);
  border-left-width: 0.35rem;
}

.shop-field-hint {
  color: #65635d;
  font-size: 0.9rem;
  margin: 0;
}

.shop-transfer {
  display: grid;
  gap: 0.75rem;
}

.shop-proof-preview {
  border: 1px solid var(--line, #8a8880);
  max-height: 14rem;
  object-fit: contain;
  width: 100%;
}

.shop-place-order {
  width: 100%;
}

.shop-checkout-signin {
  border-left: 0.35rem solid var(--bpt-purple);
  display: grid;
  gap: 0.75rem;
  padding-left: 1rem;
}

.shop-confirmation {
  background: #e7f6ee;
  border-left: 0.35rem solid #176b49;
  margin-top: 2rem;
  padding: 1rem 1.25rem;
}

.shop-confirmation h2 {
  font-family: var(--font-display), Impact, sans-serif;
  margin: 0.25rem 0;
}

.shop-order-list {
  display: grid;
  gap: 1rem;
  list-style: none;
  margin: 1.25rem 0 0;
  padding: 0;
}

.shop-order-item {
  background: var(--gi-white);
  border-left: 0.35rem solid var(--bpt-purple);
  padding: 1rem 1.25rem;
}

.shop-order-item-head,
.shop-order-lines li {
  display: flex;
  gap: 1rem;
  justify-content: space-between;
}

.shop-order-lines {
  list-style: none;
  margin: 0.75rem 0;
  padding: 0;
}

.shop-order-lines span {
  font-variant-numeric: tabular-nums;
}

.shop-order-meta {
  color: #65635d;
  margin: 0;
}

.shop-basket-bar {
  background: var(--bpt-purple);
  bottom: 0;
  color: var(--gi-white);
  display: none;
  font-weight: 700;
  inset-inline: 0;
  padding: 1rem clamp(1.25rem, 4vw, 4.5rem) calc(1rem + env(safe-area-inset-bottom));
  position: fixed;
  z-index: 20;
}

@media (max-width: 47.99rem) {
  .shop-basket-bar {
    display: block;
  }

  .shop-page {
    padding-bottom: 6rem;
  }
}

@media (min-width: 64rem) {
  .shop-layout {
    grid-template-columns: minmax(0, 1fr) 24rem;
  }

  .shop-basket {
    max-height: calc(100dvh - 2rem);
    overflow-y: auto;
    position: sticky;
    top: 1rem;
  }

  .shop-page .shop-product-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (min-width: 90rem) {
  .shop-page .shop-product-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}
```

Also in `shop.css`, change `grid-row: span 7` / `grid-row: 7` so the card subgrid still lines up: the body now has 6 children (label, h3, price, badge, optional description, form). Keep 7 rows when a description exists by always rendering the description element (`<p className="shop-product-description">{product.description ?? ""}</p>`) so the row count is constant. The product-grid `repeat(3)` rule at `64rem` in the old file is replaced by the rules above (delete the old `@media (min-width: 64rem)` block).

- [ ] **Step 8: Run**

Run: `corepack pnpm vitest run --project web apps/web/src/app/shop/page.test.tsx && corepack pnpm --filter @bpt-jersey/web typecheck`
Expected: PASS (admin page typecheck errors are fixed in Task 8; if they block, run Task 8 before the typecheck and note it).

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/app/shop apps/web/src/app/globals.css
git commit -m "feat(shop): basket, checkout with payment and pickup centre, order confirmation"
```

---

### Task 7: Web — "Club shop" in the member area

**Files:**
- Modify: `apps/web/src/app/account/calendar/calendar-header.tsx:22-26`
- Test: the existing test that asserts the account links (`grep -rln "Courses & seminars" apps/web/src/app/account`), updated.

- [ ] **Step 1: Failing assertion**

In that test add: `expect(screen.getByRole("link", { name: "Club shop" })).toHaveAttribute("href", "/shop");`

- [ ] **Step 2: Run** — Expected: FAIL.

Run: `corepack pnpm vitest run --project web <that test file>`

- [ ] **Step 3: Implement** — add `{ href: "/shop", label: "Club shop" },` after the `Competitors` entry. The link is a plain route (`/shop` sits outside `/account`), so `Link` keeps working.

- [ ] **Step 4: Run** — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/account/calendar/calendar-header.tsx <that test file>
git commit -m "feat(account): link the club shop from the member area"
```

---

### Task 8: Web — `/admin/shop` reorganised around orders

**Files:**
- Modify: `apps/web/src/app/admin/shop/page.tsx`, `apps/web/src/app/admin/admin.css:4240-4430`
- Test: `apps/web/src/app/admin/shop/page.test.tsx`

**Interfaces:**
- Consumes: v2 `ShopOrderProjection`, `getShopOrderProofUrl` (Task 4), `shopOrderReference`, `shopPaymentMethodLabels` (Task 1), `pickupNames` exported by `apps/web/src/app/shop/shop-orders.tsx` (Task 6) — import it here from `../../shop/shop-orders`.

- [ ] **Step 1: Failing tests**

Update the order fixture to v2 and add:

```tsx
it("puts orders first and shows centre, payment method and lines", async () => {
  render(<ShopAdminPage />);
  const orders = await screen.findByRole("region", { name: "Orders" });
  const products = screen.getByRole("region", { name: "Products" });
  expect(orders.compareDocumentPosition(products) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(within(orders).getByText("West")).toBeVisible();
  expect(within(orders).getByText("Bank transfer")).toBeVisible();
  expect(within(orders).getByText(/1 × BPT gi \(A2\)/)).toBeVisible();
});

it("says how many products are hidden and uses shop wording", async () => {
  render(<ShopAdminPage />);
  expect(await screen.findByText("1 product is hidden. Clients cannot see it.")).toBeVisible();
  expect(screen.getByRole("button", { name: "Show BPT hidden in shop" })).toBeEnabled();
  expect(screen.getByRole("columnheader", { name: "Visible in shop" })).toBeVisible();
});

it("opens the transfer screenshot through a short-lived link", async () => {
  shopApi.getShopOrderProofUrl.mockResolvedValue("https://signed.test/proof");
  const open = vi.spyOn(window, "open").mockReturnValue(null);
  render(<ShopAdminPage />);
  await userEvent.setup().click(await screen.findByRole("button", { name: /View transfer screenshot/ }));
  expect(shopApi.getShopOrderProofUrl).toHaveBeenCalledWith(transferOrder.orderId);
  expect(open).toHaveBeenCalledWith("https://signed.test/proof", "_blank", "noopener,noreferrer");
});

it("filters orders by centre", async () => {
  render(<ShopAdminPage />);
  await userEvent.setup().selectOptions(await screen.findByLabelText("Centre"), "town");
  expect(screen.queryByText(shopOrderReference(transferOrder.orderId))).not.toBeInTheDocument();
});
```

(`transferOrder` = v2 order with `pickupLocationId: "west"`, `paymentMethod: "bank_transfer"`, one line `BPT gi` size `A2`; products fixture includes one hidden product named `BPT hidden`; add `getShopOrderProofUrl: vi.fn()` to the mocked shop client.)

- [ ] **Step 2: Run** — Expected: FAIL.

Run: `corepack pnpm vitest run --project web apps/web/src/app/admin/shop/page.test.tsx`

- [ ] **Step 3: Implement**

- Section header description: `"Process club shop orders and choose which products clients can see. Clients pay by bank transfer or when they collect."`; actions link `href="/shop"` text `"View the shop"`.
- Render order: notice → Orders section → Products section → editor form. Remove the wrapping `.shop-admin-grid`; wrap Products + editor in `<div className="shop-admin-catalog">`.
- Add `aria-labelledby` regions with `role="region"` implied by `<section aria-labelledby>` (testing-library resolves `region` for labelled sections).
- Hidden notice above the products table when `hiddenCount > 0`:
  `<p className="shop-admin-hidden-note">{hiddenCount === 1 ? "1 product is hidden. Clients cannot see it." : `${hiddenCount} products are hidden. Clients cannot see them.`}</p>`
- Products table: header `Visible in shop`; badge `product.active ? "Visible" : "Hidden"`; toggle label `product.active ? `Hide ${product.name} from shop` : `Show ${product.name} in shop``; success notices `"${name}" is now in the shop.` / `"${name}" is hidden from the shop.`
- Orders: add state `const [centreFilter, setCentreFilter] = useState<"all" | ShopPickupLocationId>("all");` with a second `<select id="shop-order-centre">` labelled `Centre` (options All centres / Town / West). Filter by both.
- Order table columns: `Order` (reference + date), `Customer` (name + phone), `Items` (each line `"{q} × {name} ({size})"` on its own `<span>`; note under in `.shop-admin-secondary`), `Collect from` (`pickupNames[...]`), `Total`, `Payment` (`shopPaymentMethodLabels[method]` + `AdminStatusBadge` Paid/Unpaid), `Status`, `Actions`.
- Actions add, when `order.paymentMethod === "bank_transfer"`:

```tsx
<button className="shop-admin-table-button" disabled={busy !== undefined} onClick={() => void viewProof(order)} type="button">
  View transfer screenshot<span className="visually-hidden"> for {shopOrderReference(order.orderId)}</span>
</button>
```

with

```ts
async function viewProof(order: ShopOrderProjection): Promise<void> {
  setBusy(`proof-${order.orderId}`);
  try {
    window.open(await getShopOrderProofUrl(order.orderId), "_blank", "noopener,noreferrer");
  } catch {
    setNotice({ tone: "error", text: "The transfer screenshot is unavailable." });
  } finally {
    setBusy(undefined);
  }
}
```

- `changeOrder` success text: ``Order ${shopOrderReference(updated.orderId)} updated.``
- CSS in `admin.css`: replace `.shop-admin-grid` rules with

```css
.shop-admin-page {
  display: grid;
  gap: 1.5rem;
  max-width: 90rem;
}

.shop-admin-catalog {
  display: grid;
  gap: 1.5rem;
}

@media (min-width: 80rem) {
  .shop-admin-catalog {
    grid-template-columns: minmax(0, 1fr) minmax(22rem, 26rem);
    align-items: start;
  }
}

.shop-admin-hidden-note {
  background: #fff8e6;
  border-left: 0.35rem solid #c98b00;
  color: #765400;
  margin: 0 0 1rem;
  padding: 0.75rem 1rem;
}

.shop-admin-order-lines {
  display: grid;
  gap: 0.2rem;
}
```

  and change the `@media (max-width: 64rem)` rule to only `.shop-admin-form-grid { grid-template-columns: 1fr; }` below `47.99rem` (two form columns stay on tablet). Keep table actions at `min-height: 2.75rem`.

- [ ] **Step 4: Run** — Expected: PASS; then `corepack pnpm --filter @bpt-jersey/web typecheck` clean.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/admin/shop apps/web/src/app/admin/admin.css
git commit -m "feat(admin): club shop puts orders first with centre, payment and screenshot"
```

---

### Task 9: Lint, format and focused verification

- [ ] **Step 1:** `corepack pnpm exec eslint --max-warnings 0 packages/domain/src/shop apps/functions/src/shop apps/functions/src/members/enrolment-payment-proof.ts apps/web/src/lib/shop-basket.ts apps/web/src/lib/shop-client.ts apps/web/src/lib/client-auth.tsx apps/web/src/app/shop apps/web/src/app/admin/shop apps/web/src/app/account/calendar/calendar-header.tsx` — Expected: no output.
- [ ] **Step 2:** `corepack pnpm exec prettier --write <same paths> docs/superpowers/plans/2026-10-01-shop-checkout.md` (never `docs/archive/`).
- [ ] **Step 3:** `corepack pnpm typecheck` across the three touched packages: `corepack pnpm --filter @bpt-jersey/domain typecheck && corepack pnpm --filter @bpt-jersey/functions typecheck && corepack pnpm --filter @bpt-jersey/web typecheck` — Expected: clean.
- [ ] **Step 4:** Re-run every test file touched in Tasks 1–8 in one command — Expected: all PASS.
- [ ] **Step 5:** `grep -rn "shopPaymentMethodNote\|parseShopOrderRequest\|ShopOrderRequest\b" apps packages qa --include=*.ts --include=*.tsx --include=*.mjs | grep -v node_modules | grep -v "/lib/"` — Expected: no hits (old contract fully removed; `qa/scripts/seed-shop-products.mjs` only touches products and stays valid).
- [ ] **Step 6:** Commit any formatting changes: `git commit -am "chore(shop): format"` (skip if clean).

---

### Task 10: End-to-end with Playwright MCP against emulators + visual audit

Runs on this VPS: port 8080 is code-server, emulators run in Docker (`bpt-emu:local`). The browser on the host needs to reach the emulators, so this run uses loopback-only port forwards instead of `--network none`.

- [ ] **Step 1: Build artefacts**

```bash
corepack pnpm --filter @bpt-jersey/domain build:runtime
corepack pnpm --filter @bpt-jersey/functions build
node apps/functions/scripts/build-deploy-artifact.mjs
```

- [ ] **Step 2: Synthetic secrets** (scratchpad env file, deleted at the end)

```bash
ENVF=/tmp/claude-0/-root-BPT-Jersey/e0946f51-d52e-4ed0-b860-95eba469166b/scratchpad/emu.env
GCLOUD_PROJECT=demo-bpt-jersey node qa/scripts/generate-synthetic-emulator-secrets.mjs --confirmation=SYNTHETIC-EMULATOR-SECRETS --env-file=$ENVF
printf 'FUNCTIONS_DISCOVERY_TIMEOUT=300000\nCOREPACK_ENABLE_NETWORK=0\nBPT_SYNTHETIC_PILOT=true\n' >> $ENVF
```

Copy `$ENVF` into the repo at `.tmp/emu.env` for the container (bind mounts of `/tmp/claude-0` arrive empty) and delete both at Step 9.

- [ ] **Step 3: Start emulators with a loopback relay**

Inside the container the emulators keep `127.0.0.1` (the private-storage guard needs a loopback Firestore host). A tiny Node relay inside the container republishes them on `0.0.0.0:1xxxx`, and Docker maps those to the host's `127.0.0.1` only:

```bash
docker run -d --name bpt-shop-e2e --env-file .tmp/emu.env \
  -p 127.0.0.1:19099:19099 -p 127.0.0.1:15001:15001 -p 127.0.0.1:18080:18080 \
  -v /root/BPT-Jersey:/root/BPT-Jersey -v /root/.cache/firebase:/root/.cache/firebase -v /root/.cache/node:/root/.cache/node \
  -w /root/BPT-Jersey bpt-emu:local bash -lc '
    node -e "for (const [a,b] of [[19099,9099],[15001,5001],[18080,8080]]) require(\"net\").createServer(s => { const t = require(\"net\").connect(b, \"127.0.0.1\"); s.pipe(t).pipe(s); s.on(\"error\",()=>t.destroy()); t.on(\"error\",()=>s.destroy()); }).listen(a, \"0.0.0.0\")" &
    node_modules/.bin/firebase emulators:start --project demo-bpt-jersey --only auth,firestore,functions'
```

Wait until `docker logs bpt-shop-e2e` shows `All emulators ready`. If image `bpt-emu:local` is missing, rebuild it per memory `vps-emulators-docker-sparse` before continuing.

- [ ] **Step 4: Seed** (from the host, against the forwarded ports)

```bash
export FIRESTORE_EMULATOR_HOST=127.0.0.1:18080 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:19099 GCLOUD_PROJECT=demo-bpt-jersey
SHOP_ACADEMY_ID=synthetic-academy SHOP_SEED_TARGET=emulator SHOP_SEED_PUBLISH=true node qa/scripts/seed-shop-products.mjs
AUTH_EMULATOR_E2E_EMAIL=owner@example.test AUTH_EMULATOR_E2E_PASSWORD=owner-pass-1234 AUTH_EMULATOR_E2E_ROLE=owner node qa/scripts/seed-auth-emulator.mjs
AUTH_EMULATOR_E2E_EMAIL=coach@example.test AUTH_EMULATOR_E2E_PASSWORD=coach-pass-1234 AUTH_EMULATOR_E2E_ROLE=coach node qa/scripts/seed-auth-emulator.mjs
```

If a seed script rejects the forwarded host (it may pin `127.0.0.1:8080`), run it inside the container instead with `docker exec bpt-shop-e2e bash -lc '<same command without the export line>'`. Then hide one product (`bpt-joggers`) and mark one sold out (`bpt-shorts`) via the owner UI in Step 6 so both states are visible.

- [ ] **Step 5: Run the web app against the emulators**

```bash
NEXT_PUBLIC_FIREBASE_ENV=local NEXT_PUBLIC_USE_FIREBASE_EMULATORS=true \
NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_PORT=19099 NEXT_PUBLIC_FIREBASE_FUNCTIONS_EMULATOR_PORT=15001 NEXT_PUBLIC_FIREBASE_FIRESTORE_EMULATOR_PORT=18080 \
NEXT_PUBLIC_ACADEMY_ID=synthetic-academy \
corepack pnpm --filter @bpt-jersey/web dev
```

plus the `NEXT_PUBLIC_FIREBASE_PROJECT_ID=demo-bpt-jersey` / API key / app id values that `qa/run-e2e.mjs` sets for its emulator build (copy them from that file). Run in the background; wait for `http://127.0.0.1:3000/shop` to answer 200.

- [ ] **Step 6: Drive the flows with Playwright MCP** (`mcp__plugin_playwright_playwright__*`)

1. Visitor at `/shop` (1440×900): products visible; sold-out card disabled; add gi (A2) ×2 and backpack ×1; basket total correct; "Sign in or create a buyer account" visible.
2. Click it → `/login` → "Create client account" with `buyer@example.test` → back on `/shop`: basket still holds both lines; name prefilled.
3. Choose West, Bank transfer, upload a small PNG (create one in the scratchpad with `node -e` writing an 8-byte PNG header + IHDR from a real 1×1 PNG base64) → Place order → green confirmation with reference and "West"; basket empty; order in history.
4. Second order: Town + Pay when you collect.
5. Sign out; sign in as `owner@example.test` at `/login` (staff flow) → `/admin/shop`: Orders first; both orders with centre, method, lines; "View transfer screenshot" opens the signed image; Confirm → Mark ready → Mark paid; filter by Town hides the West order; hidden-products notice reflects reality; toggle visibility of a product and confirm `/shop` updates.
6. Owner and coach at `/shop`: checkout visible (no "Sign in" prompt), order placement works.
7. Check `browser_console_messages` for errors on every page — Expected: none besides emulator warnings.

- [ ] **Step 7: Visual audit and fixes**

Take screenshots of `/shop` (empty basket, filled basket, checkout with transfer selected, confirmation) and `/admin/shop` at 390×844, 768×1024 and 1440×900 into `qa/screenshots/shop-checkout-2026-10-01/`. Audit each against the Global Constraints list (DESIGN.md rules): no horizontal scroll (`document.documentElement.scrollWidth <= innerWidth` via `browser_evaluate`), touch targets ≥ 44px, square corners, status as text + left rule, tabular money, eyebrow present, mobile basket bar not covering the Place order button. Fix every violation in the owning file, re-run that task's tests, re-screenshot, commit `fix(shop): <what>`.

- [ ] **Step 8: Rendimiento ligero**

With `browser_evaluate`, confirm product images have `loading="lazy"` and explicit width/height (no layout shift), and the `/shop` network log shows one catalogue call per load. No new dependency was added (`git diff 0ad9c4a -- '**/package.json'` is empty).

- [ ] **Step 9: Tear down**

```bash
docker rm -f bpt-shop-e2e
rm -f .tmp/emu.env /tmp/claude-0/-root-BPT-Jersey/e0946f51-d52e-4ed0-b860-95eba469166b/scratchpad/emu.env
```

Stop the dev server. Commit the screenshots folder only if the repo already tracks `qa/screenshots/` (check `git ls-files qa/screenshots | head -1`); otherwise leave them untracked and list them in the report.

---

### Task 11: Handoff — push, deploy and publish (operator-gated)

- [ ] **Step 1:** Report to the operator in Spanish: commits (`git log --oneline 0ad9c4a..HEAD`), tests run and results, Playwright evidence, open issues.
- [ ] **Step 2:** Ask explicitly before `git push origin main` (Cloudflare Pages auto-publishes the web on push; the new web calls `uploadShopOrderProof`/new `placeShopOrder` payload, so **functions must deploy in the same window**).
- [ ] **Step 3:** After the OK, deploy only the affected functions, one batch: `placeShopOrder, uploadShopOrderProof, getShopOrderProofUrl, listShopCatalog, listMyShopOrders, listShopOrders, updateShopOrder, listPublicShopCatalog, listManagedShopProducts, saveShopProduct, setShopProductActive, getEnrolmentPaymentInstructions` (`firebase deploy --only functions:<name>,…`), from the operator's terminal per memory (the classifier blocks `firebase deploy` here). Then push. Verify both SHAs (`git rev-parse HEAD origin/main`).
- [ ] **Step 4:** Publishing the 5 production products: the owner presses "Show … in shop" in the new panel, or, with explicit confirmation, run `setShopProductActive` for each from the panel session. Never write prod Firestore directly without that confirmation.
- [ ] **Step 5:** Update memory (`project` type) with the shipped state and pointer to this plan.
