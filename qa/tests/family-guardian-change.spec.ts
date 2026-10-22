import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";

import { expect, test, type Page, type Route, type TestInfo } from "@playwright/test";

import { installAdminFixture, type CallableCall } from "./admin-fixture";
import { blockExternalRequests } from "./network-guard";

/**
 * ee82a95: /admin/families changes one child's tutor at a time, with the evidence the office checked
 * and a reason, through the new changeChildGuardian callable. The whole-family «Replace tutor» and
 * the per-child «Deactivate link» are gone; «End link» exists only from 16. The row finds the child's
 * active link even when the server lists the ended one first. Synthetic callables on loopback only:
 * this proves the browser behaviour, not the server's transaction.
 */

const uuidV4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const stamp = "2026-10-01T10:00:00.000Z";
const refusal = "The guardian has changed. Refresh this review";

/** Today in Europe/Jersey (the page computes ages there), as YYYY-MM-DD. */
function jerseyToday(): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Jersey",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const part = (type: string) => Number(parts.find((item) => item.type === type)!.value);
  return { year: part("year"), month: part("month"), day: part("day") };
}

/** A date of birth that makes the child `years` old today and for the next two months. */
function bornYearsAgo(years: number): string {
  const today = jerseyToday();
  let month = today.month - 2;
  let year = today.year - years;
  if (month < 1) {
    month += 12;
    year -= 1;
  }
  const day = Math.min(today.day, 28);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function familyRecord(familyId: string, tutor: string) {
  return {
    familyId,
    academyId: "academy-synthetic",
    primaryContactUserId: tutor,
    billingContactUserId: tutor,
    active: true,
    status: "active",
    schemaVersion: "1",
    createdAt: stamp,
    createdBy: "admin-synthetic",
    updatedAt: stamp,
    updatedBy: "admin-synthetic",
  };
}

function student(familyId: string, studentId: string, fullName: string, dateOfBirth: string) {
  return {
    studentId,
    academyId: "academy-synthetic",
    familyId,
    fullName,
    dateOfBirth,
    trainingCenter: "Town",
    trainingTimePreferences: ["afternoon"],
    participantType: "minor",
    active: true,
    status: "active",
    schemaVersion: "1",
    createdAt: stamp,
    createdBy: "admin-synthetic",
    updatedAt: stamp,
    updatedBy: "admin-synthetic",
  };
}

function link(
  familyId: string,
  relationshipId: string,
  studentId: string,
  adultUserId: string,
  active = true,
) {
  return {
    relationshipId,
    academyId: "academy-synthetic",
    familyId,
    studentId,
    adultUserId,
    relationshipType: "guardian",
    permissions: ["readProfile"],
    validFrom: stamp,
    ...(active ? {} : { validTo: "2026-10-22T10:00:00.000Z" }),
    active,
    status: active ? "active" : "inactive",
    schemaVersion: "1",
    createdAt: stamp,
    createdBy: "admin-synthetic",
    updatedAt: stamp,
    updatedBy: "admin-synthetic",
  };
}

type Projection = {
  family: ReturnType<typeof familyRecord>;
  students: ReturnType<typeof student>[];
  relationships: ReturnType<typeof link>[];
};

/**
 * The staff projection exactly as the server's staffProjection() (family-service.ts) returns it:
 * five keys, with a 64-hex version per relationship and one adulthood entry per student.
 */
function serverShape(projection: Projection) {
  return {
    ...projection,
    relationshipVersions: Object.fromEntries(
      projection.relationships.map((item) => [
        item.relationshipId,
        createHash("sha256").update(JSON.stringify(item)).digest("hex"),
      ]),
    ),
    adulthood: projection.students.map((item) => ({
      studentId: item.studentId,
      eighteenthBirthday: `${Number(item.dateOfBirth.slice(0, 4)) + 18}${item.dateOfBirth.slice(4)}`,
      ownAccessPrepared: false,
      guardianAccessEnded: false,
    })),
  };
}

// Family A: two children under 16. Family B: one child of 16.
const ava = student("fam-a", "stu-ava", "Ava Under", bornYearsAgo(10));
const ben = student("fam-a", "stu-ben", "Ben Under", bornYearsAgo(12));
const cleo = student("fam-b", "stu-cleo", "Cleo Sixteen", bornYearsAgo(16));

const familyA = {
  family: familyRecord("fam-a", "tutor-old"),
  students: [ava, ben],
  relationships: [
    link("fam-a", "rel-ava-1", ava.studentId, "tutor-old"),
    link("fam-a", "rel-ben-1", ben.studentId, "tutor-old"),
  ],
};
// After Ava's change: her ended link comes FIRST, then her new link, then Ben's untouched one.
const familyAChanged = {
  ...familyA,
  relationships: [
    link("fam-a", "rel-ava-1", ava.studentId, "tutor-old", false),
    link("fam-a", "rel-ava-2", ava.studentId, "tutor-new"),
    link("fam-a", "rel-ben-1", ben.studentId, "tutor-old"),
  ],
};
const familyB = {
  family: familyRecord("fam-b", "tutor-cleo"),
  students: [cleo],
  relationships: [link("fam-b", "rel-cleo-1", cleo.studentId, "tutor-cleo")],
};
const familyBEnded = {
  ...familyB,
  relationships: [link("fam-b", "rel-cleo-1", cleo.studentId, "tutor-cleo", false)],
};
const families: Record<string, unknown> = {
  "fam-a": serverShape(familyA),
  "fam-b": serverShape(familyB),
};

type ChangeBody = { data: Record<string, unknown> };

function trackBrowserHealth(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    // The refusal below is an HTTP 400 on purpose; Chromium logs every failed resource.
    if (
      message.text().startsWith("Failed to load resource") &&
      message.location().url.endsWith("/changeChildGuardian")
    )
      return;
    errors.push(`console: ${message.text()}`);
  });
  page.on("pageerror", (error) => errors.push(`page: ${error.message}`));
  return errors;
}

