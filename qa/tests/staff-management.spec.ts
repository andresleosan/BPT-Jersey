import { expect, test, type Page } from "@playwright/test";

type StaffRole = "headCoach" | "coach";

type StaffProfile = {
  staffKey: string;
  role: StaffRole;
  active: boolean;
  status: "active" | "inactive";
  self: boolean;
  schemaVersion: "1";
};

const initialProfile: StaffProfile = {
  staffKey: "staff-synthetic-1",
  role: "coach",
  active: true,
  status: "active",
  self: false,
  schemaVersion: "1",
};

const secondInitialProfile: StaffProfile = {
  staffKey: "staff-synthetic-2",
  role: "coach",
  active: true,
  status: "active",
  self: false,
  schemaVersion: "1",
};

function trackBrowserHealth(page: Page, directDataRequests: string[]): string[] {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });
  page.on("pageerror", (error) => errors.push(`page: ${error.message}`));
  page.on("request", (request) => {
    if (
      /firestore\.googleapis\.com|firebaseio\.com|firebasedatabase\.app|google\.firestore\.v1\.Firestore|:(?:8080|9000)\//iu.test(
        request.url(),
      )
    ) {
      directDataRequests.push(request.url());
    }
  });
  return errors;
}

async function expectNoBrowserHealthProblems(
  page: Page,
  errors: string[],
  directDataRequests: string[],
): Promise<void> {
  expect(errors).toEqual([]);
  expect(directDataRequests).toEqual([]);
  const dimensions = await page.evaluate(() => ({
    bodyClientWidth: document.body.clientWidth,
    bodyWidth: document.body.scrollWidth,
    documentClientWidth: document.documentElement.clientWidth,
    documentWidth: document.documentElement.scrollWidth,
  }));
  expect(dimensions.documentWidth).toBeLessThanOrEqual(dimensions.documentClientWidth);
  expect(dimensions.bodyWidth).toBeLessThanOrEqual(dimensions.bodyClientWidth);
}

async function installStaffHarness(
  page: Page,
  options: { failList?: boolean } = {},
): Promise<void> {
  let profiles: StaffProfile[] = [{ ...initialProfile }, { ...secondInitialProfile }];
  await page.route("**/*", async (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") {
      await route.fulfill({
        status: 204,
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-headers": "*",
          "access-control-allow-methods": "POST, OPTIONS",
        },
      });
      return;
    }
    if (request.method() !== "POST") {
      await route.continue();
      return;
    }

    const respond = async (data: unknown): Promise<void> => {
      await route.fulfill({
        body: JSON.stringify({ data }),
        contentType: "application/json",
        status: 200,
      });
    };

    const respondNotFound = async (): Promise<void> => {
      await route.fulfill({
        body: JSON.stringify({
          error: { status: "NOT_FOUND", message: "Synthetic staff key not found" },
        }),
        contentType: "application/json",
        status: 404,
      });
    };

    if (request.url().includes("listTeamDirectory")) {
      await respond({ people: [], nextPageToken: null });
      return;
    }
    if (
      request.url().includes("listStaffInvitations") ||
      request.url().includes("listStaffPermissionGrants")
    ) {
      await respond([]);
      return;
    }
    if (request.url().includes("listStaffProfiles")) {
      if (options.failList) {
        await route.fulfill({
          body: JSON.stringify({
            error: { status: "INTERNAL", message: "private backend details" },
          }),
          contentType: "application/json",
          status: 200,
        });
        return;
      }
      await respond(profiles);
      return;
    }

    if (request.url().includes("createStaffWithPassword")) {
      await respond({
        userId: "staff-direct-1",
        email: "direct.coach@example.test",
        role: "coach",
        passwordChangeRequired: true,
      });
      return;
    }

    if (request.url().includes("createStaffProfile")) {
      const created: StaffProfile = {
        staffKey: "staff-synthetic-3",
        role: "coach",
        active: true,
        status: "active",
        self: false,
        schemaVersion: "1",
      };
      profiles = [...profiles, created];
      await respond(created);
      return;
    }

    if (request.url().includes("updateStaffProfile")) {
      const payload = request.postDataJSON() as { data?: { role?: StaffRole; staffKey?: string } };
      const role = payload.data?.role ?? "coach";
      const staffKey = payload.data?.staffKey ?? "";
      const profile = profiles.find((candidate) => candidate.staffKey === staffKey);
      if (!profile) {
        await respondNotFound();
        return;
      }
      const updated = { ...profile, role };
      profiles = profiles.map((candidate) =>
        candidate.staffKey === updated.staffKey ? updated : candidate,
      );
      await respond(updated);
      return;
    }

    if (request.url().includes("setStaffActive")) {
      const payload = request.postDataJSON() as {
        data?: { active?: boolean; staffKey?: string };
      };
      const active = payload.data?.active ?? true;
      const status: StaffProfile["status"] = active ? "active" : "inactive";
      const staffKey = payload.data?.staffKey ?? "";
      const profile = profiles.find((candidate) => candidate.staffKey === staffKey);
      if (!profile) {
        await respondNotFound();
        return;
      }
      const updated = { ...profile, active, status };
      profiles = profiles.map((candidate) =>
        candidate.staffKey === updated.staffKey ? updated : candidate,
      );
      await respond(updated);
      return;
    }

    if (
      request.url().includes("replaceStaffAvailability") ||
      request.url().includes("replaceStaffAssignments")
    ) {
      await respond([]);
      return;
    }

    await route.continue();
  });
}

