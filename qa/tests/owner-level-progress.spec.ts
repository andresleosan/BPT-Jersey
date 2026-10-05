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
async function harness(page: Page, baseURL: string, role: string, initialized = false) {
  const origin = new URL(baseURL);
  if (origin.hostname !== "127.0.0.1") throw new Error("Synthetic flow must run on loopback.");
  const calls: { name: string; data: Record<string, unknown> }[] = [];
  const progressReads: string[] = [];
  let current = "white-belt";
  let classes = 0;
  let days = 0;
  let startedOn = "2026-07-01";
  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin === origin.origin) return route.continue();
    const headers = {
      "access-control-allow-origin": origin.origin,
      "access-control-allow-headers": "*",
      "access-control-allow-methods": "POST, OPTIONS",
    };
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers });
    if (request.method() !== "POST") return route.abort();
    const name = url.pathname.split("/").at(-1) ?? "";
    const data = request.postDataJSON()?.data ?? {};
    if (name === "getProgressManagement") progressReads.push(data.studentId);
    let result: unknown = [];
    if (name === "getMemberProfile") result = ["coach", "headCoach"].includes(role)
      ? { view: "coach", header } : profile;
    else if (name === "getStudentProgressSummary") result = { progress: initialized ? {
      state: "initialized", studentId,
      currentDefinition: { definitionKey: current },
      targetDefinition: { definitionKey: "white-2nd-stripe" },
      currentLevelStartedAt: `${startedOn}T00:00:00.000Z`, progressPercent: 0,
      criteria: {
        classes: { required: 25, completed: classes, imported: classes, met: false },
        time: { requiredDays: 75, elapsedDays: days, met: false },
      },
    } : { state: "uninitialized", studentId } };
    else if (name === "getStudentLevelHistory") result = {
      studentId, currentDefinitionKey: initialized ? current : null,
      lastApprovedPromotionId: null, entries: [],
    };
    else if (name === "listStudentEvaluations") result = { studentId, summary: {} };
    else if (name === "getMemberOverview") result = {
      rows: [{ studentId, rowKind: "member", fullName: header.fullName,
        trainingCenter: "Town", centreConfirmed: true, active: true, recordActive: true,
        source: "bpt", planState: "none", ownAccount: false, flags: [] }],
      counters: { total: 1, active: 1, expiring: 0, review: 0, inactive: 0, guardians: 0 },
      generatedAt: new Date().toISOString(),
    };
    else if (name === "getProgressManagement") result = {
      studentId, initialized, currentDefinitionKey: current, startedOn,
      classesAtLevel: classes, daysAtLevel: days, baselineCutoff: null,
      undoPromotionId: null, attendance: [], history: [],
    };
    else if (["openStudentLevel", "assignLevel", "setProgressClassCount", "setProgressLevel"].includes(name)) {
      calls.push({ name, data });
      initialized = true;
      current = data.definitionKey ?? data.toDefinitionKey ?? current;
      startedOn = data.startedOn ?? data.promotedOn ?? startedOn;
      classes = data.newLevelClasses ?? data.classes ?? classes;
      days = data.newLevelDays ?? data.days ?? days;
      result = name === "assignLevel" ? {
        promotionId: "synthetic-promotion", toDefinitionKey: current,
        promotedOn: startedOn, gaps: [],
      } : name === "openStudentLevel" ? {
        head: { studentId, currentDefinitionKey: current, state: "initialized",
          currentLevelStartedAt: `${startedOn}T00:00:00.000Z` },
        ageBand: { met: true, ageYears: 30, requiredMinAge: null, requiredMaxAge: null },
      } : name === "setProgressLevel" ? { promotionId: "synthetic-level-change" } : { classes };
    }
    return route.fulfill({ status: 200, headers, contentType: "application/json", body: JSON.stringify({ data: result }) });
  });
  await page.goto(`/admin/members/profile?id=${studentId}&view=manage&adminTestRole=${role}`);
  return { calls, progressReads };
}

