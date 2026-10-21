import { expect, test, type Page, type Route, type TestInfo } from "@playwright/test";

import { introductionClassAudienceError } from "@bpt-jersey/domain/schedule/classes-services";

import { installAdminFixture, type CallableCall } from "./admin-fixture";
import { blockExternalRequests } from "./network-guard";

/**
 * 2026-10-20 diagnosis, item 3. Whether a class is an Introduction Class came from its type's NAME
 * (or a legacy session flag), so a rename silently changed who could book, and the session editor
 * said "Membership required" for one. Types now carry an explicit marker, set in the Types editor,
 * and the session editor names it in create and edit alike. Real pages, synthetic callables only:
 * browser UI coverage with a mocked backend (the server's pin-on-save and refusal are unit-tested).
 */
const marker = "Introduction Class: free trial class for adult beginners";
const location = {
  locationId: "town",
  academyId: "bpt-jersey",
  name: "BPT Town",
  address: "St Helier",
  timezone: "Europe/Jersey",
  active: true,
  abbreviation: "town",
  kind: "presential",
  schemaVersion: "1",
};
const type = (programId: string, name: string, extra: Record<string, unknown> = {}) => ({
  programId,
  academyId: "bpt-jersey",
  name,
  ageBand: "adult",
  discipline: "bjj",
  level: "fundamentals",
  active: true,
  schemaVersion: "1",
  abbreviation: programId.toUpperCase().replace(/-/gu, "_").slice(0, 12),
  ...extra,
});
// Saved before the marker existed: only its name makes it an Introduction Class.
const legacyIntro = type("p-int", "Introduction Class Saturdays");
const gi = type("p-gi", "GI All Levels");
const marked = type("p-beg", "Weekend Beginners", { introductionClass: true });

const named = (calls: CallableCall[], name: string) =>
  calls
    .filter((call) => call.name === name)
    .map((call) => (call.body as { data: Record<string, unknown> }).data);

async function json(route: Route, status: number, body: unknown): Promise<void> {
  await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

async function evidence(page: Page, testInfo: TestInfo, name: string, blocked: string[]) {
  await page.screenshot({
    path: testInfo.outputPath(`${name}-${testInfo.project.name}.png`),
    fullPage: true,
  });
  await testInfo.attach(`${name}-blocked-requests`, {
    body: JSON.stringify(blocked, null, 2),
    contentType: "application/json",
  });
}

/** The Types page with a stateful synthetic saveProgram/updateProgram. */
async function openTypes(page: Page, refuseFirstCreate = false) {
  const calls: CallableCall[] = [];
  let stored: Record<string, unknown> = { ...legacyIntro };
  let creates = 0;
  const callables = {
    listScheduleCatalog: { locations: [location], programs: [legacyIntro] },
    // Mirrors the server's pin-on-save: an absent marker keeps what the type already had.
    updateProgram: (body: unknown) => {
      const data = (body as { data: Record<string, unknown> }).data;
      stored = {
        ...stored,
        ...data,
        introductionClass:
          "introductionClass" in data ? data.introductionClass : (stored.introductionClass ?? true),
      };
      return { program: stored };
    },
    saveProgram: null,
  };
  await installAdminFixture(page, { calls, callables });
  await page.route("**/saveProgram", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    const body = route.request().postDataJSON() as { data: Record<string, unknown> };
    calls.push({ name: "saveProgram", body });
    creates += 1;
    if (refuseFirstCreate && creates === 1) {
      return json(route, 400, {
        error: {
          status: "FAILED_PRECONDITION",
          message: introductionClassAudienceError,
          details: { reason: "introduction-class-audience" },
        },
      });
    }
    return json(route, 200, {
      data: { program: type("p-new", String(body.data.name), body.data) },
    });
  });
  const blocked = await blockExternalRequests(page, Object.keys(callables));
  await page.goto("/admin/classes-services/types?adminTestRole=owner", { timeout: 120_000 });
  await expect(page.getByRole("heading", { name: "Introduction Class Saturdays" })).toBeVisible({
    timeout: 60_000,
  });
  return { calls, blocked };
}

