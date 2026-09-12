import { describe, expect, it } from "vitest";

import { isStaffRouteAllowed, staffRoutes } from "./admin-routes";

describe("staff routes", () => {
  it("lists what each role sees in the menu, in navigation order", () => {
    expect(staffRoutes.coach).toEqual([
      "/admin",
      "/admin/attendance",
      "/admin/members/requests",
      "/admin/members/medical",
    ]);
    expect(staffRoutes.headCoach).toEqual([...staffRoutes.coach, "/admin/classes"]);
  });

  it("gates by prefix, except the overview which is exact", () => {
    expect(isStaffRouteAllowed("/admin", "coach")).toBe(true);
    expect(isStaffRouteAllowed("/admin/attendance/today", "coach")).toBe(true);
    expect(isStaffRouteAllowed("/admin/members/requests", "coach")).toBe(true);
    expect(isStaffRouteAllowed("/admin/members", "coach")).toBe(false);
    expect(isStaffRouteAllowed("/admin/members/search", "coach")).toBe(false);
    expect(isStaffRouteAllowed("/admin/classes", "coach")).toBe(false);
    expect(isStaffRouteAllowed("/admin/classes", "headCoach")).toBe(true);
    expect(isStaffRouteAllowed("/admin/billing", "headCoach")).toBe(false);
  });

  it("keeps the off-menu routes staff could already open", () => {
    expect(isStaffRouteAllowed("/admin/waitlists/x", "coach")).toBe(true);
    expect(isStaffRouteAllowed("/admin/lesson-plans", "headCoach")).toBe(true);
  });
});
