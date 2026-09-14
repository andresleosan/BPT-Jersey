import type { StaffSession } from "../../lib/staff-auth";

export type StaffRouteRole = StaffSession["role"];

/**
 * What the mat can open inside /admin, in menu order. Operator decisions 2026-09-12 (ADR-010) and
 * 2026-09-14 (ADR-010 amendment: Classes read-only for coaches, Levels for both). The member
 * directory stays office-only.
 */
const coachRoutes = Object.freeze([
  "/admin",
  "/admin/attendance",
  "/admin/members/requests",
  "/admin/members/medical",
  "/admin/classes",
  "/admin/levels",
] as const);

export const staffRoutes: Readonly<Record<StaffRouteRole, readonly string[]>> = Object.freeze({
  coach: coachRoutes,
  headCoach: coachRoutes,
});

const offMenuStaffRoutes = Object.freeze(["/admin/waitlists", "/admin/lesson-plans"] as const);

function matches(pathname: string, route: string): boolean {
  if (route === "/admin") return pathname === "/admin";
  return pathname === route || pathname.startsWith(`${route}/`);
}

export function isStaffRouteAllowed(pathname: string, role: StaffRouteRole): boolean {
  return [...staffRoutes[role], ...offMenuStaffRoutes].some((route) => matches(pathname, route));
}
