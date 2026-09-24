import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  expect,
  test,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type Page,
  type TestInfo,
} from "@playwright/test";

/**
 * Member gamification and social layer (plan 2026-09-24, task 9.3) in the browser, against the
 * Auth, Firestore and Functions Emulators and the static web export built for them.
 *
 * Seeded by qa/scripts/seed-member-engagement-emulator.mjs, one synthetic academy per project.
 * Production callables accept only the bptjersey.com origins and enforce App Check, so every call
 * the page makes to the Functions Emulator is replayed from Node with an unsigned App Check token
 * that only the emulator (skipTokenVerification) accepts. Private photos are served from the
 * emulator's own object store: its signed URLs point at a `.invalid` host on purpose.
 */
const enabled = process.env.MEMBER_ENGAGEMENT_UI_EMULATOR_E2E === "true";
const password = process.env.MGE_PASSWORD ?? "";
const projectId = "demo-bpt-jersey";
const functionsOrigin = /^http:\/\/127\.0\.0\.1:5001\//u;
const functionsBase = `http://127.0.0.1:5001/${projectId}/europe-west9`;
const authSignInUrl = `http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-api-key`;
const photoHost = "https://private-storage.emulator.invalid/";
const photoStore = join(tmpdir(), "bpt-emulator-private-storage");
const fixtures = resolve(import.meta.dirname, "../fixtures");

type World = Readonly<{
  academyId: string;
  emails: Readonly<Record<string, string>>;
  bookedSessionId: string;
  curriculum: Readonly<{ title: string; techniques: readonly string[] }>;
  names: Readonly<Record<"kids" | "teens" | "adults", Readonly<Record<string, string>>>>;
  studentIds: Readonly<Record<string, string>>;
}>;

function world(testInfo: TestInfo): World {
  const directory = process.env.MGE_WORLD_DIR ?? "";
  return JSON.parse(
    readFileSync(join(directory, `world-${testInfo.project.name}.json`), "utf8"),
  ) as World;
}

/** Public label of a seeded member in their cohort table ("Blake R."). */
function label(w: World, fullName: string): string {
  const id = w.studentIds[fullName]!;
  const name = w.names.adults[id] ?? w.names.teens[id] ?? w.names.kids[id];
  expect(name, `${fullName} has a leaderboard row`).toBeTruthy();
  return name!;
}

