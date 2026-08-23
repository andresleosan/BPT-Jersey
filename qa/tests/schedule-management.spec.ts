import { expect, test, type Page } from "@playwright/test";

import { injectSyntheticAdminRecords } from "../src/admin-test-bootstrap";

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

async function installScheduleHarness(page: Page): Promise<void> {
  await page.route("**/*", async (route) => {
    const requestUrl = new URL(route.request().url());

    if (requestUrl.pathname === "/admin/groups") {
      requestUrl.pathname = "/admin/groups.html";
      await route.continue({ url: requestUrl.toString() });
      return;
    }

    if (requestUrl.pathname === "/admin/activities") {
      requestUrl.pathname = "/admin/activities.html";
      await route.continue({ url: requestUrl.toString() });
      return;
    }

    const request = route.request();
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

    if (request.url().includes("listClasses")) {
      await respond({
        classes: [
          {
            classId: "cls-1",
            academyId: "demo-academy",
            programId: "adult-fundamentals",
            locationId: "town",
            name: "Adult Fundamentals Town",
            recurrenceRule: { dayOfWeek: 1, startTime: "18:00", durationMinutes: 60 },
            instructorIds: ["Coach Alex"],
            capacity: 25,
            minParticipants: 4,
            active: true,
            schemaVersion: "1",
            createdAt: "2026-08-23T00:00:00Z",
            createdBy: "user-1",
            updatedAt: "2026-08-23T00:00:00Z",
            updatedBy: "user-1",
          },
        ],
      });
      return;
    }

    if (request.url().includes("listSessions")) {
      await respond({
        sessions: [
          {
            sessionId: "sess-1",
            academyId: "demo-academy",
            classId: "cls-1",
            programId: "adult-fundamentals",
            locationId: "town",
            instructorId: "coach-1",
            title: "Adult Fundamentals Town",
            startAt: "2026-09-01T18:00:00Z",
            endAt: "2026-09-01T19:00:00Z",
            capacity: 25,
            minParticipants: 4,
            status: "scheduled",
            isSeminar: false,
            cancellationReason: null,
            schemaVersion: "1",
            createdAt: "2026-08-23T00:00:00Z",
            createdBy: "user-1",
            updatedAt: "2026-08-23T00:00:00Z",
            updatedBy: "user-1",
          },
        ],
      });
      return;
    }

    if (request.url().includes("saveClass")) {
      await respond({
        class: {
          classId: "cls-2",
          academyId: "demo-academy",
          programId: "adult-fundamentals",
          locationId: "town",
          name: "Adults Evening Gi",
          recurrenceRule: { dayOfWeek: 2, startTime: "18:00", durationMinutes: 60 },
          instructorIds: ["coach-1"],
          capacity: 25,
          minParticipants: 4,
          active: true,
          schemaVersion: "1",
        },
      });
      return;
    }

    if (request.url().includes("saveSession")) {
      await respond({
        session: {
          sessionId: "sess-2",
          academyId: "demo-academy",
          classId: null,
          programId: "open-mat",
          locationId: "town",
          instructorId: "coach-1",
          title: "Saturday Open Mat",
          startAt: "2026-09-05T10:00:00Z",
          endAt: "2026-09-05T12:00:00Z",
          capacity: 30,
          minParticipants: 4,
          status: "scheduled",
          isSeminar: false,
          cancellationReason: null,
          schemaVersion: "1",
        },
      });
      return;
    }

    await route.continue();
  });
}

test.describe("Schedule and Training Groups Management", () => {
  test("renders groups directory, filters, and opens creation modal", async ({ page }) => {
    const directDataRequests: string[] = [];
    const errors = trackBrowserHealth(page, directDataRequests);

    await installScheduleHarness(page);
    await injectSyntheticAdminRecords(page, "owner");
    await page.goto("/admin/groups?adminTestRole=owner");

    await expect(page.getByRole("heading", { name: "Groups / Teams", level: 2 })).toBeVisible();
    await expect(page.getByRole("table", { name: "Groups and teams" })).toBeVisible();

    // Verify filter interactions
    const programSelect = page.getByRole("combobox", { name: "Program" });
    await expect(programSelect).toBeVisible();

    // Click Create Group button (first one in header actions)
    const createButton = page.getByRole("button", { name: "Create group" }).first();
    await createButton.click();

    // Verify modal is open
    await expect(page.getByRole("heading", { name: "Create New Training Group" })).toBeVisible();
    await expect(page.getByLabel("Group Name")).toBeVisible();
    await expect(page.getByRole("spinbutton", { name: "Capacity" })).toBeVisible();

    // Fill form and cancel
    await page.getByLabel("Group Name").fill("Adults Evening Gi");
    await page.getByRole("button", { name: "Cancel" }).click();

    await expect(
      page.getByRole("heading", { name: "Create New Training Group" }),
    ).not.toBeVisible();

    expect(errors).toEqual([]);
    expect(directDataRequests).toEqual([]);
  });

  test("renders activities schedule, filters, and opens creation modal", async ({ page }) => {
    const directDataRequests: string[] = [];
    const errors = trackBrowserHealth(page, directDataRequests);

    await installScheduleHarness(page);
    await injectSyntheticAdminRecords(page, "owner");
    await page.goto("/admin/activities?adminTestRole=owner");

    await expect(page.getByRole("heading", { name: "Activities", level: 2 })).toBeVisible();
    await expect(page.getByRole("table", { name: "Academy activities" })).toBeVisible();

    // Verify status filter
    const statusSelect = page.getByRole("combobox", { name: "Activity status" });
    await expect(statusSelect).toBeVisible();

    // Click Create Activity button
    const createButton = page.getByRole("button", { name: "Create activity" }).first();
    await createButton.click();

    // Verify modal is open
    await expect(
      page.getByRole("heading", { name: "Schedule New Activity / Session" }),
    ).toBeVisible();
    await expect(page.getByLabel("Activity Title")).toBeVisible();
    await expect(page.getByRole("spinbutton", { name: "Capacity" })).toBeVisible();

    // Fill form and cancel
    await page.getByLabel("Activity Title").fill("Saturday Open Mat");
    await page.getByRole("button", { name: "Cancel" }).click();

    await expect(
      page.getByRole("heading", { name: "Schedule New Activity / Session" }),
    ).not.toBeVisible();

    expect(errors).toEqual([]);
    expect(directDataRequests).toEqual([]);
  });
});
