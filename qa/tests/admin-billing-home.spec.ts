import { expect, test } from "@playwright/test";

import { installAdminFixture, type CallableCall, type CallableResponder } from "./admin-fixture";

const audit = {
  schemaVersion: 1,
  createdAt: "2026-08-19T10:00:00.000Z",
  createdBy: "admin-1",
  updatedAt: "2026-08-19T10:00:00.000Z",
  updatedBy: "admin-1",
};

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
  ],
  upcomingRenewals: [
    { planId: "bpt-jersey-adult", nextBillingAt: "2026-08-30T00:00:00.000Z", status: "active" },
  ],
};

function recentPayment(index: number) {
  const cash = index % 2 === 0;
  return {
    paymentId: `payment-${index}`,
    occurredAt: `2026-08-${String((index % 27) + 1).padStart(2, "0")}T10:00:00.000Z`,
    amountMinor: 1000 + index,
    method: cash ? "cash" : "bank_transfer",
    manualReference: `ref-${index}`,
    invoiceReference: `INV-${100 + index}`,
    description: "Monthly membership",
    familyId: "f1",
    memberName: index === 3 ? null : `Member ${index}`,
  };
}

const recentPayments = Array.from({ length: 20 }, (_, i) => recentPayment(i));

const openInvoice = {
  invoiceId: "invoice-1",
  academyId: "synthetic-academy",
  familyId: "f1",
  membershipId: "membership-1",
  status: "open",
  totalMinor: 1500,
  currency: "GBP",
  dueAt: "2026-09-20T23:59:59.000Z",
  paidAt: null,
  chargeKind: "membership",
  sourceRef: null,
  invoiceReference: "INV-1",
  description: "Monthly membership",
  ...audit,
};

const financialAccount = {
  invoices: [{ invoice: openInvoice, payments: [], balanceMinor: 1500 }],
  balanceMinor: 1500,
  paygDebtMinor: 0,
  paymentInstructions: null,
};

const members = [
  { studentId: "student-ana", fullName: "Ana Coelho", familyId: "f1" },
  { studentId: "student-bruno", fullName: "Bruno Silva", familyId: "f2" },
  { studentId: "student-carla", fullName: "Carla Dias", familyId: "f3" },
];

function billingCallables(calls: CallableCall[]): {
  calls: CallableCall[];
  callables: Record<string, unknown | CallableResponder>;
} {
  return {
    calls,
    callables: {
      getFinancialDashboard: { dashboard },
      listRecentPayments: { payments: recentPayments },
      listFinancialAccount: financialAccount,
      listMemberships: [],
      listMemberNames: { members },
      getFamilyFinancialAccount: financialAccount,
      listIntroMembershipApplications: { applications: [] },
      issueManualInvoice: (body: unknown) => {
        const data = (body as { data: Record<string, unknown> }).data;
        return {
          invoiceId: "invoice-2",
          academyId: "synthetic-academy",
          familyId: data.familyId,
          membershipId: data.membershipId,
          status: "open",
          totalMinor: data.totalMinor,
          currency: "GBP",
          dueAt: data.dueAt,
          paidAt: null,
          chargeKind: data.chargeKind,
          sourceRef: null,
          invoiceReference: data.invoiceReference,
          description: data.description,
          ...audit,
        };
      },
      recordManualPayment: (body: unknown) => {
        const data = (body as { data: Record<string, unknown> }).data;
        return {
          paymentId: "payment-new",
          academyId: "synthetic-academy",
          familyId: "f1",
          invoiceId: data.invoiceId,
          status: "recorded",
          amountMinor: data.amountMinor,
          currency: "GBP",
          method: data.method,
          manualReference: data.manualReference,
          providerReference: null,
          occurredAt: data.occurredAt,
          ...audit,
        };
      },
    },
  };
}

