import { expect, test, type Page } from "@playwright/test";

const dashboard = {
  currency: "GBP",
  generatedAt: "2026-08-24T12:00:00.000Z",
  period: { from: "2026-08-01T00:00:00.000Z", to: "2026-08-24T12:00:00.000Z" },
  renewalWindow: { from: "2026-08-24T12:00:00.000Z", to: "2026-09-23T12:00:00.000Z" },
  metrics: {
    collectedMinor: 9_000,
    activeMemberships: 2,
    outstandingMinor: 8_000,
    paymentsReceived: 2,
    overdueBalances: 1,
    renewalsDue: 1,
  },
  recentPayments: [
    { invoiceReference: "INV-002", amountMinor: 5_000, occurredAt: "2026-08-10T00:00:00.000Z" },
  ],
  balanceAttention: [
    {
      invoiceReference: "INV-001",
      balanceMinor: 6_000,
      dueAt: "2026-08-10T00:00:00.000Z",
      status: "partially_paid",
      overdue: true,
    },
    {
      invoiceReference: "INV-003",
      balanceMinor: 2_000,
      dueAt: "2026-09-01T00:00:00.000Z",
      status: "open",
      overdue: false,
    },
  ],
  upcomingRenewals: [
    { planId: "bpt-jersey-adult", nextBillingAt: "2026-08-30T00:00:00.000Z", status: "active" },
  ],
};

async function installFinancialDashboardFixture(page: Page, requests: unknown[]): Promise<void> {
  await page.route("**/*", async (route) => {
    const requestUrl = new URL(route.request().url());
    if (requestUrl.pathname.endsWith("/getFinancialDashboard")) {
      requests.push(route.request().postDataJSON());
      await route.fulfill({
        body: JSON.stringify({ data: { dashboard } }),
        contentType: "application/json",
        status: 200,
      });
      return;
    }
    await route.continue();
  });
}

test.describe("financial dashboard", () => {
  test("loads balances, receipts, and renewals without identity or card data", async ({ page }) => {
    const browserErrors: string[] = [];
    const requests: unknown[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") browserErrors.push(message.text());
    });
    page.on("pageerror", (error) => browserErrors.push(error.message));
    await installFinancialDashboardFixture(page, requests);

    await page.goto("/admin/finance?adminTestRole=owner");

    await expect(page.getByRole("heading", { name: "Finance", level: 2 })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Next financial actions" })).toBeVisible();
    await expect(page.getByText("£90.00")).toBeVisible();
    await expect(page.getByText("£80.00")).toBeVisible();
    await expect(page.getByRole("table", { name: "Outstanding invoice balances" })).toBeVisible();
    await expect(page.getByRole("table", { name: "Upcoming membership renewals" })).toBeVisible();
    await expect(page.getByRole("table", { name: "Recent recorded payments" })).toBeVisible();

    await page.getByLabel("Balance status").selectOption("Due later");
    await expect(page.getByText("INV-003")).toBeVisible();
    await expect(page.getByText("INV-001")).not.toBeVisible();

    expect(requests).toEqual([{ data: null }]);
    const bodyText = await page.locator("body").innerText();
    expect(bodyText).not.toMatch(
      /familyId|studentId|membershipId|card number|cvv|cvc|providerReference|private-/iu,
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
});
