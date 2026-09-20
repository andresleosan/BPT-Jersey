import { expect, test, type Page } from "@playwright/test";

const studentId = "synthetic-graduation-member";
const header = {
  studentId,
  fullName: "Synthetic graduation member",
  age: 30,
  participantType: "adult",
  status: "active",
  birthdayBadge: null,
};
const profile = {
  view: "full",
  header,
  cards: {
    memberSince: "2026-07-01",
    monthsAsMember: 2,
    accountManagers: [],
    currentMembership: null,
  },
  details: {
    studentId,
    fullName: header.fullName,
    dateOfBirth: "1996-01-01",
    trainingCenter: "Town",
    trainingTimePreferences: ["evening"],
    participantType: "adult",
    active: true,
    status: "active",
    gender: "unknown",
    details: {},
  },
};
async function harness(page: Page, role: string, fail = false) {
  const calls: unknown[] = [];
  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.hostname === "127.0.0.1" && url.port === "3107") return route.continue();
    const headers = {
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "*",
      "access-control-allow-methods": "POST, OPTIONS",
    };
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers });
    if (request.method() !== "POST") return route.abort();
    const name = url.pathname.split("/").at(-1);
    let result: unknown;
    if (name === "getMemberProfile")
      result = ["coach", "headCoach"].includes(role) ? { view: "coach", header } : profile;
    else if (name === "getStudentProgressSummary")
      result = {
        progress: {
          state: "initialized",
          studentId,
          currentDefinition: { definitionKey: "white-belt" },
          targetDefinition: { definitionKey: "white-1st-stripe" },
          currentLevelStartedAt: "2026-07-01T00:00:00.000Z",
          progressPercent: 0,
          criteria: {
            classes: { required: 25, completed: 0, imported: 0, met: false },
            time: { requiredDays: 75, elapsedDays: 0, met: false },
          },
        },
      };
    else if (name === "getStudentLevelHistory")
      result = {
        studentId,
        currentDefinitionKey: "white-belt",
        lastApprovedPromotionId: null,
        entries: [],
      };
    else if (name === "listStudentEvaluations") result = { studentId, summary: {} };
    else if (name === "assignLevel") {
      calls.push(request.postDataJSON().data);
      await new Promise((resolve) => setTimeout(resolve, 800));
      if (fail)
        return route.fulfill({
          status: 503,
          headers,
          contentType: "application/json",
          body: JSON.stringify({
            error: { status: "UNAVAILABLE", message: "Synthetic service failure" },
          }),
        });
      const data = request.postDataJSON().data;
      result = {
        promotionId: "synthetic-promotion",
        toDefinitionKey: data.toDefinitionKey,
        promotedOn: data.promotedOn,
        gaps: ["Skips 1 stripe", "Classes 0/25 not met"],
      };
    } else result = [];
    return route.fulfill({
      status: 200,
      headers,
      contentType: "application/json",
      body: JSON.stringify({ data: result }),
    });
  });
  await page.goto(`/admin/members/profile?id=${studentId}&view=manage&adminTestRole=${role}`);
  return calls;
}
async function review(page: Page) {
  const form = page.getByRole("form", { name: "Assign next level" });
  await form.getByRole("combobox", { name: "Next level" }).selectOption("white-2nd-stripe");
  await form.getByLabel("Promotion date").fill("2026-07-02");
  await form.getByRole("button", { name: "Review promotion" }).click();
  return page.getByRole("dialog");
}
for (const role of ["administrator", "owner"]) {
  test(`${role} confirms a graduation with unmet criteria and no note`, async ({ page }, info) => {
    const calls = await harness(page, role);
    const dialog = await review(page);
    await expect(dialog.getByRole("list", { name: "Criteria not met" })).toContainText(
      "Classes 0/25 not met",
    );
    await expect(dialog).toContainText(
      "You can confirm this promotion even though the criteria are not met.",
    );
    await expect(dialog.getByLabel("Note (optional, 10 to 500 characters)")).toBeFocused();
    await expect(dialog.getByRole("button", { name: "Confirm promotion" })).toBeEnabled();
    await page.screenshot({
      path: `../.tmp/manual-graduation-${role}-${info.project.name}.jpg`,
      type: "jpeg",
      quality: 45,
      scale: "css",
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ),
    ).toBe(true);
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    expect(calls).toHaveLength(0);
    await expect(page.getByRole("button", { name: "Review promotion" })).toBeFocused();
    const again = await review(page);
    await again.getByRole("button", { name: "Confirm promotion" }).focus();
    await page.keyboard.press("Enter");
    await expect(again.getByRole("button", { name: "Confirm promotion" })).toBeDisabled();
    await expect(page.getByRole("status")).toHaveText("Level assigned.");
    expect(calls).toEqual([
      {
        studentId,
        fromDefinitionKey: "white-belt",
        toDefinitionKey: "white-2nd-stripe",
        promotedOn: "2026-07-02",
      },
    ]);
  });
}
test("legacy head coach still needs a note", async ({ page }) => {
  await harness(page, "headCoach");
  const dialog = await review(page);
  await expect(dialog.getByLabel("Note (required, 10 to 500 characters)")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Confirm promotion" })).toBeDisabled();
});
test("coach cannot decide graduations", async ({ page }) => {
  await harness(page, "coach");
  await expect(page.getByRole("heading", { name: "Level history" })).toBeVisible();
  await expect(page.getByRole("form", { name: "Assign next level" })).toHaveCount(0);
});
test("a failed graduation keeps the review open for retry", async ({ page }) => {
  const calls = await harness(page, "administrator", true);
  const dialog = await review(page);
  await dialog.getByRole("button", { name: "Confirm promotion" }).click();
  await expect(dialog.getByRole("alert")).toHaveText(
    "Unable to assign the level. Please try again later.",
  );
  await expect(dialog.getByRole("button", { name: "Confirm promotion" })).toBeEnabled();
  expect(calls).toHaveLength(1);
});
