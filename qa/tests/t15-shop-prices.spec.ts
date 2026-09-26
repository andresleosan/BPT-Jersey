import { expect, test, type Page } from "@playwright/test";

/**
 * T15: the club shop keeps one column on phones, uses two columns between 48rem and 64rem and
 * three from 64rem, and lines the prices up across a row with tabular figures. Prices come from
 * the published catalogue (answered here, no emulator); the page never computes them.
 */
const product = (productId: string, name: string, priceMinor: number, sortOrder: number) => ({
  productId,
  name,
  category: "gi" as const,
  description: null,
  priceMinor,
  currency: "GBP" as const,
  sizes: [],
  imageUrl: null,
  stockStatus: "in-stock" as const,
  sortOrder,
  active: true,
});

// Names of different lengths wrap to a different number of lines: the prices must still line up.
const catalogue = [
  product("bpt-gi-competition", "BPT competition gi with a long reinforced name", 11000, 1),
  product("bpt-gi-kids", "Kids gi", 6500, 2),
  product("bpt-gi-training", "Training gi", 9500, 3),
];

async function openShop(page: Page, width: number): Promise<void> {
  await page.setViewportSize({ width, height: 900 });
  await page.route("**/*", async (route) => {
    const requestUrl = new URL(route.request().url());
    if (requestUrl.pathname === "/shop") {
      requestUrl.pathname = "/shop.html";
      await route.continue({ url: requestUrl.toString() });
      return;
    }
    await route.continue();
  });
  await page.route("**/listPublicShopCatalog", (route) =>
    route.fulfill({ contentType: "application/json", body: JSON.stringify({ data: catalogue }) }),
  );
  await page.goto("/shop");
}

async function priceTops(page: Page): Promise<number[]> {
  const prices = page.locator(".shop-product-price");
  await expect(prices.first()).toBeVisible();
  return prices.evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().top)));
}

test("shop prices line up in two columns on a tablet", async ({ page }) => {
  await openShop(page, 900);
  const tops = await priceTops(page);
  expect(tops.filter((top) => top === tops[0])).toHaveLength(2);
  expect(
    await page
      .locator(".shop-product-price")
      .first()
      .evaluate((el) => getComputedStyle(el).fontVariantNumeric),
  ).toContain("tabular-nums");
});

test("shop prices line up in three columns on desktop", async ({ page }) => {
  await openShop(page, 1280);
  const tops = await priceTops(page);
  expect(tops.filter((top) => top === tops[0])).toHaveLength(3);
});

test("shop mobile layout is unchanged", async ({ page }) => {
  await openShop(page, 390);
  await expect(page.locator(".shop-product-price").first()).toBeVisible();
  await expect(page).toHaveScreenshot("shop-390.png", { fullPage: true });
});
