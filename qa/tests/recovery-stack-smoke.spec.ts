import { expect, ownerEmail, signIn, test } from "./recovery-fixture";

test.describe("recovery stack", () => {
  test("serves the public entry points", async ({ stackPage: page }) => {
    for (const path of ["/", "/enrol", "/login"]) {
      const response = await page.goto(path);
      expect(response?.status(), path).toBe(200);
    }
    await expect(page.getByRole("link", { name: /recover/iu })).toHaveCount(0);
  });

  test("no longer serves access recovery (withdrawn 2026-09-23)", async ({ stackPage: page }) => {
    for (const path of ["/login/recover", "/admin/members/recovery"]) {
      expect((await page.goto(path))?.status(), path).toBe(404);
    }
  });

  test("lets the synthetic owner open the office requests", async ({ stackPage: page }) => {
    await signIn(page, ownerEmail, { staff: true });
    await page.waitForURL(/\/admin/u);
    await page.goto("/admin/members/requests");
    await expect(page.getByRole("heading", { name: /requests/iu }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Member access recovery" })).toHaveCount(0);
  });
});
