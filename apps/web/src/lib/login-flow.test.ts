import { describe, expect, it } from "vitest";

import {
  defaultDestination,
  requireClientSession,
  sanitizeReturnPath,
  toAuthMessage,
} from "./login-flow";

describe("login-flow", () => {
  it("accepts only exact internal destinations", () => {
    expect(sanitizeReturnPath("/admin")).toBe("/admin");
    expect(sanitizeReturnPath("/account")).toBe("/account");
    expect(sanitizeReturnPath("/shop")).toBe("/shop");
    expect(sanitizeReturnPath("/checkout")).toBe("/checkout");
    expect(sanitizeReturnPath("https://outside.example")).toBeUndefined();
    expect(sanitizeReturnPath("//outside.example")).toBeUndefined();
    expect(sanitizeReturnPath("/shop?next=https://outside.example")).toBeUndefined();
    expect(sanitizeReturnPath("/unknown")).toBeUndefined();
    expect(sanitizeReturnPath(null)).toBeUndefined();
  });

  it("keeps administrator access on the admin destination", () => {
    expect(defaultDestination("administrator", "/account")).toBe("/admin");
    expect(defaultDestination("administrator")).toBe("/admin");
  });

  it("uses an allowlisted client return path or account by default", () => {
    expect(defaultDestination("client", "/shop")).toBe("/shop");
    expect(defaultDestination("client", "/checkout")).toBe("/checkout");
    expect(defaultDestination("client")).toBe("/account");
  });

  it("builds a client login requirement without allowing an external return", () => {
    expect(requireClientSession("/checkout")).toEqual({
      loginPath: "/login?role=client&returnTo=%2Fcheckout",
      returnPath: "/checkout",
      status: "required",
    });
    expect(requireClientSession("https://outside.example")).toEqual({
      loginPath: "/login?role=client&returnTo=%2Faccount",
      returnPath: "/account",
      status: "required",
    });
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
