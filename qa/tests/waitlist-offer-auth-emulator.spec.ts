import {
  devices,
  expect,
  test,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type BrowserContextOptions,
  type Page,
  type TestInfo,
} from "@playwright/test";

const projectId = "demo-bpt-jersey";
const adultSessionId = "session-t060-adult-accept";
const guardianSessionId = "session-t060-guardian-decline";
const rbacSessionId = "session-t060-rbac";
const adultSessionTitle = "T060 Adult acceptance class";
const guardianSessionTitle = "T060 Junior decline class";
const adultName = "Synthetic T060 Adult";
const minorName = "Synthetic T060 Junior";

type Identity = "owner" | "administrator" | "headCoach" | "coach" | "adult" | "guardian";
type BrowserHealth = ReturnType<typeof trackBrowserHealth>;
type AuthenticatedPage = Readonly<{
  context: BrowserContext;
  health: BrowserHealth;
  page: Page;
}>;

function fixtureIsConfigured(): boolean {
  return (
    process.env.WAITLIST_OFFER_UI_EMULATOR_E2E === "true" &&
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID === projectId &&
    Boolean(process.env.AUTH_EMULATOR_E2E_PASSWORD) &&
    [
      "WAITLIST_OFFER_OWNER_EMAIL",
      "WAITLIST_OFFER_ADMIN_EMAIL",
      "WAITLIST_OFFER_HEAD_COACH_EMAIL",
      "WAITLIST_OFFER_COACH_EMAIL",
      "WAITLIST_OFFER_ADULT_EMAIL",
      "WAITLIST_OFFER_GUARDIAN_EMAIL",
    ].every((name) => Boolean(process.env[name]))
  );
}

function requireFixture(): void {
  test.skip(
    !fixtureIsConfigured(),
    "Synthetic T060 Auth, Firestore, and Functions Emulator fixtures are required.",
  );
  expect(process.env.NEXT_PUBLIC_ADMIN_E2E).not.toBe("true");
}

function identityEmail(identity: Identity): string {
  const variable: Record<Identity, string> = {
    owner: "WAITLIST_OFFER_OWNER_EMAIL",
    administrator: "WAITLIST_OFFER_ADMIN_EMAIL",
    headCoach: "WAITLIST_OFFER_HEAD_COACH_EMAIL",
    coach: "WAITLIST_OFFER_COACH_EMAIL",
    adult: "WAITLIST_OFFER_ADULT_EMAIL",
    guardian: "WAITLIST_OFFER_GUARDIAN_EMAIL",
  };
  const value = process.env[variable[identity]]?.trim();
  if (!value) throw new Error("T060 synthetic identity is not configured");
  return value;
}

function trackBrowserHealth(page: Page) {
  const errors: string[] = [];
  const authRequests: string[] = [];
  const callableRequests: string[] = [];
  const directDataRequests: string[] = [];
  const authPort = process.env.NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_PORT ?? "9099";
  const functionsPort = process.env.NEXT_PUBLIC_FIREBASE_FUNCTIONS_EMULATOR_PORT ?? "5001";
  const firestorePort = process.env.NEXT_PUBLIC_FIREBASE_FIRESTORE_EMULATOR_PORT ?? "8080";

  page.on("console", (message) => {
    if (message.type() === "error") errors.push("console: " + message.text());
  });
  page.on("pageerror", (error) => errors.push("page: " + error.message));
  page.on("request", (request) => {
    const url = request.url();
    if (url.includes(`:${authPort}/`)) authRequests.push(url);
    if (url.includes(`:${functionsPort}/`)) callableRequests.push(url);
    if (
      /firestore\.googleapis\.com|firebaseio\.com|firebasedatabase\.app|google\.firestore\.v1\.Firestore/iu.test(
        url,
      ) ||
      url.includes(`:${firestorePort}/`)
    ) {
      directDataRequests.push(url);
    }
  });
  return { errors, authRequests, callableRequests, directDataRequests };
}

function contextOptions(testInfo: TestInfo): BrowserContextOptions {
  const descriptor =
    testInfo.project.name === "mobile-chromium" ? devices["Pixel 7"] : devices["Desktop Chrome"];
  const deviceOptions = Object.fromEntries(
    Object.entries(descriptor).filter(([key]) => key !== "defaultBrowserType"),
  ) as BrowserContextOptions;
  return {
    ...deviceOptions,
    baseURL: process.env.BASE_URL ?? "http://127.0.0.1:3100",
    locale: "en-GB",
    timezoneId: "Europe/Jersey",
  };
}

