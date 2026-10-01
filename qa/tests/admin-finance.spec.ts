import { expect, test } from "@playwright/test";

import { installAdminFixture, type CallableCall, type CallableResponder } from "./admin-fixture";

// The page opens on the current UTC month, so the fixture is dated inside it at runtime.
const now = new Date();
const currentMonth = now.toISOString().slice(0, 7);
const previousMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1))
  .toISOString()
  .slice(0, 7);
const monthStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
const day = 24 * 60 * 60 * 1000;
const at = (offsetMs: number) => new Date(monthStart + offsetMs).toISOString();
const fromNow = (offsetMs: number) => new Date(now.getTime() + offsetMs).toISOString();

const paymentRow = {
  rowId: "payment:payment-ana",
  source: "membership",
  occurredAt: at(10 * 60 * 60 * 1000),
  amountMinor: 8_500,
  method: "bank_transfer",
  reference: "ANA-OCT",
  studentId: "student-ana",
  label: "Monthly membership",
  paymentId: "payment-ana",
  invoiceId: "invoice-ana",
  shopOrderId: null,
  editable: true,
  voidable: true,
  voided: null,
};

const voidedRow = {
  ...paymentRow,
  rowId: "voided:payment-bruno",
  occurredAt: at(9 * 60 * 60 * 1000),
  amountMinor: 4_000,
  method: "cash",
  reference: "cash-1",
  studentId: "student-bruno",
  paymentId: "payment-bruno",
  invoiceId: "invoice-bruno",
  editable: false,
  voidable: false,
  voided: {
    voidedAt: at(11 * 60 * 60 * 1000),
    voidedByName: "Synthetic owner",
    reason: "Recorded twice by mistake",
  },
};

const shopRow = {
  rowId: "shop:order-1",
  source: "shop",
  occurredAt: at(8 * 60 * 60 * 1000),
  amountMinor: 2_500,
  method: "at_collection",
  reference: null,
  studentId: null,
  label: "SHOP-000001 · Dana Walker",
  paymentId: null,
  invoiceId: null,
  shopOrderId: "order-1",
  editable: false,
  voidable: false,
  voided: null,
};

function dashboardFor(month: string) {
  return {
    currency: "GBP",
    generatedAt: now.toISOString(),
    month,
    period: { from: at(0), to: at(31 * day) },
    metrics: {
      collectedMinor: 11_000,
      paymentsReceived: 2,
      outstandingMinor: 6_000,
      overdueBalances: 1,
      renewalsDue: 1,
      renewalsOverdue: 1,
      activeMemberships: 2,
    },
    payments: [paymentRow, voidedRow, shopRow],
    balances: [
      {
        invoiceId: "invoice-bruno",
        invoiceReference: "INV-BRUNO-1",
        studentId: "student-bruno",
        label: "Monthly membership",
        dueAt: fromNow(-5 * day),
        balanceMinor: 6_000,
        overdue: true,
        status: "open",
      },
    ],
    renewals: {
      overdue: [
        {
          membershipId: "membership-carla",
          studentId: "student-carla",
          planId: "town-adult",
          planName: "Town Adult",
          nextBillingAt: fromNow(-3 * day),
          status: "overdue",
        },
      ],
      dueSoon: [
        {
          membershipId: "membership-ana",
          studentId: "student-ana",
          planId: "west-adult",
          planName: "West Adult",
          nextBillingAt: fromNow(10 * day),
          status: "active",
        },
      ],
    },
  };
}

const members = [
  { studentId: "student-ana", fullName: "Ana Coelho", familyId: "f1" },
  { studentId: "student-bruno", fullName: "Bruno Silva", familyId: "f2" },
  { studentId: "student-carla", fullName: "Carla Dias", familyId: "f3" },
];

function financeCallables(calls: CallableCall[]): {
  calls: CallableCall[];
  callables: Record<string, unknown | CallableResponder>;
} {
  return {
    calls,
    callables: {
      getFinancialDashboard: (body: unknown) => {
        const data = (body as { data: { month?: string } | null }).data;
        return { dashboard: dashboardFor(data?.month ?? currentMonth) };
      },
      listMemberNames: { members },
      voidManualPayment: (body: unknown) => {
        const data = (body as { data: { paymentId: string } }).data;
        return { paymentId: data.paymentId, invoiceId: "invoice-ana", invoiceStatus: "open" };
      },
    },
  };
}

const dashboardCalls = (calls: CallableCall[]) =>
  calls.filter((call) => call.name === "getFinancialDashboard").map((call) => call.body);

