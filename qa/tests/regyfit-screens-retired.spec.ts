import { writeFileSync } from "node:fs";

import { expect, test as base, type Page, type Route, type TestInfo } from "@playwright/test";
import { PLAN_CATALOG } from "@bpt-jersey/domain/memberships";
import { memberSubscriptionContextSchema } from "@bpt-jersey/domain/memberships/admin";
import { adminDirectoryRowSchema } from "@bpt-jersey/domain/members/directory";
import { memberOverviewSchema, type MemberOverviewRow } from "@bpt-jersey/domain/members/overview";
import { memberProfileSchema } from "@bpt-jersey/domain/members/profile";

import { installAdminFixture, type AdminTestRole, type CallableCall } from "./admin-fixture";
import { blockExternalRequests } from "./network-guard";

/**
 * 5ddf68d retired the empty Regyfit archive: its screens, the record's History tab, «Previously
 * paid» and six callables. /admin/members/search keeps the office's exact identifier lookup (with
 * ?archive) and the mat's name search. Synthetic callables on loopback only.
 */

/** The callables 5ddf68d retired: the web must never ask for them again. */
const retiredCallables = [
  "listRegyfitMemberRecords",
  "getRegyfitMemberRecord",
  "listRegyfitAccessRecords",
  "revealRegyfitRecordField",
  "getMemberHistory",
  "getMemberRecoveryHistory",
];

/**
 * Every test records the callables its page POSTs; after the test the list is kept as evidence and
 * must not name a retired callable. (The fixture callback is `provide`, not `use`: see 4b5e63c.)
 */
const test = base.extend<{ posted: string[] }>({
  posted: [
    async ({ page }, provide, testInfo) => {
      const posted: string[] = [];
      const retiredSeen: string[] = [];
      page.on("request", (request) => {
        const url = new URL(request.url());
        const name = url.pathname.split("/").pop() ?? "";
        if (retiredCallables.includes(name)) retiredSeen.push(`${request.method()} ${url.href}`);
        if (request.method() === "POST" && url.hostname.endsWith(".cloudfunctions.net"))
          posted.push(name);
      });
      await provide(posted);
      const seen = [...new Set(posted)].sort();
      writeFileSync(testInfo.outputPath("callables-posted.json"), JSON.stringify(seen, null, 2));
      console.log(`[callables] ${testInfo.project.name} › ${testInfo.title}: ${seen.join(", ")}`);
      expect(retiredSeen, "no retired callable is requested").toEqual([]);
    },
    { auto: true },
  ],
});

const studentId = "rsr-member";
const fullName = "Rui Santos";

function overviewRow(id: string, name: string, extra: Partial<MemberOverviewRow> = {}) {
  return {
    studentId: id,
    rowKind: "member",
    fullName: name,
    age: 41,
    ageBand: "adult",
    trainingCenter: "Town",
    centreConfirmed: true,
    active: true,
    recordActive: true,
    source: "bpt",
    planState: "current",
    ownAccount: true,
    flags: [],
    ...extra,
  };
}
const overview = memberOverviewSchema.parse({
  rows: [
    overviewRow("rsr-bea", "Bea Lima", { age: 29 }),
    // An imported member: the directory says "Imported", never "Regyfit".
    overviewRow(studentId, fullName, {
      source: "regyfit",
      plan: {
        planId: "bpt-jersey-adult",
        displayName: "BPT Jersey Town & West",
        status: "active",
        endsAt: "2026-11-30T23:59:59.000Z",
      },
    }),
  ],
  counters: { total: 2, active: 2, expiring: 0, review: 0, inactive: 0, guardians: 0 },
  generatedAt: "2026-10-22T08:00:00.000Z",
});

const directoryRow = adminDirectoryRowSchema.parse({
  studentId,
  fullName,
  trainingCenter: "Town",
  participantType: "adult",
  active: true,
  status: "active",
  membershipReference: "****1042",
});

