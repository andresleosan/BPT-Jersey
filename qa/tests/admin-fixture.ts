import type { Page, Route } from "@playwright/test";

export type AdminTestRole = "owner" | "administrator" | "headCoach" | "coach";

const emptyReport = {
  students: {
    totalStudents: 0,
    activeStudents: 0,
    inactiveStudents: 0,
    suspendedStudents: 0,
    activeAdults: 0,
    activeMinors: 0,
    activeTown: 0,
    activeWest: 0,
  },
  attendance: {
    totalRecords: 0,
    checkedIn: 0,
    attended: 0,
    late: 0,
    absent: 0,
    noShow: 0,
    excused: 0,
    attendanceRatePercentage: 0,
  },
  memberships: {
    currentMemberships: 0,
    trial: 0,
    active: 0,
    paused: 0,
    overdue: 0,
    cancelled: 0,
  },
  revenue: {
    currency: "GBP",
    issuedMinor: 0,
    receivedMinor: 0,
    outstandingMinor: 0,
    invoiceCount: 0,
    openInvoiceCount: 0,
    partiallyPaidInvoiceCount: 0,
    paidInvoiceCount: 0,
    voidedInvoiceCount: 0,
    paymentCount: 0,
    paymentsByMethod: { cash: 0, bankTransfer: 0, other: 0 },
  },
  calculatedAt: "2026-08-24T20:00:00.000Z",
};

export type CallableResponder = (body: unknown) => unknown;

export type CallableCall = { name: string; body: unknown };

/**
 * The static export is served without Firebase: every callable is answered here. `callables` maps
 * a callable name to the `data` it returns (or a function of the request body). Unlisted callables
 * are not answered, so a page that quietly depends on one fails loudly instead of passing.
 */
export async function installAdminFixture(
  page: Page,
  options: {
    role?: AdminTestRole;
    callables?: Record<string, unknown | CallableResponder>;
    calls?: CallableCall[];
  } = {},
): Promise<void> {
  // This fixture answers callables locally, including clients requesting single-use
  // App Check attestations. Keep reCAPTCHA offline instead of calling Google with
  // the synthetic CI site key before the callable interception can run.
  // Like the real widget, execute() reports success through render()'s callback: App Check refuses
  // a limited-use token (limitedUseAppCheckTokens) until that callback has run.
  await page.addInitScript(() => {
    let succeeded: (() => void) | undefined;
    Object.defineProperty(globalThis, "grecaptcha", {
      value: {
        enterprise: {
          ready: (callback: () => void) => callback(),
          render: (_container: unknown, parameters?: { callback?: () => void }) => {
            succeeded = parameters?.callback;
            return 0;
          },
          execute: async () => {
            succeeded?.();
            return "synthetic-fixture-recaptcha";
          },
        },
      },
    });
  });

  const role = options.role ?? "owner";
  const callables: Record<string, unknown | CallableResponder> = {
    getDailyOperationsDashboard: (body: unknown) => ({
      dashboard: {
        query: (body as { data: unknown }).data,
        sessions: [],
        refreshedAt: "2026-08-24T20:00:00.000Z",
      },
    }),
    getOperationalReport: (body: unknown) => ({
      report: { query: (body as { data: unknown }).data, ...emptyReport },
    }),
    listUpcomingBirthdays: { birthdays: [] },
    // The shell's notification panel asks on every admin page.
    listAdminNotifications: { notifications: [], nextCursor: null, unreadCount: 0 },
    ...options.callables,
  };

  await page.route("**/*", async (route: Route) => {
    const url = new URL(route.request().url());
    if (
      url.hostname === "firebaseappcheck.googleapis.com" ||
      url.hostname === "content-firebaseappcheck.googleapis.com"
    ) {
      await route.fulfill({
        json: { token: "synthetic-fixture-app-check", ttl: "3600s" },
      });
      return;
    }
    const name = url.pathname.split("/").pop() ?? "";
    if (route.request().method() === "POST" && name in callables) {
      const body = route.request().postDataJSON() as unknown;
      options.calls?.push({ name, body });
      const responder = callables[name];
      const data =
        typeof responder === "function" ? (responder as CallableResponder)(body) : responder;
      await route.fulfill({
        body: JSON.stringify({ data }),
        contentType: "application/json",
        status: 200,
      });
      return;
    }
    if (url.pathname.startsWith("/admin")) {
      if (
        process.env.ADMIN_FIXTURE_STATIC_EXPORT !== "false" &&
        !url.pathname.endsWith(".html") &&
        !url.pathname.includes(".")
      ) {
        url.pathname = `${url.pathname.replace(/\/$/, "")}.html`;
      }
      url.searchParams.set("adminTestRole", role);
      await route.continue({ url: url.toString() });
      return;
    }
    await route.continue();
  });
}
