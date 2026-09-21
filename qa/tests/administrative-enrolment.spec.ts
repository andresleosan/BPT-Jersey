import { expect, test, type Page } from "@playwright/test";
import { PLAN_CATALOG } from "@bpt-jersey/domain/memberships";

const studentId = "synthetic-enrolment-member";
const fullName = "Synthetic enrolment member";
async function harness(
  page: Page,
  role: string,
  options: { failPayment?: boolean; failRead?: boolean } = {},
) {
  const calls: { name: string; data: Record<string, unknown> }[] = [];
  const plans = PLAN_CATALOG.slice(0, 2).map((plan) => ({ ...plan, active: true }));
  let levelKey: string | null = null;
  let subscription: Record<string, unknown> | null = null;
  let paymentFailures = options.failPayment ? 1 : 0;
  let readFailures = options.failRead ? 1 : 0;
  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const applicationOrigin = new URL(process.env.BASE_URL ?? "http://127.0.0.1:3100").origin;
    if (url.origin === applicationOrigin) return route.continue();
    const headers = {
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "*",
      "access-control-allow-methods": "POST, OPTIONS",
    };
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers });
    if (request.method() !== "POST") return route.abort();
    const name = url.pathname.split("/").at(-1)!;
    const data = request.postDataJSON().data ?? {};
    calls.push({ name, data });
    const fail = () =>
      route.fulfill({
        status: 503,
        headers,
        contentType: "application/json",
        body: JSON.stringify({
          error: { status: "UNAVAILABLE", message: "Synthetic internal failure" },
        }),
      });
    let result: unknown;
    if (name === "createMember") result = { studentId, memberId: studentId };
    else if (name === "getStudentProgressSummary") {
      if (readFailures-- > 0) return fail();
      result = {
        progress: levelKey
          ? {
              state: "initialized",
              studentId,
              currentDefinition: { definitionKey: levelKey },
              targetDefinition: null,
              currentLevelStartedAt: "2026-01-01T00:00:00.000Z",
              progressPercent: null,
              criteria: {
                classes: { required: null, completed: 0, imported: 0, met: true },
                time: { requiredDays: null, elapsedDays: 0, met: true },
              },
            }
          : { state: "uninitialized", studentId },
      };
    } else if (name === "openStudentLevel") {
      levelKey = data.definitionKey;
      result = {
        head: {
          studentId,
          currentDefinitionKey: levelKey,
          currentLevelStartedAt: "2026-01-01T00:00:00.000Z",
          state: "initialized",
        },
        ageBand: { met: true, requiredMinAge: null, requiredMaxAge: null, ageYears: 30 },
      };
    } else if (name === "listManagedPlans") result = plans;
    else if (name === "listMemberSubscriptions")
      result = {
        studentId,
        fullName,
        eligiblePlanIds: plans.map((p) => p.planId),
        memberships: subscription ? [subscription] : [],
      };
    else if (name === "listMemberSubscriptionBilling") result = [];
    else if (name === "manageMemberSubscription") {
      await new Promise((resolve) => setTimeout(resolve, 400));
      if (paymentFailures-- > 0) return fail();
      subscription = {
        membershipId: "synthetic-membership",
        studentId,
        planId: data.planId,
        status: "active",
        startsAt: data.startsAt,
        endsAt: data.endsAt,
        updatedAt: new Date().toISOString(),
      };
      result = subscription;
    } else return route.abort();
    return route.fulfill({
      headers,
      contentType: "application/json",
      body: JSON.stringify({ result }),
    });
  });
  await page.goto(`/admin/members/add?adminTestRole=${role}`);
  return calls;
}
async function register(page: Page) {
  await expect(page.getByLabel("Address", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Post code", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel(/Medical conditions/i)).toHaveCount(0);
  await page.getByLabel("Full name", { exact: true }).fill(fullName);
  await page.getByLabel("Date of birth", { exact: true }).fill("1990-01-01");
  await page.getByLabel("Training center", { exact: true }).selectOption("Town");
  await page.getByLabel("Evening", { exact: true }).check();
  await page.getByLabel("Email address", { exact: true }).fill("synthetic@example.test");
  await page.getByLabel("Membership number", { exact: true }).fill("33");
  await page.getByLabel("Emergency contact name", { exact: true }).fill("Synthetic contact");
  await page.getByLabel("Relationship", { exact: true }).fill("Partner");
  await page.getByLabel("Emergency contact phone", { exact: true }).fill("+44 7000 000000");
  const submit = page.getByRole("button", { name: "Add adult student", exact: true });
  await submit.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Complete member registration" })).toBeVisible();
}
async function openLevel(page: Page) {
  await page.getByRole("combobox", { name: "Level", exact: true }).selectOption("white-belt");
  await page
    .getByRole("form", { name: "Open level" })
    .getByLabel("Start date", { exact: true })
    .fill("2026-01-01");
  await page.getByLabel("Notes", { exact: true }).fill("Initial registration");
  await page.getByRole("button", { name: "Open level", exact: true }).click();
  await expect(page.getByText("Initial level: saved", { exact: true })).toBeVisible();
}
for (const role of ["administrator", "owner"]) {
  test(`${role} completes manual registration with level and subscription without a member account @member-data-foundation`, async ({
    page,
  }, info) => {
    const calls = await harness(page, role);
    await register(page);
    await expect(
      page.getByRole("heading", { name: "Registration complete", exact: true }),
    ).toHaveCount(0);
    await openLevel(page);
    await page
      .getByRole("combobox", { name: "Payment for this period", exact: true })
      .selectOption("unpaid");
    await page.getByRole("button", { name: "Assign subscription", exact: true }).click();
    await expect(page.getByRole("button", { name: "Saving…", exact: true })).toBeDisabled();
    await expect(
      page.getByRole("heading", { name: "Registration complete", exact: true }),
    ).toBeVisible();
    const creation = calls.filter((call) => call.name === "createMember");
    expect(creation).toHaveLength(1);
    expect(creation[0]!.data).toMatchObject({
      fullName,
      membershipNumber: "33",
      email: "synthetic@example.test",
      emergencyContact: {
        fullName: "Synthetic contact",
        relationship: "Partner",
        phoneNumber: "+44 7000 000000",
      },
    });
    expect(creation[0]!.data).not.toHaveProperty("postalAddress");
    expect(calls.some((call) => call.name === "saveHealthProfile")).toBe(false);
    expect(calls.find((call) => call.name === "manageMemberSubscription")!.data).toMatchObject({
      studentId,
      operation: "assign",
      settlement: { kind: "unpaid" },
    });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page
      .getByRole("heading", { name: "Registration complete", exact: true })
      .scrollIntoViewIfNeeded();
    await page.screenshot({
      path: `../.tmp/enrolment-${role}-${info.project.name}.jpg`,
      type: "jpeg",
      quality: 75,
    });
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "Registration complete", exact: true }),
    ).toBeVisible();
    expect(calls.filter((call) => call.name === "createMember")).toHaveLength(1);
  });
}
test("payment retry keeps the same operation and saved member", async ({ page }) => {
  const calls = await harness(page, "administrator", { failPayment: true });
  await register(page);
  await openLevel(page);
  await page.getByRole("button", { name: "Assign subscription", exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "Unable to complete this request",
  );
  await page.getByRole("button", { name: "Assign subscription", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Registration complete", exact: true }),
  ).toBeVisible();
  const payments = calls.filter((call) => call.name === "manageMemberSubscription");
  expect(payments).toHaveLength(2);
  expect(payments[0]!.data).toEqual(payments[1]!.data);
  expect(calls.filter((call) => call.name === "createMember")).toHaveLength(1);
});
test("coach cannot open the administrative registration @member-data-foundation", async ({ page }) => {
  const calls = await harness(page, "coach");
  await expect(page.getByRole("heading", { name: "Add adult student" })).toHaveCount(0);
  await expect(
    page
      .getByText(/not.*access|not.*available|access.*denied|cannot.*access|different role/i)
      .first(),
  ).toBeVisible();
  expect(calls).toHaveLength(0);
});
