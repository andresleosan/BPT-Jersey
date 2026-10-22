import { writeFileSync } from "node:fs";

import { expect, test, type Page } from "@playwright/test";

import { installAdminFixture } from "./admin-fixture";
import { blockExternalRequests } from "./network-guard";

/**
 * c886d32: `.coach-card-fields` (the coach website card: fields beside a 16rem preview) collapsed
 * to one column at max-width 48rem, so a 768 px viewport (exactly 48rem) already lost the preview
 * column. DESIGN.md's breakpoint is 47.99rem: two columns at 768 px, one at 767 px. Driven on
 * /admin/staff › Add to the team › New staff account (role Coach / assistant).
 */
const columnsAt = async (page: Page, width: number) => {
  await page.setViewportSize({ width, height: 900 });
  const fields = page.locator(".coach-card-fields");
  await expect(fields).toBeVisible();
  return fields.evaluate((element) =>
    getComputedStyle(element).gridTemplateColumns.split(" ").filter(Boolean),
  );
};

test.describe("Coach card fields breakpoint (c886d32)", () => {
  test.skip(process.env.NEXT_PUBLIC_ADMIN_E2E !== "true", "needs the admin E2E build");
  // The breakpoint is a viewport width, set here; the phone project adds nothing.
  test.skip(({ isMobile }) => isMobile, "sets its own desktop viewport");
  test.setTimeout(180_000);

  test("two columns at 768 px, one at 767 px", async ({ page }, testInfo) => {
    const errors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(`console: ${message.text()}`);
    });
    page.on("pageerror", (error) => errors.push(`page: ${error.message}`));
    const callables = {
      listTeamDirectory: { people: [], nextPageToken: null },
      listStaffInvitations: [],
      listStaffPermissionGrants: { grants: [] },
      listStaffProfiles: [],
    };
    await installAdminFixture(page, { role: "owner", callables });
    const blocked = await blockExternalRequests(page, Object.keys(callables));
    await page.goto("/admin/staff?adminTestRole=owner", { timeout: 120_000 });
    await page.getByText("New staff account").click({ timeout: 60_000 });
    await expect(page.getByLabel("Direct staff role")).toHaveValue("coach");

    const at768 = await columnsAt(page, 768);
    await page.screenshot({ path: testInfo.outputPath("coach-card-768.png") });
    const at767 = await columnsAt(page, 767);
    await page.screenshot({ path: testInfo.outputPath("coach-card-767.png") });
    writeFileSync(
      testInfo.outputPath("grid-template-columns.json"),
      JSON.stringify({ at768, at767 }, null, 2),
    );
    expect(at768, "fields beside the 16rem preview at 768 px").toHaveLength(2);
    expect(at768[1]).toBe("256px");
    expect(at767, "one column at 767 px").toHaveLength(1);

    writeFileSync(testInfo.outputPath("blocked-requests.json"), JSON.stringify(blocked, null, 2));
    expect(blocked).toEqual([]);
    expect(errors).toEqual([]);
  });
});
