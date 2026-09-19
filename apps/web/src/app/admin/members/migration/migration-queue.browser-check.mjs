// Synthetic-only browser verification. Run from the repository root against the local E2E dev server.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium, expect } from "@playwright/test";

const origin = "http://127.0.0.1:3106";
const artifacts = ".superpowers/sdd/2026-09-19-member-unification-s1-identity/task-6-browser";
await mkdir(artifacts, { recursive: true });
const browser = await chromium.launch({ headless: true });
const failures = [];
try {
  for (const width of [375, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    const page = await context.newPage();
    page.setDefaultTimeout(10_000);
    page.on("pageerror", (error) => failures.push(error.message));
    const makeRow = (id, category = "strong", isMinor = false) => ({
      legacyMemberId: `m${id}`,
      category,
      isMinor,
      member: {
        fullName: `Synthetic Member ${id}`,
        birthDate: "1990-01-02",
        memberNumberMasked: "•••123",
        idCardMasked: "•••456",
      },
      candidates: [
        {
          recordId: String(id),
          reason: "member-number",
          record: {
            fullName: `Synthetic Archive ${id}`,
            birthDate: "1990-01-03",
            memberNumberMasked: "•••123",
            idCardMasked: "•••789",
          },
        },
      ],
    });
    let queue = {
      rows: [
        makeRow(10),
        makeRow(11),
        makeRow(12, "suggested"),
        makeRow(13, "ambiguous"),
        { ...makeRow(14, "none"), candidates: [] },
        makeRow(15, "strong", true),
        makeRow(16, "strong", "unknown"),
      ],
      archiveOnly: 3,
      decided: 4,
    };
    let mode = "loading";
    let releaseLoading;
    const loaded = new Promise((resolve) => {
      releaseLoading = resolve;
    });
    const decisions = [];
    await page.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      const name = url.pathname.split("/").pop();
      if (route.request().method() === "POST" && name === "listMemberMigrationQueue") {
        if (mode === "loading") await loaded;
        if (mode === "error") {
          await route.fulfill({
            status: 500,
            contentType: "application/json",
            body: JSON.stringify({
              error: { status: "INTERNAL", message: "raw synthetic backend detail" },
            }),
          });
        } else await route.fulfill({ json: { data: queue } });
        return;
      }
      if (route.request().method() === "POST" && name === "decideMemberMigration") {
        const batch = route.request().postDataJSON().data.decisions;
        decisions.push(batch);
        queue = {
          ...queue,
          rows: queue.rows.filter(
            (row) => !batch.some((decision) => decision.legacyMemberId === row.legacyMemberId),
          ),
          decided: queue.decided + batch.length,
        };
        await route.fulfill({
          json: {
            data: {
              results: batch.map(({ legacyMemberId }) => ({ legacyMemberId, status: "applied" })),
            },
          },
        });
        return;
      }
      // No request is allowed to leave the local synthetic test server.
      if (url.origin !== origin) {
        await route.abort();
        return;
      }
      await route.continue();
    });
    const capture = async (name) => {
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
        0,
        `${width}: document overflow`,
      );
      assert.equal(
        await page
          .locator(".member-migration .admin-data-table-wrap")
          .evaluateAll((elements) =>
            elements.some((element) => element.scrollWidth > element.clientWidth),
          ),
        false,
        `${width}: table overflow`,
      );
      await page.screenshot({ path: `${artifacts}/${width}-${name}.png`, fullPage: true });
    };
    await page.goto(`${origin}/admin/members/migration?adminTestRole=owner`);
    await expect(page.getByText("Loading the migration queue…")).toBeVisible();
    await capture("loading");
    mode = "ready";
    releaseLoading();
    const strong = page.getByRole("tab", { name: "Strong (2)" });
    await expect(strong).toBeVisible();
    await capture("queue");
    await strong.focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("tab", { name: "Suggested (1)" })).toBeFocused();
    await page.keyboard.press("End");
    await expect(page.getByRole("tab", { name: "Under 18 / no date (2)" })).toBeFocused();
    await expect(page.getByRole("button", { name: "Skip…" })).toHaveCount(0);
    await capture("minors");
    await page.keyboard.press("Home");
    const skip = page.getByRole("button", { name: "Skip…", exact: true }).first();
    await skip.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog");
    const reason = dialog.getByLabel("Reason");
    await expect(reason).toBeFocused();
    await reason.fill("Synthetic duplicate");
    await page.keyboard.press("Shift+Tab");
    await expect(dialog.getByRole("button", { name: "Skip member" })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(reason).toBeFocused();
    await capture("dialog");
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(skip).toBeFocused();
    await skip.click();
    await page.getByRole("dialog").getByLabel("Reason").fill("Synthetic duplicate");
    await page.getByRole("button", { name: "Skip member" }).click();
    await expect(page.getByText("Applied 1 · Rejected 0")).toBeVisible();
    assert.deepEqual(decisions[0], [
      { kind: "skip", legacyMemberId: "m10", reason: "Synthetic duplicate" },
    ]);
    await page.getByLabel("Centre", { exact: true }).selectOption("West");
    await page.getByLabel("Morning", { exact: true }).check();
    await page.getByRole("button", { name: "Approve all visible (1)" }).click();
    await expect(page.getByRole("tab", { name: "Strong (0)" })).toBeVisible();
    assert.equal(decisions[1][0].trainingCenter, "West");
    assert.deepEqual(decisions[1][0].trainingTimePreferences, ["morning"]);
    await capture("empty");
    mode = "error";
    await page.reload();
    await expect(
      page.getByRole("region", { name: "Member migration queue", exact: true }).getByRole("alert"),
    ).toHaveText("The migration queue is unavailable. Try again.");
    await expect(page.locator("body")).not.toContainText("raw synthetic backend detail");
    await capture("error");
    mode = "ready";
    await page.getByRole("button", { name: "Retry" }).click();
    await expect(page.getByRole("tab", { name: "Strong (0)" })).toBeVisible();
    await context.close();
    console.log(
      `PASS ${width}px: loading, categories, zero document/table overflow, keyboard tabs, modal focus trap, Escape focus restoration, skip, batch approval, safe error and retry.`,
    );
  }
  assert.deepEqual(failures, []);
} finally {
  await browser.close();
}
