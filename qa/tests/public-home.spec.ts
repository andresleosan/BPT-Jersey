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
    const heroTitle = page.getByRole("heading", {
      name: "Brazilian Jiu-Jitsu, MMA & Self-Defence",
      level: 1,
    });

    await expect(heroTitle).toBeVisible();
    await expect(heroTitle.locator(".hero-title-line")).toHaveText([
      "Brazilian Jiu-",
      "Jitsu, MMA",
      "& Self-Defence",
    ]);
    const titleLines = heroTitle.locator(".hero-title-line");
    await expect(titleLines).toHaveCount(3);
    for (let index = 0; index < 3; index += 1) {
      await expect
        .poll(() =>
          titleLines.nth(index).evaluate((line) => {
            const range = document.createRange();
            range.selectNodeContents(line);
            return range.getClientRects().length;
          }),
        )
        .toBe(1);
    }
    const primaryNavigation = page.getByRole("navigation", { name: "Primary navigation" });
    await expect(primaryNavigation).toBeVisible();
    await expect(
      primaryNavigation.getByRole("link", { name: "Locations", includeHidden: true }),
    ).toHaveAttribute("href", "#locations");
    await expect(page.locator("#locations")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Classes in Jersey" })).toBeVisible();
    await expect(
      page.locator("#locations").getByText("Office 9, 13 Library Place", { exact: true }),
    ).toBeVisible();
    const feesSection = page.locator("#fees");
    await expect(feesSection.getByText("£125 per month", { exact: true })).toBeVisible();
    await expect(feesSection.getByText("£135 per term", { exact: true })).toBeVisible();
    await expect(feesSection.getByText("£7.50 per class", { exact: true })).toBeVisible();
    await expect(feesSection.getByText("Town Teens", { exact: true })).toHaveCount(0);
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

    // Since 4808277 "Book a free class" is the enrolment call to action, not an in-page anchor:
    // the hero button and the contact section's button both open /enrol. The click that follows
    // it is at the end of the test, so everything measured on the home page is measured first.
    const main = page.locator("main");
    const heroEnrolCta = main.getByRole("link", { name: "Book a free class" }).first();
    await expect(heroEnrolCta).toHaveAttribute("href", "/enrol");
    const contactSection = page.locator("#contact");
    const contactCta = contactSection.getByRole("link", { name: "Book a free class" });
    await expect(contactCta).toBeVisible();
    await expect(contactCta).toHaveAttribute("href", "/enrol");
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

    await contactCta.click();
    const enrolUrl = new URL(page.url());
    expect(enrolUrl.origin).toBe(initialUrl.origin);
    expect(enrolUrl.pathname).toBe("/enrol");
  });
});
