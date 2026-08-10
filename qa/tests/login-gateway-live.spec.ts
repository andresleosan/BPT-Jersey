import { expect, test } from "@playwright/test";

const liveAuthEnabled = process.env.UNIFIED_LOGIN_LIVE_AUTH === "true";

function requiredCredential(name: string): string {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`Missing local-only live-auth variable: ${name}`);
  }

  return value;
}

test.describe.configure({ mode: "serial" });

test.describe("unified login gateway live auth", () => {
  test.skip(
    Boolean(process.env.CI) || !liveAuthEnabled,
    "Live Auth is opt-in, local-only, and disabled in CI.",
  );

  test("separates client and administrator authorization", async ({ page }) => {
    const clientEmail = requiredCredential("UNIFIED_LOGIN_CLIENT_EMAIL");
    const clientPassword = requiredCredential("UNIFIED_LOGIN_CLIENT_PASSWORD");
    const administratorEmail = requiredCredential("UNIFIED_LOGIN_ADMIN_EMAIL");
    const administratorPassword = requiredCredential("UNIFIED_LOGIN_ADMIN_PASSWORD");

    await page.goto("/login?role=client");
    await page.getByLabel("Email address").fill(clientEmail);
    await page.getByLabel("Password").fill(clientPassword);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(/\/account$/);
    await expect(page.getByRole("heading", { name: "Your account" })).toBeVisible();

    await page.goto("/admin");
    await expect(
      page.getByRole("heading", { name: "Administrative access not authorized" }),
    ).toBeVisible();
    await expect(page.getByTestId("admin-shell")).toHaveCount(0);

    await page.goto("/account");
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page.getByRole("link", { name: "Sign in" })).toBeVisible();

    await page.goto("/login?role=administrator");
    await page.getByLabel("Email address").fill(administratorEmail);
    await page.getByLabel("Password").fill(administratorPassword);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(/\/admin$/);
    await expect(page.getByTestId("admin-shell")).toBeVisible();

    await page.goto("/account");
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page.getByRole("link", { name: "Sign in" })).toBeVisible();
  });
});
