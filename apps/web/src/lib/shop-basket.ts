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
  if (!(quantity >= 1)) return lines.filter((item) => basketLineKey(item) !== key);
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
    else
      storage?.setItem(
        basketStorageKey,
        JSON.stringify(lines.map(({ productId, size, quantity }) => ({ productId, size, quantity }))),
      );
  } catch {
    // Private mode or blocked storage: the basket simply lives in memory for this visit.
  }
}