const profile = memberProfileSchema.parse({
  view: "full",
  header: {
    studentId,
    fullName,
    age: 41,
    participantType: "adult",
    status: "active",
    maskedMemberReference: "****1042",
    birthdayBadge: null,
  },
  cards: {
    memberSince: "2025-11-03",
    monthsAsMember: 11,
    accountManagers: [],
    currentMembership: {
      membershipId: "rsr-membership",
      planName: "BPT Jersey Town & West",
      status: "active",
      validUntil: "2026-11-30",
    },
  },
  details: {
    studentId,
    fullName,
    dateOfBirth: "1985-04-12",
    phoneNumber: "+44 7700900042",
    email: "rui.santos@example.test",
    trainingCenter: "Town",
    trainingTimePreferences: ["evening"],
    participantType: "adult",
    active: true,
    status: "active",
    gender: "unknown",
    membershipNumber: "1042",
    details: { internalNotes: "Synthetic office note" },
  },
});

// Shaped like the server's getStudentProgressSummary answer (the IBJJF card on the Profile tab).
const levelCard = {
  progress: {
    state: "initialized",
    studentId,
    currentDefinition: { definitionKey: "white-belt" },
    targetDefinition: { definitionKey: "white-1st-stripe" },
    skillChecklist: [],
    currentLevelStartedAt: "2026-09-08T00:00:00.000Z",
    progressPercent: 40,
    criteria: {
      classes: { required: 4, completed: 2, imported: 0, met: false },
      time: { requiredDays: 30, elapsedDays: 44, met: true },
      skills: { total: 11, completed: 0, met: false, percentage: 0 },
      age: { requiredMinAge: null, requiredMaxAge: null, ageYears: 41, met: true },
      overallEligible: false,
    },
    totalAttendedClasses: 2,
    totalHours: 2,
    calculatedAt: "2026-10-21T12:00:00.000Z",
  },
};

const planIds = ["bpt-jersey-adult", "town-adult", "payg"];
const plans = planIds.map((planId) => ({
  ...PLAN_CATALOG.find((plan) => plan.planId === planId)!,
  active: true,
}));
function subscriptionsOf(status: "active" | "cancelled") {
  return memberSubscriptionContextSchema.parse({
    studentId,
    fullName,
    eligiblePlanIds: planIds,
    memberships: [
      {
        membershipId: "rsr-membership",
        studentId,
        planId: "bpt-jersey-adult",
        status,
        startsAt: "2026-10-01T00:00:00.000Z",
        endsAt: "2026-11-30T23:59:59.000Z",
        updatedAt: "2026-10-01T09:00:00.000Z",
      },
    ],
  });
}

const lookupOf = (body: unknown) => (body as { data: { lookupKind: string; value: string } }).data;

/** Every callable the pages below read, answered with the synthetic data above. */
const callables: Record<string, unknown> = {
  getMemberOverview: overview,
  lookupMemberIdentity: (body: unknown) => {
    const { lookupKind, value } = lookupOf(body);
    return lookupKind === "membership-number" && value === "1042"
      ? { matched: true, row: directoryRow }
      : { matched: false };
  },
  searchMemberNames: { members: [{ studentId, fullName }] },
  getMemberProfile: profile,
  getStudentProgressSummary: levelCard,
  listMemberSubscriptions: subscriptionsOf("active"),
  listManagedPlans: plans,
  listMemberSubscriptionBilling: [],
  listMemberClassRecords: (body: unknown) => ({
    studentId,
    kind: (body as { data: { kind: string } }).data.kind,
    rows: [],
    nextCursor: null,
  }),
  getStudentGroupAccess: { studentId, programIds: [], revision: 0, dateOfBirth: "1985-04-12" },
  listScheduleCatalog: { locations: [], programs: [] },
};

type Answer = (route: Route) => Promise<void>;

