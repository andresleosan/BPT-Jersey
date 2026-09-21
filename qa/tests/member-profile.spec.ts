import { randomInt, randomUUID } from "node:crypto";
import { createRequire } from "node:module";

import { deleteApp, initializeApp, type App } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { expect, test, type APIRequestContext, type Locator, type Page } from "@playwright/test";

/**
 * T051V2 Task 18. Plan B (search, record header, PROFILE, birthdays, DETAILS) and Plan C (the
 * JIU-JITSU IBJJF card, the Manage view, assign, void, history and the skills assessment) driven
 * through the real static web build against the Auth, Functions and Firestore emulators, at
 * desktop and at 390px, with axe and screenshots.
 *
 * It also discharges the modal debt the unit suites cannot: jsdom 30 implements neither
 * `showModal` nor `close`, so the focus trap, the inert background, the `::backdrop`, native
 * Escape and the focus return are provable only in a real browser.
 */
const enabled = process.env.MEMBER_PROFILE_UI_EMULATOR_E2E === "true";
const projectId = "demo-bpt-jersey";
const academyId = process.env.MEMBER_PROFILE_E2E_ACADEMY_ID ?? "member-profile-e2e";
const functionsBaseUrl = `http://127.0.0.1:5001/${projectId}/us-central1`;
const authUrl =
  "http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo";
const require = createRequire(import.meta.url);
const dayMs = 86_400_000;