test.describe("admin billing home", () => {
  test("reviews an Intro Class payment application before granting membership", async ({
    page,
  }) => {
    const calls: CallableCall[] = [];
    const fixture = billingCallables(calls);
    const application = {
      applicationId: "intro-application-1",
      requestId: "00112233-4455-4677-8899-aabbccddeeff",
      academyId: "synthetic-academy",
      applicantUid: "member-1",
      studentId: "student-1",
      conversionId: "intro-student-1",
      site: "Town",
      planId: "town-adult",
      planName: "Town Adult",
      priceMinor: 8500,
      currency: "GBP",
      billingPeriod: "monthly",
      planUpdatedAt: "2026-09-20T00:00:00.000Z",
      proofId: "a".repeat(64),
      bankReference: "INTRO-33",
      status: "pending_review",
      revision: 0,
      decisionReason: null,
      approvedMembershipId: null,
      createdAt: "2026-09-21T12:00:00.000Z",
      updatedAt: "2026-09-21T12:00:00.000Z",
      schemaVersion: "1",
    };
    let pending = true;
    fixture.callables.listIntroMembershipApplications = () => ({
      applications: pending ? [application] : [],
    });
    fixture.callables.getIntroMembershipProofUrl = {
      url: "https://evidence.example.test/receipt",
      expiresAt: "2026-09-21T12:01:00.000Z",
    };
    fixture.callables.reviewIntroMembershipApplication = () => {
      pending = false;
      return { status: "approved", membershipId: "membership-1" };
    };
    await installAdminFixture(page, fixture);
    await page.goto("/admin/billing?adminTestRole=owner");

    const panel = page.getByRole("region", { name: "Membership applications" });
    await expect(panel.getByText("Town Adult")).toBeVisible();
    await expect(panel.getByText(/Town · £85.00 · INTRO-33/u)).toBeVisible();
    await panel.getByRole("button", { name: "View evidence" }).click();
    await expect(panel.getByRole("link", { name: "Open payment evidence" })).toHaveAttribute(
      "href",
      "https://evidence.example.test/receipt",
    );
    page.once("dialog", (dialog) => void dialog.accept());
    await panel.getByRole("button", { name: "Approve" }).click();
    await expect(panel.getByText("No Intro Class applications are waiting.")).toBeVisible();
    await expect
      .poll(() => calls.find((call) => call.name === "reviewIntroMembershipApplication")?.body)
      .toMatchObject({ data: { applicationId: application.applicationId, decision: "approve" } });
  });

  test("shows the metrics and latest payments", async ({ page }, testInfo) => {
    const browserErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") browserErrors.push(message.text());
    });
    page.on("pageerror", (error) => browserErrors.push(error.message));
    await installAdminFixture(page, billingCallables([]));
    await page.goto("/admin/billing?adminTestRole=owner");

    await expect(page.getByRole("heading", { name: "Billing" })).toBeVisible();
    const metrics = page.locator(".admin-metrics-grid article");
    await expect(metrics).toHaveCount(4);
    await expect(metrics.getByText("Collected this month")).toBeVisible();
    await expect(metrics.getByText("Outstanding", { exact: true })).toBeVisible();
    await expect(metrics.getByText("Overdue invoices")).toBeVisible();
    await expect(metrics.getByText("Renewals due")).toBeVisible();

    const latestPayments = page.getByRole("region", { name: "Latest payments" });
    const rows = latestPayments.locator("tbody tr");
    await expect(rows).toHaveCount(20);
    await expect(latestPayments.getByText("Cash").first()).toBeVisible();

    for (const summary of [
      "Outstanding invoices",
      "Upcoming renewals",
      "Payment instructions",
      "All invoices",
    ]) {
      const details = page.locator("details", { has: page.getByText(summary, { exact: true }) });
      await expect(details).not.toHaveAttribute("open", "");
    }

    await page.screenshot({
      path: testInfo.outputPath(`billing-home-${testInfo.project.name}.png`),
      fullPage: true,
    });

    // Folded from the old financial-dashboard.spec.ts (finance moved to /admin/billing): no
    // identity/card data leaks into the DOM, and no page-level horizontal scroll.
    const bodyText = await page.locator("body").innerText();
    expect(bodyText).not.toMatch(
      /card number|cvv|cvc|providerReference|private-|familyId|studentId|membershipId/iu,
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

  test("member history shows one member's account", async ({ page }) => {
    const calls: CallableCall[] = [];
    await installAdminFixture(page, billingCallables(calls));
    await page.goto("/admin/billing?adminTestRole=owner");

    await page.getByRole("searchbox", { name: "Find a member" }).fill("ana");
    await page.getByRole("option", { name: "Ana Coelho" }).click();

    const panel = page.getByRole("region", { name: "Ana Coelho's account" });
    await expect(panel).toBeVisible();
    await expect(panel.getByRole("table", { name: "All payments" })).toBeVisible();

    const call = calls.find((c) => c.name === "getFamilyFinancialAccount");
    expect(call?.body).toMatchObject({ data: { familyId: "f1" } });
  });

  test("issues an invoice with no membership", async ({ page }, testInfo) => {
    const calls: CallableCall[] = [];
    await installAdminFixture(page, billingCallables(calls));
    await page.goto("/admin/billing?adminTestRole=owner");

    await page.getByRole("button", { name: "Issue invoice" }).click();
    const dialog = page.getByRole("dialog", { name: "Issue invoice" });
    await dialog.getByRole("searchbox", { name: "Find a member" }).fill("ana");
    await dialog.getByRole("option", { name: "Ana Coelho" }).click();
    await dialog.getByRole("radio", { name: "No membership · custom charge" }).click();
    await dialog.getByLabel("Invoice amount (GBP)").fill("15");
    await dialog.getByLabel("Due date").fill("2026-09-30");
    await dialog.getByLabel("Invoice reference").fill("INV-CUSTOM-1");
    await dialog.getByLabel("Description").fill("Custom charge for gi replacement");

    await page.screenshot({
      path: testInfo.outputPath(`billing-invoice-${testInfo.project.name}.png`),
      fullPage: true,
    });

    await dialog.getByRole("button", { name: "Issue invoice" }).click();
    // The billing skeleton can still be announcing its own status while the notice appears.
    await expect(page.getByRole("status").filter({ hasText: "Invoice issued." })).toBeVisible();

    const call = calls.find((c) => c.name === "issueManualInvoice");
    expect(call?.body).toMatchObject({
      data: { membershipId: null, dueAt: "2026-09-30T23:59:59.000Z" },
    });
  });

  test("records a cash payment for an open invoice", async ({ page }) => {
    const calls: CallableCall[] = [];
    await installAdminFixture(page, billingCallables(calls));
    await page.goto("/admin/billing?adminTestRole=owner");

    await page.locator("summary").filter({ hasText: "All invoices" }).click();
    await page.getByRole("button", { name: "Record payment for INV-1" }).click();
    const dialog = page.getByRole("dialog", { name: "Record payment" });
    await dialog.getByRole("radio", { name: "Cash" }).click();
    await dialog.getByLabel("Payment reference").fill("cash-1");
    await dialog.getByRole("button", { name: "Save payment" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Payment recorded." })).toBeVisible();

    const call = calls.find((c) => c.name === "recordManualPayment");
    expect(call?.body).toMatchObject({ data: { method: "cash" } });
  });
});
