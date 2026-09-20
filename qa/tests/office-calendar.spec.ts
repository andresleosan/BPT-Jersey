import { expect, test, type Page } from "@playwright/test";
import { writeFile } from "node:fs/promises";

const location = {
  locationId: "town",
  academyId: "demo-academy",
  name: "BPT Town",
  address: "Synthetic address",
  timezone: "Europe/Jersey",
  active: true,
  schemaVersion: "1",
};
const program = {
  programId: "gi",
  academyId: "demo-academy",
  name: "Synthetic Gi",
  ageBand: "adult",
  discipline: "bjj",
  level: "all-levels",
  active: true,
  schemaVersion: "1",
  colour: "#F0EFFF",
};
const base = {
  academyId: "demo-academy",
  classId: null,
  programId: "gi",
  locationId: "town",
  instructorId: "synthetic-coach",
  instructorIds: ["synthetic-coach"],
  capacity: 20,
  minParticipants: 0,
  status: "scheduled",
  isSeminar: false,
  cancellationReason: null,
  schemaVersion: "1",
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
  createdBy: "synthetic-owner",
  updatedBy: "synthetic-owner",
};
async function harness(page: Page, role: string, count = 8, countsDelayMs = 0) {
  await page.clock.setFixedTime(new Date("2026-09-14T10:00:00.000Z"));
  let sessionsRespondedAt = 0;
  let rows = Array.from({ length: count }, (_, i) => ({
    ...base,
    sessionId: `synthetic-${i}`,
    title: `Synthetic class ${i}`,
    startAt:
      count > 8
        ? new Date(Date.UTC(2026, 8, 14 + (i % 7), 6 + (Math.floor(i / 7) % 14))).toISOString()
        : "2026-09-14T16:00:00.000Z",
    endAt:
      count > 8
        ? new Date(Date.UTC(2026, 8, 14 + (i % 7), 7 + (Math.floor(i / 7) % 14))).toISOString()
        : "2026-09-14T17:00:00.000Z",
  }));
  const calls: { name: string; data: Record<string, unknown> }[] = [];
  let failNext = false;
  let countsUnavailable = countsDelayMs < 0;
  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin === new URL(process.env.BASE_URL ?? "http://127.0.0.1:3107").origin)
      return route.continue();
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
    if (name === "listSessionBookedCounts" && countsUnavailable) {
      return route.fulfill({
        status: 503,
        headers,
        contentType: "application/json",
        body: JSON.stringify({
          error: { status: "UNAVAILABLE", message: "Synthetic counts failure" },
        }),
      });
    }
    if (name === "listSessions" && failNext && data.from === "2026-09-20T23:00:00.000Z") {
      failNext = false;
      return route.fulfill({
        status: 503,
        headers,
        contentType: "application/json",
        body: JSON.stringify({ error: { status: "UNAVAILABLE", message: "Synthetic failure" } }),
      });
    }
    let result: unknown;
    if (name === "listScheduleCatalog")
      result = {
        locations: [location, { ...location, locationId: "west", name: "BPT West" }],
        programs: [program, { ...program, programId: "nogi", name: "Synthetic No Gi" }],
      };
    else if (name === "listSessions")
      result = {
        sessions: rows.filter((row) => row.startAt >= data.from && row.startAt <= data.to),
      };
    else if (name === "listSessionBookedCounts") {
      if (countsDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, countsDelayMs));
      result = { counts: {} };
    } else if (name === "listStaffProfiles")
      result = [
        {
          staffKey: "synthetic-coach",
          role: "coach",
          active: true,
          status: "active",
          self: false,
          schemaVersion: "1",
        },
      ];
    else if (name === "listAdminNotifications")
      result = { notifications: [], nextCursor: null, unreadCount: 0 };
    else if (name === "saveSession") {
      const row = {
        ...base,
        ...data,
        sessionId: `synthetic-new-${calls.length}`,
      } as (typeof rows)[number];
      rows.push(row);
      result = { session: row };
    } else if (name === "updateSession" || name === "cancelSession") {
      rows = rows.map((row) =>
        row.sessionId === data.sessionId
          ? ({
              ...row,
              ...data,
              ...(name === "cancelSession"
                ? { status: "cancelled", cancellationReason: data.reason }
                : {}),
            } as (typeof rows)[number])
          : row,
      );
      result = { session: rows.find((row) => row.sessionId === data.sessionId) };
    } else return route.abort();
    if (name === "listSessions" && !sessionsRespondedAt) sessionsRespondedAt = Date.now();
    return route.fulfill({
      headers,
      contentType: "application/json",
      body: JSON.stringify({ result }),
    });
  });
  await page.goto(`/admin/classes-services/classes?adminTestRole=${role}`);
  await page.getByLabel("Go to date").fill("2026-09-14");
  await expect(page.locator(".cs-event")).toHaveCount(
    count > 8 && (page.viewportSize()?.width ?? 1000) <= 800 ? Math.ceil(count / 7) : count,
  );
  return {
    calls,
    sessionsToVisibleMs: Date.now() - sessionsRespondedAt,
    restoreCounts: () => {
      countsUnavailable = false;
    },
    fail: () => {
      failNext = true;
    },
  };
}

