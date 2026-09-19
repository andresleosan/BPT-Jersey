import { expect, test } from "@playwright/test";

import { installAdminFixture, type CallableCall } from "./admin-fixture";

const town = {
  locationId: "town",
  academyId: "synthetic-academy",
  name: "Synthetic Town",
  address: "",
  timezone: "Europe/Jersey",
  active: true,
  abbreviation: "TOWN",
  kind: "presential",
  schemaVersion: "1",
};

test("location patterns validate and geofence submits only its own callable", async ({
  page,
}, testInfo) => {
  const calls: CallableCall[] = [];
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await installAdminFixture(page, {
    calls,
    callables: {
      listScheduleCatalog: { locations: [town], programs: [] },
      listSessions: { sessions: [] },
      saveLocationGeofence: (body: unknown) => ({
        location: { ...town, ...(body as { data: object }).data },
      }),
      updateLocation: (body: unknown) => ({
        location: { ...town, ...(body as { data: object }).data },
      }),
    },
  });
  // Only loopback requests may leave this browser; callable responses are synthetic.
  await page.route("**/*", (route) => {
    const hostname = new URL(route.request().url()).hostname;
    return ["127.0.0.1", "localhost"].includes(hostname) ? route.fallback() : route.abort();
  });
  await page.goto("/admin/classes-services/locations?adminTestRole=owner");
  await expect(page.getByText(town.name, { exact: true })).toBeVisible();
  const abbreviation = page.getByLabel("Abbreviation", { exact: true });
  await abbreviation.fill("T!");
  await expect
    .poll(() => abbreviation.evaluate((input: HTMLInputElement) => input.validity.patternMismatch))
    .toBe(true);
  await abbreviation.fill("T_-");
  await expect
    .poll(() => abbreviation.evaluate((input: HTMLInputElement) => input.validity.patternMismatch))
    .toBe(false);

  const edit = page.getByRole("button", { name: "Edit", exact: true });
  await edit.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog");
  const editAbbreviation = dialog.getByLabel("Abbreviation", { exact: true });
  await editAbbreviation.fill("T!");
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(editAbbreviation).toBeFocused();
  expect(calls.filter((call) => call.name === "updateLocation")).toHaveLength(0);

  await dialog.getByLabel("Latitude", { exact: true }).fill("49.183998");
  await page.keyboard.press("Tab");
  await expect(dialog.getByLabel("Longitude", { exact: true })).toBeFocused();
  await dialog.getByLabel("Longitude", { exact: true }).fill("-2.107137");
  await page.keyboard.press("Tab");
  await expect(dialog.getByRole("button", { name: "Save coordinates", exact: true })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(dialog.getByRole("status")).toContainText("coordinates saved");
  expect(
    calls.filter((call) => call.name === "saveLocationGeofence").map((call) => call.body),
  ).toEqual([
    { data: { locationId: "town", geofence: { latitude: 49.183998, longitude: -2.107137 } } },
  ]);
  expect(calls.filter((call) => call.name === "updateLocation")).toHaveLength(0);
  await expect(dialog.getByRole("button", { name: "Clear coordinates" })).toBeEnabled();

  await dialog.getByLabel("Latitude", { exact: true }).fill("91");
  await dialog.getByRole("button", { name: "Save coordinates", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("Enter the site latitude");
  await page.screenshot({ path: testInfo.outputPath("location-dialog.png") });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.keyboard.press("Escape");
  await expect(edit).toBeFocused();
  expect(errors).toEqual([]);
});

test("locations show loading and catalog errors without overflow", async ({ page }, testInfo) => {
  await installAdminFixture(page);
  let release!: () => void;
  const ready = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (!["127.0.0.1", "localhost"].includes(url.hostname)) return route.abort();
    if (url.pathname.endsWith("/listScheduleCatalog")) {
      await ready;
      return route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({
          error: { status: "INVALID_ARGUMENT", message: "Synthetic failure" },
        }),
      });
    }
    return route.fallback();
  });
  await page.goto("/admin/classes-services/locations?adminTestRole=owner");
  await expect(page.getByText("Loading sites...", { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("locations-loading.png") });
  release();
  await expect(page.getByRole("alert").filter({ hasText: "Unable to load sites." })).toHaveText(
    "Unable to load sites. Refresh and try again.",
  );
  await page.screenshot({ path: testInfo.outputPath("locations-error.png") });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});