async function signIn(
  browser: Browser,
  testInfo: TestInfo,
  identity: Identity,
  access: "administrator" | "client",
): Promise<AuthenticatedPage> {
  const context = await browser.newContext(contextOptions(testInfo));
  const page = await context.newPage();
  const health = trackBrowserHealth(page);
  await page.goto(`/login?role=${access}`);
  await page.getByLabel("Email address").fill(identityEmail(identity));
  await page.getByLabel("Password").fill(process.env.AUTH_EMULATOR_E2E_PASSWORD!);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(access === "client" ? /\/account$/u : /\/admin$/u);
  return { context, health, page };
}

async function assertNoHorizontalOverflow(page: Page): Promise<void> {
  const dimensions = await page.evaluate(() => ({
    bodyClientWidth: document.body.clientWidth,
    bodyWidth: document.body.scrollWidth,
    documentClientWidth: document.documentElement.clientWidth,
    documentWidth: document.documentElement.scrollWidth,
  }));
  expect(dimensions.documentWidth).toBeLessThanOrEqual(dimensions.documentClientWidth);
  expect(dimensions.bodyWidth).toBeLessThanOrEqual(dimensions.bodyClientWidth);
}

async function assertNoInternalIdentifiers(page: Page): Promise<void> {
  await expect(page.locator("body")).not.toContainText(
    /academyId|membershipId|studentId|studentReference|synthetic-academy|session-t060|membership-t060|student-t060/iu,
  );
}

function expectCallable(health: BrowserHealth, callable: string): void {
  expect(
    health.callableRequests.some((url) => url.includes(callable)),
    `${callable}: ${JSON.stringify(health.callableRequests)}`,
  ).toBe(true);
}

async function selectStaffSession(
  page: Page,
  sessionId: string,
  title: string,
  canIssue = true,
): Promise<void> {
  await page.goto("/admin/waitlists");
  await expect(page.getByRole("heading", { name: "Class waitlists", level: 2 })).toBeVisible();
  await page.getByRole("combobox", { name: "Class" }).selectOption(sessionId);
  await expect(page.getByRole("heading", { name: title, level: 3 })).toBeVisible();
  await expect(page.getByRole("combobox", { name: /participant|student/iu })).toHaveCount(0);
  await expect(page.getByLabel("Queue position 1")).toHaveText("01");
  await expect(page.getByText("Waiting", { exact: true }).first()).toBeVisible();
  if (canIssue) {
    await expect(page.getByRole("button", { name: "Offer next place" })).toBeEnabled();
  } else {
    await expect(page.getByText("Read-only staff access.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Offer next place" })).toHaveCount(0);
  }
}

