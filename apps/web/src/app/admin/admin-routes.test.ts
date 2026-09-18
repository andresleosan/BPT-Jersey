import { describe, expect, it } from "vitest";

import { isStaffRouteAllowed, staffRoutes } from "./admin-routes";

describe("staff routes", () => {
  it("lists what each role sees in the menu, in navigation order", () => {
    expect(staffRoutes.coach).toEqual([
      "/admin",
      "/admin/attendance",
      "/admin/members/search",
      "/admin/members/requests",
      "/admin/members/medical",
      "/admin/classes-services",
      "/admin/levels",
    ]);
    expect(staffRoutes.headCoach).toEqual(staffRoutes.coach);
  });

  it("gates by prefix, except the overview which is exact", () => {
    expect(isStaffRouteAllowed("/admin", "coach")).toBe(true);
    expect(isStaffRouteAllowed("/admin/attendance/today", "coach")).toBe(true);
    expect(isStaffRouteAllowed("/admin/members/requests", "coach")).toBe(true);
    expect(isStaffRouteAllowed("/admin/members", "coach")).toBe(false);
    expect(isStaffRouteAllowed("/admin/members/search", "coach")).toBe(true);
    expect(isStaffRouteAllowed("/admin/classes-services", "coach")).toBe(true);
    expect(isStaffRouteAllowed("/admin/classes-services/locations", "coach")).toBe(true);
    expect(isStaffRouteAllowed("/admin/classes-services", "headCoach")).toBe(true);
    expect(isStaffRouteAllowed("/admin/levels", "coach")).toBe(true);
    expect(isStaffRouteAllowed("/admin/billing", "headCoach")).toBe(false);
  });

  /**
   * The section is one route, but only three of its nine tabs belong to the mat (ADR-010 amendment,
   * 2026-09-14). The prefix gate above would hand a coach the office tabs on a typed URL.
   */
  it("inside Classes / Services, lets staff open the mat tabs only", () => {
    for (const role of ["coach", "headCoach"] as const) {
      expect(isStaffRouteAllowed("/admin/classes-services", role)).toBe(true);
      expect(isStaffRouteAllowed("/admin/classes-services/locations", role)).toBe(true);
      expect(isStaffRouteAllowed("/admin/classes-services/types", role)).toBe(true);
      expect(isStaffRouteAllowed("/admin/classes-services/classes", role)).toBe(true);
      expect(isStaffRouteAllowed("/admin/classes-services/classes/new", role)).toBe(true);
      expect(isStaffRouteAllowed("/admin/classes-services/memberships", role)).toBe(false);
      expect(isStaffRouteAllowed("/admin/classes-services/bulk", role)).toBe(false);
      expect(isStaffRouteAllowed("/admin/classes-services/reports", role)).toBe(false);
      expect(isStaffRouteAllowed("/admin/classes-services/drop-ins", role)).toBe(false);
      expect(isStaffRouteAllowed("/admin/classes-services/options", role)).toBe(false);
      expect(isStaffRouteAllowed("/admin/classes-services/history", role)).toBe(false);
      expect(isStaffRouteAllowed("/admin/classes-services/history/2026", role)).toBe(false);
    }
  });

  it("keeps the off-menu routes staff could already open", () => {
    expect(isStaffRouteAllowed("/admin/waitlists/x", "coach")).toBe(true);
    expect(isStaffRouteAllowed("/admin/lesson-plans", "headCoach")).toBe(true);
    // The legacy /admin/classes page only redirects now, so the mat still has to be let in.
    expect(isStaffRouteAllowed("/admin/classes", "coach")).toBe(true);
  });

  it("opens the member record and name search to the mat, not the office directory (ADR-010, 2026-09-17)", () => {
    for (const role of ["coach", "headCoach"] as const) {
      expect(isStaffRouteAllowed("/admin/members/profile", role)).toBe(true);
      expect(isStaffRouteAllowed("/admin/members/search", role)).toBe(true);
      expect(isStaffRouteAllowed("/admin/members", role)).toBe(false);
      expect(isStaffRouteAllowed("/admin/members/add", role)).toBe(false);
      expect(isStaffRouteAllowed("/admin/members/import", role)).toBe(false);
    }
  });
});
