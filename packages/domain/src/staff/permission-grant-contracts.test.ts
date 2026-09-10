import { describe, expect, it } from "vitest";

import {
  decidePermissionGrant,
  delegablePermissions,
  evaluateDelegatedPermission,
  isDelegablePermission,
  maxGrantDurationDays,
  parseGrantPermissionCommand,
  parseRevokePermissionCommand,
  permissionGrantStatusAt,
  type PermissionGrant,
} from "./permission-grant-contracts";

const now = "2026-09-05T12:00:00.000Z";
const academyId = "academy-1";

function grant(overrides: Partial<PermissionGrant> = {}): PermissionGrant {
  return {
    grantId: "grant-1",
    academyId,
    subjectUserId: "coach-1",
    permission: "reviewPenalties",
    reason: "Covers the office desk while Ana is away",
    grantedBy: "owner-1",
    grantedAt: "2026-09-01T09:00:00.000Z",
    expiresAt: "2026-10-01T09:00:00.000Z",
    revokedAt: null,
    revokedBy: null,
    revocationReason: null,
    schemaVersion: "1",
    ...overrides,
  };
}

function command(overrides: Record<string, unknown> = {}) {
  return {
    subjectUserId: "coach-1",
    permission: "reviewPenalties",
    reason: "Covers the office desk while Ana is away",
    expiresAt: "2026-10-01T09:00:00.000Z",
    ...overrides,
  };
}

describe("delegable permission list (T116)", () => {
  it("never offers a permission that would let a coach escalate themselves", () => {
    // The closed list is the whole safety argument. If staff administration, money, health or
    // safeguarding ever appear here, a grant stops being a bounded delegation.
    for (const forbidden of [
      "manageStaff",
      "grantPermissions",
      "issueInvoice",
      "readHealth",
      "exportMembers",
      "resolveSafeguarding",
    ]) {
      expect(isDelegablePermission(forbidden)).toBe(false);
    }
    expect([...delegablePermissions]).toEqual(["reviewPenalties", "manageClasses"]);
  });

  it("rejects anything that is not exactly a listed permission", () => {
    expect(isDelegablePermission("reviewpenalties")).toBe(false);
    expect(isDelegablePermission(" reviewPenalties")).toBe(false);
    expect(isDelegablePermission(undefined)).toBe(false);
    expect(isDelegablePermission(null)).toBe(false);
  });
});

describe("permissionGrantStatusAt (T116)", () => {
  it("is active only inside its window", () => {
    expect(permissionGrantStatusAt(grant(), now)).toBe("active");
    expect(permissionGrantStatusAt(grant(), "2026-10-01T09:00:00.000Z")).toBe("expired");
    expect(permissionGrantStatusAt(grant(), "2026-11-01T00:00:00.000Z")).toBe("expired");
  });

  it("treats revocation as immediate and final, whatever the expiry says", () => {
    const revoked = grant({ revokedAt: "2026-09-02T10:00:00.000Z", revokedBy: "owner-1" });
    expect(permissionGrantStatusAt(revoked, now)).toBe("revoked");
    // Still revoked before the revocation instant: the document is dead, not time-travelling.
    expect(permissionGrantStatusAt(revoked, "2026-09-01T10:00:00.000Z")).toBe("revoked");
  });

  it("fails closed on an unreadable date instead of granting access", () => {
    expect(permissionGrantStatusAt(grant({ expiresAt: "not-a-date" }), now)).toBe("expired");
    expect(permissionGrantStatusAt(grant(), "not-a-date")).toBe("expired");
  });
});

describe("evaluateDelegatedPermission (T116)", () => {
  it("allows the holder and names the grant that opened the door", () => {
    const decision = evaluateDelegatedPermission({
      grants: [grant()],
      subjectUserId: "coach-1",
      permission: "reviewPenalties",
      now,
    });
    expect(decision.allowed).toBe(true);
    expect(decision.grantId).toBe("grant-1");
    expect(decision.reason).toContain("owner-1");
  });

  it("never lets one person's grant serve another, or one permission serve another", () => {
    const grants = [grant()];
    expect(
      evaluateDelegatedPermission({
        grants,
        subjectUserId: "coach-2",
        permission: "reviewPenalties",
        now,
      }).allowed,
    ).toBe(false);
    expect(
      evaluateDelegatedPermission({
        grants,
        subjectUserId: "coach-1",
        permission: "manageClasses",
        now,
      }).allowed,
    ).toBe(false);
  });

  it("stops allowing the moment the grant is revoked or expires", () => {
    const revoked = [grant({ revokedAt: "2026-09-02T10:00:00.000Z" })];
    expect(
      evaluateDelegatedPermission({
        grants: revoked,
        subjectUserId: "coach-1",
        permission: "reviewPenalties",
        now,
      }),
    ).toMatchObject({ allowed: false, grantId: null });
    expect(
      evaluateDelegatedPermission({
        grants: [grant()],
        subjectUserId: "coach-1",
        permission: "reviewPenalties",
        now: "2026-12-01T00:00:00.000Z",
      }).allowed,
    ).toBe(false);
  });

  it("refuses on an empty list rather than assuming anything", () => {
    expect(
      evaluateDelegatedPermission({
        grants: [],
        subjectUserId: "coach-1",
        permission: "reviewPenalties",
        now,
      }),
    ).toMatchObject({ allowed: false, grantId: null });
  });

  it("prefers the longest live grant when the same permission was granted twice", () => {
    const decision = evaluateDelegatedPermission({
      grants: [
        grant({ grantId: "short", expiresAt: "2026-09-10T00:00:00.000Z" }),
        grant({ grantId: "long", expiresAt: "2026-09-30T00:00:00.000Z" }),
        grant({ grantId: "dead", revokedAt: "2026-09-02T00:00:00.000Z" }),
      ],
      subjectUserId: "coach-1",
      permission: "reviewPenalties",
      now,
    });
    expect(decision).toMatchObject({ allowed: true, grantId: "long" });
  });
});