async function open(
  page: Page,
  url: string,
  options: {
    role?: AdminTestRole;
    callables?: Record<string, unknown>;
    answers?: Readonly<Record<string, Answer>>;
  } = {},
) {
  const calls: CallableCall[] = [];
  const answered = { ...callables, ...options.callables };
  await installAdminFixture(page, { role: options.role ?? "owner", calls, callables: answered });
  for (const [name, answer] of Object.entries(options.answers ?? {}))
    await page.route(`**/${name}`, answer);
  const blocked = await blockExternalRequests(page, Object.keys(answered));
  // Every address the tab shows, client-side (history) navigations included.
  const visited: string[] = [];
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) visited.push(frame.url());
  });
  await page.goto(url, { timeout: 120_000 });
  return { calls, blocked, visited };
}

const pathOf = (href: string) => new URL(href).pathname;

async function evidence(page: Page, testInfo: TestInfo, name: string) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow, "no horizontal page scroll").toBeLessThanOrEqual(0);
  await page.screenshot({
    path: testInfo.outputPath(`${name}-${testInfo.project.name}.png`),
    fullPage: true,
    // A full-page capture of a scrolled page draws the fixed, off-screen skip link mid-page.
    style: ".skip-link { display: none !important; }",
  });
}

/** The guard aborted nothing: every request was loopback or a callable this spec answered. */
async function noneBlocked(testInfo: TestInfo, blocked: readonly string[]) {
  writeFileSync(testInfo.outputPath("blocked-requests.json"), JSON.stringify(blocked, null, 2));
  await testInfo.attach("blocked-requests", {
    body: JSON.stringify(blocked, null, 2),
    contentType: "application/json",
  });
  expect(blocked).toEqual([]);
}

/** None of the retired archive's words anywhere on the page. */
async function noArchiveCopy(page: Page) {
  for (const text of [
    /imported archive/i,
    /previously paid/i,
    /regyfit/i,
    /previous member records/i,
  ])
    await expect(page.getByText(text)).toHaveCount(0);
}

const recordTabs = [
  "Profile",
  "Details",
  "Plan",
  "Documents",
  "Payments",
  "Classes",
  "Communication",
  "Notes",
];

