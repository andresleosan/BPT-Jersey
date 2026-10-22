import { writeFileSync } from "node:fs";

import {
  expect,
  test as base,
  type Locator,
  type Page,
  type Route,
  type TestInfo,
} from "@playwright/test";
import { progressManagementSchema, type ProgressManagement } from "@bpt-jersey/domain/levels";
import {
  subscriptionBillingSchema,
  type SubscriptionBilling,
} from "@bpt-jersey/domain/memberships/admin";
import { memberOverviewSchema, type MemberOverviewRow } from "@bpt-jersey/domain/members/overview";

import { installAdminFixture, type CallableCall } from "./admin-fixture";
import { blockExternalRequests } from "./network-guard";

/**
 * 8fb73fa: Delete account in /admin/members opens a dialog that lists what the delete removes,
 * loaded from getProgressManagement and listMemberSubscriptionBilling, and keeps the destructive
 * button disabled until those totals settle and the member's full name is typed. Synthetic
 * callables on loopback only: this proves the browser behaviour, not the server's delete.
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

function memberRow(
  studentId: string,
  fullName: string,
  extra: Partial<MemberOverviewRow> = {},
): MemberOverviewRow {
  return {
    studentId,
    rowKind: "member",
    fullName,
    age: 34,
    ageBand: "adult",
    trainingCenter: "Town",
    centreConfirmed: true,
    active: true,
    recordActive: true,
    source: "bpt",
    planState: "current",
    ownAccount: false,
    flags: [],
    ...extra,
  };
}

const ana = memberRow("dac-ana", "Ana María Coelho", {
  ownAccount: true,
  plan: {
    planId: "bpt-jersey-adult",
    displayName: "BPT Jersey Town & West",
    status: "active",
    endsAt: null,
  },
});
const kit = memberRow("dac-kit", "Kit Kid", {
  age: 9,
  ageBand: "kids",
  guardian: { fullName: "Kara Kid", online: true },
  plan: {
    planId: "town-kids-1x",
    displayName: "Town Kids & Teens 1x",
    status: "active",
    endsAt: "2026-12-20T23:59:59.000Z",
  },
});
const max = memberRow("dac-max", "Max Mat", {
  trainingCenter: "West",
  plan: { planId: "west-adult", displayName: "West Adult", status: "active", endsAt: null },
});
const members = [ana, kit, max];

function overviewOf(rows: readonly MemberOverviewRow[]) {
  return memberOverviewSchema.parse({
    rows,
    counters: {
      total: rows.length,
      active: rows.length,
      expiring: 0,
      review: 0,
      inactive: 0,
      guardians: 0,
    },
    generatedAt: "2026-10-22T08:00:00.000Z",
  });
}

/** `attended` class check-ins, then `manual` office-added dates (each with its change-log line). */
function progressOf(
  studentId: string,
  attended: number,
  manual: number,
  initialized: boolean,
): ProgressManagement {
  return progressManagementSchema.parse({
    studentId,
    initialized,
    currentDefinitionKey: initialized ? "white-belt" : null,
    startedOn: initialized ? "2026-03-02" : null,
    classesAtLevel: initialized ? attended : 0,
    daysAtLevel: initialized ? 120 : 0,
    baselineCutoff: null,
    undoPromotionId: null,
    attendance: [
      ...Array.from({ length: attended }, (_, index) => ({
        id: `session-${index}__${studentId}`,
        kind: "attendance",
        date: "2026-10-01",
        label: "Adults Gi",
        openMat: false,
        voided: false,
        reason: null,
      })),
      ...Array.from({ length: manual }, (_, index) => ({
        id: `manual-${index}`,
        kind: "manual",
        date: "2026-10-02",
        label: "Added by owner",
        openMat: false,
        voided: false,
        reason: "Trained at a seminar",
      })),
    ],
    history: Array.from({ length: manual }, () => ({
      at: "2026-10-02T10:00:00.000Z",
      by: "Office",
      summary: "Attendance added on 2026-10-02",
      reason: "Trained at a seminar",
    })),
  });
}

/** One array per membership, one number of payments per invoice. */
function billingOf(studentId: string, ...memberships: number[][]): SubscriptionBilling[] {
  return memberships.map((invoices, membership) =>
    subscriptionBillingSchema.parse({
      membershipId: `${studentId}-m${membership}`,
      complimentary: false,
      currentInvoiceId: null,
      reason: null,
      invoices: invoices.map((payments, invoice) => ({
        invoiceId: `${studentId}-m${membership}-i${invoice}`,
        status: "paid",
        totalMinor: 12500,
        paidAt: "2026-09-01T10:00:00.000Z",
        dueAt: "2026-09-01T00:00:00.000Z",
        description: "Monthly membership",
        payments: Array.from({ length: payments }, (_, payment) => ({
          paymentId: `${studentId}-m${membership}-i${invoice}-p${payment}`,
          amountMinor: 2500,
          method: "cash",
          reference: "Cash at the desk",
          occurredAt: "2026-09-01T10:00:00.000Z",
        })),
      })),
    }),
  );
}

