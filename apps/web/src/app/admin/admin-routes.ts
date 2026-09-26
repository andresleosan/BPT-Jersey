import type { StaffSession } from "../../lib/staff-auth";
import { classesServicesTabs } from "./classes-services/classes-services-tabs";

export type StaffRouteRole = StaffSession["role"];

/**
 * What the mat can open inside /admin, in menu order. Operator decisions 2026-09-12 (ADR-010),
 * 2026-09-14 (Classes read-only, Levels) and 2026-09-17 (member record header and name search,
 * grill G6). The office directory (/admin/members and its add/import pages) stays office-only.
 */
const coachRoutes = Object.freeze([
  "/admin",
  "/admin/attendance",
  "/admin/members/search",
  "/admin/members/requests",
  "/admin/members/medical",
  "/admin/classes-services",
  "/admin/levels",
] as const);

export const staffRoutes: Readonly<Record<StaffRouteRole, readonly string[]>> = Object.freeze({
  coach: coachRoutes,
  headCoach: coachRoutes,
});

const offMenuStaffRoutes = Object.freeze([
  "/coach",
  "/admin/waitlists",
  // Kept so the mat still reaches the redirect that /admin/classes became on 2026-09-16.
  "/admin/classes",
  // The member record opens from search and the overview; `getMemberProfile` trims it to the header.
  "/admin/members/profile",
] as const);

const classesServicesRoot = "/admin/classes-services";

function matches(pathname: string, route: string): boolean {
  if (route === "/admin") return pathname === "/admin";
  return pathname === route || pathname.startsWith(`${route}/`);
}

/**
 * Classes / Services is one menu route with nine tabs, and only the three mat ones belong to the
 * mat (ADR-010 amendment, 2026-09-14). Without this the prefix match would hand a coach who types
 * the URL the six office tabs. The section index is allowed because it only redirects to a mat tab.
 */
function isClassesServicesStaffTab(pathname: string): boolean {
  if (pathname === classesServicesRoot) return true;
  return classesServicesTabs.some((tab) => tab.staffVisible && matches(pathname, tab.href));
}

export function isStaffRouteAllowed(pathname: string, role: StaffRouteRole): boolean {
  const allowed = [...staffRoutes[role], ...offMenuStaffRoutes].some((route) =>
    matches(pathname, route),
  );
  if (!allowed) return false;
  return matches(pathname, classesServicesRoot) ? isClassesServicesStaffTab(pathname) : true;
}
