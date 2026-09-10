import { expect, test, type Page } from "@playwright/test";

const adminPaths = ["/admin", "/admin/reports"] as const;
const deniedRoles = ["coach", "guardian", "adultStudent"] as const;

type AdminTestRole = "owner" | "administrator" | (typeof deniedRoles)[number];

function staffLoginFor(pathname: string): string {
  return `/staff/login?returnTo=${encodeURIComponent(pathname)}`;
}

function trackBrowserHealth(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") {
      errors.push(`console: ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => errors.push(`page: ${error.message}`));
  return errors;
}

async function expectNoBrowserHealthProblems(page: Page, errors: string[]): Promise<void> {
  expect(errors).toEqual([]);
  const dimensions = await page.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    documentClientWidth: document.documentElement.clientWidth,
    bodyWidth: document.body.scrollWidth,
    bodyClientWidth: document.body.clientWidth,
  }));

  expect(dimensions.documentWidth).toBeLessThanOrEqual(dimensions.documentClientWidth);
  expect(dimensions.bodyWidth).toBeLessThanOrEqual(dimensions.bodyClientWidth);
}

async function installStaticAdminRoute(page: Page, pathname: string): Promise<void> {
  await page.route("**/*", async (route) => {
    const requestUrl = new URL(route.request().url());
    if (requestUrl.pathname.endsWith("/getDailyOperationsDashboard")) {
      const body = route.request().postDataJSON() as {
        data: Readonly<{ from: string; to: string }>;
      };
      await route.fulfill({
        body: JSON.stringify({
          data: {
            dashboard: {
              query: body.data,
              sessions: [],
              refreshedAt: "2026-08-24T20:00:00.000Z",
            },
          },
        }),
        contentType: "application/json",
        status: 200,
      });
      return;
    }

    if (requestUrl.pathname === pathname) {
      requestUrl.pathname = `${pathname}.html`;
      await route.continue({ url: requestUrl.toString() });
      return;
    }

    await route.continue();
  });
}

function roleUrl(pathname: string, role?: AdminTestRole): string {
  if (!role) {
    return pathname;
  }

  return `${pathname}?${new URLSearchParams({ adminTestRole: role }).toString()}`;
}

test.describe("admin authentication boundary", () => {
  for (const pathname of adminPaths) {
    test(`keeps ${pathname} signed-out without shell or records`, async ({ page }) => {
      const errors = trackBrowserHealth(page);
      await installStaticAdminRoute(page, pathname);
      await page.goto(pathname);

      await expect(page.getByRole("heading", { name: "Admin access required" })).toBeVisible();
      await expect(page.getByRole("link", { name: "Sign in" })).toHaveAttribute(
        "href",
        staffLoginFor(pathname),
      );
      await expect(page.getByTestId("admin-shell")).toHaveCount(0);
      await expect(page.locator("body")).not.toContainText(/role=administrator|203\.0\.113\.10/);
      await expectNoBrowserHealthProblems(page, errors);
    });
  }

  for (const role of ["owner", "administrator"] as const) {
    test(`authorizes ${role} on both admin routes`, async ({ page }) => {
      const errors = trackBrowserHealth(page);

      for (const pathname of adminPaths) {
        await installStaticAdminRoute(page, pathname);
        await page.goto(roleUrl(pathname, role));
        expect(new URL(page.url()).searchParams.get("adminTestRole")).toBe(role);
        await expect(page.getByTestId("admin-shell")).toBeVisible();
        const roleLabel = role === "owner" ? "Owner access" : "Administrator access";
        await expect(page.getByText(`Synthetic ${role}`, { exact: true })).toBeVisible();
        await expect(
          page.getByText(`${roleLabel} - ${role}@example.test`, { exact: true }),
        ).toBeVisible();
        if (pathname === "/admin/reports") {
          await expect(page.getByRole("heading", { name: "Reports", level: 2 })).toBeVisible();
        }
      }

      await expectNoBrowserHealthProblems(page, errors);
    });
  }

  for (const role of deniedRoles) {
    test(`denies ${role} without rendering an administrative surface`, async ({ page }) => {
      const errors = trackBrowserHealth(page);

      for (const pathname of adminPaths) {
        await installStaticAdminRoute(page, pathname);
        await page.goto(roleUrl(pathname, role));
        expect(new URL(page.url()).searchParams.get("adminTestRole")).toBe(role);
        await expect(
          page.getByRole("heading", { name: "Administrative access not authorized" }),
        ).toBeVisible();
        await expect(page.getByTestId("admin-shell")).toHaveCount(0);
        await expect(page.getByRole("link", { name: "Home" })).toHaveAttribute("href", "/");
      }

      await expectNoBrowserHealthProblems(page, errors);
    });
  }
});
