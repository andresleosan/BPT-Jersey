import { expect, test } from "@playwright/test";
import {
  decideMemberMigrationInputSchema,
  type MemberMigrationDecisionInput,
  type MemberMigrationQueueResponse,
} from "@bpt-jersey/domain/members/migration";
import { installAdminFixture } from "./admin-fixture";

test.use({ serviceWorkers: "block" });

type Row = MemberMigrationQueueResponse["rows"][number];

function row(
  id: number,
  category: Row["category"] = "strong",
  isMinor: Row["isMinor"] = false,
): Row {
  const person = {
    fullName: `Synthetic Member ${id}`,
    ...(isMinor === "unknown" ? {} : { birthDate: isMinor ? "2015-01-02" : "1990-01-02" }),
    memberNumberMasked: `•••${id}`,
  };
  return {
    legacyMemberId: `m${id}`,
    category,
    isMinor,
    member: person,
    candidates:
      category === "none"
        ? []
        : [
            {
              recordId: String(id),
              reason: category === "suggested" ? "name-and-birth-date" : "member-number",
              record: { ...person, fullName: `Synthetic Archive ${id}` },
            },
          ],
  };
}

test("member migration queue: counters, batch links, required skip reason and responsive keyboard flow", async ({
  page,
  baseURL,
  isMobile,
}, testInfo) => {
  await page.setViewportSize({ width: isMobile ? 375 : 1440, height: 900 });
  let queue: MemberMigrationQueueResponse = {
    rows: [
      row(10),
      row(11),
      row(12, "suggested"),
      row(13, "ambiguous"),
      row(14, "none"),
      row(15, "strong", true),
      row(16, "strong", "unknown"),
    ],
    archiveOnly: 3,
    decided: 4,
  };
  const decisions: MemberMigrationDecisionInput[][] = [];
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await installAdminFixture(page, {
    callables: {
      listMemberMigrationQueue: () => queue,
      decideMemberMigration: (body: unknown) => {
        const batch = decideMemberMigrationInputSchema.parse(
          (body as { data: unknown }).data,
        ).decisions;
        decisions.push(batch);
        queue = {
          ...queue,
          rows: queue.rows.filter(
            (row) => !batch.some((decision) => decision.legacyMemberId === row.legacyMemberId),
          ),
          decided: queue.decided + batch.length,
        };
        return {
          results: batch.map(({ legacyMemberId }) => ({ legacyMemberId, status: "applied" })),
        };
      },
    },
  });

  let mode: "loading" | "ready" | "error" = "loading";
  let releaseLoading!: () => void;
  const loading = new Promise<void>((resolve) => {
    releaseLoading = resolve;
  });
  const stubbedCallables = new Set([
    "listMemberMigrationQueue",
    "decideMemberMigration",
    "listAdminNotifications",
    "getDailyOperationsDashboard",
    "getOperationalReport",
    "listUpcomingBirthdays",
  ]);
  // Let the shared admin fixture answer callables; block every other non-local request.
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    const name = url.pathname.split("/").pop() ?? "";
    if (route.request().method() === "POST" && stubbedCallables.has(name)) {
      if (name === "listMemberMigrationQueue") {
        if (mode === "loading") await loading;
        if (mode === "error") {
          await route.fulfill({
            status: 500,
            json: { error: { status: "INTERNAL", message: "Synthetic backend detail" } },
          });
          return;
        }
      }
      await route.fallback();
      return;
    }
    if (url.origin !== new URL(baseURL!).origin) {
      await route.abort();
      return;
    }
    await route.fallback();
  });

  const capture = async (name: string) => {
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
    ).toBe(0);
    const tables = page.getByRole("region", { name: "Migration comparisons", exact: true });
    expect(
      await tables.evaluateAll((elements) =>
        elements.some((element) => element.scrollWidth > element.clientWidth),
      ),
    ).toBe(false);
    await page.screenshot({ path: testInfo.outputPath(`${name}.png`), fullPage: true });
  };
  await page.goto("/admin/members/migration?adminTestRole=owner");
  await expect(page.getByText("Loading the migration queue…")).toBeVisible();
  await capture("loading");
  mode = "ready";
  releaseLoading();
  await expect(page.getByRole("heading", { name: "Member migration", exact: true })).toBeVisible();
  const strong = page.getByRole("tab", { name: "Strong (2)", exact: true });
  await expect(strong).toBeVisible();
  for (const name of ["Suggested (1)", "Ambiguous (1)", "No match (1)", "Under 18 / no date (2)"]) {
    await expect(page.getByRole("tab", { name, exact: true })).toBeVisible();
  }
  await expect(page.getByText("Only in the archive: 3", { exact: true })).toBeVisible();
  await expect(page.getByText("Decided: 4 · Remaining: 7", { exact: true })).toBeVisible();
  await capture("queue");

  await strong.focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab", { name: "Suggested (1)" })).toBeFocused();
  await page.keyboard.press("End");
  await expect(page.getByRole("tab", { name: "Under 18 / no date (2)" })).toBeFocused();
  await expect(page.getByText("Guardian required", { exact: true })).toBeVisible();
  await expect(page.getByText("Check age", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Skip…", exact: true })).toHaveCount(2);
  await expect(
    page.getByRole("button", { name: "Create without archive record", exact: true }),
  ).toHaveCount(2);
  await capture("minors");
  await page.keyboard.press("Home");
  await expect(strong).toBeFocused();

  const approve = page.getByRole("button", { name: "Approve all visible (2)", exact: true });
  await expect(approve).toBeDisabled();
  await page.getByLabel("Evening", { exact: true }).check();
  await expect(approve).toBeDisabled();
  expect(decisions).toEqual([]);
  await page.getByLabel("Centre", { exact: true }).selectOption("Town");
  await expect(approve).toBeEnabled();
  await approve.click();
  await expect(page.getByText("Applied 2 · Rejected 0", { exact: true })).toBeVisible();
  const requestId = expect.stringMatching(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
  );
  expect(decisions).toEqual([
    [
      {
        kind: "link",
        legacyMemberId: "m10",
        recordId: "10",
        requestId,
        trainingCenter: "Town",
        trainingTimePreferences: ["evening"],
      },
      {
        kind: "link",
        legacyMemberId: "m11",
        recordId: "11",
        requestId,
        trainingCenter: "Town",
        trainingTimePreferences: ["evening"],
      },
    ],
  ]);
  await expect(page.getByRole("tab", { name: "Strong (0)", exact: true })).toBeVisible();
  await expect(page.getByText("Decided: 6 · Remaining: 5", { exact: true })).toBeVisible();

  await page.getByRole("tab", { name: "No match (1)", exact: true }).click();
  const skip = page.getByRole("button", { name: "Skip…", exact: true });
  await skip.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog");
  const reason = dialog.getByRole("textbox", { name: "Reason", exact: true });
  const confirm = dialog.getByRole("button", { name: "Skip member", exact: true });
  await expect(reason).toBeFocused();
  await expect(confirm).toBeDisabled();
  await reason.fill("   ");
  await expect(confirm).toBeDisabled();
  await reason.fill("ab");
  await expect(confirm).toBeDisabled();
  expect(decisions).toHaveLength(1);
  await reason.fill("Synthetic duplicate");
  await expect(confirm).toBeEnabled();
  await page.keyboard.press("Shift+Tab");
  await expect(confirm).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(reason).toBeFocused();
  await capture("skip-dialog");
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(skip).toBeFocused();
  expect(decisions).toHaveLength(1);
  await page.keyboard.press("Enter");
  await reason.fill("Synthetic duplicate");
  await confirm.click();
  await expect(page.getByText("Applied 1 · Rejected 0", { exact: true })).toBeVisible();
  expect(decisions).toHaveLength(2);
  expect(decisions[1]).toEqual([
    { kind: "skip", legacyMemberId: "m14", reason: "Synthetic duplicate" },
  ]);
  await expect(page.getByRole("tab", { name: "No match (0)", exact: true })).toBeVisible();
  await capture("empty");

  mode = "error";
  await page.reload();
  await expect(
    page.getByRole("region", { name: "Member migration queue", exact: true }).getByRole("alert"),
  ).toHaveText("The migration queue is unavailable. Try again.");
  await expect(page.locator("body")).not.toContainText("Synthetic backend detail");
  await capture("error");
  mode = "ready";
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page.getByRole("tab", { name: "Strong (0)", exact: true })).toBeVisible();
  expect(pageErrors).toEqual([]);
});