function base64Url(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

// Unsigned, emulator-only App Check token. It is never accepted outside skipTokenVerification.
function syntheticAppCheckToken(): string {
  const now = Math.floor(Date.now() / 1000);
  return `${base64Url({ alg: "none", typ: "JWT" })}.${base64Url({
    sub: `1:${projectId}:web:member-profile-e2e`,
    aud: [`projects/${projectId}`],
    iss: `https://firebaseappcheck.googleapis.com/${projectId}`,
    iat: now,
    exp: now + 3_600,
  })}.emulator-only`;
}

const jerseyDay = (instant: Date) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Jersey" }).format(instant);
const utcDay = (offsetDays: number) =>
  new Date(Date.now() + offsetDays * dayMs).toISOString().slice(0, 10);

const adultLevelKey = "white-belt";
const adultTargetName = "White - 1st Stripe";
const adultNextButOneName = "White - 2nd Stripe";
const kidsLevelKey = "white-belt-kids-4-5-and-5-7-yo";
const toppedOutKey = "red-belt";
/** Not in the kids target's eleven requirements, so it exercises the "other ratings" sentence. */
const unrequiredSkillKey = "berimbolo";

type Member = Readonly<{ studentId: string; fullName: string }>;

const members: Record<string, Member> = {};
let suffix = "";
let ownerToken = "";

async function idTokenFor(
  request: APIRequestContext,
  email: string,
  password: string,
): Promise<string> {
  const response = await request.post(authUrl, {
    data: { email, password, returnSecureToken: true },
  });
  expect(response.ok(), await response.text()).toBe(true);
  return ((await response.json()) as { idToken: string }).idToken;
}

async function callAsOwner(
  request: APIRequestContext,
  name: string,
  data: unknown,
): Promise<unknown> {
  const response = await request.post(`${functionsBaseUrl}/${name}`, {
    headers: {
      Authorization: `Bearer ${ownerToken}`,
      "X-Firebase-AppCheck": syntheticAppCheckToken(),
    },
    data: { data },
  });
  expect(response.status(), `${name}: ${await response.text()}`).toBe(200);
  return ((await response.json()) as { result: unknown }).result;
}

/** Every callable payload this page sent, so a save can be asserted on the wire, not on screen. */
type SentCall = Readonly<{ name: string; payload: Record<string, unknown> }>;

type Session = Readonly<{
  sent: SentCall[];
  confirms: string[];
  errors: string[];
  setConfirmAnswer: (accept: boolean) => void;
}>;

async function signIn(page: Page, email: string, password: string): Promise<Session> {
  const sent: SentCall[] = [];
  const confirms: string[] = [];
  const errors: string[] = [];
  let accept = true;
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("dialog", (dialog) => {
    confirms.push(dialog.message());
    void (accept ? dialog.accept() : dialog.dismiss());
  });
  await page.route("http://127.0.0.1:5001/**", (route) => {
    const request = route.request();
    const name = new URL(request.url()).pathname.split("/").pop() ?? "";
    let payload: Record<string, unknown> = {};
    try {
      const body = request.postDataJSON() as { data?: unknown };
      payload = (body?.data ?? {}) as Record<string, unknown>;
    } catch {
      payload = {};
    }
    sent.push({ name, payload });
    return route.continue({
      headers: { ...request.headers(), "x-firebase-appcheck": syntheticAppCheckToken() },
    });
  });
  await page.goto("/login");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/account/u, { timeout: 30_000 });
  return {
    sent,
    confirms,
    errors,
    setConfirmAnswer: (value: boolean) => {
      accept = value;
    },
  };
}

type AxeViolation = Readonly<{
  id: string;
  impact: string | null;
  nodes: number;
  targets: string[];
}>;

async function axeViolations(page: Page): Promise<AxeViolation[]> {
  await page.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
  return await page.evaluate(async () => {
    const axe = (
      window as unknown as {
        axe: {
          run: (context: Document) => Promise<{
            violations: {
              id: string;
              impact: string | null;
              nodes: { target: unknown[] }[];
            }[];
          }>;
        };
      }
    ).axe;
    const result = await axe.run(document);
    return result.violations
      .filter((violation) => violation.impact === "serious" || violation.impact === "critical")
      .map((violation) => ({
        id: violation.id,
        impact: violation.impact,
        nodes: violation.nodes.length,
        targets: violation.nodes.slice(0, 4).map((node) => String(node.target)),
      }));
  });
}

/**
 * Findings are COLLECTED, not thrown on the spot, and asserted in `afterEach`. A serious
 * violation on the first page of a viewport pass would otherwise end the test before the rest of
 * that viewport was ever measured or screenshotted, and the evidence Task 19 records would be
 * missing exactly where it matters most. Nothing is tolerated: the assertion is still `[]`.
 */
let axeFindings: { label: string; violations: AxeViolation[] }[] = [];

async function auditAxe(page: Page, label: string): Promise<void> {
  const violations = await axeViolations(page);
  if (violations.length > 0) axeFindings.push({ label, violations });
}

async function expectNoHorizontalScroll(page: Page, label: string): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, label).toBeLessThanOrEqual(0);
}

const recordUrl = (studentId: string, query = "") =>
  `/admin/members/profile?id=${encodeURIComponent(studentId)}${query}`;

async function openManage(page: Page, studentId: string): Promise<void> {
  await page.goto(recordUrl(studentId, "&view=manage"));
  await expect(page.getByRole("heading", { name: "Level history" })).toBeVisible({
    timeout: 60_000,
  });
}

/**
 * The five properties the unit suite cannot reach. Each is a separate assertion with its own
 * message, so a failure names which one of them regressed.
 */
async function proveModalBehaviour(
  page: Page,
  dialog: Locator,
  opener: Locator,
  behind: Locator,
): Promise<void> {
  const handle = await dialog.elementHandle();
  expect(handle, "the dialog element is in the DOM").not.toBeNull();

  // 1. Real modality and the focus trap. `:modal` matches only an element opened with showModal().
  expect(
    await dialog.evaluate((element) => element.matches(":modal")),
    "the dialog is open as a real modal (showModal), not <dialog open>",
  ).toBe(true);
  /**
   * Tab and Shift+Tab may never put focus on anything in the page BEHIND the dialog. Chromium
   * parks focus on `<body>` for one step as the cycle wraps - that is the wrap, not an escape -
   * so the assertion is on the element that is actually reachable, and the visited set is
   * reported so a regression names what it reached.
   */
  const visited: string[] = [];
  for (const key of [
    ...Array.from({ length: 14 }, () => "Tab"),
    ...Array.from({ length: 6 }, () => "Shift+Tab"),
  ]) {
    await page.keyboard.press(key);
    visited.push(
      await dialog.evaluate((element) => {
        const active = document.activeElement;
        if (active === null) return "none";
        if (active === document.body || active === document.documentElement) return "body";
        return element.contains(active)
          ? `inside:${active.tagName.toLowerCase()}`
          : `OUTSIDE:${active.tagName.toLowerCase()}.${active.className}`;
      }),
    );
  }
  expect(
    visited.filter((entry) => entry.startsWith("OUTSIDE")),
    "no Tab or Shift+Tab reached the page behind the dialog",
  ).toEqual([]);
  expect(
    new Set(visited.filter((entry) => entry.startsWith("inside:"))),
    "the cycle really did move through the dialog's own controls",
  ).toEqual(new Set(["inside:textarea", "inside:button"]));

  // 2. The background is inert to the pointer: a hit test over an element behind the dialog
  //    resolves to the dialog's own top-layer box, never to the element itself.
  const behindBox = await behind.boundingBox();
  expect(behindBox, "the element behind the dialog is laid out").not.toBeNull();
  const hit = await page.evaluate(
    ([x, y]) => {
      const element = document.elementFromPoint(x as number, y as number);
      return element === null ? "none" : element.tagName.toLowerCase();
    },
    [
      (behindBox?.x ?? 0) + (behindBox?.width ?? 0) / 2,
      (behindBox?.y ?? 0) + (behindBox?.height ?? 0) / 2,
    ],
  );
  expect(hit, "a point over the background hit-tests to the dialog, not the page behind").toBe(
    "dialog",
  );
  await expect(
    behind.click({ timeout: 2_000 }),
    "a click aimed at the background never reaches it",
  ).rejects.toThrow();

  // 3. The backdrop renders.
  const backdrop = await dialog.evaluate(
    (element) => window.getComputedStyle(element, "::backdrop").backgroundColor,
  );
  expect(backdrop, "the ::backdrop paints something over the page").not.toBe("rgba(0, 0, 0, 0)");

  // 4 and 5 are proved by the callers, which know what must NOT have happened and where focus
  //    must land.
  void opener;
}

test.describe("T051V2 member record and JIU-JITSU IBJJF on Firebase Emulators", () => {
  test.describe.configure({ mode: "serial" });
  test.afterEach(() => {
    const found = axeFindings;
    axeFindings = [];
    expect(found, "serious or critical axe violations").toEqual([]);
  });
  test.skip(
    !enabled || !process.env.AUTH_EMULATOR_E2E_EMAIL,
    "Member profile emulator flags and synthetic actors are required.",
  );

  test.beforeAll(async ({ playwright }) => {
    const request = await playwright.request.newContext();
    ownerToken = await idTokenFor(
      request,
      process.env.AUTH_EMULATOR_E2E_EMAIL!,
      process.env.AUTH_EMULATOR_E2E_PASSWORD!,
    );
    suffix = randomUUID().replace(/-/gu, "").slice(0, 8).toUpperCase();

    // Birthday in three Jersey calendar days, so the header chip reads "Birthday in 3 days".
    // T051V2 Task 19: the badge counts from the ACADEMY day (Europe/Jersey), so the seed must too.
    // Reading the UTC day instead made this read "Birthday in 2 days" between 23:00 and midnight
    // UTC under BST, when the Jersey day has already turned over and the UTC one has not.
    const today = jerseyDay(new Date());
    const birthday = new Date(Date.parse(`${today}T00:00:00.000Z`) + 3 * dayMs);
    // A leap birth year also accepts February 29; subtracting 30 years did not.
    const adultDateOfBirth = `2000-${birthday.toISOString().slice(5, 10)}`;
    let nextMembershipNumber = randomInt(100_000_000, 999_999_996);

    async function createMember(label: string, dateOfBirth: string): Promise<Member> {
      const localSuffix = `${suffix}${label.toUpperCase()}`;
      const fullName = `Synthetic ${label} ${suffix}`;
      const result = (await callAsOwner(request, "createMember", {
        requestId: `t051-create-${localSuffix.toLowerCase()}`,
        fullName,
        dateOfBirth,
        phoneNumber: "+441534000051",
        email: `t051-${localSuffix.toLowerCase()}@example.test`,
        trainingCenter: "Town",
        trainingTimePreferences: ["evening"],
        membershipNumber: String(nextMembershipNumber++),
        gender: "unknown",
        emergencyContact: {
          fullName: "Synthetic T051 Contact",
          relationship: "Spouse",
          phoneNumber: "+441534000052",
        },
      })) as { studentId: string };
      return { studentId: result.studentId, fullName };
    }

    members.adult = await createMember("Adult", adultDateOfBirth);
    /**
     * NOT a minor: `createMember` refuses one outright with `minor_requires_family_flow`, so the
     * canonical directory has no way to make a child here. The requirement set this member
     * exercises is the one attached to the kids WHITE BELT, which the head below puts them on -
     * requirements belong to the level held and its target, never to the member's age.
     */
    members.kid = await createMember("Kids", utcDay(-25 * 365));
    members.top = await createMember("Top", utcDay(-70 * 365));
    members.orphan = await createMember("Orphan", "1985-04-05");
    await request.dispose();

    process.env.FIRESTORE_EMULATOR_HOST ??= "127.0.0.1:8080";
    const app: App = initializeApp({ projectId }, `t051-member-profile-${suffix}`);
    try {
      const firestore = getFirestore(app);
      const root = `academies/${academyId}`;

      async function head(
        member: Member,
        fields: Readonly<Record<string, unknown>>,
      ): Promise<void> {
        await firestore.doc(`${root}/studentLevelProgress/${member.studentId}`).set({
          academyId,
          studentId: member.studentId,
          systemId: "ibjjf-v3",
          lastApprovedPromotionId: null,
          openedByStaffId: null,
          openedByRole: null,
          source: "regyfit-import",
          state: "initialized",
          schemaVersion: "1",
          createdBy: "system:t051-e2e",
          updatedBy: "system:t051-e2e",
          ...fields,
        });
      }

      async function attend(member: Member, offsets: readonly number[]): Promise<void> {
        for (const [index, offset] of offsets.entries()) {
          const sessionId = `t051-session-${member.studentId}-${index}`;
          const startAt = `${utcDay(offset)}T18:00:00.000Z`;
          await firestore
            .doc(`${root}/sessions/${sessionId}`)
            .set({ sessionId, academyId, startAt, endAt: `${utcDay(offset)}T19:00:00.000Z` });
          const attendanceId = `t051-attendance-${member.studentId}-${index}`;
          await firestore.doc(`${root}/attendance/${attendanceId}`).set({
            attendanceId,
            academyId,
            studentId: member.studentId,
            sessionId,
            state: "attended",
            correctionOf: null,
            occurredAt: startAt,
          });
        }
      }

      const adultStartedAt = `${utcDay(-30)}T00:00:00.000Z`;
      await head(members.adult!, {
        currentDefinitionKey: adultLevelKey,
        currentLevelStartedAt: adultStartedAt,
        openingNotes: "Synthetic imported level.",
        openedDefinitionKey: adultLevelKey,
        openedOn: utcDay(-30),
        importedBaseline: { classes: 9, cutoff: utcDay(-10), source: "regyfit-import" },
        createdAt: adultStartedAt,
        updatedAt: adultStartedAt,
      });
      // The class on day -20 is before the baseline cutoff, so it is already inside the imported
      // nine: three, not four, are counted from BPT.
      await attend(members.adult!, [-20, -5, -4, -3]);

      const kidStartedAt = `${utcDay(-40)}T00:00:00.000Z`;
      await head(members.kid!, {
        currentDefinitionKey: kidsLevelKey,
        currentLevelStartedAt: kidStartedAt,
        openingNotes: "Synthetic imported kids level.",
        openedDefinitionKey: kidsLevelKey,
        openedOn: utcDay(-40),
        createdAt: kidStartedAt,
        updatedAt: kidStartedAt,
      });
      await attend(members.kid!, [-9, -2]);

      const topStartedAt = `${utcDay(-500)}T00:00:00.000Z`;
      await head(members.top!, {
        currentDefinitionKey: toppedOutKey,
        currentLevelStartedAt: topStartedAt,
        openingNotes: "Synthetic imported top level.",
        openedDefinitionKey: toppedOutKey,
        openedOn: utcDay(-500),
        createdAt: topStartedAt,
        updatedAt: topStartedAt,
      });

      /**
       * NO head at all, and a promotion written straight into the collection - the shape Plan D's
       * Regyfit import produces before a head exists. `getStudentLevelHistory` then reports
       * `currentDefinitionKey: null` beside a standing promotion row, which is the only way the
       * view's "neither current nor previous" branch is reachable: a head that EXISTS while
       * naming no current level is refused outright by `getStudentProgressSummary`
       * ("Progress head is invalid"), so the whole view fails closed and renders nothing.
       */
      const orphanPromotionId = `t051-import-${members.orphan!.studentId}`;
      await firestore.doc(`${root}/levelPromotions/${orphanPromotionId}`).set({
        promotionId: orphanPromotionId,
        academyId,
        studentId: members.orphan!.studentId,
        systemId: "ibjjf-v2",
        status: "approved",
        fromDefinitionKey: adultLevelKey,
        toDefinitionKey: adultTargetKeyFor(adultTargetName),
        promotedOn: utcDay(-200),
        decidedAt: `${utcDay(-200)}T12:00:00.000Z`,
        decidedBy: "system:t051-e2e",
        decidedByRole: null,
        decisionNotes: "",
        note: null,
        gaps: [],
        source: "regyfit-import",
        schemaVersion: "1",
        createdAt: `${utcDay(-200)}T12:00:00.000Z`,
        createdBy: "system:t051-e2e",
        updatedAt: `${utcDay(-200)}T12:00:00.000Z`,
        updatedBy: "system:t051-e2e",
      });
    } finally {
      await deleteApp(app);
    }

    // A rating the kids target does NOT require, recorded through the real callable so the panel
    // meets it exactly as the store holds it.
    const ratingRequest = await playwright.request.newContext();
    await callAsOwner(ratingRequest, "recordEvaluation", {
      studentId: members.kid!.studentId,
      definitionKey: kidsLevelKey,
      ratings: [{ skillKey: unrequiredSkillKey, score: 4 }],
    });
    await ratingRequest.dispose();
  });

  test("Plan B: search, record header, birthday badge and DETAILS save @critical @member-data-foundation", async ({
    page,
  }) => {
    test.setTimeout(240_000);
    const session = await signIn(
      page,
      process.env.AUTH_EMULATOR_E2E_EMAIL!,
      process.env.AUTH_EMULATOR_E2E_PASSWORD!,
    );
    await page.setViewportSize({ width: 1440, height: 900 });
    const adult = members.adult!;

    // The office searches from Members since 2026-09-19.
    await page.goto("/admin/members");
    await page.getByLabel("Member name").fill(adult.fullName);
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await auditAxe(page, "member search at 1440px");
    await page.screenshot({ path: "screenshots/t051-member-search-desktop.png", fullPage: true });
    await page
      .getByRole("link", { name: `Open record for ${adult.fullName}` })
      .first()
      .click();

    await expect(page).toHaveURL(new RegExp(`/admin/members/profile\\?id=`, "u"), {
      timeout: 30_000,
    });
    await expect(page.getByRole("heading", { name: adult.fullName })).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.getByText("Birthday in 3 days")).toBeVisible();
    // The birthday is three days away, so thirty years since birth is still an age of 29.
    await expect(page.getByText("29 years")).toBeVisible();

    await page.getByRole("tab", { name: "Details" }).click();
    await expect(page.getByLabel("Address", { exact: true })).toHaveCount(0);
    await expect(page.getByLabel("City", { exact: true })).toHaveCount(0);
    await expect(page.getByLabel("Post code", { exact: true })).toHaveCount(0);
    await expect(page.getByLabel("Country", { exact: true })).toHaveCount(0);
    await page.getByLabel("Nickname").fill(`Nick ${suffix}`);
    await auditAxe(page, "record DETAILS tab at 1440px");
    await page.screenshot({ path: "screenshots/t051-record-details-desktop.png", fullPage: true });
    await page.getByRole("button", { name: "Save details" }).click();
    await expect(page.getByText("Details saved.")).toBeVisible({ timeout: 60_000 });
    await page.reload();
    await page.getByRole("tab", { name: "Details" }).click();
    await expect(page.getByLabel("Nickname")).toHaveValue(`Nick ${suffix}`, { timeout: 60_000 });
    expect(session.errors, "no uncaught page errors").toEqual([]);
  });

  test("Plan C: the IBJJF card, assign, the modal, void and the history @critical @member-data-foundation", async ({
    page,
  }) => {
    test.setTimeout(300_000);
    const session = await signIn(
      page,
      process.env.AUTH_EMULATOR_E2E_EMAIL!,
      process.env.AUTH_EMULATOR_E2E_PASSWORD!,
    );
    await page.setViewportSize({ width: 1440, height: 900 });
    const adult = members.adult!;

    await page.goto(recordUrl(adult.studentId));
    const card = page.getByRole("region", { name: "JIU-JITSU IBJJF" });
    await expect(card.getByRole("heading", { name: "WHITE BELT" })).toBeVisible({
      timeout: 60_000,
    });
    // The two criteria, and the imported / BPT split: the class on day -20 sits before the
    // baseline cutoff, so it is inside the imported nine rather than counted twice.
    await expect(card.getByText("12/20")).toBeVisible();
    await expect(card.getByText("9 imported + 3 in BPT")).toBeVisible();
    // The days criterion is the TARGET level's (White - 1st Stripe requires 60), not the 90 the
    // held WHITE BELT itself carries.
    await expect(card.getByText("30/60")).toBeVisible();
    // One progress value, and the number beside the bar is the bar's own value.
    const progress = card.getByRole("progressbar");
    const value = await progress.evaluate((element) => (element as HTMLProgressElement).value);
    expect(value).toBeGreaterThan(0);
    expect(value).toBeLessThan(100);
    await expect(card.getByText(`${value}%`)).toBeVisible();
    await auditAxe(page, "record PROFILE tab at 1440px");
    await page.screenshot({ path: "screenshots/t051-ibjjf-card-desktop.png", fullPage: true });

    await card.getByRole("link", { name: "Manage" }).click();
    await expect(page).toHaveURL(/view=manage/u);
    await expect(page.getByRole("heading", { name: "Level history" })).toBeVisible({
      timeout: 60_000,
    });
    // Nothing has been promoted, so the head names no promotion: no Void button anywhere, and no
    // instruction to void something else either.
    await expect(page.getByRole("button", { name: "Void" })).toHaveCount(0);
    await expect(page.getByText("Void the most recently recorded promotion first")).toHaveCount(0);

    const assign = page.getByRole("form", { name: "Assign next level" });
    await assign.getByLabel("Next level").selectOption({ label: adultNextButOneName });
    await assign.getByLabel("Promotion date").fill(jerseyDay(new Date()));
    const opener = assign.getByRole("button", { name: "Review promotion" });
    await opener.click();

    const promote = page.getByRole("dialog");
    await expect(promote.getByRole("heading")).toContainText(
      `Promote ${adult.fullName} from WHITE BELT to ${adultNextButOneName} on `,
    );
    const notMet = promote.getByRole("list", { name: "Criteria not met" });
    await expect(notMet).toContainText("Skips 1 stripe");
    await expect(notMet).toContainText("Classes 12/20 not met");
    await expect(
      promote.getByRole("button", { name: "Confirm promotion" }),
      "An owner can confirm unmet criteria without a note",
    ).toBeEnabled();
    await auditAxe(page, "assign confirmation dialog at 1440px");
    await page.screenshot({ path: "screenshots/t051-ibjjf-assign-dialog-desktop.png" });

    await proveModalBehaviour(
      page,
      promote,
      opener,
      page.getByRole("link", { name: "Back to record" }),
    );

    // Native Escape closes it through `onCancel`, performs nothing, and gives focus back.
    const assignsBefore = session.sent.filter((call) => call.name === "assignLevel").length;
    await page.keyboard.press("Escape");
    await expect(promote).toHaveCount(0);
    expect(
      session.sent.filter((call) => call.name === "assignLevel").length,
      "Escape performed no promotion",
    ).toBe(assignsBefore);
    expect(
      await page.evaluate(() => document.activeElement?.textContent ?? ""),
      "focus returned to the button that opened the dialog",
    ).toContain("Review promotion");

    // Reopen and promote for real.
    await opener.click();
    await promote.getByLabel(/^Note/u).fill("Synthetic competition result justifies it.");
    await promote.getByRole("button", { name: "Confirm promotion" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Level assigned." })).toBeVisible({
      timeout: 60_000,
    });
    const history = page.getByRole("table", { name: "Level history" });
    const topRow = history.getByRole("row").nth(1);
    await expect(topRow).toContainText(adultNextButOneName);
    await expect(topRow).toContainText("Current");
    // One assignment per confirm.
    expect(
      session.sent.filter((call) => call.name === "assignLevel").length,
      "exactly one assignLevel reached the server",
    ).toBe(assignsBefore + 1);

    // Void sits on the row the server's own `lastApprovedPromotionId` names.
    await expect(topRow.getByRole("button", { name: "Void" })).toBeVisible();
    await expect(
      history.getByRole("button", { name: "Void" }),
      "exactly one row offers Void",
    ).toHaveCount(1);
    await topRow.getByRole("button", { name: "Void" }).click();
    const voidDialog = page.getByRole("dialog");
    await expect(voidDialog.getByRole("heading")).toContainText(
      `Void the promotion of ${adult.fullName} to ${adultNextButOneName}?`,
    );
    await voidDialog.getByLabel(/^Reason/u).fill("Synthetic promotion assigned by mistake.");
    await voidDialog.getByRole("button", { name: "Void promotion" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Promotion voided." })).toBeVisible({
      timeout: 60_000,
    });
    await expect(history.getByRole("row").nth(1)).toContainText("Voided");
    await expect(history.getByRole("row").nth(1)).toContainText("Owner");
    await page.screenshot({ path: "screenshots/t051-ibjjf-manage-desktop.png", fullPage: true });
    await auditAxe(page, "Manage view at 1440px");

    // The state survives a reload of the real page.
    await page.reload();
    await expect(
      page.getByRole("table", { name: "Level history" }).getByRole("row").nth(1),
      "the voided row is still voided after a reload",
    ).toContainText("Voided");
    await expectNoHorizontalScroll(page, "Manage view at 1440px");
    expect(session.errors, "no uncaught page errors").toEqual([]);
  });

  test("Decision 9: an adult target with no requirements rates nothing @critical", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await signIn(
      page,
      process.env.AUTH_EMULATOR_E2E_EMAIL!,
      process.env.AUTH_EMULATOR_E2E_PASSWORD!,
    );
    await page.setViewportSize({ width: 1440, height: 900 });
    await openManage(page, members.adult!.studentId);
    const panel = page.getByRole("region", { name: "Skills assessment" });
    await expect(panel.getByText("This level requires no rated skills.")).toBeVisible();
    await expect(panel.getByRole("radio")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Save ratings/u })).toHaveCount(0);
    await expect(page.getByText("the level currently held")).toHaveCount(0);
    await page.screenshot({ path: "screenshots/t051-skills-adult-none-desktop.png" });
  });

  test("Decision 9: the top of the catalogue says so on the card and in the panel", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await signIn(
      page,
      process.env.AUTH_EMULATOR_E2E_EMAIL!,
      process.env.AUTH_EMULATOR_E2E_PASSWORD!,
    );
    await page.setViewportSize({ width: 1440, height: 900 });
    const top = members.top!;
    await page.goto(recordUrl(top.studentId));
    const card = page.getByRole("region", { name: "JIU-JITSU IBJJF" });
    await expect(card.getByRole("heading", { name: "RED BELT" })).toBeVisible({ timeout: 60_000 });
    await expect(
      card.getByText("This is the highest level BPT tracks, so there is no next graduation"),
    ).toBeVisible();
    await expect(card.getByRole("progressbar")).toHaveCount(0);
    await page.screenshot({ path: "screenshots/t051-ibjjf-card-topped-out-desktop.png" });

    await openManage(page, top.studentId);
    await expect(
      page.getByText("This is the highest level BPT tracks, so there are no skills to rate."),
    ).toBeVisible();
    await expect(page.getByText("This level requires no rated skills.")).toHaveCount(0);
  });

  test("a standing promotion is never called Previous when no current level is named", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await signIn(
      page,
      process.env.AUTH_EMULATOR_E2E_EMAIL!,
      process.env.AUTH_EMULATOR_E2E_PASSWORD!,
    );
    await page.setViewportSize({ width: 1440, height: 900 });
    await openManage(page, members.orphan!.studentId);
    const history = page.getByRole("table", { name: "Level history" });
    await expect(history.getByRole("row")).not.toHaveCount(0);
    await expect(history, "no row claims to be a former level").not.toContainText("Previous");
    await expect(history, "and none claims to be the current one either").not.toContainText(
      "Current",
    );
  });

  test("Decision 9: a kids target rates exactly its eleven requirements @critical", async ({
    page,
  }) => {
    test.setTimeout(300_000);
    const session = await signIn(
      page,
      process.env.AUTH_EMULATOR_E2E_EMAIL!,
      process.env.AUTH_EMULATOR_E2E_PASSWORD!,
    );
    await page.setViewportSize({ width: 1440, height: 900 });
    const kid = members.kid!;
    await openManage(page, kid.studentId);

    const panel = page.getByRole("region", { name: "Skills assessment" });
    await expect(panel.getByText("This level requires no rated skills.")).toHaveCount(0);
    await expect(
      panel.getByText("A rating for 1 other skill is on record. Nothing here changes it."),
      "a rating outside the requirement set is stated, never hidden",
    ).toBeVisible();
    await expect(
      panel.getByText("WHITE BELT KIDS 4-5 and 5-7 YO, the level currently held"),
    ).toBeVisible();

    // Eleven requirements: one Fundamentals and ten Warm Up, and nothing else from the 58 skills.
    await expect(panel.getByText("0/1 rated")).toBeVisible();
    await expect(panel.getByText("0/10 rated")).toBeVisible();
    await expect(panel.locator("details")).toHaveCount(2);
    for (const summary of await panel.locator("details > summary").all()) {
      await summary.click();
    }
    await expect(panel.locator("fieldset")).toHaveCount(11);
    await expect(panel.getByText("Berimbolo")).toHaveCount(0);
    await page.screenshot({ path: "screenshots/t051-skills-kids-desktop.png", fullPage: true });
    await auditAxe(page, "Manage view with the kids assessment at 1440px");

    // Rate two of the eleven and save. Only listed skills may reach the wire.
    await panel
      .locator("fieldset", { hasText: "Warm Up 2 - Bridges" })
      .getByRole("radio", { name: "4" })
      .check();
    await panel
      .locator("fieldset", { hasText: "Tie The Belt" })
      .getByRole("radio", { name: "3" })
      .check();
    await expect(panel.getByText("You have unsaved ratings.")).toBeVisible();

    const readsBefore = session.sent.filter((call) =>
      ["getStudentProgressSummary", "getStudentLevelHistory", "listStudentEvaluations"].includes(
        call.name,
      ),
    ).length;
    await panel.getByRole("button", { name: "Save ratings" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Ratings saved." })).toBeVisible({
      timeout: 60_000,
    });
    const saves = session.sent.filter((call) => call.name === "recordEvaluation");
    expect(saves, "exactly one batch was sent").toHaveLength(1);
    const ratings = saves[0]!.payload["ratings"] as { skillKey: string }[];
    expect(
      ratings.map((rating) => rating.skillKey).sort(),
      "the payload carries only skills the target requires",
    ).toEqual(["tie-the-belt", "warm-up-2-bridges"]);
    const readsAfter = session.sent.filter((call) =>
      ["getStudentProgressSummary", "getStudentLevelHistory", "listStudentEvaluations"].includes(
        call.name,
      ),
    ).length;
    expect(readsAfter, "a ratings save does not refetch the view").toBe(readsBefore);
    await expect(panel.getByText("You have unsaved ratings.")).toHaveCount(0);
    // The counters count SAVED ratings, and say so.
    await expect(panel.getByText("1/1 rated")).toBeVisible();
    await expect(panel.getByText("1/1 saved at minimum")).toBeVisible();
    await expect(panel.getByText("1/10 rated")).toBeVisible();
    await expect(panel.getByText("1/10 saved at minimum")).toBeVisible();

    // The promotion dialog agrees with the panel: two of eleven are at minimum.
    const assign = page.getByRole("form", { name: "Assign next level" });
    await assign
      .getByLabel("Next level")
      .selectOption({ label: "White 4-5 and 5-7yo - 1st Stripe" });
    await assign.getByLabel("Promotion date").fill(jerseyDay(new Date()));
    await assign.getByRole("button", { name: "Review promotion" }).click();
    await expect(
      page.getByRole("dialog").getByRole("list", { name: "Criteria not met" }),
      "the dialog counts the same saved ratings the panel does",
    ).toContainText("Skills 2/11 at minimum not met");
    await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();
  });

  test("all five exits ask before unsaved ratings are discarded @critical", async ({ page }) => {
    test.setTimeout(300_000);
    const session = await signIn(
      page,
      process.env.AUTH_EMULATOR_E2E_EMAIL!,
      process.env.AUTH_EMULATOR_E2E_PASSWORD!,
    );
    await page.setViewportSize({ width: 1440, height: 900 });
    const kid = members.kid!;

    async function makeDirty(): Promise<void> {
      const panel = page.getByRole("region", { name: "Skills assessment" });
      await panel.locator("details > summary").first().click();
      await panel
        .locator("fieldset", { hasText: "Tie The Belt" })
        .getByRole("radio", { name: "5" })
        .check();
      await expect(panel.getByText("You have unsaved ratings.")).toBeVisible();
    }

    // Exit 1: the "Back to record" anchor. Answer no, and the view stays.
    await openManage(page, kid.studentId);
    await makeDirty();
    session.setConfirmAnswer(false);
    await page.getByRole("link", { name: "Back to record" }).click();
    await expect(page).toHaveURL(/view=manage/u);
    expect(session.confirms.at(-1), "exit 1 asked").toBe("Discard unsaved ratings?");

    // Exit 2: a tab click.
    const beforeTab = session.confirms.length;
    await page.getByRole("tab", { name: "Payments" }).click();
    expect(session.confirms.at(-1), "exit 2 asked").toBe("Discard unsaved ratings?");
    expect(session.confirms.length).toBe(beforeTab + 1);
    await expect(page).toHaveURL(/view=manage/u);

    // Exit 4: an operator-initiated write whose reload would unmount the panel.
    const beforeAssign = session.confirms.length;
    const assign = page.getByRole("form", { name: "Assign next level" });
    await assign
      .getByLabel("Next level")
      .selectOption({ label: "White 4-5 and 5-7yo - 1st Stripe" });
    await assign.getByLabel("Promotion date").fill(jerseyDay(new Date()));
    await assign.getByRole("button", { name: "Review promotion" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel(/^Note/u).fill("Synthetic note for the exit check.");
    await dialog.getByRole("button", { name: "Confirm promotion" }).click();
    expect(session.confirms.at(-1), "exit 4 asked before the write").toBe(
      "Discard unsaved ratings?",
    );
    expect(session.confirms.length).toBe(beforeAssign + 1);
    expect(
      session.sent.filter((call) => call.name === "assignLevel"),
      "the refused confirmation sent nothing",
    ).toHaveLength(0);
    await dialog.getByRole("button", { name: "Cancel" }).click();

    /**
     * Exit 3: the browser's own Forward and Back. `history.forward()` / `history.back()` driven
     * from the page are the same same-document history moves the browser's buttons make, and they
     * fire the `popstate` the record listens on - which `page.goForward()` cannot be used for
     * here, because the record answers a refusal by pushing the current entry back and Playwright
     * then waits for a navigation that never completes.
     */
    session.setConfirmAnswer(true);
    await page.getByRole("tab", { name: "Payments" }).click();
    await expect(page).not.toHaveURL(/view=manage/u);
    await page.evaluate(() => window.history.back());
    await expect(page).toHaveURL(/view=manage/u);
    await expect(page.getByRole("heading", { name: "Level history" })).toBeVisible({
      timeout: 60_000,
    });
    await makeDirty();
    session.setConfirmAnswer(false);

    const beforeForward = session.confirms.length;
    await page.evaluate(() => window.history.forward());
    await page.waitForTimeout(750);
    expect(session.confirms.at(-1), "exit 3 (Forward) asked").toBe("Discard unsaved ratings?");
    expect(session.confirms.length).toBe(beforeForward + 1);
    await expect(page, "a refused Forward leaves the address on the view on screen").toHaveURL(
      /view=manage/u,
    );

    const beforeBack = session.confirms.length;
    await page.evaluate(() => window.history.back());
    await page.waitForTimeout(750);
    expect(session.confirms.at(-1), "exit 3 (Back) asked").toBe("Discard unsaved ratings?");
    expect(session.confirms.length).toBe(beforeBack + 1);
    await expect(page, "a refused Back leaves the address on the view on screen").toHaveURL(
      /view=manage/u,
    );

    // Exit 5: the back link (to Members, for the office), this time answered yes.
    const beforeLink = session.confirms.length;
    session.setConfirmAnswer(true);
    await page.getByRole("link", { name: "Back to members" }).click();
    expect(session.confirms.at(-1), "exit 5 asked").toBe("Discard unsaved ratings?");
    expect(session.confirms.length).toBe(beforeLink + 1);
    await expect(page).toHaveURL(/\/admin\/members\/?(?:\?|$)/u, { timeout: 30_000 });
    expect(session.errors, "no uncaught page errors").toEqual([]);
  });

  test("a coach may rate but never decide; an administrator may rate and graduate", async ({
    page,
  }) => {
    test.setTimeout(240_000);
    const password = process.env.MEMBER_PROFILE_E2E_PASSWORD!;
    const kid = members.kid!;

    await signIn(page, process.env.MEMBER_PROFILE_COACH_EMAIL!, password);
    await page.setViewportSize({ width: 1440, height: 900 });
    await openManage(page, kid.studentId);
    await expect(page.getByRole("region", { name: "Skills assessment" })).toBeVisible();
    await expect(page.getByRole("form", { name: "Assign next level" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Void" })).toHaveCount(0);
    await expect(
      page.getByText("Only an administrator or the owner can open, assign or void a level."),
    ).toBeVisible();
    await page.screenshot({ path: "screenshots/t051-ibjjf-manage-coach-desktop.png" });

    await page.context().clearCookies();
    await page.goto("/login");
    await page.evaluate(() => {
      window.localStorage.clear();
      window.sessionStorage.clear();
    });
    await page.reload();
    await page.getByLabel("Email address").fill(process.env.MEMBER_PROFILE_ADMINISTRATOR_EMAIL!);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(/\/account/u, { timeout: 30_000 });
    await openManage(page, kid.studentId);
    await expect(page.getByRole("region", { name: "Skills assessment" })).toBeVisible();
    await expect(page.getByRole("form", { name: "Assign next level" })).toBeVisible();
    await expect(page.getByRole("table", { name: "Level history" })).toBeVisible();
    await page.screenshot({ path: "screenshots/t051-ibjjf-manage-administrator-desktop.png" });
  });

  test("the record and the Manage view fit a 390px phone @critical", async ({ page }) => {
    test.setTimeout(300_000);
    await signIn(
      page,
      process.env.AUTH_EMULATOR_E2E_EMAIL!,
      process.env.AUTH_EMULATOR_E2E_PASSWORD!,
    );
    await page.setViewportSize({ width: 390, height: 844 });
    const adult = members.adult!;
    const kid = members.kid!;

    // The office searches from Members since 2026-09-19.
    await page.goto("/admin/members");
    await page.getByLabel("Member name").fill(adult.fullName);
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await expect(
      page.getByRole("link", { name: `Open record for ${adult.fullName}` }).first(),
    ).toBeVisible({ timeout: 60_000 });
    await expectNoHorizontalScroll(page, "member search at 390px");
    await auditAxe(page, "member search at 390px");
    await page.screenshot({ path: "screenshots/t051-member-search-phone.png", fullPage: true });

    await page.goto(recordUrl(adult.studentId));
    await expect(
      page.getByRole("region", { name: "JIU-JITSU IBJJF" }).getByRole("heading", {
        name: "WHITE BELT",
      }),
      "the voided promotion restored the white belt",
    ).toBeVisible({ timeout: 60_000 });
    await expectNoHorizontalScroll(page, "record PROFILE tab at 390px");
    await auditAxe(page, "record PROFILE tab at 390px");
    await page.screenshot({ path: "screenshots/t051-ibjjf-card-phone.png", fullPage: true });

    await page.getByRole("tab", { name: "Details" }).click();
    await expect(page.getByLabel("Nickname")).toBeVisible({ timeout: 60_000 });
    await expectNoHorizontalScroll(page, "record DETAILS tab at 390px");
    await auditAxe(page, "record DETAILS tab at 390px");
    await page.screenshot({ path: "screenshots/t051-record-details-phone.png", fullPage: true });

    await openManage(page, kid.studentId);
    await expectNoHorizontalScroll(page, "Manage view at 390px");
    await auditAxe(page, "Manage view at 390px");
    await page.screenshot({ path: "screenshots/t051-ibjjf-manage-phone.png", fullPage: true });

    const assign = page.getByRole("form", { name: "Assign next level" });
    await assign
      .getByLabel("Next level")
      .selectOption({ label: "White 4-5 and 5-7yo - 1st Stripe" });
    await assign.getByLabel("Promotion date").fill(jerseyDay(new Date()));
    await assign.getByRole("button", { name: "Review promotion" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading")).toBeVisible();
    await expectNoHorizontalScroll(page, "assign confirmation dialog at 390px");
    await auditAxe(page, "assign confirmation dialog at 390px");
    await page.screenshot({ path: "screenshots/t051-ibjjf-assign-dialog-phone.png" });
    await proveModalBehaviour(
      page,
      dialog,
      assign.getByRole("button", { name: "Review promotion" }),
      page.getByRole("link", { name: "Back to record" }),
    );
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
  });
});

/** The adult ladder's stripe names are stable in the shipped catalogue; this maps one to its key. */
function adultTargetKeyFor(name: string): string {
  return name === "White - 1st Stripe" ? "white-1st-stripe" : "white-2nd-stripe";
}