test.describe("Regyfit screens retired (5ddf68d)", () => {
  test.skip(process.env.NEXT_PUBLIC_ADMIN_E2E !== "true", "needs the admin E2E build");
  // A dev server compiles each route on its first request.
  test.setTimeout(180_000);

  test("office: Migration tools opens the exact identifier lookup, which stays put and opens the record", async ({
    page,
    posted,
  }, testInfo) => {
    const h = await open(page, "/admin/members?adminTestRole=owner");
    const directory = page.getByRole("table", { name: "Member directory" });
    await expect(directory).toBeVisible({ timeout: 60_000 });
    // "Regyfit" in Members reads "Imported".
    await expect(directory.getByRole("row").filter({ hasText: fullName })).toContainText(
      "41 years · Imported",
    );
    await expect(page.getByRole("combobox", { name: "Source" }).locator("option")).toHaveText([
      "All sources",
      "Imported",
      "New BPT registration",
    ]);
    await page.getByText("Migration tools", { exact: true }).click();
    const lookupLink = page.getByRole("link", { name: "exact identifier lookup", exact: true });
    await expect(lookupLink).toHaveAttribute("href", "/admin/members/search?archive");
    await expect(page.locator(".members-legacy-tools")).toContainText(
      "Find a member by exact membership, ID card or VAT number in the exact identifier lookup.",
    );
    await noArchiveCopy(page);
    await evidence(page, testInfo, "members-migration-tools");

    const clickedAt = h.visited.length;
    await lookupLink.click();
    const lookup = page.getByRole("heading", { name: "Find by identifier" });
    await expect(lookup).toBeVisible({ timeout: 60_000 });
    // The office used to be bounced back to Members right after this link: wait, then look again.
    await page.waitForTimeout(2_500);
    await expect(lookup).toBeVisible();
    const here = new URL(page.url());
    expect(here.pathname).toBe("/admin/members/search");
    expect(here.searchParams.has("archive")).toBe(true);
    // Next may rewrite the same address (replaceState); it never left the lookup.
    const after = h.visited.slice(clickedAt).map(pathOf);
    expect(after.length).toBeGreaterThan(0);
    expect(new Set(after)).toEqual(new Set(["/admin/members/search"]));
    await expect(page.getByRole("heading", { name: "Find a member" })).toHaveCount(0);
    await noArchiveCopy(page);
    await evidence(page, testInfo, "exact-lookup-settled");

    // An ID card number that matches nobody, then the member's membership number.
    await page.getByLabel("Identifier type").selectOption("id-card-number");
    await page.getByLabel("Exact identifier").fill("JE-0000");
    await page.getByRole("button", { name: "Search exact identifier" }).click();
    const result = page.getByRole("region", { name: "Member lookup result" });
    await expect(result).toHaveText("No matching student was found.");
    await page.getByLabel("Identifier type").selectOption("membership-number");
    await page.getByLabel("Exact identifier").fill("1042");
    await page.getByRole("button", { name: "Search exact identifier" }).click();
    const openRecord = result.getByRole("link", { name: `Open record for ${fullName}` });
    await expect(openRecord).toHaveText("Open record");
    await expect(openRecord).toHaveAttribute("href", `/admin/members/profile?id=${studentId}`);
    await expect(result).toContainText(`${fullName} ****1042`);
    expect(
      h.calls.filter((call) => call.name === "lookupMemberIdentity").map((call) => call.body),
    ).toEqual([
      {
        data: {
          lookupKind: "id-card-number",
          value: "JE-0000",
          purpose: "member-identity-lookup",
        },
      },
      {
        data: { lookupKind: "membership-number", value: "1042", purpose: "member-identity-lookup" },
      },
    ]);
    await evidence(page, testInfo, "exact-lookup-match");

    await openRecord.click();
    await expect(page.getByRole("heading", { level: 2, name: fullName })).toBeVisible({
      timeout: 60_000,
    });
    expect(pathOf(page.url())).toBe("/admin/members/profile");
    expect(new URL(page.url()).searchParams.get("id")).toBe(studentId);
    expect(posted).not.toContain("searchMemberNames");
    await noneBlocked(testInfo, h.blocked);
  });

  test("office: the search page without ?archive sends the office to Members", async ({
    page,
    posted,
  }, testInfo) => {
    const h = await open(page, "/admin/members/search?adminTestRole=owner");
    await expect(page.getByRole("table", { name: "Member directory" })).toBeVisible({
      timeout: 60_000,
    });
    expect(pathOf(page.url())).toBe("/admin/members");
    await expect(
      page.getByRole("heading", { level: 2, name: "Members", exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("heading", { name: "Find by identifier" })).toHaveCount(0);
    expect(h.visited.map(pathOf)).toContain("/admin/members");
    expect(posted).not.toContain("lookupMemberIdentity");
    await evidence(page, testInfo, "search-redirects-office");
    await noneBlocked(testInfo, h.blocked);
  });

  test("coach: the search page is the name search, never the exact lookup", async ({
    page,
    posted,
  }, testInfo) => {
    const h = await open(page, "/admin/members/search?adminTestRole=coach", { role: "coach" });
    const nameSearch = page.getByRole("search", { name: "Search members by name" });
    await expect(page.getByRole("heading", { name: "Find a member" })).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.getByRole("heading", { name: "Find by identifier" })).toHaveCount(0);
    await expect(page.getByLabel("Identifier type")).toHaveCount(0);
    await nameSearch.getByLabel("Member name").fill("ru");
    await nameSearch.getByRole("button", { name: "Search" }).click();
    const results = page.getByRole("region", { name: "Member search results" });
    await expect(
      results.getByRole("link", { name: `Open record for ${fullName}` }),
    ).toHaveAttribute("href", `/admin/members/profile?id=${studentId}`);
    expect(pathOf(page.url())).toBe("/admin/members/search");
    await evidence(page, testInfo, "coach-name-search");

    // ?archive changes nothing for the mat.
    await page.goto("/admin/members/search?archive&adminTestRole=coach");
    await expect(page.getByRole("heading", { name: "Find a member" })).toBeVisible({
      timeout: 60_000,
    });
    await page.waitForTimeout(1_500);
    await expect(page.getByRole("heading", { name: "Find by identifier" })).toHaveCount(0);
    expect(pathOf(page.url())).toBe("/admin/members/search");
    expect(posted).not.toContain("lookupMemberIdentity");
    expect(
      h.calls.filter((call) => call.name === "searchMemberNames").map((call) => call.body),
    ).toEqual([{ data: { query: "ru" } }]);
    await evidence(page, testInfo, "coach-archive-param");
    await noneBlocked(testInfo, h.blocked);
  });

  test("office record: no History tab, ?tab=history falls back, no archive copy on any tab", async ({
    page,
  }, testInfo) => {
    const h = await open(
      page,
      `/admin/members/profile?id=${studentId}&tab=history&adminTestRole=owner`,
    );
    const record = page.getByRole("region", { name: "Member record" });
    await expect(record.getByRole("heading", { level: 2, name: fullName })).toBeVisible({
      timeout: 60_000,
    });
    const tabs = record.getByRole("tablist", { name: "Member record sections" }).getByRole("tab");
    await expect(tabs).toHaveText(recordTabs);
    // The unknown tab falls back to Profile and the address names the tab on screen.
    await expect(record.getByRole("tab", { name: "Profile" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(page).toHaveURL(new RegExp(`/admin/members/profile\\?id=${studentId}$`));
    await expect(record.getByRole("region", { name: "JIU-JITSU IBJJF" })).toBeVisible();
    await expect(record.getByRole("alert")).toHaveCount(0);
    await noArchiveCopy(page);
    await evidence(page, testInfo, "record-history-fallback");

    // The Plan tab's editor is "Change Plan": a plan and its expiry, no payment choice at all.
    await record.getByRole("tab", { name: "Plan" }).click();
    await expect(record.getByText("Current plan: BPT Jersey Town & West")).toBeVisible();
    await record.getByRole("button", { name: "Change Plan" }).click();
    const changePlan = record.getByRole("form", { name: "Change plan" });
    await expect(changePlan.getByRole("combobox")).toHaveCount(1);
    await expect(changePlan.getByRole("combobox", { name: "Plan" }).locator("option")).toHaveText([
      "Select a plan",
      "BPT Jersey Town & West",
      "Town Adult",
      "West Pay as you go · no expiry",
    ]);
    await expect(page.getByRole("combobox", { name: "Payment for this period" })).toHaveCount(0);
    await noArchiveCopy(page);
    await evidence(page, testInfo, "record-plan-change");
    await changePlan.getByRole("button", { name: "Cancel" }).click();

    // The other tabs lost their "may still be in the imported archive" lines.
    await record.getByRole("tab", { name: "Payments" }).click();
    await expect(
      record.getByText("No invoices or payments recorded for this member's memberships."),
    ).toBeVisible();
    await noArchiveCopy(page);
    await record.getByRole("tab", { name: "Classes" }).click();
    await expect(record.getByText("No bookings recorded")).toBeVisible();
    await expect(record.getByText("No attendance recorded")).toBeVisible();
    await noArchiveCopy(page);
    await record.getByRole("tab", { name: "Notes" }).click();
    await expect(record.getByText("Synthetic office note")).toBeVisible();
    await noArchiveCopy(page);
    for (const tab of ["Documents", "Communication"]) {
      await record.getByRole("tab", { name: tab }).click();
      await expect(record.getByRole("tab", { name: tab })).toHaveAttribute("aria-selected", "true");
      await noArchiveCopy(page);
    }
    await expect(tabs).toHaveText(recordTabs);
    await evidence(page, testInfo, "record-last-tab");
    await noneBlocked(testInfo, h.blocked);
  });

  test("office: the subscription editor's payment choices have no «Previously paid»", async ({
    page,
  }, testInfo) => {
    // member-subscription-editor.tsx is the office's editor from a notification (Overview) and from
    // the last step of Add member; the record's Plan tab has its own Change Plan form (test above).
    const h = await open(page, "/admin?adminTestRole=owner", {
      callables: {
        listAdminNotifications: {
          notifications: [
            {
              notificationId: "rsr-notice",
              kind: "membership",
              title: `Membership ended for ${fullName}`,
              message: `${fullName}'s membership was cancelled.`,
              href: "/admin/members",
              createdAt: "2026-10-21T09:00:00.000Z",
              readAt: "2026-10-21T10:00:00.000Z",
              resolvedAt: null,
              membershipId: "rsr-membership",
              studentId,
              endsAt: null,
            },
          ],
          nextCursor: null,
          unreadCount: 0,
        },
        // A cancelled membership: the editor offers a new subscription and keeps the old one read-only.
        listMemberSubscriptions: subscriptionsOf("cancelled"),
      },
    });
    await page
      .getByRole("button", { name: new RegExp(`Membership ended for ${fullName}`) })
      .click({ timeout: 60_000 });
    await page.getByRole("button", { name: "Edit subscription" }).click();
    const editor = page.getByRole("region", { name: "Member subscriptions" });
    const payment = editor.getByRole("combobox", { name: "Payment for this period" });
    await expect(payment).toHaveCount(2, { timeout: 60_000 });
    // The new subscription (operation "assign", where «Previously paid» used to be offered)...
    await expect(payment.nth(0).locator("option")).toHaveText([
      "Payment received",
      "Unpaid — amount due",
      "Complimentary — no payment required",
    ]);
    // ...and the cancelled one (operation "update").
    await expect(payment.nth(1).locator("option")).toHaveText([
      "Keep current payment status",
      "Payment received",
      "Unpaid — amount due",
      "Complimentary — no payment required",
    ]);
    await expect(editor.getByText(/member archive|previous paid membership/i)).toHaveCount(0);
    await noArchiveCopy(page);
    writeFileSync(
      testInfo.outputPath("payment-choices.json"),
      JSON.stringify(
        {
          newSubscription: await payment.nth(0).locator("option").allTextContents(),
          cancelledSubscription: await payment.nth(1).locator("option").allTextContents(),
        },
        null,
        2,
      ),
    );
    // The reader pane scrolls on its own, so a full-page capture cuts the editor off.
    await payment.nth(0).scrollIntoViewIfNeeded();
    await page.screenshot({
      path: testInfo.outputPath(`subscription-editor-new-${testInfo.project.name}.png`),
    });
    await payment.nth(1).scrollIntoViewIfNeeded();
    await page.screenshot({
      path: testInfo.outputPath(`subscription-editor-cancelled-${testInfo.project.name}.png`),
    });
    await evidence(page, testInfo, "subscription-editor-payment-choices");
    await noneBlocked(testInfo, h.blocked);
  });

  test("office record that does not exist links to the migration queue only", async ({
    page,
  }, testInfo) => {
    const h = await open(page, `/admin/members/profile?id=${studentId}&adminTestRole=owner`, {
      answers: {
        getMemberProfile: async (route) => {
          if (route.request().method() !== "POST") return route.fallback();
          await route.fulfill({
            status: 404,
            contentType: "application/json",
            body: JSON.stringify({ error: { status: "NOT_FOUND", message: "Synthetic missing" } }),
          });
        },
      },
    });
    const record = page.getByRole("region", { name: "Member record" });
    await expect(
      record.getByText("Live member record unavailable. It may not have been created yet."),
    ).toBeVisible({ timeout: 60_000 });
    await expect(record.getByRole("link")).toHaveText([
      "Back to members",
      "Review member migration",
    ]);
    await expect(record.getByRole("link", { name: "Review member migration" })).toHaveAttribute(
      "href",
      "/admin/members/migration",
    );
    await noArchiveCopy(page);
    await evidence(page, testInfo, "record-missing");
    await noneBlocked(testInfo, h.blocked);
  });
});