async function openFamilies(page: Page, answer: (route: Route, body: ChangeBody) => Promise<void>) {
  const calls: CallableCall[] = [];
  const callables = {
    getFamily: (body: unknown) => families[(body as { data: { familyId: string } }).data.familyId],
    changeChildGuardian: null,
  };
  await installAdminFixture(page, { role: "owner", calls, callables });
  await page.route("**/changeChildGuardian", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    const body = route.request().postDataJSON() as ChangeBody;
    calls.push({ name: "changeChildGuardian", body });
    await answer(route, body);
  });
  const blocked = await blockExternalRequests(page, Object.keys(callables));
  await page.goto("/admin/families?adminTestRole=owner", { timeout: 120_000 });
  await expect(page.getByRole("heading", { name: "Family management" })).toBeVisible({
    timeout: 60_000,
  });
  return { calls, blocked };
}

async function loadFamily(page: Page, familyId: string) {
  await page.getByLabel("Family ID").fill(familyId);
  await page.getByRole("button", { name: "Load family" }).click();
  await expect(page.getByRole("heading", { name: "Family workspace" })).toBeVisible();
}

const rowOf = (page: Page, fullName: string) =>
  page.locator("article.family-relationship-row").filter({
    has: page.getByRole("heading", { name: fullName, exact: true }),
  });

async function evidence(page: Page, testInfo: TestInfo, name: string) {
  const width = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  expect(width.scroll, "no horizontal page scroll").toBeLessThanOrEqual(width.client);
  await page.screenshot({
    path: testInfo.outputPath(`${name}-${testInfo.project.name}.png`),
    fullPage: true,
    style: ".skip-link { display: none !important; }",
  });
}

async function noneBlocked(testInfo: TestInfo, blocked: readonly string[], errors: string[]) {
  writeFileSync(testInfo.outputPath("blocked-requests.json"), JSON.stringify(blocked, null, 2));
  expect(blocked).toEqual([]);
  expect(errors).toEqual([]);
}

const json = (route: Route, status: number, body: unknown) =>
  route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

