import { describe, expect, it } from "vitest";

import { userRoles } from "../actor-context";
import {
  canReadRegyfitAccess,
  canReadRestrictedIp,
  parseAdminClaims,
  parseUserClaims,
} from "./admin-contracts";

describe("administrative identity contracts", () => {
  it("parses every academy-scoped MVP user role without granting admin access", () => {
    for (const role of userRoles) {
      const result = parseUserClaims({ academyId: "academy-demo", role });

      expect(result).toEqual({
        ok: true,
        value: { academyId: "academy-demo", role },
      });
      expect(Object.isFrozen(result.ok ? result.value : undefined)).toBe(true);
    }

    for (const role of ["headCoach", "coach", "guardian", "adultStudent"] as const) {
      expect(parseAdminClaims({ academyId: "academy-demo", role }).ok).toBe(false);
    }
  });

  it("rejects malformed user claims and unknown fields", () => {
    expect(parseUserClaims({ academyId: "academy-demo", role: "minor" }).ok).toBe(false);
    expect(parseUserClaims({ academyId: " ", role: "guardian" }).ok).toBe(false);
    expect(
      parseUserClaims({ academyId: "academy-demo", role: "guardian", familyId: "family-1" }).ok,
    ).toBe(false);
  });

  it("accepts only an academy-scoped owner or administrator claim", () => {
    expect(parseAdminClaims({ academyId: "academy-demo", role: "owner" }).ok).toBe(true);
    expect(parseAdminClaims({ academyId: "academy-demo", role: "administrator" }).ok).toBe(true);
    expect(parseAdminClaims({ academyId: "academy-demo", role: "coach" }).ok).toBe(false);
  });

  it("rejects empty academy IDs and unknown claim fields", () => {
    expect(parseAdminClaims({ academyId: "", role: "owner" }).ok).toBe(false);
    expect(parseAdminClaims({ academyId: "   ", role: "owner" }).ok).toBe(false);
    expect(
      parseAdminClaims({ academyId: "academy-demo", role: "owner", uid: "synthetic" }).ok,
    ).toBe(false);
  });

  it("rejects non-enumerable unknown claim fields", () => {
    const claims = { academyId: "academy-demo", role: "owner" };
    Object.defineProperty(claims, "uid", { value: "synthetic", enumerable: false });

    expect(parseAdminClaims(claims).ok).toBe(false);
  });

  it("returns a frozen claim value after successful parsing", () => {
    const result = parseAdminClaims({ academyId: "academy-demo", role: "owner" });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(Object.isFrozen(result.value)).toBe(true);
      expect(result.value).toEqual({ academyId: "academy-demo", role: "owner" });
    }
  });

  it("does not grant Regyfit access to non-administrative roles", () => {
    expect(canReadRegyfitAccess("owner")).toBe(true);
    expect(canReadRegyfitAccess("administrator")).toBe(true);
    expect(canReadRegyfitAccess("coach")).toBe(false);
    expect(canReadRegyfitAccess("guardian")).toBe(false);
    expect(canReadRestrictedIp("owner")).toBe(true);
    expect(canReadRestrictedIp("administrator")).toBe(false);
  });
});