async function issueNextPlace(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Offer next place" }).click();
  await expect(page.getByRole("status")).toHaveText("Offer sent to the next eligible participant.");
  await expect(page.getByText("Offered", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Offer next place" })).toBeDisabled();
}

async function openClientWaitlist(page: Page, participantName: string): Promise<void> {
  await page.goto("/account/waitlist");
  await expect(page.getByRole("heading", { name: "Hold your place on the mat." })).toBeVisible();
  await expect(page.getByLabel("Participant")).toContainText(participantName);
}

async function expectOfferedPlace(page: Page, title: string): Promise<void> {
  const item = page
    .getByRole("listitem")
    .filter({ has: page.getByRole("heading", { name: title }) });
  await expect(item.getByText("Offered", { exact: true })).toBeVisible();
  const deadline = item.locator("time");
  await expect(deadline).toBeVisible();
  const dateTime = await deadline.getAttribute("datetime");
  expect(dateTime).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/u);
  expect(Date.parse(dateTime!)).toBeGreaterThan(Date.now());
  await expect(item.getByText(/\d+ min remaining/u)).toBeAttached();
  await expect(
    item.getByText(
      "The countdown is informational. The academy confirms whether the offer is still available.",
    ),
  ).toBeAttached();
  await expect(item.getByRole("button", { name: "Accept place" })).toBeVisible();
  await expect(item.getByRole("button", { name: "Decline offer" })).toBeVisible();
}

async function expectHealthy(page: AuthenticatedPage, callables: readonly string[]): Promise<void> {
  await assertNoHorizontalOverflow(page.page);
  await assertNoInternalIdentifiers(page.page);
  for (const callable of callables) expectCallable(page.health, callable);
  expect(page.health.authRequests.length).toBeGreaterThan(0);
  expect(page.health.directDataRequests).toEqual([]);
  expect(page.health.errors).toEqual([]);
}

type CallableEnvelope = Readonly<{
  error?: Readonly<{ status?: string }>;
}>;

async function expectIssueDenied(
  request: APIRequestContext,
  identity: "headCoach" | "coach",
): Promise<void> {
  const authPort = process.env.NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_PORT ?? "9099";
  const functionsPort = process.env.NEXT_PUBLIC_FIREBASE_FUNCTIONS_EMULATOR_PORT ?? "5001";
  const login = await request.post(
    `http://127.0.0.1:${authPort}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo`,
    {
      data: {
        email: identityEmail(identity),
        password: process.env.AUTH_EMULATOR_E2E_PASSWORD,
        returnSecureToken: true,
      },
    },
  );
  expect(login.status()).toBe(200);
  const loginBody = (await login.json()) as { idToken?: string };
  expect(loginBody.idToken).toEqual(expect.any(String));

  const response = await request.post(
    `http://127.0.0.1:${functionsPort}/${projectId}/us-central1/issueNextWaitlistOffer`,
    {
      data: { data: { sessionId: rbacSessionId } },
      headers: { Authorization: `Bearer ${loginBody.idToken}` },
    },
  );
  expect(response.status()).toBe(403);
  expect((await response.json()) as CallableEnvelope).toMatchObject({
    error: { status: "PERMISSION_DENIED" },
  });
}

test.describe("T060 waitlist offers with Firebase Emulators", () => {
  test("owner offers the first FIFO place and the authorised adult accepts @critical", async ({
    browser,
  }, testInfo) => {
    requireFixture();
    const owner = await signIn(browser, testInfo, "owner", "administrator");
    const adult = await signIn(browser, testInfo, "adult", "client");

    try {
      await openClientWaitlist(adult.page, adultName);
      await expect(adult.page.getByText("Waiting", { exact: true })).toBeVisible();

      await selectStaffSession(owner.page, adultSessionId, adultSessionTitle);
      await issueNextPlace(owner.page);

      await adult.page.reload();
      await expectOfferedPlace(adult.page, adultSessionTitle);
      await adult.page.getByRole("button", { name: "Accept place" }).click();
      await expect(adult.page.getByRole("status")).toHaveText("Place accepted.");
      await expect(adult.page.getByText("Accepted", { exact: true })).toBeVisible();
      await expect(adult.page.getByRole("button", { name: "Accept place" })).toHaveCount(0);

      await expectHealthy(owner, ["listSessions", "listSessionWaitlist", "issueNextWaitlistOffer"]);
      await expectHealthy(adult, [
        "listMemberships",
        "listSessions",
        "listStudentWaitlist",
        "acceptWaitlistOffer",
      ]);
    } finally {
      await adult.context.close();
      await owner.context.close();
    }
  });

  test("administrator offers the first FIFO place and the authorised tutor declines", async ({
    browser,
  }, testInfo) => {
    requireFixture();
    const administrator = await signIn(browser, testInfo, "administrator", "administrator");
    const guardian = await signIn(browser, testInfo, "guardian", "client");

    try {
      await openClientWaitlist(guardian.page, minorName);
      await expect(guardian.page.getByText("Waiting", { exact: true })).toBeVisible();

      await selectStaffSession(administrator.page, guardianSessionId, guardianSessionTitle);
      await issueNextPlace(administrator.page);

      await guardian.page.reload();
      await expectOfferedPlace(guardian.page, guardianSessionTitle);
      await guardian.page.getByRole("button", { name: "Decline offer" }).click();
      const confirmation = guardian.page.getByRole("group", {
        name: "Confirm offer decline",
      });
      await expect(confirmation.getByText("Decline this offered place?")).toBeVisible();
      await confirmation.getByRole("button", { name: "Confirm decline" }).click();
      await expect(guardian.page.getByRole("status")).toHaveText("Offer declined.");
      await expect(guardian.page.getByText("Cancelled", { exact: true })).toBeVisible();
      await expect(guardian.page.getByRole("button", { name: "Decline offer" })).toHaveCount(0);

      await expectHealthy(administrator, [
        "listSessions",
        "listSessionWaitlist",
        "issueNextWaitlistOffer",
      ]);
      await expectHealthy(guardian, [
        "listMemberships",
        "listSessions",
        "getFamily",
        "listStudentWaitlist",
        "declineWaitlistOffer",
      ]);
    } finally {
      await guardian.context.close();
      await administrator.context.close();
    }
  });

  test("head coach and coach can read the queue but cannot issue an offer", async ({
    browser,
    request,
  }, testInfo) => {
    requireFixture();

    for (const identity of ["headCoach", "coach"] as const) {
      const staff = await signIn(browser, testInfo, identity, "administrator");
      try {
        await selectStaffSession(staff.page, rbacSessionId, "T060 read-only staff class", false);
        await expectHealthy(staff, ["listSessions", "listSessionWaitlist"]);
      } finally {
        await staff.context.close();
      }
      await expectIssueDenied(request, identity);
    }
  });
});
