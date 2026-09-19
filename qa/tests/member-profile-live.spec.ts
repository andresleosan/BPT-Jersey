import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { PLAN_CATALOG } from "@bpt-jersey/domain/memberships";
import { installAdminFixture, type CallableCall } from "./admin-fixture";
const at = "2026-09-20T10:00:00.000Z";
const note = "Office follow-up\n" + "LongOfficeNote".repeat(100);
const profile = {
  view: "full",
  header: {
    studentId: "s",
    fullName: "Synthetic S3 member",
    age: null,
    participantType: "minor",
    status: "active",
    birthdayBadge: null,
    guardianStatus: "pending",
    reviewReason: "date-of-birth-missing",
  },
  cards: {
    memberSince: "2026-09-20",
    monthsAsMember: 0,
    accountManagers: [],
    currentMembership: null,
  },
  details: {
    studentId: "s",
    fullName: "Synthetic S3 member",
    trainingCenter: "Town",
    trainingTimePreferences: ["evening"],
    participantType: "minor",
    active: true,
    status: "active",
    gender: "unknown",
    guardianStatus: "pending",
    reviewReason: "date-of-birth-missing",
    details: { internalNotes: note },
  },
};
const membership = {
  membershipId: "m",
  studentId: "s",
  planId: PLAN_CATALOG[0]!.planId,
  status: "active",
  startsAt: at,
  endsAt: null,
  updatedAt: at,
};
const invoice = {
  invoiceId: "i",
  status: "partially_paid",
  totalMinor: 6000,
  dueAt: at,
  paidAt: null,
  description: "Synthetic training period",
  payments: [
    {
      paymentId: "p",
      amountMinor: 2000,
      method: "cash",
      reference: "REFERENCE".repeat(20),
      occurredAt: at,
    },
  ],
};
async function fixture(page: Page, populated: boolean, calls: CallableCall[] = []) {
  await installAdminFixture(page, {
    calls,
    callables: {
      getMemberProfile: populated
        ? profile
        : { ...profile, details: { ...profile.details, details: {} } },
      listMemberSubscriptions: {
        studentId: "s",
        fullName: profile.header.fullName,
        eligiblePlanIds: [],
        memberships: populated
          ? [membership, { ...membership, membershipId: "old", status: "cancelled" }]
          : [],
      },
      listManagedPlans: [{ ...PLAN_CATALOG[0], active: false }],
      listMemberSubscriptionBilling: populated
        ? [
            {
              membershipId: "m",
              complimentary: false,
              currentInvoiceId: "i",
              reason: null,
              invoices: [invoice],
            },
          ]
        : [],
      listMemberClassRecords: (body: unknown) => {
        const { kind } = (body as { data: { kind: string } }).data;
        return {
          studentId: "s",
          kind,
          rows: populated
            ? kind === "bookings"
              ? [
                  {
                    recordId: "b",
                    requestedAt: at,
                    status: "confirmed",
                    session: {
                      sessionId: "session",
                      title: "Synthetic BJJ class",
                      startAt: at,
                      endAt: "2026-09-20T11:00:00.000Z",
                      locationId: "town",
                    },
                  },
                ]
              : [{ recordId: "a", occurredAt: at, state: "late", method: "self", session: null }]
            : [],
          nextCursor: null,
        };
      },
    },
  });
  // Unlisted calls remain isolated from any other local job or remote service.
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (
      route.request().method() === "POST" &&
      ![
        "getMemberProfile",
        "listMemberSubscriptions",
        "listManagedPlans",
        "listMemberSubscriptionBilling",
        "listMemberClassRecords",
        "listAdminNotifications",
      ].includes(url.pathname.split("/").pop() ?? "")
    ) {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          error: { status: "UNAVAILABLE", message: "Synthetic unavailable" },
        }),
      });
    } else await route.fallback();
  });
}
async function capture(page: Page, info: TestInfo, name: string) {
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
  ).toBeLessThanOrEqual(0);
  await page.screenshot({ path: info.outputPath(`${name}.png`), fullPage: true });
}
test.describe("S3 live member record", () => {
  test.skip(process.env.NEXT_PUBLIC_ADMIN_E2E !== "true", "requires synthetic admin build");
  test.beforeEach(async ({ page }, info) => {
    await page.setViewportSize(
      info.project.name === "mobile-chromium"
        ? { width: 390, height: 844 }
        : { width: 1440, height: 900 },
    );
  });
  test("populated live tabs, long text, keyboard and Details return", async ({ page }, info) => {
    const calls: CallableCall[] = [];
    await fixture(page, true, calls);
    await page.goto("/admin/members/profile?id=s&tab=plan&adminTestRole=owner");
    await expect(page.getByText("Cancelled", { exact: true })).toBeVisible();
    await expect(page.getByText(/Current plan:/)).toContainText(PLAN_CATALOG[0]!.displayName);
    expect(calls.filter((call) => call.name === "listMemberSubscriptionBilling")).toHaveLength(0);
    await capture(page, info, "plan");
    await page.getByRole("tab", { name: "Payments", exact: true }).click();
    await expect(page.getByText("Partly paid · £60.00")).toBeVisible();
    await expect(page.getByText(/£20.00 received/)).toContainText("Cash");
    await capture(page, info, "payments");
    await page.getByRole("tab", { name: "Classes", exact: true }).click();
    await expect(page.getByText("Synthetic BJJ class")).toBeVisible();
    await expect(page.getByText("Class details unavailable")).toBeVisible();
    await expect(page.getByText(/^20 Sept 2026, 11:00/)).toContainText("Town (St Helier)");
    await capture(page, info, "classes");
    await page.getByRole("tab", { name: "Classes", exact: true }).focus();
    await page.keyboard.press("End");
    await expect(page.getByRole("tab", { name: "Notes", exact: true })).toBeFocused();
    await expect(page.getByText(note)).toBeVisible();
    await capture(page, info, "notes");
    await page.getByRole("button", { name: "Edit in Details" }).click();
    await expect(page.getByLabel("Internal notes", { exact: true })).toBeFocused();
    await page.goBack();
    await expect(page.getByRole("tab", { name: "Notes", exact: true })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await page.goForward();
    await expect(page.getByLabel("Internal notes", { exact: true })).toHaveValue(note);
  });
  test("new canonical member with pending review has truthful empty tabs", async ({
    page,
  }, info) => {
    await fixture(page, false);
    await page.goto("/admin/members/profile?id=s&tab=plan&adminTestRole=owner");
    await expect(page.getByText(/No membership recorded yet/)).toBeVisible();
    await capture(page, info, "empty-plan");
    await page.getByRole("tab", { name: "Payments", exact: true }).click();
    await expect(
      page.getByText("No invoices or payments recorded for this member's memberships."),
    ).toBeVisible();
    await capture(page, info, "empty-payments");
    await page.getByRole("tab", { name: "Classes", exact: true }).click();
    await expect(page.getByText("No bookings recorded")).toBeVisible();
    await expect(page.getByText("No attendance recorded")).toBeVisible();
    await capture(page, info, "empty-classes");
    await page.getByRole("tab", { name: "Notes", exact: true }).click();
    await expect(page.getByText("No office notes recorded.")).toBeVisible();
    await capture(page, info, "empty-notes");
  });
  test("missing identity, failed read and loading are distinct", async ({ page }, info) => {
    await fixture(page, false);
    let mode = "loading";
    let release: () => void = () => {};
    const pending = new Promise<void>((done) => {
      release = done;
    });
    await page.route("**/getMemberProfile", async (route) => {
      if (mode === "loading") await pending;
      await route.fulfill({
        status: mode === "missing" ? 404 : 503,
        contentType: "application/json",
        body: JSON.stringify({
          error: {
            status: mode === "missing" ? "NOT_FOUND" : "UNAVAILABLE",
            message: "Synthetic failure",
          },
        }),
      });
    });
    await page.goto("/admin/members/profile?id=s&adminTestRole=owner");
    await expect(page.getByRole("status", { name: "Loading member record" })).toBeVisible();
    await capture(page, info, "loading");
    mode = "missing";
    release();
    await expect(
      page.getByText("Live member record unavailable. It may not have been created yet."),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "Review member migration" })).toHaveAttribute(
      "href",
      "/admin/members/migration",
    );
    await capture(page, info, "missing");
    mode = "error";
    await page.reload();
    await expect(page.getByRole("region", { name: "Member record" }).getByRole("alert")).toHaveText(
      "Unable to load this member record. Please try again.",
    );
    await capture(page, info, "error");
  });
  for (const tab of ["plan", "payments", "classes"]) {
    test(`${tab} replaces a loaded record with unavailable navigation after deletion`, async ({
      page,
    }, info) => {
      await fixture(page, true);
      const callable =
        tab === "plan"
          ? "listMemberSubscriptions"
          : tab === "payments"
            ? "listMemberSubscriptionBilling"
            : "listMemberClassRecords";
      let missing = false;
      await page.route(`**/${callable}`, async (route) => {
        if (missing) {
          await route.fulfill({
            status: 404,
            contentType: "application/json",
            body: JSON.stringify({
              error: { status: "NOT_FOUND", message: "Synthetic missing member" },
            }),
          });
        } else if (tab === "classes") {
          const { kind } = route.request().postDataJSON().data;
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
              data: {
                studentId: "s",
                kind,
                rows:
                  kind === "bookings"
                    ? [
                        {
                          recordId: "b",
                          requestedAt: at,
                          status: "confirmed",
                          session: {
                            sessionId: "session",
                            title: "Synthetic BJJ class",
                            startAt: at,
                            endAt: "2026-09-20T11:00:00.000Z",
                            locationId: "town",
                          },
                        },
                      ]
                    : [],
                nextCursor: kind === "bookings" ? { at, recordId: "b" } : null,
              },
            }),
          });
        } else await route.fallback();
      });
      await page.goto(`/admin/members/profile?id=s&tab=${tab}&adminTestRole=owner`);
      await expect(
        page.getByText(
          tab === "plan"
            ? "Cancelled"
            : tab === "payments"
              ? "Partly paid · £60.00"
              : "Synthetic BJJ class",
          { exact: true },
        ),
      ).toBeVisible();
      missing = true;
      const record = page.getByRole("region", { name: "Member record" });
      await record
        .getByRole("button", { name: tab === "classes" ? "Load more" : "Refresh", exact: true })
        .click();
      await expect(record.getByRole("tablist")).toHaveCount(0);
      await expect(record.getByRole("heading", { name: profile.header.fullName })).toHaveCount(0);
      await expect(
        record.getByText("Live member record unavailable. It may not have been created yet."),
      ).toBeVisible();
      const migration = record.getByRole("link", { name: "Review member migration" });
      await expect(migration).toHaveAttribute("href", "/admin/members/migration");
      await expect(record.getByRole("button")).toHaveCount(0);
      await migration.focus();
      await page.keyboard.press("Tab");
      await expect(record.getByRole("link", { name: "Imported archive" })).toBeFocused();
      await capture(page, info, `${tab}-deleted`);
    });
  }
  test("coach forged tabs make no financial or notes requests", async ({ page }, info) => {
    const calls: CallableCall[] = [];
    const header = {
      studentId: "s",
      fullName: "Synthetic S3 member",
      age: null,
      participantType: "minor",
      status: "active",
      birthdayBadge: null,
    };
    await installAdminFixture(page, {
      role: "coach",
      calls,
      callables: { getMemberProfile: { view: "coach", header } },
    });
    await page.route("**/*", async (route) => {
      if (
        route.request().method() === "POST" &&
        !["getMemberProfile", "listAdminNotifications"].includes(
          new URL(route.request().url()).pathname.split("/").pop() ?? "",
        )
      )
        await route.fulfill({ status: 503, body: "{}" });
      else await route.fallback();
    });
    for (const tab of ["plan", "payments", "classes", "notes"]) {
      await page.goto(`/admin/members/profile?id=s&tab=${tab}&adminTestRole=coach`);
      await expect(page.getByRole("tab")).toHaveText(["Profile"]);
    }
    expect(
      calls.filter((call) => !["getMemberProfile", "listAdminNotifications"].includes(call.name)),
    ).toEqual([]);
    await capture(page, info, "coach");
  });
  test("section failures stay distinct from empty data and retry independently", async ({
    page,
  }, info) => {
    await fixture(page, false);
    let paymentsFailed = true;
    await page.route("**/listMemberSubscriptionBilling", async (route) => {
      await route.fulfill({
        status: paymentsFailed ? 503 : 200,
        contentType: "application/json",
        body: JSON.stringify(
          paymentsFailed
            ? { error: { status: "UNAVAILABLE", message: "Synthetic failure" } }
            : { data: [] },
        ),
      });
    });
    await page.goto("/admin/members/profile?id=s&tab=payments&adminTestRole=owner");
    const record = page.getByRole("region", { name: "Member record" });
    await expect(record.getByRole("alert")).toHaveText(
      "Unable to load recorded invoices and payments. Refresh to try again.",
    );
    await expect(page.getByText(/No invoices or payments recorded/)).toHaveCount(0);
    await capture(page, info, "payments-error");
    paymentsFailed = false;
    await record.getByRole("button", { name: "Refresh", exact: true }).click();
    await expect(
      page.getByText("No invoices or payments recorded for this member's memberships."),
    ).toBeVisible();
    await page.route("**/listMemberClassRecords", async (route) => {
      const { kind } = route.request().postDataJSON().data;
      if (kind === "bookings") await route.fallback();
      else
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ error: { status: "UNAVAILABLE", message: "Synthetic failure" } }),
        });
    });
    await page.getByRole("tab", { name: "Classes", exact: true }).click();
    await expect(page.getByText("No bookings recorded")).toBeVisible();
    await expect(
      page.getByRole("region", { name: "Attendance", exact: true }).getByRole("alert"),
    ).toHaveText("Unable to load class history. Refresh to try again.");
    await expect(page.getByText("No attendance recorded")).toHaveCount(0);
    await capture(page, info, "classes-error");
  });
});