test.describe("admin financial dashboard", () => {
  test("@smoke Billing forwards to the single Financial dashboard", async ({ page }) => {
    await installAdminFixture(page, financeCallables([]));
    await page.goto("/admin/billing?adminTestRole=owner");

    await expect(page).toHaveURL(/\/admin\/finance(\.html)?\?/u);
    await expect(page.getByRole("heading", { name: "Financial dashboard" })).toBeVisible();
    // The sidebar is in the DOM at every width (hidden behind the menu on phones). Each link text
    // starts with an aria-hidden "->" glyph, so match on how the label ends.
    const sidebarLinks = page.locator(".admin-sidebar a");
    await expect(sidebarLinks.filter({ hasText: /Financial dashboard$/u })).toHaveCount(1);
    await expect(sidebarLinks.filter({ hasText: /Financial dashboard$/u })).toHaveAttribute(
      "href",
      "/admin/finance",
    );
    await expect(sidebarLinks.filter({ hasText: /Billing$/u })).toHaveCount(0);
  });

  test("shows the KPIs, named payment rows and asks for the previous month", async ({ page }) => {
    const calls: CallableCall[] = [];
    await installAdminFixture(page, financeCallables(calls));
    await page.goto("/admin/finance?adminTestRole=owner");

    const metrics = page.locator(".admin-metrics-grid article");
    await expect(metrics).toHaveCount(4);
    for (const label of ["Collected", "Outstanding", "Overdue invoices", "Renewals"]) {
      await expect(metrics.getByText(label, { exact: true })).toBeVisible();
    }
    await expect(metrics.getByText("£110.00")).toBeVisible();

    const table = page.getByRole("tabpanel").getByRole("table");
    await expect(table.locator("tbody tr")).toHaveCount(3);
    await expect(table.getByText("Ana Coelho")).toBeVisible();
    await expect(table.getByText("Bruno Silva")).toBeVisible();
    await expect(table.getByText(/Voided — Recorded twice by mistake/u)).toBeVisible();
    await expect(table.getByRole("link", { name: "SHOP-000001 · Dana Walker" })).toHaveAttribute(
      "href",
      /\/admin\/shop/u,
    );
    expect(dashboardCalls(calls)[0]).toEqual({ data: null });

    await page.getByRole("button", { name: "Previous month" }).click();
    await expect
      .poll(() => dashboardCalls(calls).at(-1))
      .toEqual({ data: { month: previousMonth } });
  });

  test("voids a payment with a reason", async ({ page }) => {
    const calls: CallableCall[] = [];
    await installAdminFixture(page, financeCallables(calls));
    await page.goto("/admin/finance?adminTestRole=owner");

    await page.getByRole("button", { name: "Void", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Void payment" });
    await expect(dialog.getByText("Ana Coelho")).toBeVisible();
    await dialog.getByLabel("Reason for voiding").fill("Paid into the wrong account");
    await dialog.getByRole("button", { name: "Void payment" }).click();

    await expect(page.getByRole("status").filter({ hasText: "Payment voided." })).toBeVisible();
    await expect(dialog).toHaveCount(0);
    const call = calls.find((c) => c.name === "voidManualPayment");
    expect(call?.body).toMatchObject({
      data: {
        paymentId: "payment-ana",
        reason: "Paid into the wrong account",
        requestId: expect.stringMatching(
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u,
        ) as unknown as string,
      },
    });
  });

  test("Owed and Renewals tabs name the members and link to the plan", async ({ page }) => {
    await installAdminFixture(page, financeCallables([]));
    await page.goto("/admin/finance?adminTestRole=owner");

    await page.getByRole("tab", { name: "Owed" }).click();
    const panel = page.getByRole("tabpanel");
    await expect(panel.getByRole("table", { name: "Invoices with a balance" })).toBeVisible();
    await expect(panel.getByText("Bruno Silva")).toBeVisible();
    await expect(panel.getByText("INV-BRUNO-1")).toBeVisible();
    await expect(panel.getByRole("button", { name: "Record payment" })).toBeVisible();

    await page.getByRole("tab", { name: "Renewals" }).click();
    await expect(page).toHaveURL(/tab=renewals/u);
    await expect(panel.getByText("Carla Dias")).toBeVisible();
    await expect(panel.getByText("Ana Coelho")).toBeVisible();
    const planLinks = panel.getByRole("link", { name: "Open plan" });
    await expect(planLinks).toHaveCount(2);
    await expect(planLinks.first()).toHaveAttribute("href", /id=student-carla.*tab=plan/u);
  });

  test("has no horizontal scroll at 390px", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await installAdminFixture(page, financeCallables([]));
    await page.goto("/admin/finance?adminTestRole=owner");

    await expect(page.getByRole("heading", { name: "Financial dashboard" })).toBeVisible();
    await expect(page.getByRole("tabpanel").locator("tbody tr")).toHaveCount(3);
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(390);
  });
});
