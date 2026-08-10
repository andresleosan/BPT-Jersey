import { expect, test } from "@playwright/test";

const liveEnabled = process.env.T017_MFA_LIVE === "true";
const adminEmail = process.env.T017_MFA_ADMIN_EMAIL;
const adminPassword = process.env.T017_MFA_ADMIN_PASSWORD;
const totpCode = process.env.T017_MFA_TOTP_CODE;
const clientEmail = process.env.T017_MFA_CLIENT_EMAIL;
const clientPassword = process.env.T017_MFA_CLIENT_PASSWORD;

function skipReason(required: readonly [string, string | undefined][]): string | undefined {
  if (!liveEnabled) {
    return "T017 live MFA is opt-in only.";
  }

  const missing = required.filter(([, value]) => !value).map(([name]) => name);
  return missing.length > 0
    ? `Missing local-only T017 variables: ${missing.join(", ")}`
    : undefined;
}

test.describe.configure({ mode: "serial" });

test("staging admin MFA enrollment/challenge never captures setup artifacts", async ({ page }) => {
  const reason = skipReason([
    ["T017_MFA_ADMIN_EMAIL", adminEmail],
    ["T017_MFA_ADMIN_PASSWORD", adminPassword],
    ["T017_MFA_TOTP_CODE", totpCode],
  ]);
  test.skip(Boolean(reason), reason);

  await page.goto("/login?role=administrator");
  await page.getByLabel("Email address").fill(adminEmail!);
  await page.getByLabel("Password").fill(adminPassword!);
  await page.getByRole("button", { name: "Sign in" }).click();

  const enrollment = page.getByRole("heading", { name: "Set up your authenticator" });
  const challenge = page.getByRole("heading", { name: "Verify your authenticator" });

  if (await enrollment.isVisible().catch(() => false)) {
    await expect(page.getByRole("img", { name: "Authenticator setup QR code" })).toBeVisible();
    await expect(page.getByLabel("Authenticator code")).toBeVisible();
    test.info().annotations.push({
      type: "manual-step",
      description:
        "Scan the one-time QR with the dedicated staging authenticator, then rerun with the current code.",
    });
    return;
  }

  await expect(challenge).toBeVisible();
  await page.getByLabel("Authenticator code").fill(totpCode!);
  await page.getByRole("button", { name: "Verify code" }).click();
  await expect(page.getByTestId("admin-shell")).toBeVisible();
  await expect(page.locator("body")).not.toContainText(totpCode!);
});

test("staging client login remains MFA-free", async ({ page }) => {
  const reason = skipReason([
    ["T017_MFA_CLIENT_EMAIL", clientEmail],
    ["T017_MFA_CLIENT_PASSWORD", clientPassword],
  ]);
  test.skip(Boolean(reason), reason);

  await page.goto("/login?role=client");
  await page.getByLabel("Email address").fill(clientEmail!);
  await page.getByLabel("Password").fill(clientPassword!);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/account/);
  await expect(page.getByRole("heading", { name: /client account/i })).toHaveCount(0);
});
