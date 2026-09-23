import { expect, test as base, type Page } from "@playwright/test";

/**
 * Browser E2E against the local Emulator stack (qa/scripts/run-recovery-stack.mjs).
 *
 * Production callables only accept the bptjersey.com origins and enforce App Check, so the page's
 * calls to the Functions Emulator are replayed from Node (no CORS) with an unsigned App Check token,
 * which the emulator decodes without verifying. Test-only: the application code is untouched.
 */
const projectId = "demo-bpt-jersey";
const functionsOrigin = /^http:\/\/127\.0\.0\.1:5011\//u; // run-recovery-stack.mjs ports
export const syntheticPassword = process.env.RECOVERY_E2E_PASSWORD ?? "synthetic-pass-2026";
export const ownerEmail = "recovery-owner@example.test";

function base64Url(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

export function syntheticAppCheckToken(): string {
  const now = Math.floor(Date.now() / 1000);
  return `${base64Url({ alg: "none", typ: "JWT" })}.${base64Url({
    sub: `1:${projectId}:web:recovery-e2e`,
    aud: [`projects/${projectId}`],
    iss: `https://firebaseappcheck.googleapis.com/${projectId}`,
    iat: now,
    exp: now + 3_600,
  })}.emulator-only`;
}

export async function routeFunctionsThroughNode(page: Page): Promise<void> {
  await page.route(functionsOrigin, async (route) => {
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
    // The emulator loads the whole Functions bundle on a cold call: allow it a minute.
    const response = await route.fetch({
      timeout: 60_000,
      headers: { ...request.headers(), "x-firebase-appcheck": syntheticAppCheckToken() },
    });
    const body = await response.text();
    if (body.includes('"error"')) {
      // Callable failures surface as friendly copy in the UI; keep the server's reason in the log.
      console.log(`[callable] ${new URL(request.url()).pathname.split("/").pop()} → ${body.slice(0, 400)}`);
    }
    await route.fulfill({ response, body, headers: { ...response.headers(), ...cors } });
  });
}

/** Members sign in at /login, office staff at /staff/login. */
export async function signIn(page: Page, email: string, options: { staff?: boolean } = {}) {
  await page.goto(options.staff ? "/staff/login" : "/login");
  const form = page.locator("#login-form");
  await form.getByLabel(/email address/iu).fill(email);
  await form.getByLabel("Password", { exact: true }).fill(syntheticPassword);
  await form.getByRole("button", { name: /^Sign in$/u }).click();
}

/** A new client account through the public "Create member account" option. */
export async function createMemberAccount(page: Page, email: string, returnTo = "/enrol") {
  await page.goto(`/login?returnTo=${encodeURIComponent(returnTo)}`);
  await page.getByRole("group", { name: "Account access" })
    .getByRole("button", { name: "Create member account" }).click();
  const form = page.locator("#login-form");
  await form.getByLabel(/email address/iu).fill(email);
  await form.getByLabel("Password", { exact: true }).fill(syntheticPassword);
  await form.getByRole("button", { name: "Create member account" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 60_000 });
}

export const uniqueEmail = (label: string) =>
  `${label}-${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}@example.test`;

/** 1×1 transparent PNG: a valid payment screenshot for the upload control. */
export const transferScreenshot = {
  name: "transfer.png",
  mimeType: "image/png",
  buffer: Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
    "base64",
  ),
};

export const test = base.extend<{ stackPage: Page }>({
  stackPage: async ({ page }, use, testInfo) => {
    testInfo.setTimeout(240_000);
    await routeFunctionsThroughNode(page);
    await use(page);
    // Background calls (calendar warm-up pings) may still be in flight when the test ends.
    await page.unrouteAll({ behavior: "ignoreErrors" });
  },
});
/** Saves a full-page screenshot for the visual review when SHOTS=1; a no-op otherwise. */
export async function shot(page: Page, name: string): Promise<void> {
  if (process.env.SHOTS !== "1") return;
  const project = base.info().project.name;
  await page.screenshot({
    path: `screenshots/2026-09-23-recovery/${project}-${name}.png`,
    fullPage: true,
  });
}

export { expect };
