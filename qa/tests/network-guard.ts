import type { Page } from "@playwright/test";

// installAdminFixture answers these on every admin page, besides each spec's own callables.
const fixtureCallables = [
  "getDailyOperationsDashboard",
  "getOperationalReport",
  "listUpcomingBirthdays",
  "listAdminNotifications",
];
const appCheckHosts = new Set([
  "firebaseappcheck.googleapis.com",
  "content-firebaseappcheck.googleapis.com",
]);

/**
 * Keeps a fixture page offline. Register it AFTER installAdminFixture (the newest route runs first):
 * loopback assets, the App Check exchange and the answered callables fall through to the fixture,
 * which fulfils them in the browser; every other request is aborted and returned for the report.
 */
export async function blockExternalRequests(
  page: Page,
  answeredCallables: readonly string[],
): Promise<string[]> {
  const blocked: string[] = [];
  const answered = new Set([...fixtureCallables, ...answeredCallables]);
  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const loopback = url.hostname === "127.0.0.1" || url.hostname === "localhost";
    const callable =
      request.method() === "POST" && answered.has(url.pathname.split("/").pop() ?? "");
    if (loopback || appCheckHosts.has(url.hostname) || callable) {
      await route.fallback();
      return;
    }
    blocked.push(`${request.method()} ${url.origin}${url.pathname}`);
    await route.abort("blockedbyclient");
  });
  return blocked;
}
