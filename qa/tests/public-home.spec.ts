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
    const initialUrl = new URL(page.url());
    await expect(page).toHaveTitle(/BPT Jersey/);
    await expect(
      page.getByRole("heading", {
        name: /Brazilian Jiu-Jitsu, MMA & Self-Defence/i,
        level: 1,
      }),
    ).toBeVisible();
    const primaryNavigation = page.getByRole("navigation", { name: "Primary navigation" });
    await expect(primaryNavigation).toBeVisible();
    await expect(
      primaryNavigation.getByRole("link", { name: "Locations", includeHidden: true }),
    ).toHaveAttribute("href", "#locations");
    await expect(page.locator("#locations")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Classes in Jersey" })).toBeVisible();
    await expect(page.getByText("Office 9, 13 Library Place", { exact: true })).toBeVisible();
    const feesSection = page.locator("#fees");
    await expect(feesSection.getByText("£85", { exact: true })).toBeVisible();
    await expect(feesSection.getByText("£10 / £65", { exact: true })).toBeVisible();
    await expect(feesSection.getByText("£95", { exact: true })).toBeVisible();
    const scheduleRows = page.locator("#classes table tbody tr.schedule-row");
    await expect(scheduleRows).toHaveCount(8);
    await expect(scheduleRows.first()).toBeVisible();

    const skipLink = page.getByRole("link", { name: "Skip to main content" });
    await page.keyboard.press("Tab");
    await expect(skipLink).toBeFocused();
    await expect(skipLink).toHaveAccessibleName("Skip to main content");
    await skipLink.press("Enter");
    await expect(page.locator("main#main-content")).toBeFocused();

    await page.getByRole("link", { name: "View classes" }).click();
    const classesUrl = new URL(page.url());
    expect(classesUrl.origin).toBe(initialUrl.origin);
    expect(classesUrl.pathname).toBe(initialUrl.pathname);
    expect(classesUrl.hash).toBe("#classes");

    const main = page.locator("main");
    await main.getByRole("link", { name: "Book a free class" }).first().click();
    const contactUrl = new URL(page.url());
    expect(contactUrl.origin).toBe(initialUrl.origin);
    expect(contactUrl.pathname).toBe(initialUrl.pathname);
    expect(contactUrl.hash).toBe("#contact");
    const contactSection = page.locator("#contact");
    const contactCta = contactSection.getByRole("link", { name: "Book a free class" });
    await expect(contactCta).toBeVisible();
    await expect(contactCta).toHaveAttribute("href", "#contact");
    await expect(
      page.getByText("Public information last verified 2026-08-07.", { exact: true }),
    ).toBeVisible();
    await expect(page.locator('a[href="https://bptjersey.com/"]')).toHaveCount(0);

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