// Ana: 12 classes and 3 office-added dates that stay behind; 4 payments over two memberships.
// Kit: one class, no level yet, no payments. Max: a full 1,000-row list (990 classes + 10 added).
const progress: Record<string, ProgressManagement> = {
  [ana.studentId]: progressOf(ana.studentId, 12, 3, true),
  [kit.studentId]: progressOf(kit.studentId, 1, 0, false),
  [max.studentId]: progressOf(max.studentId, 990, 10, true),
};
const billing: Record<string, SubscriptionBilling[]> = {
  [ana.studentId]: billingOf(ana.studentId, [2, 1], [1]),
  [kit.studentId]: [],
  [max.studentId]: billingOf(max.studentId, [1]),
};

const anaItems = [
  "12 classes attended",
  "Current level",
  "4 plan payments, unless the family has other members",
  "Plan: BPT Jersey Town & West",
  "Bookings",
  "The app login, unless another member uses it",
];
const warning =
  "This deletes the member and everything below for good, even with an active plan. A copy is kept for 30 days.";
const uuidV4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

type Answer = (route: Route) => Promise<void>;

/** Holds every POST to a callable until `release`, then lets the fixture answer it. */
function hold(): { answer: Answer; release: () => void } {
  let release: () => void = () => {};
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  return {
    answer: async (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      await released;
      return route.fallback();
    },
    release,
  };
}

const studentIdOf = (body: unknown) => (body as { data: { studentId: string } }).data.studentId;

/**
 * The owner's Members page with the three members above. `answers` replace the fixture's answer
 * for a callable (registered before the network guard, so the guard still sees every request).
 */
async function openMembers(page: Page, answers: Readonly<Record<string, Answer>> = {}) {
  const calls: CallableCall[] = [];
  const deleted = new Set<string>();
  const callables = {
    getMemberOverview: () => overviewOf(members.filter((row) => !deleted.has(row.studentId))),
    getProgressManagement: (body: unknown) => progress[studentIdOf(body)],
    listMemberSubscriptionBilling: (body: unknown) => billing[studentIdOf(body)],
    deleteMemberAccount: (body: unknown) => {
      const studentId = studentIdOf(body);
      deleted.add(studentId);
      return { studentId, cancelledBookings: 0, removedMemberships: 1 };
    },
  };
  await installAdminFixture(page, { role: "owner", calls, callables });
  for (const [name, answer] of Object.entries(answers)) await page.route(`**/${name}`, answer);
  const blocked = await blockExternalRequests(page, Object.keys(callables));
  await page.goto("/admin/members?adminTestRole=owner", { timeout: 120_000 });
  await expect(page.getByRole("table", { name: "Member directory" })).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.getByText("3 of 3 members")).toBeVisible();
  return { calls, blocked };
}

const rowOf = (page: Page, fullName: string) =>
  page
    .getByRole("table", { name: "Member directory" })
    .getByRole("row")
    .filter({ hasText: fullName });
const deleteButtonOf = (page: Page, fullName: string) =>
  rowOf(page, fullName).getByRole("button", { name: "Delete account", exact: true });
const dialogOf = (page: Page) => page.getByRole("dialog", { name: "Delete account" });
const itemsIn = (dialog: Locator) =>
  dialog.getByRole("list", { name: "What will be deleted" }).getByRole("listitem");
const nameBoxIn = (dialog: Locator, fullName: string) =>
  dialog.getByRole("textbox", { name: `Type “${fullName}” to confirm` });
const removeIn = (dialog: Locator) =>
  dialog.getByRole("button", { name: "Delete account", exact: true });
const count = (posted: readonly string[], name: string) =>
  posted.filter((item) => item === name).length;

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

