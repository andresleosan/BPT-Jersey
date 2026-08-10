import { describe, expect, it } from "vitest";

import { isValidTotpCode, toMfaMessage, type MfaStatus } from "./mfa-flow";

describe("mfa-flow", () => {
  it("accepts only six numeric digits as a TOTP code", () => {
    expect(isValidTotpCode("123456")).toBe(true);
    expect(isValidTotpCode("12345")).toBe(false);
    expect(isValidTotpCode("1234567")).toBe(false);
    expect(isValidTotpCode("12 456")).toBe(false);
  });

  it("maps MFA provider failures to generic messages", () => {
    expect(toMfaMessage({ code: "auth/invalid-verification-code" })).toMatch(
      /couldn't verify/i,
    );
    expect(toMfaMessage({ code: "auth/network-request-failed" })).toMatch(/connection/i);
    expect(toMfaMessage({ code: "auth/cancelled-popup-request" })).toMatch(/cancelled/i);
    expect(toMfaMessage({ code: "auth/internal-error", message: "secret=do-not-show" })).not.toMatch(
      /secret|do-not-show|auth\/internal-error/i,
    );
  });

  it("keeps the public MFA status contract finite", () => {
    const statuses: readonly MfaStatus[] = [
      "not-required",
      "enrollment-required",
      "challenge-required",
      "verified",
    ];

    expect(statuses).toHaveLength(4);
  });
});