function base64Url(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

// Unsigned, emulator-only App Check token. It is never accepted outside skipTokenVerification.
function syntheticAppCheckToken(): string {
  const now = Math.floor(Date.now() / 1000);
  return `${base64Url({ alg: "none", typ: "JWT" })}.${base64Url({
    sub: `1:${projectId}:web:member-engagement-e2e`,
    aud: [`projects/${projectId}`],
    iss: `https://firebaseappcheck.googleapis.com/${projectId}`,
    iat: now,
    exp: now + 3_600,
  })}.emulator-only`;
}

type Health = { errors: string[]; directDataRequests: string[] };

/** No console errors (bar the ones a case expects) and no direct Firestore/RTDB reads. */
function trackBrowserHealth(page: Page, health: Health): void {
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const url = message.location().url;
    // Pre-existing background calls, older than this suite: the course calendar warm-up sends an
    // empty query on purpose, and the calendar asks for no-show penalties that are office-only.
    if (/\/getCourseCalendar$/u.test(url) && message.text().includes("status of 400")) return;
    if (/\/listNoShowPenalties$/u.test(url) && message.text().includes("status of 403")) return;
    health.errors.push(`console: ${message.text()} (${url})`);
  });
  page.on("pageerror", (error) => health.errors.push(`page: ${error.message}`));
  page.on("request", (request) => {
    const url = request.url();
    if (
      /firestore\.googleapis\.com|firebaseio\.com|firebasedatabase\.app|google\.firestore\.v1\.Firestore|:(?:8080|9000)\//iu.test(
        url,
      )
    ) {
      health.directDataRequests.push(url);
    }
  });
}

async function routeBackend(context: BrowserContext): Promise<void> {
  await context.route(functionsOrigin, async (route) => {
    const request = route.request();
    const origin = request.headers()["origin"] ?? "http://127.0.0.1:3100";
    const cors = {
      "access-control-allow-origin": origin,
      "access-control-allow-credentials": "true",
      "access-control-allow-headers": "*",
      "access-control-allow-methods": "POST, OPTIONS",
    };
    if (request.method() === "OPTIONS") {
      await route.fulfill({ status: 204, headers: cors });
      return;
    }
    try {
      // A cold emulator loads the whole Functions bundle on the first call: allow it a minute.
      const response = await route.fetch({
        timeout: 90_000,
        headers: { ...request.headers(), "x-firebase-appcheck": syntheticAppCheckToken() },
      });
      const body = await response.text();
      if (body.includes('"error"')) {
        console.log(
          `[callable] ${new URL(request.url()).pathname.split("/").pop()} → ${body.slice(0, 300)}`,
        );
      }
      await route.fulfill({ response, body, headers: { ...response.headers(), ...cors } });
    } catch {
      // The page navigated or closed while the call was in flight; nobody is waiting for it.
      await route.abort().catch(() => undefined);
    }
  });
  // The emulator store's signed URLs resolve nowhere; serve the stored object instead.
  await context.route(`${photoHost}**`, async (route) => {
    const objectKey = decodeURIComponent(new URL(route.request().url()).pathname.slice(1));
    const file = join(photoStore, createHash("sha256").update(objectKey).digest("hex"));
    if (!existsSync(file)) {
      await route.fulfill({ status: 404, body: "" });
      return;
    }
    await route.fulfill({ status: 200, contentType: "image/webp", body: readFileSync(file) });
  });
}

type Member = Readonly<{ page: Page; context: BrowserContext; health: Health }>;

async function openContext(browser: Browser, testInfo: TestInfo): Promise<Member> {
  const use = testInfo.project.use;
  const context = await browser.newContext({
    baseURL: use.baseURL,
    viewport: use.viewport,
    userAgent: use.userAgent,
    deviceScaleFactor: use.deviceScaleFactor,
    isMobile: use.isMobile,
    hasTouch: use.hasTouch,
    locale: use.locale,
    timezoneId: use.timezoneId,
  });
  await routeBackend(context);
  const page = await context.newPage();
  const health: Health = { errors: [], directDataRequests: [] };
  trackBrowserHealth(page, health);
  return { page, context, health };
}

/** Background calls may still be in flight when a case ends. */
async function close(opened: Member): Promise<void> {
  await opened.context.unrouteAll({ behavior: "ignoreErrors" });
  await opened.context.close();
}

async function signIn(page: Page, email: string, options: { staff?: boolean } = {}) {
  await page.goto(options.staff ? "/staff/login" : "/login");
  const form = page.locator("#login-form");
  await form.getByLabel(/email address/iu).fill(email);
  await form.getByLabel("Password", { exact: true }).fill(password);
  await form.getByRole("button", { name: /^Sign in$/u }).click();
}

async function member(browser: Browser, testInfo: TestInfo, email: string): Promise<Member> {
  const opened = await openContext(browser, testInfo);
  await signIn(opened.page, email);
  await opened.page.waitForURL(/\/account(?:$|[/?#])/u, { timeout: 60_000 });
  return opened;
}

async function staff(browser: Browser, testInfo: TestInfo, email: string): Promise<Member> {
  const opened = await openContext(browser, testInfo);
  await signIn(opened.page, email, { staff: true });
  await opened.page.waitForURL((url) => !url.pathname.startsWith("/staff/login"), {
    timeout: 60_000,
  });
  return opened;
}

function expectHealthy(members: readonly Member[], allowed: readonly RegExp[] = []): void {
  for (const { health } of members) {
    expect(
      health.errors.filter((error) => !allowed.some((pattern) => pattern.test(error))),
    ).toEqual([]);
    expect(health.directDataRequests).toEqual([]);
  }
}

/** A callable invoked from Node with a member's ID token, for the server-side refusals. */
async function callAs(
  request: APIRequestContext,
  email: string,
  name: string,
  data: unknown,
): Promise<
  Readonly<{
    status: number;
    body: { result?: unknown; error?: { message?: string; status?: string } };
  }>
> {
  const session = await request.post(authSignInUrl, {
    data: { email, password, returnSecureToken: true },
  });
  expect(session.ok()).toBe(true);
  const { idToken } = (await session.json()) as { idToken: string };
  const response = await request.post(`${functionsBase}/${name}`, {
    headers: {
      Authorization: `Bearer ${idToken}`,
      "X-Firebase-AppCheck": syntheticAppCheckToken(),
    },
    data: { data },
    timeout: 90_000,
  });
  return { status: response.status(), body: await response.json() };
}

test.describe("Member gamification and social layer with Firebase Emulators", () => {
  test.skip(!enabled || password.length < 12, "MEMBER_ENGAGEMENT_UI_EMULATOR_E2E is not enabled");
  test.beforeEach(({}, testInfo) => {
    testInfo.setTimeout(300_000);
  });

  test("1 avatar: consent gates the upload, a hostile file is refused, the photo is a 512 WebP (R11)", async ({
    browser,
    request,
  }, testInfo) => {
    const w = world(testInfo);
    const avery = await member(browser, testInfo, w.emails.avery!);
    const { page } = avery;
    await page.goto("/account/settings");
    await expect(page.getByRole("heading", { name: "Account settings" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Photo" })).toBeVisible({ timeout: 90_000 });

    const file = page.getByLabel("Choose a photo");
    const uploadButton = page.getByRole("button", { name: "Upload photo" });
    const consent = page.getByRole("checkbox", { name: /shown to other BPT Jersey members/u });

    // Without the consent tick the upload stays disabled, even with a photo chosen.
    await file.setInputFiles(join(fixtures, "avatar.png"));
    await expect(page.getByRole("img", { name: "Preview of your new photo" })).toBeVisible();
    await expect(consent).not.toBeChecked();
    await expect(uploadButton).toBeDisabled();

    // An SVG is refused with the fixed message.
    await file.setInputFiles(join(fixtures, "evil.svg"));
    await expect(page.locator(".settings-error")).toHaveText("Choose a JPEG, PNG or WebP photo.");
    await expect(uploadButton).toBeDisabled();
    // And the server refuses it too when it is sent as if it were a PNG.
    const hostile = await callAs(request, w.emails.avery!, "uploadProfilePhoto", {
      studentId: w.studentIds["Avery Stone"],
      base64: readFileSync(join(fixtures, "evil.svg")).toString("base64"),
      mime: "image/png",
      consent: true,
    });
    expect(hostile.status).toBe(400);
    expect(hostile.body.error?.status).toBe("INVALID_ARGUMENT");
    expect(hostile.body.error?.message).toBe("Choose a single JPEG, PNG or WebP image under 2 MB.");

    await file.setInputFiles(join(fixtures, "avatar.png"));
    await consent.check();
    await expect(uploadButton).toBeEnabled();
    await uploadButton.click();
    await expect(page.getByRole("status").filter({ hasText: "Photo saved." })).toBeVisible({
      timeout: 60_000,
    });
    const photo = page.getByRole("img", { name: "Current photo" });
    await expect(photo).toBeVisible();
    const src = (await photo.getAttribute("src")) ?? "";
    expect(src.startsWith(photoHost)).toBe(true);
    const objectKey = decodeURIComponent(new URL(src).pathname.slice(1));
    expect(objectKey).toMatch(
      new RegExp(
        `^academies/${w.academyId}/avatars/${w.studentIds["Avery Stone"]}/[0-9a-f-]{36}\\.webp$`,
        "u",
      ),
    );
    // The stored object itself: WebP, re-encoded at 512 × 512.
    const stored = readFileSync(
      join(photoStore, createHash("sha256").update(objectKey).digest("hex")),
    );
    expect(stored.subarray(0, 4).toString("ascii")).toBe("RIFF");
    expect(stored.subarray(8, 12).toString("ascii")).toBe("WEBP");
    await expect
      .poll(() =>
        photo.evaluate((image: HTMLImageElement) => [image.naturalWidth, image.naturalHeight]),
      )
      .toEqual([512, 512]);

    expectHealthy([avery]);
    await close(avery);
  });

  test("2 streak: one short of the goal, x3 flame, hours, and a still flame on reduced motion (R3-R5)", async ({
    browser,
  }, testInfo) => {
    const w = world(testInfo);
    const blake = await member(browser, testInfo, w.emails.blake!);
    const { page } = blake;
    const panel = page.getByRole("region", { name: "Streak" });
    await expect(panel).toBeVisible({ timeout: 90_000 });
    await expect(panel.getByText("Just x1 missing to get goal!")).toBeVisible();
    await expect(panel.locator(".streak-bar.is-almost")).toHaveCount(1);
    await expect(panel.locator(".streak-bar.is-almost")).toContainText("Next goal");
    await expect(panel.locator(".streak-bar.is-almost")).toContainText("9/10");
    await expect(panel.getByText("9 h trained since September")).toBeVisible();
    await expect(panel.locator(".streak-multiplier")).toContainText("x3");
    const flame = panel.getByTestId("streak-flame");
    await expect(flame.locator("svg")).toHaveCount(1, { timeout: 30_000 });

    const twoFrames = async () => {
      const first = await flame.screenshot({ animations: "allow" });
      await page.waitForTimeout(500);
      const second = await flame.screenshot({ animations: "allow" });
      return first.equals(second);
    };
    // Control: with motion allowed the flame moves, so identical frames below mean something.
    expect(await twoFrames()).toBe(false);

    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.reload();
    await expect(panel.locator(".streak-multiplier")).toContainText("x3", { timeout: 90_000 });
    await expect(flame.locator("svg")).toHaveCount(1, { timeout: 30_000 });
    await page.waitForTimeout(300);
    expect(await twoFrames()).toBe(true);

    expectHealthy([blake]);
    await close(blake);
  });

  test("3 competitors: two above and below in your own cohort, hidden members left out (R2, R7, R8)", async ({
    browser,
  }, testInfo) => {
    const w = world(testInfo);
    const rows = (page: Page) =>
      page.getByRole("tabpanel", { name: "Attendance" }).locator(".competitor-name");

    // Blake sits in the middle: Gray and Finley above, Avery and Taylor below. Dana (hidden) has
    // more sessions than Blake and would be directly above if she were shown.
    const blake = await member(browser, testInfo, w.emails.blake!);
    await blake.page.goto("/account/competitors");
    await expect(blake.page.getByText("Adults table")).toBeVisible({ timeout: 90_000 });
    await expect(rows(blake.page)).toHaveText([
      label(w, "Finley Hart"),
      label(w, "Gray Wolfe"),
      `${label(w, "Blake Rivers")} (you)`,
      label(w, "Avery Stone"),
      label(w, "Taylor Parker"),
    ]);
    await expect(blake.page.locator("main")).not.toContainText("Dana");
    await expect(blake.page.locator("main")).not.toContainText(label(w, "Dana Frost"));

    // The comparator on another member's card.
    await blake.page
      .getByRole("button", { name: new RegExp(label(w, "Finley Hart"), "u") })
      .click();
    const card = blake.page.getByRole("dialog", { name: label(w, "Finley Hart") });
    await expect(card).toBeVisible();
    await expect(card.getByRole("heading", { name: "They have, you don't" })).toBeVisible();
    await expect(card.getByRole("heading", { name: "You have, they don't" })).toBeVisible();
    await card.getByRole("button", { name: "Close" }).click();
    await expect(card).toBeHidden();

    // The leader has nobody above.
    const casey = await member(browser, testInfo, w.emails.casey!);
    await casey.page.goto("/account/competitors");
    await expect(casey.page.getByText("Adults table")).toBeVisible({ timeout: 90_000 });
    await expect(rows(casey.page)).toHaveText([
      `${label(w, "Casey Morgan")} (you)`,
      label(w, "Finley Hart"),
      label(w, "Gray Wolfe"),
    ]);

    // The 13-year-old, seen by the guardian, is in the teens table and sees no adult.
    const taylor = await member(browser, testInfo, w.emails.taylor!);
    await taylor.page.goto("/account/competitors");
    await taylor.page.getByLabel("Showing").selectOption({ label: "Charlie Parker" });
    await expect(taylor.page.getByText("Teens table")).toBeVisible({ timeout: 90_000 });
    await expect(rows(taylor.page).first()).toBeVisible();
    const teenRows = await rows(taylor.page).allTextContents();
    expect(teenRows).toContain(`${label(w, "Charlie Parker")} (you)`);
    for (const adult of Object.values(w.names.adults)) {
      expect(teenRows.join("|")).not.toContain(adult);
    }

    expectHealthy([blake, casey, taylor]);
    for (const opened of [blake, casey, taylor]) await close(opened);
  });

  test("4 session detail: the plan and who is coming from your own age group only (R9, R10)", async ({
    browser,
    request,
  }, testInfo) => {
    const w = world(testInfo);
    const avery = await member(browser, testInfo, w.emails.avery!);
    const { page } = avery;
    const card = page.locator(`[data-session-id="${w.bookedSessionId}"]`);
    await expect(card).toBeVisible({ timeout: 90_000 });
    await card.getByRole("button", { name: "Fundamentals" }).click();
    const dialog = page.getByRole("dialog", { name: "Plan for this class" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(w.curriculum.title)).toBeVisible({ timeout: 60_000 });
    for (const technique of w.curriculum.techniques) {
      await expect(dialog.getByRole("listitem").filter({ hasText: technique })).toBeVisible();
    }
    const coming = dialog.locator(".competitor-list .competitor-name");
    await expect(coming).toHaveText([
      label(w, "Avery Stone"),
      label(w, "Casey Morgan"),
      label(w, "Finley Hart"),
      label(w, "Gray Wolfe"),
    ]);
    await expect(dialog.locator(".competitor-list .is-you")).toContainText("You");
    await expect(dialog.getByText("+3 members from other age groups")).toBeVisible();
    for (const hidden of ["Dana", "Jordan", "Poppy"]) {
      await expect(dialog).not.toContainText(hidden);
    }

    await dialog.getByRole("button", { name: new RegExp(label(w, "Casey Morgan"), "u") }).click();
    const casey = page.getByRole("dialog", { name: label(w, "Casey Morgan") });
    await expect(casey).toBeVisible();
    await expect(casey.getByText("Sessions this season")).toBeVisible();

    // A member who did not book the class is refused by the server (R9).
    const refused = await callAs(request, w.emails.blake!, "getSessionDetail", {
      sessionId: w.bookedSessionId,
      studentId: w.studentIds["Blake Rivers"],
    });
    expect(refused.status).toBe(403);
    expect(refused.body.error?.status).toBe("PERMISSION_DENIED");

    expectHealthy([avery]);
    await close(avery);
  });

  test("5 disclaimer: missing terms block the calendar but not Settings, and a failed check fails closed (R14)", async ({
    browser,
  }, testInfo) => {
    const w = world(testInfo);
    const eli = await member(browser, testInfo, w.emails.eli!);
    const { page } = eli;
    await expect(
      page.getByText("Eli Brooks needs to accept the academy terms before booking."),
    ).toBeVisible({
      timeout: 90_000,
    });
    await expect(page.getByRole("link", { name: "Review and accept" })).toBeVisible();
    await expect(page.locator("[data-session-id]")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Book/u })).toHaveCount(0);

    await page.getByRole("link", { name: "Settings" }).click();
    await expect(page.getByRole("heading", { name: "Account settings" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Photo" })).toBeVisible({ timeout: 60_000 });

    // The terms check itself fails: Retry, never the calendar.
    await page.route("**/getMyDisclaimerStatus", (route) =>
      route.fulfill({ status: 500, body: "" }),
    );
    await page.goto("/account");
    await expect(page.getByText("We couldn't check your terms.")).toBeVisible({ timeout: 90_000 });
    await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
    await expect(page.locator("[data-session-id]")).toHaveCount(0);

    expectHealthy([eli], [/Failed to load resource: the server responded with a status of 500/u]);
    await close(eli);
  });

  test("6 teen access: the guardian gives a 13-year-old a sign-in and takes it back (R12)", async ({
    browser,
  }, testInfo) => {
    const w = world(testInfo);
    const teenEmail = w.emails.teen!;
    const teenPassword = `${password}-teen`;
    const taylor = await member(browser, testInfo, w.emails.taylor!);
    const { page } = taylor;
    await page.goto("/account/settings");
    const person = page.getByLabel("Settings for");
    await expect(person).toBeVisible({ timeout: 90_000 });

    // The 9-year-old has no own access section.
    await person.selectOption({ label: "Poppy Parker" });
    await expect(page.getByRole("heading", { name: "Photo" })).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole("heading", { name: "Own access" })).toHaveCount(0);

    await person.selectOption({ label: "Charlie Parker" });
    const ownAccess = page.getByRole("heading", { name: "Own access" });
    await expect(ownAccess).toBeVisible({ timeout: 60_000 });
    await page.getByLabel("Email", { exact: true }).fill(teenEmail);
    await page.getByLabel("Password", { exact: true }).fill(teenPassword);
    await page.getByRole("button", { name: "Create access" }).click();
    await expect(page.getByText(`Charlie Parker signs in with ${teenEmail}.`)).toBeVisible({
      timeout: 60_000,
    });

    // The teen signs in (the account was created verified) and sees their calendar, not the plan.
    const teen = await openContext(browser, testInfo);
    await teen.page.goto("/login");
    const form = teen.page.locator("#login-form");
    await form.getByLabel(/email address/iu).fill(teenEmail);
    await form.getByLabel("Password", { exact: true }).fill(teenPassword);
    await form.getByRole("button", { name: /^Sign in$/u }).click();
    await teen.page.waitForURL(/\/account(?:$|[/?#])/u, { timeout: 60_000 });
    await expect(teen.page.getByRole("heading", { level: 1, name: "Charlie" })).toBeVisible({
      timeout: 90_000,
    });
    await expect(teen.page.getByRole("region", { name: "Streak" })).toBeVisible({
      timeout: 60_000,
    });
    await expect(teen.page.getByRole("link", { name: "My plan" })).toHaveCount(0);
    await close(teen);

    // The guardian revokes it.
    await page.getByRole("button", { name: "Revoke access" }).click();
    await page
      .getByRole("dialog", { name: "Revoke access?" })
      .getByRole("button", { name: "Revoke access" })
      .click();
    await expect(page.getByRole("button", { name: "Create access" })).toBeVisible({
      timeout: 60_000,
    });

    // The teen can no longer sign in.
    const refused = await openContext(browser, testInfo);
    await refused.page.goto("/login");
    const again = refused.page.locator("#login-form");
    await again.getByLabel(/email address/iu).fill(teenEmail);
    await again.getByLabel("Password", { exact: true }).fill(teenPassword);
    await again.getByRole("button", { name: /^Sign in$/u }).click();
    await expect(refused.page.getByRole("alert")).toBeVisible({ timeout: 30_000 });
    await refused.page.waitForTimeout(2_000);
    expect(new URL(refused.page.url()).pathname).toBe("/login");

    expectHealthy([taylor, teen]);
    expectHealthy(
      [refused],
      [/Failed to load resource: the server responded with a status of 400/u],
    );
    await close(refused);
    await close(taylor);
  });

  test("7 admin: the office lists exactly who is missing the terms; a coach has no such view (R15)", async ({
    browser,
    request,
  }, testInfo) => {
    const w = world(testInfo);
    const owner = await staff(browser, testInfo, w.emails.owner!);
    const { page } = owner;
    await page.goto("/admin/waivers");
    await page.getByRole("button", { name: "Acceptances" }).click();
    const table = page.getByRole("table");
    await expect(table).toBeVisible({ timeout: 90_000 });
    await expect(table.getByRole("rowheader", { name: "Avery Stone" })).toBeVisible();

    await page.getByRole("checkbox", { name: "Missing only" }).check();
    // Children approved by case 8 in this academy also lack the terms; they are named "Newchild".
    await expect
      .poll(async () =>
        (await table.getByRole("rowheader").allTextContents()).filter(
          (name) => !name.startsWith("Newchild"),
        ),
      )
      .toEqual(["Eli Brooks"]);

    await page.getByRole("checkbox", { name: "Missing only" }).uncheck();
    await page.getByRole("searchbox", { name: "Search by name" }).fill("Eli");
    await expect(table.getByRole("rowheader")).toHaveText(["Eli Brooks"]);
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download CSV" }).click();
    const csv = readFileSync((await (await download).path())!, "utf8");
    expect(csv).toContain("Eli Brooks");
    expect(csv).not.toContain("Avery Stone");

    // A coach sees no Acceptances view, and the server refuses the list to them.
    const coach = await staff(browser, testInfo, w.emails.coach!);
    await coach.page.goto("/admin/waivers");
    await coach.page.waitForLoadState("networkidle");
    await expect(coach.page.getByRole("button", { name: "Acceptances" })).toHaveCount(0);
    await expect(coach.page.getByRole("link", { name: "Waivers and disclaimers" })).toHaveCount(0);
    const refused = await callAs(request, w.emails.coach!, "listDisclaimerAcceptances", {
      missingOnly: true,
    });
    expect(refused.status).toBe(403);

    expectHealthy([owner, coach]);
    await close(owner);
    await close(coach);
  });

  test("8 my plan: you and your children, and a child added through the office (R16)", async ({
    browser,
  }, testInfo) => {
    const w = world(testInfo);
    const taylor = await member(browser, testInfo, w.emails.taylor!);
    const { page } = taylor;
    await page.goto("/account/membership");
    const people = page.getByRole("group", { name: "Plan for" });
    await expect(people).toBeVisible({ timeout: 90_000 });
    await expect(people.getByRole("radio")).toHaveCount(3);
    for (const name of ["You", "Charlie Parker", "Poppy Parker"]) {
      await expect(people.getByRole("radio", { name })).toBeVisible();
    }

    await page.getByRole("button", { name: /Add a child/u }).click();
    const form = page.getByRole("dialog", { name: "Add a child" });
    await form.getByLabel("Full name").fill("Newchild Parker");
    await form.getByLabel("Date of birth").fill(`${new Date().getUTCFullYear() - 7}-05-05`);
    await form.getByLabel("Centre").selectOption("Town");
    await form.getByLabel("Afternoon").check();
    await form.getByRole("button", { name: "Send request" }).click();
    await expect(form).toBeHidden({ timeout: 60_000 });

    const owner = await staff(browser, testInfo, w.emails.owner!);
    await owner.page.goto("/admin/members/requests");
    const panel = owner.page.getByRole("region", { name: "Plan requests" });
    const request = panel.getByRole("listitem").filter({ hasText: "Newchild Parker" });
    await expect(request).toBeVisible({ timeout: 90_000 });
    await request.getByRole("button", { name: "Approve" }).click();
    await expect(panel.getByText("Newchild Parker was added.")).toBeVisible({ timeout: 90_000 });

    await page.reload();
    await expect(people.getByRole("radio")).toHaveCount(4, { timeout: 90_000 });
    await expect(people.getByRole("radio", { name: "Newchild Parker" })).toBeVisible();

    expectHealthy([taylor, owner]);
    await close(owner);
    await close(taylor);
  });
});