test.describe("Delete account confirmation (8fb73fa)", () => {
  test.skip(process.env.NEXT_PUBLIC_ADMIN_E2E !== "true", "needs the admin E2E build");
  // A dev server compiles each route on its first request.
  test.setTimeout(180_000);

  test("lists what goes from each member's own totals, the login only for an own account", async ({
    page,
    posted,
  }, testInfo) => {
    const h = await openMembers(page);
    // The totals are read when the dialog opens, not with the directory.
    expect(count(posted, "getProgressManagement")).toBe(0);
    expect(count(posted, "listMemberSubscriptionBilling")).toBe(0);

    await deleteButtonOf(page, ana.fullName).click();
    const dialog = dialogOf(page);
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("heading", { name: "Delete account" })).toBeVisible();
    // The 3 office-added dates and their change log stay behind, so they are not counted.
    await expect(itemsIn(dialog)).toHaveText(anaItems);
    await expect(nameBoxIn(dialog, ana.fullName)).toHaveAccessibleDescription(warning);
    await expect(dialog.getByText("Some totals could not be loaded.")).toHaveCount(0);
    await expect(removeIn(dialog)).toBeDisabled();
    await evidence(page, testInfo, "totals-own-account");
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);

    // A child on a guardian's account: no app login of its own, no level yet, nothing paid.
    await deleteButtonOf(page, kit.fullName).click();
    await expect(itemsIn(dialog)).toHaveText([
      "1 class attended",
      "No level yet",
      "0 plan payments",
      "Plan: Town Kids & Teens 1x",
      "Bookings",
    ]);
    await expect(nameBoxIn(dialog, kit.fullName)).toBeVisible();
    await evidence(page, testInfo, "totals-no-login");
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);

    // The progress list stops at 1,000 rows, so the classes left in a full list are a minimum.
    await deleteButtonOf(page, max.fullName).click();
    await expect(itemsIn(dialog)).toHaveText([
      "990 or more classes attended",
      "Current level",
      "1 plan payment, unless the family has other members",
      "Plan: West Adult",
      "Bookings",
    ]);
    await evidence(page, testInfo, "totals-at-list-limit");
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);

    // Each dialog asked about its own member only (a dev build may ask twice: React Strict Mode).
    for (const name of ["getProgressManagement", "listMemberSubscriptionBilling"]) {
      const asked = h.calls
        .filter((call) => call.name === name)
        .map((call) => studentIdOf(call.body));
      expect(asked.filter((id, index) => id !== asked[index - 1])).toEqual([
        ana.studentId,
        kit.studentId,
        max.studentId,
      ]);
    }
    expect(count(posted, "deleteMemberAccount")).toBe(0);
    await noneBlocked(testInfo, h.blocked);
  });

  test("enables Delete only for the full name, deletes once with a UUID, then reloads without the member", async ({
    page,
    posted,
  }, testInfo) => {
    const totals = hold();
    const deletion = hold();
    const h = await openMembers(page, {
      getProgressManagement: totals.answer,
      deleteMemberAccount: deletion.answer,
    });
    await deleteButtonOf(page, ana.fullName).click();
    const dialog = dialogOf(page);
    const nameBox = nameBoxIn(dialog, ana.fullName);
    const remove = removeIn(dialog);

    // The right name before the totals settle is not enough.
    await expect(dialog.getByRole("status")).toHaveText("Checking what will be deleted…");
    await nameBox.fill(ana.fullName);
    await expect(remove).toBeDisabled();
    await evidence(page, testInfo, "checking-totals");
    totals.release();
    await expect(itemsIn(dialog)).toHaveText(anaItems);
    await expect(remove).toBeEnabled();

    for (const typed of [
      "",
      "Ana",
      "Ana María",
      "Ana María Coelh",
      "Ana Maria Coelho",
      "Ana María Coelho Jr",
    ]) {
      await nameBox.fill(typed);
      await expect(remove, `disabled for «${typed}»`).toBeDisabled();
    }
    await evidence(page, testInfo, "wrong-name");
    // An accent typed as two code points is the same name.
    await nameBox.fill("Ana María Coelho");
    await expect(remove).toBeEnabled();
    // Typed by hand, in other capitals and with extra spaces.
    await nameBox.fill("");
    await expect(remove).toBeDisabled();
    await nameBox.pressSequentially("  ana  MARÍA   coelho ");
    await expect(nameBox).toHaveValue("  ana  MARÍA   coelho ");
    await expect(remove).toBeEnabled();
    await evidence(page, testInfo, "full-name-typed");

    const reads = count(posted, "getMemberOverview");
    await remove.click();
    await expect(dialog.getByRole("button", { name: "Deleting…" })).toBeDisabled();
    await expect(dialog.getByRole("button", { name: "Cancel" })).toBeDisabled();
    // Escape while the delete is in flight keeps the dialog. Chromium does not let a page refuse a
    // second Escape without a new user gesture: it closes the dialog, which opens itself again.
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);
    await expect(dialog).toBeVisible();
    expect(await dialog.evaluate((element) => (element as HTMLDialogElement).open)).toBe(true);
    await expect(dialog.getByRole("button", { name: "Deleting…" })).toBeDisabled();
    await evidence(page, testInfo, "deleting");
    // One request is in flight (held above); a second Escape or click sent nothing more.
    await expect.poll(() => count(posted, "deleteMemberAccount")).toBe(1);

    deletion.release();
    // After the delete the dialog closes and the directory is read again, without the member.
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(rowOf(page, ana.fullName)).toHaveCount(0);
    await expect(page.getByText("2 of 2 members")).toBeVisible();
    await expect(rowOf(page, kit.fullName)).toBeVisible();
    await expect(rowOf(page, max.fullName)).toBeVisible();
    expect(count(posted, "getMemberOverview")).toBe(reads + 1);
    expect(count(posted, "deleteMemberAccount")).toBe(1);
    const deletes = h.calls.filter((call) => call.name === "deleteMemberAccount");
    expect(deletes).toHaveLength(1);
    expect(deletes[0]!.body).toEqual({
      data: { studentId: ana.studentId, requestId: expect.stringMatching(uuidV4) },
    });
    writeFileSync(
      testInfo.outputPath("delete-request.json"),
      JSON.stringify(deletes[0]!.body, null, 2),
    );
    await evidence(page, testInfo, "deleted");
    await noneBlocked(testInfo, h.blocked);
  });

  test("Cancel and Escape close without deleting, focus back on the row's button", async ({
    page,
    posted,
  }, testInfo) => {
    const h = await openMembers(page);
    const opener = deleteButtonOf(page, ana.fullName);
    const dialog = dialogOf(page);
    const reads = count(posted, "getMemberOverview");

    // Armed (totals in, full name typed), then Cancel.
    await opener.click();
    await expect(itemsIn(dialog)).toHaveText(anaItems);
    await nameBoxIn(dialog, ana.fullName).fill(ana.fullName);
    await expect(removeIn(dialog)).toBeEnabled();
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(opener).toBeFocused();
    await evidence(page, testInfo, "after-cancel");

    // A new dialog starts empty; armed again, then Escape.
    await opener.click();
    await expect(nameBoxIn(dialog, ana.fullName)).toHaveValue("");
    await expect(itemsIn(dialog)).toHaveText(anaItems);
    await nameBoxIn(dialog, ana.fullName).fill(ana.fullName);
    await expect(removeIn(dialog)).toBeEnabled();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(opener).toBeFocused();
    await evidence(page, testInfo, "after-escape");

    // Nothing was deleted and the directory was not read again.
    await page.waitForTimeout(1_000);
    expect(count(posted, "deleteMemberAccount")).toBe(0);
    expect(count(posted, "getMemberOverview")).toBe(reads);
    await expect(rowOf(page, ana.fullName)).toBeVisible();
    await expect(page.getByText("3 of 3 members")).toBeVisible();
    await noneBlocked(testInfo, h.blocked);
  });

  test("a failed progress read says some totals are missing and still lets the office delete", async ({
    page,
    posted,
  }, testInfo) => {
    const h = await openMembers(page, {
      getProgressManagement: async (route) => {
        if (route.request().method() !== "POST") return route.fallback();
        await route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ error: { status: "INTERNAL", message: "Synthetic failure" } }),
        });
      },
    });
    await deleteButtonOf(page, ana.fullName).click();
    const dialog = dialogOf(page);
    await expect(dialog.getByRole("status")).toHaveText("Some totals could not be loaded.");
    // The classes total is unknown; the payments total still loaded.
    await expect(itemsIn(dialog)).toHaveText([
      "Classes attended",
      "Current level",
      "4 plan payments, unless the family has other members",
      "Plan: BPT Jersey Town & West",
      "Bookings",
      "The app login, unless another member uses it",
    ]);
    await expect(removeIn(dialog)).toBeDisabled();
    await evidence(page, testInfo, "totals-failed");

    await nameBoxIn(dialog, ana.fullName).fill(ana.fullName);
    await expect(removeIn(dialog)).toBeEnabled();
    await removeIn(dialog).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(rowOf(page, ana.fullName)).toHaveCount(0);
    await expect(page.getByText("2 of 2 members")).toBeVisible();
    expect(count(posted, "getProgressManagement")).toBeGreaterThan(0);
    const deletes = h.calls.filter((call) => call.name === "deleteMemberAccount");
    expect(deletes).toHaveLength(1);
    expect(deletes[0]!.body).toEqual({
      data: { studentId: ana.studentId, requestId: expect.stringMatching(uuidV4) },
    });
    await evidence(page, testInfo, "deleted-after-failed-totals");
    await noneBlocked(testInfo, h.blocked);
  });
});
