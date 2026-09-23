import { expect, shot, signIn, test } from "./recovery-fixture";

// Rule R6 (D12): an existing member who never accepted the academy terms sees only the terms,
// accepts them, and then reaches the calendar and books.
test("R6 a member without the waiver accepts it before reaching the calendar", async ({
  stackPage: page,
}) => {
  await signIn(page, "legacy-member@example.test");
  await page.waitForURL(/\/account/u, { timeout: 60_000 });
  await expect(page.getByRole("heading", { name: "Accept the academy terms" })).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.getByRole("button", { name: /^Book/u })).toHaveCount(0);
  const accept = page.getByRole("button", { name: "Accept and continue" });
  await expect(accept).toBeDisabled();
  await shot(page, "R6-1-waiver-gate");
  await page.getByRole("checkbox", { name: /Morgan Legacy/u }).check();
  await accept.click();
  const book = page.getByRole("button", { name: /^Book$/u }).first();
  await expect(book).toBeVisible({ timeout: 60_000 });
  await book.click();
  await expect(page.getByRole("button", { name: /^Booked/u }).first()).toBeVisible({
    timeout: 60_000,
  });
  await page.reload();
  await expect(page.getByRole("heading", { name: "Accept the academy terms" })).toHaveCount(0);
});
