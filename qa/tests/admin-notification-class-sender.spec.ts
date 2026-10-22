import { writeFileSync } from "node:fs";

import { expect, test } from "@playwright/test";

import { installAdminFixture } from "./admin-fixture";
import { blockExternalRequests } from "./network-guard";

/**
 * c886d32: a class notice without details.from named its sender «Classe» (the plural tab label
 * minus its last letter). It reads «Class» in the row and in the reading pane. Synthetic
 * listAdminNotifications on loopback only.
 */
const base = {
  href: "/admin/members",
  createdAt: "2026-10-20T10:00:00.000Z",
  // Read notices: opening one sends no updateAdminNotification.
  readAt: "2026-10-20T11:00:00.000Z",
  resolvedAt: null,
  membershipId: null,
  studentId: null,
  endsAt: null,
};
const classNotice = {
  ...base,
  notificationId: "n-class",
  kind: "class",
  title: "Kids Gi moved to 17:30",
  message: "The Thursday class starts half an hour later.",
};
const paymentNotice = {
  ...base,
  notificationId: "n-payment",
  kind: "payment",
  title: "Payment received",
  message: "A payment was recorded.",
};

test.describe("Admin notifications: class sender (c886d32)", () => {
  test.skip(process.env.NEXT_PUBLIC_ADMIN_E2E !== "true", "needs the admin E2E build");
  test.setTimeout(180_000);

  test("a class notice without a sender reads «Class», never «Classe»", async ({
    page,
  }, testInfo) => {
    const errors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(`console: ${message.text()}`);
    });
    page.on("pageerror", (error) => errors.push(`page: ${error.message}`));
    await installAdminFixture(page, {
      role: "owner",
      callables: {
        listAdminNotifications: {
          notifications: [classNotice, paymentNotice],
          nextCursor: null,
          unreadCount: 0,
        },
      },
    });
    const blocked = await blockExternalRequests(page, []);
    await page.goto("/admin?adminTestRole=owner", { timeout: 120_000 });

    const list = page.getByRole("list", { name: "Notifications" });
    await expect(list).toBeVisible({ timeout: 60_000 });
    const row = list.getByRole("button").filter({ hasText: classNotice.title });
    await expect(row.locator(".admin-inbox-row-from")).toHaveText("Class");
    await expect(
      list
        .getByRole("button")
        .filter({ hasText: paymentNotice.title })
        .locator(".admin-inbox-row-from"),
    ).toHaveText("Payment");

    await row.click();
    const reader = page.getByRole("article", { name: classNotice.title });
    await expect(reader.locator(".admin-eyebrow")).toHaveText("Class");
    await expect(reader.locator(".admin-inbox-meta strong")).toHaveText("Class");
    await expect(page.getByText("Classe", { exact: true })).toHaveCount(0);

    const width = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      client: document.documentElement.clientWidth,
    }));
    expect(width.scroll, "no horizontal page scroll").toBeLessThanOrEqual(width.client);
    await page.screenshot({
      path: testInfo.outputPath(`class-sender-${testInfo.project.name}.png`),
      fullPage: true,
      style: ".skip-link { display: none !important; }",
    });
    writeFileSync(testInfo.outputPath("blocked-requests.json"), JSON.stringify(blocked, null, 2));
    expect(blocked).toEqual([]);
    expect(errors).toEqual([]);
  });
});
