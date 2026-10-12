import * as logger from "firebase-functions/logger";
import { onSchedule } from "firebase-functions/v2/scheduler";

/**
 * What the staff screens (dashboard, members, attendance, coach, classes calendar) and the member
 * calendar call first. At the academy's traffic each one was cold on almost every visit:
 * 3-4 s before its first answer (production logs, 2026-10-12). A preflight keeps an instance
 * warm: onCall answers OPTIONS in its CORS middleware, before App Check, the ID token or any read,
 * and Cloud Run keeps an idle instance up to ~15 minutes (documented, not guaranteed).
 * The list is fixed here, so no input reaches a URL; a renamed callable shows up as a 404 in the log.
 */
export const hotFunctions = Object.freeze([
  "getDailyOperationsDashboard",
  "getOperationalReport",
  "listUpcomingBirthdays",
  "listAdminNotifications",
  "getMemberOverview",
  "getMemberProfile",
  "getStudentProgressSummary",
  "listLevelCatalog",
  "listSessions",
  "getSessionOperationalView",
  "getPreClassView",
  "searchAttendanceMembers",
  "listSessionBookings",
  "listScheduleCatalog",
  "listSessionBookedCounts",
  "listStaffProfiles",
  "getMemberCalendarWeek",
  "getCourseCalendar",
  "getClientProfile",
  "getSessionDetail",
  "listCourseParticipants",
  "listMemberships",
  "listPlans",
  "listMyMemberProfiles",
] as const);

/** Pings the project it runs in (firebase-tools sets GCLOUD_PROJECT), never production from staging. */
export async function warmHotFunctions(
  fetchImpl: typeof fetch = fetch,
  project = process.env.GCLOUD_PROJECT,
) {
  if (!project) return [];
  const origin = `https://europe-west9-${project}.cloudfunctions.net`;
  return Promise.all(
    hotFunctions.map(async (name) => {
      const started = Date.now();
      try {
        const response = await fetchImpl(`${origin}/${name}`, {
          method: "OPTIONS",
          redirect: "manual",
          headers: { Origin: "https://www.bptjersey.com", "Access-Control-Request-Method": "POST" },
          signal: AbortSignal.timeout(10_000),
        });
        return { name, status: response.status, ms: Date.now() - started };
      } catch {
        return { name, status: 0, ms: Date.now() - started };
      }
    }),
  );
}

// Every 10 minutes from 06:00 to 21:50 Jersey time; outside those hours the first call is cold.
export const keepHotFunctionsWarm = onSchedule(
  {
    schedule: "*/10 6-21 * * *",
    timeZone: "Europe/Jersey",
    timeoutSeconds: 60,
    maxInstances: 1,
    retryCount: 0,
  },
  async () => {
    const results = await warmHotFunctions();
    logger.info("keep-hot-functions-warm", {
      project: process.env.GCLOUD_PROJECT ?? null,
      warm: results.filter((result) => result.status === 204).length,
      failed: results.filter((result) => result.status !== 204).map((r) => `${r.name}:${r.status}`),
      slowestMs: Math.max(...results.map((result) => result.ms)),
    });
  },
);
