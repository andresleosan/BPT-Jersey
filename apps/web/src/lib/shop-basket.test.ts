import { describe, expect, it } from "vitest";

import {
  addToBasket,
  basketStorageKey,
  basketTotalMinor,
  readBasket,
  reconcileBasket,
  setBasketQuantity,
  writeBasket,
  type BasketLine,
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
    let lines: readonly BasketLine[] = Array.from({ length: 10 }, (_, index) => ({ productId: `p-${index}0`, size: null, quantity: 1 }));
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
  it("removes a line when the quantity is not a number", () => {
    const lines = [{ productId: "bpt-gi", size: "A2", quantity: 2 }];
    expect(setBasketQuantity(lines, "bpt-gi|A2", Number.NaN)).toEqual([]);
  });
  it("stores only product, size and quantity for each line", () => {
    const storage = memoryStorage();
    const line = { productId: "bpt-gi", size: "A2", quantity: 2, name: "BPT gi", priceMinor: 1 };
    writeBasket([line as BasketLine], storage);
    expect(JSON.parse(storage.values.get(basketStorageKey) ?? "null")).toEqual([{ productId: "bpt-gi", size: "A2", quantity: 2 }]);
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
