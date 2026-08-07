import { expect, test } from "@playwright/test";

test.describe("public homepage @smoke", () => {
  test("presents the BPT Jersey academy and platform across viewports", async ({
    page,
  }, testInfo) => {
    const browserErrors: string[] = [];

    page.on("console", (message) => {
      if (message.type() === "error") {
        browserErrors.push(message.text());
      }
    });
    page.on("pageerror", (error) => browserErrors.push(error.message));

    const response = await page.goto("/");

    expect(response?.ok()).toBe(true);
    await expect(page).toHaveTitle(/BPT Jersey/);
    await expect(page.getByRole("heading", { name: /built for the mat/i, level: 1 })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Primary navigation" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Tonight at BPT" })).toBeVisible();

    await page.getByRole("link", { name: "Explore the platform" }).click();

    await expect(page).toHaveURL(/#platform$/);
    await expect(
      page.getByRole("heading", { name: "One academy. One clear system." }),
    ).toBeVisible();

    const hasHorizontalOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(hasHorizontalOverflow).toBe(false);
    expect(browserErrors).toEqual([]);

    if (process.env.CAPTURE_VISUALS === "true") {
      await page.screenshot({
        path: `visuals/home-${testInfo.project.name}.png`,
        fullPage: true,
      });
    }
  });
});
