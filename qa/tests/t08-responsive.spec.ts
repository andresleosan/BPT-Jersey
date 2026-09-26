import { expect, test, type Page } from "@playwright/test";

import { installAdminFixture } from "./admin-fixture";

/**
 * T08: every main surface fits phones, tablets and desktops without horizontal scroll. Admin and
 * coach routes are signed in through the synthetic admin fixture (static export built with
 * NEXT_PUBLIC_ADMIN_E2E=true); /account/calendar is measured in the state a visitor without a
 * session reaches, since member sign-in needs the Auth Emulator.
 */
const routes = [
  "/",
  "/login",
  "/shop",
  "/courses",
  "/levels",
  "/account/calendar",
  "/admin",
  "/admin/attendance",
  "/admin/classes-services/classes",
  "/coach",
];

/** The static server has no clean URLs: `/login` is `login.html`. /admin is left to the fixture. */
async function serveStaticRoutes(page: Page): Promise<void> {
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    const isPage =
      route.request().resourceType() === "document" &&
      url.pathname !== "/" &&
      !url.pathname.split("/").pop()?.includes(".");
    if (!isPage || url.pathname.startsWith("/admin")) {
      await route.fallback();
      return;
    }
    url.pathname = `${url.pathname.replace(/\/$/u, "")}.html`;
    await route.continue({ url: url.toString() });
  });
}

async function open(page: Page, route: string): Promise<void> {
  const staff = route.startsWith("/admin") || route === "/coach";
  if (staff) {
    await installAdminFixture(page, {
      role: route === "/coach" ? "coach" : "owner",
      callables: { listSessions: { sessions: [] } },
    });
  }
  await serveStaticRoutes(page);
  await page.goto(route === "/coach" ? "/coach?adminTestRole=coach" : route);
  await page.waitForLoadState("networkidle");
}

for (const width of [320, 390, 768, 1024, 1440]) {
  for (const route of routes) {
    test(`${route} has no horizontal scroll at ${width}px`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 900 });
      await open(page, route);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
      const name = route.replaceAll("/", "_").replace(/^_/u, "") || "home";
      await page.screenshot({
        path: `screenshots/t08-${testInfo.project.name}-${name}-${width}.png`,
        fullPage: true,
      });
    });
  }
}

test("landing menu opens on phones", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto("/");
  const menu = page.getByRole("button", { name: "Menu" });
  const navigation = page.getByRole("navigation", { name: "Primary navigation" });
  await expect(navigation.getByRole("link", { name: "Classes" })).toBeHidden();
  await expect(navigation.getByRole("link", { name: "Sign in" })).toBeVisible();

  await menu.click();
  await expect(menu).toHaveAttribute("aria-expanded", "true");
  await expect(navigation.getByRole("link", { name: "Classes" })).toBeVisible();
  for (const link of await navigation.getByRole("link").all()) {
    const box = await link.boundingBox();
    if (box) expect(box.height, await link.innerText()).toBeGreaterThanOrEqual(44);
  }

  await page.keyboard.press("Escape");
  await expect(menu).toHaveAttribute("aria-expanded", "false");
  await expect(menu).toBeFocused();
  await expect(navigation.getByRole("link", { name: "Classes" })).toBeHidden();
});

test("landing shows every link without a menu on desktop", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Menu" })).toBeHidden();
  const navigation = page.getByRole("navigation", { name: "Primary navigation" });
  await expect(navigation.getByRole("link", { name: "Classes" })).toBeVisible();
});

test("hero title keeps each line whole at 320px", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 900 });
  await page.goto("/");
  const lines = page.locator("#hero-title .hero-title-line");
  await expect(lines).toHaveCount(3);
  const hero = await page.locator(".hero-copy").boundingBox();
  for (const line of await lines.all()) {
    const box = await line.boundingBox();
    expect(box && hero && box.x + box.width <= hero.x + hero.width + 0.5).toBe(true);
  }
});

test("form controls are at least 16px", async ({ page }) => {
  await serveStaticRoutes(page);
  await page.goto("/login");
  const controls = await page.locator("input, select, textarea").all();
  expect(controls.length).toBeGreaterThan(0);
  for (const input of controls) {
    expect(
      parseFloat(await input.evaluate((element) => getComputedStyle(element).fontSize)),
    ).toBeGreaterThanOrEqual(16);
  }
});

test("admin sign-out is a 44px target on desktop", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  // The synthetic owner session has no sign-out; the staff session does.
  await installAdminFixture(page, {
    role: "coach",
    callables: { listSessions: { sessions: [] } },
  });
  await page.goto("/admin/attendance?adminTestRole=coach");
  const signOut = page.getByRole("button", { name: "Sign out" });
  await expect(signOut).toBeVisible();
  expect((await signOut.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
});