describe("parseGrantPermissionCommand (T116)", () => {
  it("accepts exactly the four fields", () => {
    const parsed = parseGrantPermissionCommand(command());
    expect(parsed.ok).toBe(true);
  });

  it("refuses an extra key, a missing key and a non-object", () => {
    expect(parseGrantPermissionCommand({ ...command(), role: "administrator" }).ok).toBe(false);
    const withoutReason = command();
    delete (withoutReason as Record<string, unknown>).reason;
    expect(parseGrantPermissionCommand(withoutReason).ok).toBe(false);
    expect(parseGrantPermissionCommand([command()]).ok).toBe(false);
    expect(parseGrantPermissionCommand(null).ok).toBe(false);
  });

  it("refuses a permission outside the closed list", () => {
    const parsed = parseGrantPermissionCommand(command({ permission: "manageStaff" }));
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error).toContain("not delegable");
  });

  it("requires a reason a human would recognise", () => {
    expect(parseGrantPermissionCommand(command({ reason: "ok" })).ok).toBe(false);
    expect(parseGrantPermissionCommand(command({ reason: "   " })).ok).toBe(false);
    expect(parseGrantPermissionCommand(command({ reason: "x".repeat(201) })).ok).toBe(false);
  });

  it("trims the reason it stores", () => {
    const parsed = parseGrantPermissionCommand(command({ reason: "  Covering the desk  " }));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.value.reason).toBe("Covering the desk");
  });
});

describe("parseRevokePermissionCommand (T116)", () => {
  it("takes a grant and a reason, and nothing else", () => {
    expect(
      parseRevokePermissionCommand({ grantId: "grant-1", reason: "No longer covering" }).ok,
    ).toBe(true);
    expect(
      parseRevokePermissionCommand({
        grantId: "grant-1",
        reason: "No longer covering",
        force: true,
      }).ok,
    ).toBe(false);
    expect(
      parseRevokePermissionCommand({ grantId: "../escape", reason: "No longer covering" }).ok,
    ).toBe(false);
    expect(parseRevokePermissionCommand({ grantId: "grant-1" }).ok).toBe(false);
  });
});

describe("decidePermissionGrant (T116)", () => {
  function base(overrides: Record<string, unknown> = {}) {
    const parsed = parseGrantPermissionCommand(command());
    if (!parsed.ok) throw new Error(parsed.error);
    return {
      command: parsed.value,
      actorId: "owner-1",
      actorRole: "owner",
      subjectRole: "coach" as string | null,
      subjectActive: true,
      academyId,
      grantId: "grant-1",
      now,
      ...overrides,
    };
  }

  it("lets office grant a listed permission to an active coach", () => {
    const decision = decidePermissionGrant(base());
    expect(decision.ok).toBe(true);
    if (decision.ok) {
      expect(decision.value.grant).toMatchObject({
        subjectUserId: "coach-1",
        permission: "reviewPenalties",
        grantedBy: "owner-1",
        revokedAt: null,
      });
    }
  });

  it("refuses every role that is not office, including a head coach", () => {
    for (const role of ["headCoach", "coach", "guardian", "adultStudent"]) {
      const decision = decidePermissionGrant(base({ actorRole: role }));
      expect(decision.ok, role).toBe(false);
    }
    expect(decidePermissionGrant(base({ actorRole: "administrator" })).ok).toBe(true);
  });

  it("refuses a grant to oneself", () => {
    const decision = decidePermissionGrant(base({ actorId: "coach-1" }));
    expect(decision.ok).toBe(false);
    if (!decision.ok) expect(decision.error).toContain("oneself");
  });

  it("refuses a subject who is not grantable staff", () => {
    expect(decidePermissionGrant(base({ subjectRole: null })).ok).toBe(false);
    expect(decidePermissionGrant(base({ subjectRole: "owner" })).ok).toBe(false);
    expect(decidePermissionGrant(base({ subjectRole: "administrator" })).ok).toBe(false);
    expect(decidePermissionGrant(base({ subjectActive: false })).ok).toBe(false);
    expect(decidePermissionGrant(base({ subjectRole: "headCoach" })).ok).toBe(true);
  });

  it("requires an expiry that is ahead and bounded", () => {
    expect(decidePermissionGrant(base({ now: "2026-10-02T00:00:00.000Z" })).ok).toBe(false);
    const parsed = parseGrantPermissionCommand(command({ expiresAt: "2027-06-01T00:00:00.000Z" }));
    if (!parsed.ok) throw new Error(parsed.error);
    const tooLong = decidePermissionGrant(base({ command: parsed.value }));
    expect(tooLong.ok).toBe(false);
    if (!tooLong.ok) expect(tooLong.error).toContain(String(maxGrantDurationDays));
  });

  it("accepts a grant that lands exactly on the maximum duration", () => {
    const expiresAt = new Date(Date.parse(now) + maxGrantDurationDays * 86_400_000).toISOString();
    const parsed = parseGrantPermissionCommand(command({ expiresAt }));
    if (!parsed.ok) throw new Error(parsed.error);
    expect(decidePermissionGrant(base({ command: parsed.value })).ok).toBe(true);
  });
});
