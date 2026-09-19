import { expect, test } from "@playwright/test";

import { installAdminFixture, type CallableCall } from "./admin-fixture";

test.describe("admin shell @smoke", () => {
  test("renders the data-free shell without overflow across viewports", async ({
    page,
  }, testInfo) => {
    const browserErrors: string[] = [];

    page.on("console", (message) => {
      if (message.type() === "error") {
        browserErrors.push(message.text());
      }
    });
    page.on("pageerror", (error) => browserErrors.push(error.message));

    // The static export writes this route as admin.html; keep the test URL semantic as /admin.
    await installAdminFixture(page);

    const response = await page.goto("/admin?adminTestRole=owner");

    expect(response?.ok()).toBe(true);
    await expect(page).toHaveTitle(/BPT Jersey/);
    await expect(
      page.getByRole("heading", { name: "Academy control room", level: 1 }),
    ).toBeVisible();

    const desktopNavigation = page.locator(".admin-desktop-navigation");
    const skipLink = page.getByRole("link", { name: "Skip to main content" });
    await page.keyboard.press("Tab");
    await expect(skipLink).toBeFocused();
    await skipLink.press("Enter");
    await expect(page.locator("main#admin-main-content")).toBeFocused();

    if (testInfo.project.name === "mobile-chromium") {
      await expect(page.locator(".admin-sidebar")).toBeHidden();
      const menuButton = page.getByRole("button", { name: "Open admin navigation" });
      await expect(menuButton).toBeVisible();
      await menuButton.click();
      const drawer = page.getByRole("dialog", { name: "Admin navigation" });
      await expect(drawer).toBeVisible();
      await expect(drawer.getByRole("img", { name: "BPT Jersey mobile logo" })).toBeVisible();
      await expect(page.locator(".admin-mobile-backdrop")).toBeVisible();
      await expect(drawer.getByRole("link", { name: "Members", exact: true })).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(drawer).not.toBeVisible();
    } else {
      await expect(page.locator(".admin-sidebar")).toBeVisible();
      await expect(
        desktopNavigation.getByRole("link", { name: "Members", exact: true }),
      ).toBeVisible();
      await expect(page.getByRole("button", { name: /admin navigation/i })).toBeHidden();
    }

    await expect(
      page.getByRole("heading", { name: "Today's academy view", level: 2 }),
    ).toBeVisible();
    await expect(page.getByText("No connected sessions are scheduled for today.")).toBeVisible();
    await expect(page.getByRole("table", { name: "Today's classes" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Add new member" })).toHaveCount(0);
    await expect(page.getByLabel("Quick actions")).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Next birthdays" })).toBeVisible();

    const bodyText = await page.locator("body").innerText();
    expect(bodyText).not.toMatch(
      /203\.0\.113\.10|synthetic member|source-demo-\d|memberNumber|\bIP\b|\bpassword\b|\bsecret\b|api[_ -]?key|\bbearer\b/i,
    );

    const dimensions = await page.evaluate(() => ({
      documentWidth: document.documentElement.scrollWidth,
      documentClientWidth: document.documentElement.clientWidth,
      bodyWidth: document.body.scrollWidth,
      bodyClientWidth: document.body.clientWidth,
    }));
    expect(dimensions.documentWidth).toBeLessThanOrEqual(dimensions.documentClientWidth);
    expect(dimensions.bodyWidth).toBeLessThanOrEqual(dimensions.bodyClientWidth);
    expect(browserErrors).toEqual([]);
  });

  test("selects a route from the mobile drawer without horizontal overflow", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile-chromium");

    await installAdminFixture(page);

    await page.goto("/admin?adminTestRole=owner");
    await page.getByRole("button", { name: "Open admin navigation" }).click();
    await page
      .getByRole("dialog", { name: "Admin navigation" })
      .getByRole("link", {
        name: "Members",
        exact: true,
      })
      .click();
    await expect(page).toHaveURL(/\/admin\/members/);
    await expect(page.getByRole("dialog", { name: "Admin navigation" })).not.toBeVisible();

    const dimensions = await page.evaluate(() => ({
      documentWidth: document.documentElement.scrollWidth,
      documentClientWidth: document.documentElement.clientWidth,
      bodyWidth: document.body.scrollWidth,
      bodyClientWidth: document.body.clientWidth,
    }));
    expect(dimensions.documentWidth).toBeLessThanOrEqual(dimensions.documentClientWidth);
    expect(dimensions.bodyWidth).toBeLessThanOrEqual(dimensions.bodyClientWidth);
  });

  test("shows a coach the seven modules and nothing else", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chromium");

    const calls: CallableCall[] = [];
    await installAdminFixture(page, { calls, role: "coach" });
    await page.goto("/admin?adminTestRole=coach");

    const navigation = page.locator(".admin-desktop-navigation");
    await expect(navigation.getByRole("link")).toHaveText([
      // The coach workspace group leads the menu since d3be699 / 8b9ddff.
      "->Dashboard",
      "->Progression syllabus",
      "->My sign-in",
      "->Overview",
      "->Attendance",
      // Operator decision 2026-09-17 (grill G6, T051V2 Plan B): the mat reads the member record
      // through name search. The OFFICE directory at /admin/members stays office-only, asserted
      // below. This spec still said six after that shipped, so @smoke has been red since.
      "->Member search",
      "->Enrolment requests",
      "->Medical conditions",
      "->Classes / Services",
      "->Levels",
    ]);
    await expect(navigation.getByRole("link", { name: "Dashboard" })).toHaveAttribute(
      "href",
      "/coach",
    );
    await expect(
      page.getByRole("heading", { name: "Today's academy view", level: 2 }),
    ).toBeVisible();
    // Verify that office-only and billing modules are absent
    await expect(page.getByRole("link", { name: "Members" })).not.toBeVisible();
    await expect(page.getByRole("link", { name: "Billing" })).not.toBeVisible();
    await expect(page.getByRole("link", { name: "Shop" })).not.toBeVisible();
    await expect(page.getByRole("link", { name: "Staff" })).not.toBeVisible();
    await expect(page.getByRole("link", { name: "Reports" })).not.toBeVisible();
    // The operational report carries revenue amounts, so the mat never asks for it (ADR-010).
    await expect(page.getByRole("article", { name: /Overdue memberships/ })).toHaveCount(0);
    expect(calls.filter((call) => call.name === "getOperationalReport")).toEqual([]);
    await page.screenshot({
      path: testInfo.outputPath(`admin-shell-coach-${testInfo.project.name}.png`),
      fullPage: true,
    });
  });
});