test.describe("Per-child tutor change on /admin/families (ee82a95)", () => {
  test.skip(process.env.NEXT_PUBLIC_ADMIN_E2E !== "true", "needs the admin E2E build");
  test.setTimeout(180_000);

  test("under 16: no whole-family replace, no End link; one child's tutor changes with evidence", async ({
    page,
  }, testInfo) => {
    const errors = trackBrowserHealth(page);
    let changes = 0;
    const h = await openFamilies(page, async (route) => {
      changes += 1;
      if (changes === 1) return json(route, 200, { data: serverShape(familyAChanged) });
      return json(route, 400, { error: { status: "FAILED_PRECONDITION", message: refusal } });
    });
    await loadFamily(page, "fam-a");

    // The two retired buttons are gone; under 16 a link can only be changed.
    await expect(page.getByRole("button", { name: /Replace tutor/u })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Deactivate link/u })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /End link|End the tutor link/u })).toHaveCount(0);
    for (const child of [ava, ben]) {
      const row = rowOf(page, child.fullName);
      await expect(row.getByText("Tutor linked")).toBeVisible();
      await expect(
        row.getByText("A tutor is required until 16: change the tutor instead of ending the link."),
      ).toBeVisible();
      await expect(
        row.getByRole("button", { name: `Change tutor for ${child.fullName}` }),
      ).toBeVisible();
    }

    await page.getByRole("button", { name: `Change tutor for ${ava.fullName}` }).click();
    const form = page.getByRole("form", { name: `Tutor for ${ava.fullName}` });
    await expect(form).toBeVisible();
    await form.getByLabel("New tutor user ID").fill("tutor-new");
    await form.getByLabel("Evidence checked").fill("Court order seen at the desk");
    await form.getByLabel("Reason").fill("Mother takes over the account");
    await evidence(page, testInfo, "change-form-open");
    await form.getByRole("button", { name: "Save tutor" }).click();

    await expect(page.getByRole("status")).toHaveText("Tutor changed.");
    await expect(page.getByRole("form", { name: `Tutor for ${ava.fullName}` })).toHaveCount(0);
    const sent = h.calls.filter((call) => call.name === "changeChildGuardian");
    expect(sent).toHaveLength(1);
    expect(sent[0]!.body).toEqual({
      data: {
        familyId: "fam-a",
        requestId: expect.stringMatching(uuidV4),
        studentId: ava.studentId,
        expectedRelationshipId: "rel-ava-1",
        proposedGuardianUserId: "tutor-new",
        evidence: "Court order seen at the desk",
        reason: "Mother takes over the account",
      },
    });
    writeFileSync(
      testInfo.outputPath("change-request.json"),
      JSON.stringify(sent[0]!.body, null, 2),
    );
    // Ava's ended link is listed first; her row still finds the new active one. Ben is untouched.
    for (const child of [ava, ben]) {
      await expect(rowOf(page, child.fullName).getByText("Tutor linked")).toBeVisible();
      await expect(rowOf(page, child.fullName).getByText("Link inactive")).toHaveCount(0);
    }
    await evidence(page, testInfo, "tutor-changed");

    // A stale view: the server's refusal is shown as written, and nothing changes on screen.
    await page.getByRole("button", { name: `Change tutor for ${ben.fullName}` }).click();
    const benForm = page.getByRole("form", { name: `Tutor for ${ben.fullName}` });
    await benForm.getByLabel("New tutor user ID").fill("tutor-other");
    await benForm.getByLabel("Evidence checked").fill("Signed letter");
    await benForm.getByLabel("Reason").fill("Father moves abroad");
    await benForm.getByRole("button", { name: "Save tutor" }).click();
    // (The page's own alert, not Next's empty route announcer.)
    await expect(page.getByRole("alert").and(page.locator(".family-message-error"))).toHaveText(
      refusal,
    );
    await expect(benForm).toBeVisible();
    await expect(rowOf(page, ben.fullName).getByText("Tutor linked")).toBeVisible();
    const second = h.calls.filter((call) => call.name === "changeChildGuardian")[1]!;
    expect((second.body as ChangeBody).data).toMatchObject({
      studentId: ben.studentId,
      expectedRelationshipId: "rel-ben-1",
      proposedGuardianUserId: "tutor-other",
    });
    await evidence(page, testInfo, "refusal-shown");
    await noneBlocked(testInfo, h.blocked, errors);
  });

  test("from 16: End link sends no new tutor, then the row offers to link one", async ({
    page,
  }, testInfo) => {
    const errors = trackBrowserHealth(page);
    const h = await openFamilies(page, (route) =>
      json(route, 200, { data: serverShape(familyBEnded) }),
    );
    await loadFamily(page, "fam-b");

    const row = rowOf(page, cleo.fullName);
    await expect(row.getByText("Tutor linked")).toBeVisible();
    await expect(row.getByText(/A tutor is required until 16/u)).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Replace tutor/u })).toHaveCount(0);
    const end = row.getByRole("button", { name: `End the tutor link for ${cleo.fullName}` });
    await expect(end).toHaveText("End link");
    await end.click();

    const form = page.getByRole("form", { name: `Tutor for ${cleo.fullName}` });
    await expect(form).toBeVisible();
    await expect(form.getByLabel("New tutor user ID")).toHaveCount(0);
    await form.getByLabel("Evidence checked").fill("Cleo asked in person, ID checked");
    await form.getByLabel("Reason").fill("Manages her own account now");
    await evidence(page, testInfo, "end-form-open");
    await form.getByRole("button", { name: "End link" }).click();

    await expect(page.getByRole("status")).toHaveText("Tutor link ended.");
    const sent = h.calls.filter((call) => call.name === "changeChildGuardian");
    expect(sent).toHaveLength(1);
    expect(sent[0]!.body).toEqual({
      data: {
        familyId: "fam-b",
        requestId: expect.stringMatching(uuidV4),
        studentId: cleo.studentId,
        expectedRelationshipId: "rel-cleo-1",
        proposedGuardianUserId: null,
        evidence: "Cleo asked in person, ID checked",
        reason: "Manages her own account now",
      },
    });
    await expect(row.getByText("Link inactive")).toBeVisible();
    await expect(
      row.getByRole("button", { name: `Link a tutor for ${cleo.fullName}` }),
    ).toBeVisible();
    await expect(row.getByRole("button", { name: /End the tutor link/u })).toHaveCount(0);
    await evidence(page, testInfo, "link-ended");
    await noneBlocked(testInfo, h.blocked, errors);
  });
});