for (const role of ["owner", "administrator"]) {
  test(`${role} can edit, create and remove sessions while history remains accessible`, async ({
    page,
  }, info) => {
    const { calls } = await harness(page, role);
    const cards = page.locator(".cs-event");
    const boxes = await cards.evaluateAll((elements) =>
      elements.map((element) => {
        const r = element.getBoundingClientRect();
        return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
      }),
    );
    for (let i = 1; i < boxes.length; i++) {
      if (info.project.name === "mobile-chromium")
        expect(boxes[i]!.top).toBeGreaterThanOrEqual(boxes[i - 1]!.bottom - 1);
      else expect(boxes[i]!.left).toBeGreaterThanOrEqual(boxes[i - 1]!.right - 1);
    }
    await cards.first().focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.getByLabel("Class/service location").selectOption("west");
    await page.getByLabel("Class/service type").selectOption("nogi");
    await page.screenshot({
      path: `../.tmp/calendar-editor-${role}-${info.project.name}.jpg`,
      type: "jpeg",
      quality: 70,
    });
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(calls.find((c) => c.name === "updateSession")?.data).toMatchObject({
      programId: "nogi",
      locationId: "west",
    });
    await page.getByRole("button", { name: "Add a class", exact: true }).click();
    await page.getByLabel("Maximum capacity").fill("20");
    await page.getByRole("checkbox", { name: "synthetic-coach", exact: true }).check();
    await page.getByRole("button", { name: "Create session", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(calls.filter((c) => c.name === "saveSession")).toHaveLength(1);
    await page.locator(".cs-event").first().click();
    await page.getByRole("button", { name: "Cancel session", exact: true }).click();
    await expect(page.getByText(/Reservations and attendance stay/)).toBeVisible();
    await page.getByLabel("Reason", { exact: true }).fill("Synthetic removal");
    await page.getByRole("button", { name: "Confirm cancellation" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    if (info.project.name === "mobile-chromium")
      await page.getByText("Filters and options", { exact: true }).click();
    await page.getByRole("combobox", { name: "Status", exact: true }).selectOption("inactive");
    await expect(page.locator(".cs-event")).toHaveCount(1);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: `../.tmp/calendar-${role}-${info.project.name}.jpg`,
      type: "jpeg",
      quality: 70,
    });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  });
}

test("navigation recovers from errors and a cached return avoids new reads", async ({
  page,
}, info) => {
  const h = await harness(page, "administrator");
  h.fail();
  await page.getByRole("button", { name: "Next week", exact: true }).click();
  await expect(page.locator(".cs-notice[role=alert]")).toBeVisible();
  await expect(page.locator(".cs-event")).toHaveCount(0);
  await page.screenshot({
    path: `../.tmp/calendar-error-${info.project.name}.jpg`,
    type: "jpeg",
    quality: 70,
  });
  await page.getByRole("button", { name: "Retry schedule" }).click();
  await expect(page.locator(".cs-notice[role=alert]")).toHaveCount(0);
  const before = h.calls.filter((c) => c.name === "listSessions").length;
  await page.getByRole("button", { name: "Previous week", exact: true }).click();
  await expect(page.locator(".cs-event")).toHaveCount(8);
  expect(h.calls.filter((c) => c.name === "listSessions").length).toBe(before);
});

test("measures month interaction with 1400 synthetic sessions", async ({ page }, info) => {
  await harness(page, "administrator", 1400);
  const start = await page.evaluate(() => performance.now());
  await page.getByRole("button", { name: "Month", exact: true }).click();
  await expect(
    page.locator(info.project.name === "mobile-chromium" ? ".cs-month-week" : ".cs-month-cell"),
  ).toHaveCount(info.project.name === "mobile-chromium" ? 5 : 35);
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  const durationMs = await page.evaluate((s) => performance.now() - s, start);
  await writeFile(
    `../.tmp/calendar-browser-${info.project.name}.json`,
    JSON.stringify(
      {
        syntheticSessions: 1400,
        monthInteractionMs: durationMs,
        environment: "local Next development server; intercepted data; no production latency claim",
      },
      null,
      2,
    ),
  );
  await page.screenshot({
    path: `../.tmp/calendar-month-${info.project.name}.jpg`,
    type: "jpeg",
    quality: 70,
  });
});

test("coach calendar remains read-only", async ({ page }) => {
  await harness(page, "coach");
  await expect(page.getByRole("button", { name: "Add a class", exact: true })).toHaveCount(0);
  await page.locator(".cs-event").first().click();
  await expect(page.getByRole("button", { name: "Save changes", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Cancel session", exact: true })).toHaveCount(0);
});

test("measures first sessions under delayed booking counts", async ({ page }, info) => {
  const h = await harness(page, "administrator", 8, 2000);
  expect(h.sessionsToVisibleMs).toBeLessThan(2000);
  await expect(page.getByText("Loading registrations…", { exact: true })).toBeVisible();
  await expect(page.locator(".cs-event").first()).toContainText("— / 20");
  await writeFile(
    `../.tmp/calendar-loading-${process.env.CALENDAR_PHASE ?? "after"}-${info.project.name}.json`,
    JSON.stringify(
      {
        sessionsToVisibleMs: h.sessionsToVisibleMs,
        simulatedCountsDelayMs: 2000,
        environment: "Local synthetic responses; not production latency",
      },
      null,
      2,
    ),
  );
  await page.locator(".cs-event").first().scrollIntoViewIfNeeded();
  await page.screenshot({
    path: `../.tmp/calendar-loading-${process.env.CALENDAR_PHASE ?? "after"}-${info.project.name}.jpg`,
    type: "jpeg",
    quality: 75,
  });
});

test("mobile agenda selects days, creates on the selected day and remains readable at 320px", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "mobile-chromium", "Mobile layout");
  const h = await harness(page, "administrator");
  await page.setViewportSize({ width: 320, height: 740 });
  await page.getByLabel("Day to show").selectOption("2026-09-16");
  await expect(page.getByText("No classes match this day and these filters.")).toBeVisible();
  const before = h.calls.length;
  await page.getByRole("button", { name: "Add a class", exact: true }).click();
  await expect(page.getByLabel("Date", { exact: true })).toHaveValue("2026-09-16");
  await page.getByRole("button", { name: "Close session", exact: true }).click();
  await page.getByRole("button", { name: "Today", exact: true }).click();
  await expect(page.getByLabel("Day to show")).toHaveValue("2026-09-14");
  await expect(page.locator(".cs-event")).toHaveCount(8);
  expect(h.calls.length).toBe(before);
  const first = page.locator(".cs-event").first();
  await first.scrollIntoViewIfNeeded();
  expect(
    await first.evaluate((el) => parseFloat(getComputedStyle(el).fontSize)),
  ).toBeGreaterThanOrEqual(16);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: "../.tmp/calendar-agenda-320.jpg", type: "jpeg", quality: 75 });
  await first.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toBeVisible();
});

test("failed registration counts leave classes visible and retry independently", async ({
  page,
}, info) => {
  const h = await harness(page, "administrator", 8, -1);
  const reads = h.calls.filter((c) => c.name === "listSessions").length;
  await expect(page.locator(".cs-event").first()).toContainText("— / 20");
  const retry = page.getByRole("button", { name: "Retry registrations" });
  await expect(retry).toBeVisible();
  await retry.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: `../.tmp/calendar-counts-error-${info.project.name}.jpg`,
    type: "jpeg",
    quality: 75,
  });
  h.restoreCounts();
  await retry.focus();
  await page.keyboard.press("Enter");
  await expect(retry).toHaveCount(0);
  await expect(page.locator(".cs-event").first()).toContainText("0 / 20");
  expect(h.calls.filter((c) => c.name === "listSessions").length).toBe(reads);
});
