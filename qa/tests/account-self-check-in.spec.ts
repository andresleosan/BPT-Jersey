import { expect, test, type BrowserContext, type Page } from "@playwright/test";

/** T040V2 real-workbench coverage. Opt in because it uses actual browser geolocation. */
const enabled = process.env.ACCOUNT_WORKBENCH_E2E === "true";
const password = "Passw0rd!";
const town = { latitude: 49.183954, longitude: -2.107142, accuracy: 12 };
const far = { latitude: 49.185034, longitude: -2.107142, accuracy: 12 };
const errors = new WeakMap<Page, string[]>();

function redact(message: string): string {
  return message
    .replace(/(authorization|x-firebase-appcheck):\s*[^\s]+/giu, "$1: [redacted]")
    .replace(/bearer\s+[^\s]+/giu, "Bearer [redacted]")
    .replace(/eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/gu, "[redacted JWT]");
}

function viewportFor(projectName: string) {
  return projectName === "mobile-chromium"
    ? { width: 390, height: 844 }
    : { width: 1280, height: 800 };
}

async function signIn(page: Page, email: string, path = "/login"): Promise<void> {
  if (path) await page.goto(path);
  await expect(page.getByRole("heading", { name: "Client account" })).toBeVisible();
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL(/\/account(?:[?#]|$)/u);
  await expect(page.getByRole("region", { name: "Ready for Jiu Jitsu" })).toBeVisible();
}

function slider(page: Page) {
  return page.getByRole("slider", { name: /Slide to clock in/u });
}

async function commitWithPointer(page: Page): Promise<void> {
  const box = await slider(page).boundingBox();
  if (!box) throw new Error("The Ready for Jiu Jitsu range is not measurable.");
  await page.mouse.move(box.x + 4, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 4, box.y + box.height / 2, { steps: 12 });
  await page.mouse.up();
}

async function repeatPointer(page: Page): Promise<void> {
  const box = await slider(page).boundingBox();
  if (!box) throw new Error("The Ready for Jiu Jitsu range is not measurable.");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.up();
}

/** Delays Chromium's genuine callback; it does not replace the configured position. */
async function delayActualGeolocation(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    const geolocation = navigator.geolocation;
    const nativeGetCurrentPosition = geolocation.getCurrentPosition.bind(geolocation);
    Object.defineProperty(geolocation, "getCurrentPosition", {
      configurable: true,
      value: (
        onSuccess: PositionCallback,
        onError?: PositionErrorCallback | null,
        options?: PositionOptions,
      ) => {
        const countedWindow = window as Window & { __readyLocationRequests?: number };
        countedWindow.__readyLocationRequests = (countedWindow.__readyLocationRequests ?? 0) + 1;
        nativeGetCurrentPosition(
          (position) => window.setTimeout(() => onSuccess(position), 2_000),
          onError,
          options,
        );
      },
    });
  });
}

async function denyGeolocation(page: Page, context: BrowserContext): Promise<void> {
  await context.clearPermissions();
  const client = await context.newCDPSession(page);
  await client.send("Browser.setPermission", {
    origin: new URL(page.url()).origin,
    permission: { name: "geolocation" },
    setting: "denied",
  });
  await client.detach();
}

/**
 * Fixture `clockIn` is in-process, so a network listener would be vacuous. React's live prop is
 * the immediate `(input) => repository.clockIn(input)` adapter; breakpointing it observes that
 * boundary without replacing the repository or mocking a backend.
 */
async function fixtureClockInCallsDuring(
  page: Page,
  context: BrowserContext,
  action: () => Promise<void>,
): Promise<number> {
  const client = await context.newCDPSession(page);
  const callable = await client.send("Runtime.evaluate", {
    expression: `(() => {
      const card = document.querySelector(".ready-card");
      const key = card && Object.keys(card).find((name) => name.startsWith("__reactFiber$"));
      let fiber = key ? card[key] : undefined;
      while (fiber) {
        if (typeof fiber.memoizedProps?.clockIn === "function") {
          window.__bptReadyClockIn = fiber.memoizedProps.clockIn;
          return window.__bptReadyClockIn;
        }
        fiber = fiber.return;
      }
      return undefined;
    })()`,
  });
  const objectId = callable.result.objectId;
  if (!objectId) {
    throw new Error("ReadyForJiuJitsu did not expose its repository clockIn adapter.");
  }
  await client.send("Debugger.enable");
  let calls = 0;
  client.on("Debugger.paused", () => {
    calls += 1;
    void client.send("Debugger.resume");
  });
  const breakpoint = await client.send("Debugger.setBreakpointOnFunctionCall", { objectId });

  try {
    await action();
    return calls;
  } finally {
    await client.send("Debugger.removeBreakpoint", { breakpointId: breakpoint.breakpointId });
    await client.send("Debugger.disable");
    await client.detach();
  }
}

test.describe("Ready for Jiu Jitsu @account", () => {
  test.describe.configure({ timeout: 90_000 });
  test.skip(!enabled, "ACCOUNT_WORKBENCH_E2E is not enabled");

  test.beforeEach(async ({ page }, testInfo) => {
    await page.setViewportSize(viewportFor(testInfo.project.name));
    const pageErrors: string[] = [];
    errors.set(page, pageErrors);
    page.on("pageerror", (error) => pageErrors.push(redact(error.message)));
    page.on("console", (message) => {
      if (message.type() === "error") pageErrors.push(redact(message.text()));
    });
  });

  test.afterEach(({ page }) => {
    const pageErrors = errors.get(page) ?? [];
    expect(pageErrors, pageErrors.join(" | ")).toEqual([]);
  });

  test("uses the /accounts alias, then End to check in and persists the confirmation after reload", async ({
    page,
    context,
  }) => {
    await context.grantPermissions(["geolocation"]);
    await context.setGeolocation(town);
    await page.goto("/accounts");
    await expect(page.getByRole("heading", { name: "Sign in to continue" })).toBeVisible();
    await page.getByRole("link", { name: "Sign in", exact: true }).click();
    await page.waitForURL(/\/login/u);
    await signIn(page, "teen@bpt.test", "");
    await expect(page).toHaveURL(/\/account$/u);
    await expect(page.locator("main.member-app > *").first()).toHaveClass(/ready-card/u);
    await slider(page).focus();
    await page.keyboard.press("End");
    await expect(page.getByRole("heading", { name: "You're in" })).toBeVisible();
    await expect(page.getByText(/\d{2}:\d{2} · (On time|Late)/u)).toBeVisible();
    await expect(page.locator('li[data-session-id$="_town_prog-teens_ready"]')).toHaveAttribute(
      "data-status",
      "attended",
    );
    await page.reload();
    await expect(page.getByRole("heading", { name: "You're in" })).toBeVisible();
    await page.goto("/account");
    await expect(page).toHaveURL(/\/account$/u);
    await expect(page.getByRole("heading", { name: "You're in" })).toBeVisible();
  });

  test("keeps actual ArrowRight progress below 95 and commits when the native range reaches 95", async ({
    page,
    context,
  }) => {
    await context.grantPermissions(["geolocation"]);
    await context.setGeolocation(town);
    await signIn(page, "teen@bpt.test");
    await slider(page).focus();
    for (let value = 0; value < 94; value += 1) await page.keyboard.press("ArrowRight");
    await expect(slider(page)).toHaveValue("94");
    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("heading", { name: "You're in" })).toBeVisible();
  });

  test("holds locating for the genuine location callback and ignores a duplicate pointer gesture", async ({
    page,
    context,
  }) => {
    await context.grantPermissions(["geolocation"]);
    await context.setGeolocation(town);
    await delayActualGeolocation(context);
    await signIn(page, "teen@bpt.test");
    await commitWithPointer(page);
    await expect(page.getByRole("status")).toHaveText("Checking you're at the gym…");
    await expect(slider(page)).toBeDisabled();
    await repeatPointer(page);
    await expect(page.getByRole("status")).toHaveText("Checking you're at the gym…");
    await expect
      .poll(() =>
        page.evaluate(
          () => (window as Window & { __readyLocationRequests?: number }).__readyLocationRequests,
        ),
      )
      .toBe(1);
    await expect(page.getByRole("heading", { name: "You're in" })).toBeVisible();
  });

  test("refuses distance, reports CDP-denied location, and lets a guardian switch to the ready sibling", async ({
    page,
    context,
  }) => {
    await context.grantPermissions(["geolocation"]);
    await context.setGeolocation(far);
    await signIn(page, "teen@bpt.test");
    await slider(page).focus();
    await page.keyboard.press("End");
    await expect(page.getByRole("status")).toHaveText(
      "You're 120 m away. Get to the gym and try again.",
    );
    await expect(slider(page)).toHaveValue("0");
    await denyGeolocation(page, context);
    const deniedClockInCalls = await fixtureClockInCallsDuring(page, context, async () => {
      await slider(page).focus();
      await page.keyboard.press("End");
      await expect(page.getByRole("status")).toHaveText(
        "Location is off. Allow it for this site, or ask a coach to check you in.",
      );
    });
    expect(deniedClockInCalls).toBe(0);
    await page.getByRole("button", { name: "Sign out" }).click();
    await page.waitForURL(/\/login/u);
    await signIn(page, "tutor@bpt.test", "");
    await expect(page.getByRole("slider", { name: /Teens BJJ/u })).toBeVisible();
    await expect(page.getByText("Leo is ready too — switch to Leo")).toBeVisible();
    await page.getByRole("button", { name: "Leo", exact: true }).click();
    await expect(page.getByRole("slider", { name: /Kids BJJ/u })).toBeVisible();
  });
});