test.describe("staff management", () => {
  for (const role of ["owner", "administrator"] as const) {
    test(`allows ${role} to view the staff workspace`, async ({ page }, testInfo) => {
      const directDataRequests: string[] = [];
      const errors = trackBrowserHealth(page, directDataRequests);
      await installStaffHarness(page);
      await page.goto(`/admin/staff?adminTestRole=${role}`);

      await expect(page.getByRole("heading", { name: "Staff management" })).toBeVisible();
      const staffLink =
        testInfo.project.name === "mobile-chromium"
          ? (await page.getByRole("button", { name: "Open admin navigation" }).click(),
            page.getByRole("dialog", { name: "Admin navigation" }).getByRole("link", {
              name: "Staff",
              exact: true,
            }))
          : page.getByRole("link", { name: "Staff", exact: true });
      await expect(staffLink).toHaveAttribute("href", "/admin/staff");
      await expect(page.getByRole("table", { name: "Staff profiles" })).toBeVisible();
      await expect(page.getByText("staff-synthetic-1")).toBeVisible();
      await expectNoBrowserHealthProblems(page, errors, directDataRequests);
    });
  }

  test("denies a non-administrator without rendering the staff workspace", async ({ page }) => {
    const directDataRequests: string[] = [];
    const errors = trackBrowserHealth(page, directDataRequests);
    await installStaffHarness(page);
    await page.goto("/admin/staff?adminTestRole=coach");

    await expect(
      page.getByRole("heading", { name: "Administrative access not authorized" }),
    ).toBeVisible();
    await expect(page.getByTestId("admin-shell")).toHaveCount(0);
    await expect(page.getByRole("table", { name: "Staff profiles" })).toHaveCount(0);
    await expectNoBrowserHealthProblems(page, errors, directDataRequests);
  });

  test("runs create, status, availability, and assignment flows with keyboard focus", async ({
    page,
  }) => {
    const directDataRequests: string[] = [];
    const errors = trackBrowserHealth(page, directDataRequests);
    await installStaffHarness(page);
    await page.goto("/admin/staff?adminTestRole=owner");

    const rowAction = page.getByRole("button", { name: "Select staff staff-synthetic-1" });
    await rowAction.click();
    await expect(
      page.getByRole("button", { name: "Select staff staff-synthetic-1" }),
    ).toBeFocused();

    await page.getByRole("button", { name: "Deactivate staff profile" }).click();
    await expect(page.getByText("Inactive")).toBeVisible();
    await expect(
      page.getByRole("row", { name: /staff-synthetic-2.*Coach.*Active/i }),
    ).toBeVisible();

    await page.getByLabel("Weekday").selectOption("1");
    await page.getByLabel("Start local time").fill("17:00");
    await page.getByLabel("End local time").fill("19:00");
    await page.getByLabel("IANA timezone").fill("Europe/London");
    await page.getByRole("button", { name: "Replace availability" }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "Staff availability replaced." }),
    ).toHaveText("Staff availability replaced.");

    await page.getByLabel("Target ID").fill("location-synthetic");
    await page.getByRole("button", { name: "Replace assignment" }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "Staff assignment replaced." }),
    ).toHaveText("Staff assignment replaced.");

    await page.getByLabel("Full name", { exact: true }).fill("Direct Coach");
    await page.getByLabel("Direct staff email").fill("direct.coach@example.test");
    await page.getByLabel("Initial password").fill("A-test-only-phrase-2026");
    await page.getByLabel("Direct staff role").selectOption("coach");
    await page.getByRole("button", { name: "Create staff account" }).click();
    await expect(
      page
        .getByRole("status")
        .filter({ hasText: "must change the initial password or link Google" }),
    ).toBeVisible();

    const fullName = page.getByLabel("Full name", { exact: true });
    await fullName.focus();
    await page.keyboard.press("Tab");
    await expect(page.getByLabel("Direct staff email", { exact: true })).toBeFocused();
    await expectNoBrowserHealthProblems(page, errors, directDataRequests);
  });

  test("shows a generic backend error without exposing response details", async ({ page }) => {
    const directDataRequests: string[] = [];
    const errors = trackBrowserHealth(page, directDataRequests);
    await installStaffHarness(page, { failList: true });
    await page.goto("/admin/staff?adminTestRole=administrator");

    await expect(page.locator("#staff-error-message")).toHaveText(
      "Unable to load staff profiles. Please try again.",
    );
    await expect(page.locator("body")).not.toContainText("private backend details");
    await expectNoBrowserHealthProblems(page, errors, directDataRequests);
  });
});
