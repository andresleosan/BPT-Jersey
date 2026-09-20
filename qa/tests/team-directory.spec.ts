import { expect, test, type Page } from "@playwright/test";
const people = [
  {
    userId: "synthetic-admin-owner",
    name: "Academy owner",
    email: "owner@example.test",
    role: "owner",
  },
  {
    userId: "office",
    name: "Office and coaching lead",
    email: "administrator@example.test",
    role: "administrator",
  },
  {
    userId: "coach",
    name: "Academy coach",
    email: "long.coaching.address.for.mobile.layout@example.test",
    role: "coach",
  },
];
async function harness(page: Page, mode: "ready" | "error" | "loading" = "ready") {
  const calls: { name: string; data: unknown }[] = [];
  await page.route("**/*", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (url.hostname === "127.0.0.1" && url.port !== "5001") {
      await route.continue();
      return;
    }
    if (req.method() === "OPTIONS") {
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
    const name = url.pathname.split("/").at(-1)!;
    if (req.method() !== "POST") {
      await route.abort();
      return;
    }
    const data: unknown = req.postDataJSON()?.data;
    calls.push({ name, data });
    let result: unknown = [];
    if (name === "listTeamDirectory") {
      if (mode === "loading") {
        await new Promise((resolve) => setTimeout(resolve, 3500));
      }
      if (mode === "error") {
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ error: { status: "UNAVAILABLE", message: "Synthetic failure" } }),
          headers: { "access-control-allow-origin": "*" },
        });
        return;
      }
      result = { people, nextPageToken: null };
    } else if (name === "createStaffInvitation") {
      const input = data as { email: string; role: string };
      result = {
        id: "a".repeat(64),
        version: "synthetic-invitation",
        academyId: "synthetic-academy",
        ...input,
        invitedBy: "synthetic-admin-owner",
        createdAt: "2026-09-20T00:00:00.000Z",
        expiresAt: "2026-09-27T00:00:00.000Z",
        status: "pending",
        claimedBy: null,
      };
    } else if (name === "changeTeamRole") result = { changed: true };
    else if (
      !["listStaffInvitations", "listStaffProfiles", "listStaffPermissionGrants"].includes(name)
    ) {
      await route.abort();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: result }),
      headers: { "access-control-allow-origin": "*" },
    });
  });
  return calls;
}
async function noOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true);
}
test("owner reviews role changes and email authorisations using the keyboard", async ({
  page,
}, info) => {
  const calls = await harness(page);
  await page.goto("/admin/staff?adminTestRole=owner");
  await expect(page.getByRole("table", { name: "Team directory" })).toBeVisible();
  await noOverflow(page);
  await page.screenshot({ path: `../.tmp/team-${info.project.name}.png`, fullPage: true });
  await page.screenshot({
    path: `../.tmp/team-viewport-${info.project.name}.jpg`,
    type: "jpeg",
    quality: 45,
    scale: "css",
  });
  const change = page.getByRole("button", { name: "Change role for Academy coach" });
  await change.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("combobox", { name: "New role", exact: true })).toBeFocused();
  await page.getByRole("button", { name: "Review role change" }).click();
  expect(calls.some((call) => call.name === "changeTeamRole")).toBe(false);
  await expect(page.getByRole("button", { name: "Confirm access" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByText(/Role changed to Administrator/)).toBeVisible();
  expect(calls.find((call) => call.name === "changeTeamRole")?.data).toEqual({
    userId: "coach",
    email: people[2]!.email,
    role: "administrator",
  });
  await page.getByLabel("Invitation email").fill("invited@example.test");
  await page.getByRole("combobox", { name: "Invitation role", exact: true }).selectOption("owner");
  await page.getByRole("button", { name: "Review invitation" }).click();
  await expect(
    page.getByText(
      "Owners can manage the academy and grant administrative access to other people.",
    ),
  ).toBeVisible();
  await page.getByRole("button", { name: "Confirm access" }).click();
  await expect(page.getByText(/Access authorised for invited@example.test/)).toBeVisible();
  await noOverflow(page);
});
test("administrator reads the directory without administrative grant controls", async ({
  page,
}) => {
  const calls = await harness(page);
  await page.goto("/admin/staff?adminTestRole=administrator");
  await expect(page.getByText("administrator@example.test", { exact: true }).last()).toBeVisible();
  await expect(page.getByLabel("Invitation email")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Change role for/ })).toHaveCount(0);
  expect(calls.some((call) => call.name === "listStaffInvitations")).toBe(false);
  await noOverflow(page);
});
test("directory errors remain readable and offer retry", async ({ page }, info) => {
  await harness(page, "error");
  await page.goto("/admin/staff?adminTestRole=owner");
  await expect(
    page.getByText("Unable to load the team directory. Please try again."),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Refresh team" })).toBeEnabled();
  await noOverflow(page);
  await page.screenshot({
    path: `../.tmp/team-error-${info.project.name}.jpg`,
    type: "jpeg",
    quality: 45,
    scale: "css",
  });
});
test("loading reserves a readable state before showing identities", async ({ page }, info) => {
  await harness(page, "loading");
  await page.goto("/admin/staff?adminTestRole=owner");
  await expect(page.getByText("Loading team directory…")).toBeVisible();
  await noOverflow(page);
  await page.screenshot({
    path: `../.tmp/team-loading-${info.project.name}.jpg`,
    type: "jpeg",
    quality: 45,
    scale: "css",
  });
  await expect(page.getByRole("table", { name: "Team directory" })).toBeVisible();
});