test("owner opens, assigns and edits exact classes and days", async ({ page, baseURL }) => {
  test.setTimeout(60000);
  const { calls, progressReads } = await harness(page, baseURL!, "owner");
  const open = page.getByRole("form", { name: "Open level" });
  await expect(open).toBeVisible({ timeout: 30000 });
  await open.getByRole("combobox", { name: "Level", exact: true }).selectOption("white-belt");
  await open.getByLabel("Start date").fill("2026-07-01");
  await open.getByLabel("Notes").fill("Synthetic progress verification");
  await open.getByLabel("Classes completed at this level through today").fill("0");
  await open.getByLabel("Days completed at this level through today").fill("42");
  await open.getByRole("button", { name: "Open level" }).click();
  await expect(page.getByRole("status")).toHaveText("Level opened.");
  expect(calls[0]).toMatchObject({ name: "openStudentLevel", data: { newLevelClasses: 0, newLevelDays: 42 } });

  const assign = page.getByRole("form", { name: "Assign next level" });
  await assign.getByRole("combobox", { name: "Level", exact: true }).selectOption("white-1st-stripe");
  await assign.getByLabel("Promotion date").fill("2026-09-01");
  await assign.getByLabel("Classes completed in the new level through today").fill("8");
  await assign.getByRole("button", { name: "Review promotion" }).click();
  await expect(assign.getByRole("alert")).toContainText("Enter both new-level counts");
  expect(calls).toHaveLength(1);
  await assign.getByLabel("Days completed in the new level through today").fill("19");
  await assign.getByRole("button", { name: "Review promotion" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("8 classes and 19 days");
  await dialog.getByRole("button", { name: "Confirm promotion" }).click();
  await expect(page.getByRole("status")).toHaveText("Level assigned.");
  expect(calls[1]).toMatchObject({ name: "assignLevel", data: { newLevelClasses: 8, newLevelDays: 19 } });

  await page.goto("/admin/members?adminTestRole=owner");
  await page.getByRole("tab", { name: "Progress management", exact: true }).click();
  const progress = page.getByRole("region", { name: "Progress management", exact: true });
  await progress.getByLabel("Member", { exact: true }).fill("Synthetic");
  await progress.getByRole("button", { name: header.fullName, exact: true }).click();
  await expect(progress.getByLabel("Classes up to today")).toHaveValue("8");
  await expect(progress.getByLabel("Days completed through today")).toHaveValue("19");
  await progress.getByLabel("Classes up to today").fill("12");
  await progress.getByLabel("Days completed through today").fill("5");
  await progress.getByRole("button", { name: "Save level and progress", exact: true }).click();
  await expect.poll(() => calls.length).toBe(3);
  await expect.poll(() => progressReads.length).toBe(2);
  await expect(progress.getByLabel("Classes up to today")).toHaveValue("12");
  await expect(progress.getByLabel("Days completed through today")).toHaveValue("5");
  expect(calls[2]).toMatchObject({ name: "setProgressClassCount", data: { studentId, classes: 12, days: 5 } });
  await progress.getByRole("combobox", { name: "Belt / stripe" }).selectOption("white-2nd-stripe");
  await expect(progress.getByLabel("Classes up to today")).toHaveValue("0");
  await expect(progress.getByLabel("Days completed through today")).toHaveValue("0");
  await progress.getByLabel("Classes up to today").fill("2");
  await progress.getByLabel("Days completed through today").fill("3");
  await progress.getByRole("button", { name: "Save level and progress", exact: true }).click();
  await expect.poll(() => calls.length).toBe(4);
  await expect.poll(() => progressReads.length).toBe(3);
  await expect(progress.getByLabel("Classes up to today")).toHaveValue("2");
  await expect(progress.getByLabel("Days completed through today")).toHaveValue("3");
  expect(calls[3]).toMatchObject({ name: "setProgressLevel", data: { definitionKey: "white-2nd-stripe", classes: 2, days: 3 } });
});

for (const role of ["administrator", "headCoach"]) {
  test(`${role} cannot override owner progress`, async ({ page, baseURL }) => {
    await harness(page, baseURL!, role, true);
    const form = page.getByRole("form", { name: "Assign next level" });
    await expect(form).toBeVisible();
    await expect(form.getByLabel("Classes completed in the new level through today")).toHaveCount(0);
    await expect(form.getByLabel("Days completed in the new level through today")).toHaveCount(0);
  });
}
