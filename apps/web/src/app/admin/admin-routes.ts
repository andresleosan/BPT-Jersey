import type { StaffSession } from "../../lib/staff-auth";

export type StaffRouteRole = StaffSession["role"];

/**
 * What the mat can open inside /admin, in menu order. The shell lists exactly these; the gate
 * lets a staff session through exactly these (plus two working routes kept off the menu).
 * Operator decision 2026-09-12, ADR-010.
 */
const coachRoutes = Object.freeze([
  "/admin",
  "/admin/attendance",
  "/admin/members/requests",
  "/admin/members/medical",
] as const);

export const staffRoutes: Readonly<Record<StaffRouteRole, readonly string[]>> = Object.freeze({
  coach: coachRoutes,
  headCoach: Object.freeze([...coachRoutes, "/admin/classes"]),
});

const offMenuStaffRoutes = Object.freeze(["/admin/waitlists", "/admin/lesson-plans"] as const);

function matches(pathname: string, route: string): boolean {
  if (route === "/admin") return pathname === "/admin";
  return pathname === route || pathname.startsWith(`${route}/`);
}

export function isStaffRouteAllowed(pathname: string, role: StaffRouteRole): boolean {
  return [...staffRoutes[role], ...offMenuStaffRoutes].some((route) => matches(pathname, route));
}
