import { expect, test, type Page, type Route, type TestInfo } from "@playwright/test";

import {
  legacyReadsEliminatedReason,
  legacyRegistrationClosedMessage,
} from "@bpt-jersey/domain/members/migration";

import { installAdminFixture } from "./admin-fixture";
import { blockExternalRequests } from "./network-guard";

/**
 * 2026-10-21 item 4. The office registers an imported member, the answer is lost, and the retry
 * reaches the server once Regyfit is closed. Synthetic callables on loopback only: this is browser
 * coverage of the screen with a mocked backend (the same request is resent, the created member opens,
 * the closed refusal is named). That the server answers such a retry from its v2 receipt, and refuses
 * a v1 one, is proven by the real callable, writer and in-memory store in
 * canonical-member-directory-service.test.ts, not here.
 */
const record = {
  recordId: "161",
  memberNumber: "1234",
  fullName: "Synthetic Imported Adult",
  birthDate: "1990-04-05",
  gender: "unknown",
  membershipState: "inactive",
  appAccess: {},
  graduation: {},
  plan: {},
  attendance: { records: [] },
  payments: [],
  capturedAt: "2026-09-01T10:00:00.000Z",
  source: "regyfit-admin-capture",
  schemaVersion: "1",
};
const created = { memberId: "student-imported-1", studentId: "student-imported-1" };
const closed = {
  status: "FAILED_PRECONDITION",
  message: legacyRegistrationClosedMessage,
  details: { reason: legacyReadsEliminatedReason },
};

type Answer = (route: Route) => Promise<void>;
const ok =
  (data: unknown): Answer =>
  (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data }) });
const refuse =
  (status: number, error: unknown): Answer =>
  (route) =>
    route.fulfill({ status, contentType: "application/json", body: JSON.stringify({ error }) });
/** The request left the browser but its answer never came back. */
const lost: Answer = (route) => route.abort("failed");

/** The imported archive with registerImportedMemberForOffice answered by `answers`, in order. */
async function openImportedRecord(page: Page, answers: readonly Answer[]) {
  const registrations: unknown[] = [];
  const subscriptionReads: unknown[] = [];
  const callables = {
    listRegyfitMemberRecords: {
      rows: [
        {
          recordId: record.recordId,
          memberNumber: record.memberNumber,
          fullName: record.fullName,
          birthDate: record.birthDate,
          membershipState: record.membershipState,
        },
      ],
      total: 1,
      capturedAt: record.capturedAt,
    },
    getRegyfitMemberRecord: record,
    resolveMemberSubscriptionProfile: { studentId: null },
    registerImportedMemberForOffice: null,
    listMemberSubscriptions: (body: unknown) => {
      subscriptionReads.push((body as { data: unknown }).data);
      return {
        studentId: created.studentId,
        fullName: record.fullName,
        eligiblePlanIds: [],
        memberships: [],
      };
    },
    listMemberSubscriptionBilling: [],
    listManagedPlans: [],
  };
  await installAdminFixture(page, { callables });
  let next = 0;
  await page.route("**/registerImportedMemberForOffice", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    registrations.push((route.request().postDataJSON() as { data: unknown }).data);
    const answer = answers[next++];
    if (answer === undefined) throw new Error("More registrations than the scenario expects");
    return answer(route);
  });
  const blocked = await blockExternalRequests(page, Object.keys(callables));
  // The office reaches imported records in the archive; without `?archive` the page moves it to
  // /admin/members, which is not where an imported member is registered.
  await page.goto("/admin/members/search?archive&adminTestRole=owner", { timeout: 120_000 });
  await page
    .getByRole("button", { name: `Open full record for ${record.fullName}` })
    .click({ timeout: 60_000 });
  await page.getByRole("tab", { name: "Membership" }).click();
  await expect(page.getByLabel("Date of birth")).toHaveValue(record.birthDate);
  return { registrations, subscriptionReads, blocked };
}

async function fill(page: Page, centre: "Town" | "West") {
  await page.getByLabel("Training centre").selectOption(centre);
  await page.getByLabel("Preferred training time").selectOption("evening");
}

const register = (page: Page) =>
  page.getByRole("button", { name: "Register member and choose subscription" }).click();
/** The screen's own alert: Next's route announcer is an alert too. */
const alert = (page: Page, text: string | RegExp) =>
  page.getByRole("alert").filter({ hasText: text });

async function evidence(page: Page, testInfo: TestInfo, name: string, blocked: string[]) {
  await page.screenshot({
    path: testInfo.outputPath(`${name}-${testInfo.project.name}.png`),
    fullPage: true,
  });
  await testInfo.attach(`${name}-blocked-requests`, {
    body: JSON.stringify(blocked, null, 2),
    contentType: "application/json",
  });
}

test.describe("Imported registration retried after a lost answer (2026-10-21 item 4)", () => {
  test.skip(process.env.NEXT_PUBLIC_ADMIN_E2E !== "true", "needs the admin E2E build");
  test.setTimeout(180_000);

  test("resends the same request and opens the member the first one created", async ({
    page,
  }, testInfo) => {
    const h = await openImportedRecord(page, [lost, ok(created)]);
    await fill(page, "Town");

    await register(page);
    await expect(alert(page, "Please try again")).toBeVisible();
    await register(page);

    await expect(page.getByRole("region", { name: "Member subscriptions" })).toBeVisible();
    expect(h.registrations).toHaveLength(2);
    expect(h.registrations[1]).toEqual(h.registrations[0]);
    expect(h.registrations[0]).toMatchObject({
      recordId: "161",
      dateOfBirth: record.birthDate,
      trainingCenter: "Town",
      trainingTimePreferences: ["evening"],
    });
    // The editor asks for the member the registration answered with, once it has mounted.
    await expect.poll(() => h.subscriptionReads).toContainEqual({ studentId: created.studentId });
    expect(h.blocked).toEqual([]);
    await evidence(page, testInfo, "imported-retry-answered", h.blocked);
  });

  test("names a retry refused as closed and sends nothing more", async ({ page }, testInfo) => {
    const h = await openImportedRecord(page, [lost, refuse(400, closed)]);
    await fill(page, "Town");

    await register(page);
    await expect(alert(page, "Please try again")).toBeVisible();
    await register(page);

    await expect(alert(page, legacyRegistrationClosedMessage)).toBeVisible();
    await expect(alert(page, "Please try again")).toHaveCount(0);
    await expect(page.getByText(/subscription dates/)).toHaveCount(0);
    await page.waitForTimeout(1_500);
    expect(h.registrations).toHaveLength(2);
    expect(h.registrations[1]).toEqual(h.registrations[0]);
    expect(h.subscriptionReads).toEqual([]);
    expect(h.blocked).toEqual([]);
    await evidence(page, testInfo, "imported-retry-closed", h.blocked);
  });

  test("sends a new request, not a retry, once the office changes the centre", async ({
    page,
  }, testInfo) => {
    const h = await openImportedRecord(page, [lost, ok(created)]);
    await fill(page, "Town");
    await register(page);
    await expect(alert(page, "Please try again")).toBeVisible();

    await fill(page, "West");
    await register(page);

    await expect(page.getByRole("region", { name: "Member subscriptions" })).toBeVisible();
    const [first, second] = h.registrations as { requestId: string; trainingCenter: string }[];
    expect(second?.trainingCenter).toBe("West");
    expect(second?.requestId).not.toBe(first?.requestId);
    expect(h.blocked).toEqual([]);
    await evidence(page, testInfo, "imported-retry-changed", h.blocked);
  });
});
