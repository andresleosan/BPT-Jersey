import { describe, expect, it } from "vitest";

import {
  memberDestination,
  requireClientSession,
  requireStaffSession,
  resolveStaffDestination,
  sanitizeReturnPath,
  sanitizeStaffReturnPath,
  toAuthMessage,
} from "./login-flow";

describe("login-flow", () => {
  it("accepts only exact internal member destinations", () => {
    expect(sanitizeReturnPath("/account")).toBe("/account");
    expect(sanitizeReturnPath("/account/guardian-profile")).toBe("/account/guardian-profile");
    expect(sanitizeReturnPath("/account/family")).toBe("/account/family");
    expect(sanitizeReturnPath("/account/waiver")).toBe("/account/waiver");
    expect(sanitizeReturnPath("/account/waitlist")).toBe("/account/waitlist");
    expect(sanitizeReturnPath("/account/classes")).toBe("/account/classes");
    expect(sanitizeReturnPath("/shop")).toBe("/shop");
    expect(sanitizeReturnPath("/checkout")).toBe("/checkout");
    expect(sanitizeReturnPath("/admin")).toBeUndefined();
    expect(sanitizeReturnPath("/coach")).toBeUndefined();
    expect(sanitizeReturnPath("https://outside.example")).toBeUndefined();
    expect(sanitizeReturnPath("//outside.example")).toBeUndefined();
    expect(sanitizeReturnPath("/shop?next=https://outside.example")).toBeUndefined();
    expect(sanitizeReturnPath("/unknown")).toBeUndefined();
    expect(sanitizeReturnPath(null)).toBeUndefined();
  });

  it("uses an allowlisted member return path or the account home by default", () => {
    expect(memberDestination("/shop")).toBe("/shop");
    expect(memberDestination("/checkout")).toBe("/checkout");
    expect(memberDestination()).toBe("/account");
  });

  it("accepts only plain internal paths under the two staff surfaces", () => {
    expect(sanitizeStaffReturnPath("/admin")).toBe("/admin");
    expect(sanitizeStaffReturnPath("/admin/members/search")).toBe("/admin/members/search");
    expect(sanitizeStaffReturnPath("/coach")).toBe("/coach");
    expect(sanitizeStaffReturnPath("/coach/levels")).toBe("/coach/levels");
    expect(sanitizeStaffReturnPath("/account")).toBeUndefined();
    expect(sanitizeStaffReturnPath("/administrator")).toBeUndefined();
    expect(sanitizeStaffReturnPath("/admin/../account")).toBeUndefined();
    expect(sanitizeStaffReturnPath("/admin?next=https://outside.example")).toBeUndefined();
    expect(sanitizeStaffReturnPath("//outside.example/admin")).toBeUndefined();
    expect(sanitizeStaffReturnPath("https://outside.example/admin")).toBeUndefined();
    expect(sanitizeStaffReturnPath(`/admin/${"a".repeat(90)}`)).toBeUndefined();
    expect(sanitizeStaffReturnPath(null)).toBeUndefined();
  });

  it("routes office roles to the admin workspace and coaches to the coach portal", () => {
    const academyId = "demo-academy";

    expect(resolveStaffDestination({ academyId, role: "owner" })).toBe("/admin");
    expect(resolveStaffDestination({ academyId, role: "administrator" }, "/admin/staff")).toBe(
      "/admin/staff",
    );
    expect(resolveStaffDestination({ academyId, role: "headCoach" })).toBe("/coach");
    expect(resolveStaffDestination({ academyId, role: "coach" }, "/coach/levels")).toBe(
      "/coach/levels",
    );
    expect(resolveStaffDestination({ academyId, role: "coach" }, "/admin/attendance")).toBe(
      "/admin/attendance",
    );
    expect(resolveStaffDestination({ academyId, role: "coach" }, "/admin/staff")).toBe("/coach");
  });

  it("refuses to route anything that is not a staff account", () => {
    expect(resolveStaffDestination({ academyId: "demo-academy", role: "guardian" })).toBeUndefined();
    expect(
      resolveStaffDestination({ academyId: "demo-academy", role: "adultStudent" }),
    ).toBeUndefined();
    expect(resolveStaffDestination({ academyId: "demo-academy" })).toBeUndefined();
    expect(resolveStaffDestination({ role: "owner" })).toBeUndefined();
    expect(resolveStaffDestination({ academyId: "  ", role: "owner" })).toBeUndefined();
    expect(resolveStaffDestination({})).toBeUndefined();
  });

  it("builds a member login requirement without allowing an external return", () => {
    expect(requireClientSession("/checkout")).toEqual({
      loginPath: "/login?returnTo=%2Fcheckout",
      returnPath: "/checkout",
      status: "required",
    });
    expect(requireClientSession("https://outside.example")).toEqual({
      loginPath: "/login?returnTo=%2Faccount",
      returnPath: "/account",
      status: "required",
    });
    expect(requireClientSession("/admin").loginPath).toBe("/login?returnTo=%2Faccount");
  });

  it("builds a staff login requirement on the unlinked staff path", () => {
    expect(requireStaffSession("/coach/levels")).toEqual({
      loginPath: "/staff/login?returnTo=%2Fcoach%2Flevels",
      returnPath: "/coach/levels",
      status: "required",
    });
    expect(requireStaffSession("/admin/reports")).toEqual({
      loginPath: "/staff/login?returnTo=%2Fadmin%2Freports",
      returnPath: "/admin/reports",
      status: "required",
    });
    expect(requireStaffSession("https://outside.example")).toEqual({
      loginPath: "/staff/login?returnTo=%2Fadmin",
      returnPath: "/admin",
      status: "required",
    });
    expect(requireStaffSession("/account").returnPath).toBe("/admin");
  });

  it("maps Firebase failures to generic messages without raw details", () => {
    expect(toAuthMessage({ code: "auth/invalid-credential" })).toMatch(/couldn't sign you in/i);
    expect(toAuthMessage({ code: "auth/user-not-found" })).toMatch(/couldn't sign you in/i);
    expect(toAuthMessage({ code: "auth/popup-closed-by-user" })).toMatch(/window was closed/i);
    expect(toAuthMessage({ code: "auth/network-request-failed" })).toMatch(/connect/i);
    expect(toAuthMessage({ code: "auth/internal-error", message: "token=secret" })).not.toContain(
      "token=secret",
    );
    expect(toAuthMessage({ code: "auth/internal-error" })).not.toContain("auth/internal-error");
  });
});
