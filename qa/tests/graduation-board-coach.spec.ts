import { expect, test, type Page, type TestInfo } from "@playwright/test";

import { installAdminFixture, type AdminTestRole, type CallableCall } from "./admin-fixture";
import { blockExternalRequests } from "./network-guard";

/**
 * Operator decision 2026-10-21: coaches read the graduation board, so they see which children are
 * ready without opening each card; only the office decides. Synthetic callables on loopback only:
 * browser coverage of the screen and the menu with a mocked backend. The server's role mapping
 * (graduationBoardAccess) is unit-tested; decideGraduation still refuses the mat on the server.
 */
function board(canDecide: boolean) {
  return {
    canDecide,
    generatedAt: "2026-10-21T08:00:00.000Z",
    rows: [
      {
        studentId: "student-1",
        fullName: "Synthetic Kid Ready",
        stage: "approval",
        current: { definitionKey: "white-kids", name: "White belt kids" },
        target: { definitionKey: "white-kids-1", name: "White belt kids, 1st stripe" },
        classesDone: 4,
        minClasses: 4,
        daysDone: 42,
        minDays: 30,
        likelyNext: null,
        graduationClass: {
          sessionId: "session-1",
          occurredAt: "2026-10-20T17:00:00.000Z",
          title: "Kids 4-7",
        },
        lastNotYetNote: null,
      },
      {
        studentId: "student-2",
        fullName: "Synthetic Kid Next",
        stage: "next",
        current: { definitionKey: "white-kids", name: "White belt kids" },
        target: { definitionKey: "white-kids-1", name: "White belt kids, 1st stripe" },
        classesDone: 3,
        minClasses: 4,
        daysDone: 35,
        minDays: 30,
        likelyNext: {
          sessionId: "session-2",
          startAt: "2026-10-22T17:00:00.000Z",
          title: "Kids 4-7",
        },
        graduationClass: null,
        lastNotYetNote: null,
      },
    ],
  };
}

async function openBoard(page: Page, role: AdminTestRole) {
  const calls: CallableCall[] = [];
  const callables = {
    listGraduationBoard: board(role === "owner" || role === "administrator"),
    decideGraduation: { ok: true },
  };
  await installAdminFixture(page, { role, callables, calls });
  const blocked = await blockExternalRequests(page, Object.keys(callables));
  await page.goto(`/admin/graduations?adminTestRole=${role}`, { timeout: 120_000 });
  await expect(page.getByText("Synthetic Kid Ready")).toBeVisible({ timeout: 60_000 });
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

test.describe("Graduation board for the mat (operator 2026-10-21)", () => {
  test.skip(process.env.NEXT_PUBLIC_ADMIN_E2E !== "true", "needs the admin E2E build");
  test.setTimeout(180_000);

  for (const role of ["coach", "headCoach"] as const) {
    test(`a ${role} sees who is ready and who is next, and cannot decide`, async ({
      page,
    }, testInfo) => {
      const h = await openBoard(page, role);

      await expect(page.getByText("Synthetic Kid Next")).toBeVisible();
      await expect(page.getByText("The office decides")).toBeVisible();
      await expect(page.getByRole("button", { name: "Promote" })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Not yet" })).toHaveCount(0);
      // The menu names the board for the mat; on a phone it sits in the drawer.
      if (testInfo.project.name === "mobile-chromium")
        await page.getByRole("button", { name: "Open coach navigation" }).click();
      await expect(page.getByRole("link", { name: "Graduations" }).first()).toBeVisible();
      expect(h.calls.map((call) => call.name)).not.toContain("decideGraduation");
      expect(h.blocked).toEqual([]);
      await evidence(page, testInfo, `graduation-board-${role}`, h.blocked);
    });
  }

  test("the office still promotes or says not yet", async ({ page }, testInfo) => {
    const h = await openBoard(page, "owner");

    await expect(page.getByRole("button", { name: "Promote" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Not yet" })).toBeVisible();
    await expect(page.getByText("The office decides")).toHaveCount(0);
    expect(h.blocked).toEqual([]);
    await evidence(page, testInfo, "graduation-board-owner", h.blocked);
  });
});
