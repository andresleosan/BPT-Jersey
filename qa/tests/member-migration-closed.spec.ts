import { expect, test, type Page, type Route, type TestInfo } from "@playwright/test";

import {
  legacyReadsEliminatedReason,
  memberMigrationClosedMessage,
} from "@bpt-jersey/domain/members/migration";

import { installAdminFixture } from "./admin-fixture";
import { blockExternalRequests } from "./network-guard";

/**
 * 2026-10-20 capacity preparation, part 2. Once legacy reads are eliminated the migration queue and
 * its decisions answer "closed" (failed-precondition, reason legacy-reads-eliminated) and the page
 * says so once, with nothing to retry. Synthetic callables on loopback only: browser coverage with a
 * mocked backend; the server closing before any legacy read is unit-tested.
 */
const queue = {
  rows: [
    {
      legacyMemberId: "m1",
      sourceVersion: "1:0",
      category: "strong",
      isMinor: false,
      member: { fullName: "Synthetic Member", birthDate: "1990-01-02" },
      candidates: [
        {
          recordId: "10",
          sourceVersion: "1:0",
          conflicts: [],
          reason: "member-number",
          record: { fullName: "Synthetic Member", birthDate: "1990-01-02" },
        },
      ],
    },
  ],
  archiveOnly: 0,
  decided: 0,
};
const closed = {
  status: "FAILED_PRECONDITION",
  message: memberMigrationClosedMessage,
  details: { reason: legacyReadsEliminatedReason },
};
const closedText = /The member migration is closed/;

type Answer = (route: Route) => Promise<void>;
function answer(status: number, body: unknown): Answer {
  return (route) =>
    route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}
const ok = (data: unknown) => answer(200, { data });
const refuse = (status: number, error: Record<string, unknown>) => answer(status, { error });

/**
 * The migration page with each callable answered by `answers`; `calls` keeps their order.
 * `next dev` runs React Strict Mode (Next's App Router default; next.config.ts does not change it),
 * which mounts the page twice, so the first queue read may arrive twice - a development artefact the
 * jsdom test (no Strict Mode) shows as one. What matters, and is asserted, is that nothing is read
 * again after the closed answer.
 */
async function openMigration(page: Page, answers: Readonly<Record<string, Answer>>) {
  const calls: string[] = [];
  const callables = { listMemberMigrationQueue: null, decideMemberMigration: null };
  await installAdminFixture(page, { callables });
  for (const [name, answer] of Object.entries(answers)) {
    await page.route(`**/${name}`, async (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      calls.push(name);
      return answer(route);
    });
  }
  const blocked = await blockExternalRequests(page, Object.keys(callables));
  await page.goto("/admin/members/migration?adminTestRole=owner", { timeout: 120_000 });
  return { calls, blocked };
}

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

test.describe("Member migration after legacy reads are eliminated (2026-10-20 part 2)", () => {
  test.skip(process.env.NEXT_PUBLIC_ADMIN_E2E !== "true", "needs the admin E2E build");
  test.setTimeout(180_000);

  test("says the queue is closed once and offers nothing to retry", async ({ page }, testInfo) => {
    const h = await openMigration(page, {
      listMemberMigrationQueue: refuse(400, closed),
    });

    await expect(page.getByText(closedText)).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole("button", { name: "Retry" })).toHaveCount(0);
    await expect(page.getByLabel("Identity evidence")).toHaveCount(0);
    await expect(page.getByRole("tab")).toHaveCount(0);
    // No retry loop: once the closed answer is on screen, nothing asks again.
    const shown = h.calls.length;
    await page.waitForTimeout(1_500);
    expect(h.calls).toHaveLength(shown);
    expect(new Set(h.calls)).toEqual(new Set(["listMemberMigrationQueue"]));
    await evidence(page, testInfo, "migration-closed", h.blocked);
  });

  test("closes after a decision comes back closed, without reading the queue again", async ({
    page,
  }, testInfo) => {
    const h = await openMigration(page, {
      listMemberMigrationQueue: ok(queue),
      decideMemberMigration: refuse(400, closed),
    });
    await expect(page.getByRole("tab", { name: "Strong (1)" })).toBeVisible({ timeout: 60_000 });
    await page.getByLabel("Identity evidence").fill("Synthetic passport seen");
    await page.getByLabel("Reason for the reviewed choices").fill("Same synthetic person");
    await page.getByLabel("Centre").selectOption("Town");
    await page.getByLabel("Evening").check();

    await page.getByRole("button", { name: "Link to this record" }).click();

    await expect(page.getByText(closedText)).toBeVisible();
    await expect(page.getByRole("tab")).toHaveCount(0);
    await expect(page.getByLabel("Identity evidence")).toHaveCount(0);
    await expect(page.getByText(/Could not save/)).toHaveCount(0);
    await page.waitForTimeout(1_500);
    // One decision, and the queue is not read again after it: every read came before it.
    const decided = h.calls.indexOf("decideMemberMigration");
    expect(h.calls.filter((name) => name === "decideMemberMigration")).toHaveLength(1);
    expect(h.calls.slice(decided + 1)).toEqual([]);
    expect(h.calls.slice(0, decided).length).toBeGreaterThan(0);
    await evidence(page, testInfo, "migration-closed-on-decision", h.blocked);
  });

  test("reports a batch the queue closed partway through, sending and reading nothing after", async ({
    page,
  }, testInfo) => {
    const second = {
      ...queue.rows[0]!,
      legacyMemberId: "m2",
      candidates: [{ ...queue.rows[0]!.candidates[0]!, recordId: "11" }],
    };
    const h = await openMigration(page, {
      listMemberMigrationQueue: ok({ ...queue, rows: [...queue.rows, second] }),
      decideMemberMigration: ok({
        results: [{ legacyMemberId: "m1", status: "applied", studentId: "student-1" }],
        closed: true,
      }),
    });
    await expect(page.getByRole("tab", { name: "Strong (2)" })).toBeVisible({ timeout: 60_000 });
    await page.getByLabel("Identity evidence").fill("Synthetic passport seen");
    await page.getByLabel("Reason for the reviewed choices").fill("Same synthetic person");
    await page.getByLabel("Centre").selectOption("Town");
    await page.getByLabel("Evening").check();

    await page.getByRole("button", { name: "Approve compatible matches (2, up to 50)" }).click();

    await expect(page.getByText(closedText)).toBeVisible();
    await expect(page.getByText("Applied 1 · Rejected 0")).toBeVisible();
    await expect(page.getByText(/Could not save/)).toHaveCount(0);
    await page.waitForTimeout(1_500);
    const decided = h.calls.indexOf("decideMemberMigration");
    expect(h.calls.filter((name) => name === "decideMemberMigration")).toHaveLength(1);
    expect(h.calls.slice(decided + 1)).toEqual([]);
    await evidence(page, testInfo, "migration-closed-partway", h.blocked);
  });

  test("an office refused for permission sees the safe outage notice, never the closed one", async ({
    page,
  }, testInfo) => {
    const h = await openMigration(page, {
      listMemberMigrationQueue: refuse(403, {
        status: "PERMISSION_DENIED",
        message: "Only the office can review the member migration.",
      }),
    });

    await expect(
      page.getByRole("alert").filter({ hasText: "The migration queue is unavailable. Try again." }),
    ).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
    await expect(page.getByText(closedText)).toHaveCount(0);
    await expect(page.getByText("Only the office can review")).toHaveCount(0);
    await evidence(page, testInfo, "migration-permission-denied", h.blocked);
  });
});