test.describe("Introduction Class marker (2026-10-20 item 3)", () => {
  test.skip(process.env.NEXT_PUBLIC_ADMIN_E2E !== "true", "needs the admin E2E build");
  test.setTimeout(180_000);

  test("creates a marked type after a refusal, once, on a double-clicked submit", async ({
    page,
  }, testInfo) => {
    const h = await openTypes(page, true);
    const create = page.getByRole("region", { name: "Create a class type" });
    await create.getByLabel("Name", { exact: true }).fill("Saturday Beginners");
    await create.getByLabel("Abbreviation", { exact: true }).fill("SAT_BEG");
    await create.getByRole("checkbox", { name: marker }).check();

    // Error: the server's audience refusal reaches the office as its own words.
    await create.getByRole("button", { name: "Create type" }).click();
    // Scoped to the page's notice: Next's route announcer is an alert too.
    const refusal = page.getByRole("alert").filter({ hasText: introductionClassAudienceError });
    await expect(refusal).toHaveText(introductionClassAudienceError);
    await expect(create.getByLabel("Name", { exact: true })).toHaveValue("Saturday Beginners");
    await evidence(page, testInfo, "types-refusal", h.blocked);

    // Repeated submission: the form locks while saving, so a double click creates one type.
    await create.getByRole("button", { name: "Create type" }).dblclick();
    await expect(page.getByRole("status").filter({ hasText: "Class type created." })).toBeVisible();
    const row = page.getByRole("listitem").filter({ hasText: "Saturday Beginners" });
    await expect(row).toContainText("Introduction Class");
    const saved = named(h.calls, "saveProgram");
    expect(saved).toHaveLength(2);
    for (const data of saved) expect(data).toMatchObject({ introductionClass: true });
    await evidence(page, testInfo, "types-created", h.blocked);
  });

  test("edits a legacy type: cancel sends nothing, a rename keeps it, unticking clears it", async ({
    page,
  }, testInfo) => {
    const h = await openTypes(page);
    const editor = (name: string) => page.getByRole("group", { name: `Edit ${name}` });

    await page.getByRole("button", { name: "Edit Introduction Class Saturdays" }).click();
    const legacy = editor("Introduction Class Saturdays");
    await expect(legacy.getByRole("checkbox", { name: marker })).toBeChecked();
    await legacy.getByRole("checkbox", { name: marker }).uncheck();
    await legacy.getByRole("button", { name: "Cancel" }).click();
    expect(named(h.calls, "updateProgram")).toEqual([]);

    await page.getByRole("button", { name: "Edit Introduction Class Saturdays" }).click();
    await legacy.getByLabel("Name", { exact: true }).fill("Saturday Beginners");
    await legacy.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Class type updated." })).toBeVisible();
    expect(named(h.calls, "updateProgram")[0]).not.toHaveProperty("introductionClass");
    const row = page.getByRole("listitem").filter({ hasText: "Saturday Beginners" });
    await expect(row).toContainText("Introduction Class");
    await evidence(page, testInfo, "types-renamed", h.blocked);

    await page.getByRole("button", { name: "Edit Saturday Beginners" }).click();
    await editor("Saturday Beginners").getByRole("checkbox", { name: marker }).uncheck();
    await editor("Saturday Beginners").getByRole("button", { name: "Save changes" }).click();
    await expect(row.getByText("Introduction Class", { exact: true })).toHaveCount(0);
    expect(named(h.calls, "updateProgram")[1]).toMatchObject({ introductionClass: false });
    await evidence(page, testInfo, "types-unmarked", h.blocked);
  });

  test("a legacy kids Introduction Class: an unrelated edit saves, a new age range needs the marker off", async ({
    page,
  }, testInfo) => {
    // Saved before the marker and the v2 fields: its name makes it an Introduction Class, and its
    // kids band means it can never admit every adult beginner.
    const legacyKids = {
      programId: "p-kids",
      academyId: "bpt-jersey",
      name: "Introduction Class Kids",
      ageBand: "kids",
      discipline: "bjj",
      level: "fundamentals",
      active: true,
      schemaVersion: "1",
    };
    const calls: CallableCall[] = [];
    let stored: Record<string, unknown> = { ...legacyKids };
    const callables = {
      listScheduleCatalog: { locations: [location], programs: [legacyKids] },
      updateProgram: null,
    };
    await installAdminFixture(page, { calls, callables });
    // Mirrors the server for this type: while it stays an Introduction Class a different age range
    // is refused; any other save pins the marker. The server side is unit-tested with this payload.
    await page.route("**/updateProgram", async (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      const body = route.request().postDataJSON() as { data: Record<string, unknown> };
      calls.push({ name: "updateProgram", body });
      const marked = body.data.introductionClass ?? stored.introductionClass ?? true;
      const newAges =
        JSON.stringify(body.data.ageRange ?? null) !== JSON.stringify(stored.ageRange ?? null);
      if (marked === true && newAges) {
        return json(route, 400, {
          error: {
            status: "FAILED_PRECONDITION",
            message: introductionClassAudienceError,
            details: { reason: "introduction-class-audience" },
          },
        });
      }
      stored = { ...stored, ...body.data, introductionClass: marked };
      return json(route, 200, { data: { program: stored } });
    });
    const blocked = await blockExternalRequests(page, Object.keys(callables));
    await page.goto("/admin/classes-services/types?adminTestRole=owner", { timeout: 120_000 });
    await expect(page.getByRole("heading", { name: "Introduction Class Kids" })).toBeVisible({
      timeout: 60_000,
    });
    const editor = page.getByRole("group", { name: "Edit Introduction Class Kids" });
    const saved = page.getByRole("status").filter({ hasText: "Class type updated." });

    // An unrelated edit: the editor resends every field, the unchanged age range included.
    await page.getByRole("button", { name: "Edit Introduction Class Kids" }).click();
    await expect(editor.getByRole("checkbox", { name: marker })).toBeChecked();
    await editor.getByLabel("Message shown when booking").fill("Bring a water bottle.");
    await editor.getByRole("button", { name: "Save changes" }).click();
    await expect(saved).toBeVisible();
    const [unrelated] = named(calls, "updateProgram");
    expect(unrelated).toMatchObject({ message: "Bring a water bottle.", ageRange: null });
    expect(unrelated).not.toHaveProperty("introductionClass");
    await evidence(page, testInfo, "types-legacy-kids-unrelated-edit", blocked);

    // A new age range while it stays an Introduction Class: refused, the form kept to correct.
    await page.getByRole("button", { name: "Edit Introduction Class Kids" }).click();
    await editor.getByLabel("From age").selectOption("4");
    await editor.getByLabel("To age").selectOption("12");
    await editor.getByRole("button", { name: "Save changes" }).click();
    const refusal = page.getByRole("alert").filter({ hasText: introductionClassAudienceError });
    await expect(refusal).toHaveText(introductionClassAudienceError);
    await expect(editor.getByLabel("From age")).toHaveValue("4");
    await evidence(page, testInfo, "types-legacy-kids-refused", blocked);

    // With the marker off the same ages save, and the type stops being an Introduction Class.
    await editor.getByRole("checkbox", { name: marker }).uncheck();
    await editor.getByRole("button", { name: "Save changes" }).click();
    await expect(saved).toBeVisible();
    const row = page.getByRole("listitem").filter({ hasText: "Introduction Class Kids" });
    await expect(row.getByText("Introduction Class", { exact: true })).toHaveCount(0);
    expect(named(calls, "updateProgram").slice(1)).toEqual([
      expect.objectContaining({ ageRange: { minAge: 4, maxAge: 12 } }),
      expect.objectContaining({ ageRange: { minAge: 4, maxAge: 12 }, introductionClass: false }),
    ]);
    expect(named(calls, "updateProgram")[1]).not.toHaveProperty("introductionClass");
    await evidence(page, testInfo, "types-legacy-kids-unmarked", blocked);
  });

  test("the session editor names the type's Introduction Class and keeps a legacy option", async ({
    page,
  }, testInfo) => {
    const calls: CallableCall[] = [];
    const legacySession = {
      sessionId: "s-legacy",
      academyId: "bpt-jersey",
      classId: null,
      programId: "p-gi",
      locationId: "town",
      instructorId: "staff-synthetic-1",
      instructorIds: ["staff-synthetic-1"],
      title: "GI All Levels",
      startAt: "2026-10-21T18:00:00.000Z",
      endAt: "2026-10-21T19:00:00.000Z",
      capacity: 20,
      minParticipants: 1,
      status: "scheduled",
      isSeminar: false,
      cancellationReason: null,
      accessMode: "intro",
      schemaVersion: "1",
      createdAt: "2026-10-01T00:00:00.000Z",
      createdBy: "staff-synthetic-1",
      updatedAt: "2026-10-01T00:00:00.000Z",
      updatedBy: "staff-synthetic-1",
      bookingRules: "defined",
      waitingList: "general",
    };
    const callables = {
      listScheduleCatalog: { locations: [location], programs: [gi, marked] },
      listSessions: { sessions: [legacySession] },
      listSessionBookedCounts: { counts: { "s-legacy": 0 } },
      listStaffProfiles: [
        {
          staffKey: "staff-synthetic-1",
          role: "coach",
          active: true,
          status: "active",
          self: false,
          schemaVersion: "1",
        },
      ],
      saveSession: { session: legacySession },
      updateSession: { session: legacySession },
    };
    await installAdminFixture(page, { calls, callables });
    const blocked = await blockExternalRequests(page, Object.keys(callables));
    await page.clock.setFixedTime(new Date("2026-10-21T10:00:00Z"));
    await page.goto("/admin/classes-services/classes?adminTestRole=owner", { timeout: 120_000 });

    // Edit: a legacy intro session keeps its option after switching away; closing saves nothing.
    await page
      .getByRole("button", { name: /GI All Levels/ })
      .first()
      .click({ timeout: 60_000 });
    const edit = page.getByRole("dialog", { name: "Edit session" });
    const editAccess = edit.getByLabel("Class access");
    await expect(editAccess).toHaveValue("intro");
    await editAccess.selectOption("membership");
    await expect(editAccess.locator("option", { hasText: "Free Intro Class" })).toHaveCount(1);
    await editAccess.selectOption("intro");
    await evidence(page, testInfo, "session-legacy-intro", blocked);
    await edit.getByRole("button", { name: "Close session" }).click();
    await expect(edit).toBeHidden();

    // Create: choosing the marked type names it, in the same words the edit view would use.
    await page.getByRole("tablist", { name: "View" }).getByRole("tab", { name: "List" }).click();
    await page.getByRole("button", { name: "Add a class" }).click();
    const create = page.getByRole("dialog", { name: "Create session" });
    const createAccess = create.getByLabel("Class access");
    await expect(createAccess.locator("option", { hasText: "Membership required" })).toHaveCount(1);
    await create.getByLabel("Class/service type").selectOption("p-beg");
    await expect(
      createAccess.locator("option", { hasText: "Introduction Class (set by the class type)" }),
    ).toHaveCount(1);
    await expect(
      create.getByText("Free trial class for adult beginners (16 and over)"),
    ).toBeVisible();
    await evidence(page, testInfo, "session-create-marked-type", blocked);
    await create.getByRole("button", { name: "Close session" }).click();
    await expect(create).toBeHidden();

    expect(named(calls, "saveSession")).toEqual([]);
    expect(named(calls, "updateSession")).toEqual([]);
  });
});
