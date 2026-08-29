import { describe, expect, it } from "vitest";
import {
  applyCreditUsage,
  bookingCreditReasons,
  bookingCreditStatuses,
  buildWaitlistId,
  parseBookingCreditRecord,
  parseGrantBookingCreditInput,
  parseJoinWaitlistInput,
  parseWaitlistEntryRecord,
  reverseCreditUsage,
  waitlistStatuses,
} from "./advanced-booking-contracts";

const waitlistRecord = (overrides: Record<string, unknown> = {}) => ({
  waitlistId: "session-1__student-1",
  academyId: "academy-1",
  sessionId: "session-1",
  studentId: "student-1",
  membershipId: "membership-1",
  position: 1,
  status: "waiting",
  requestedAt: "2026-09-01T10:00:00Z",
  offeredAt: null,
  offerExpiresAt: null,
  acceptedAt: null,
  cancelledAt: null,
  schemaVersion: "1",
  createdAt: "2026-09-01T10:00:00Z",
  createdBy: "staff-1",
  updatedAt: "2026-09-01T10:00:00Z",
  updatedBy: "staff-1",
  ...overrides,
});

const creditRecord = (overrides: Record<string, unknown> = {}) => ({
  creditId: "credit-1",
  academyId: "academy-1",
  studentId: "student-1",
  units: 3,
  remainingUnits: 3,
  reason: "session_cancelled",
  expiresAt: "2026-12-01T00:00:00Z",
  relatedSessionId: "session-1",
  status: "available",
  issuedAt: "2026-09-01T10:00:00Z",
  issuedBy: "staff-1",
  schemaVersion: "1",
  createdAt: "2026-09-01T10:00:00Z",
  createdBy: "staff-1",
  updatedAt: "2026-09-01T10:00:00Z",
  updatedBy: "staff-1",
  ...overrides,
});

describe("advanced booking contracts", () => {
  it("freezes enums", () => {
    expect(waitlistStatuses).toEqual(["waiting", "offered", "accepted", "expired", "cancelled"]);
    expect(bookingCreditReasons).toEqual([
      "late_cancel",
      "session_cancelled",
      "admin_grant",
      "manual_adjustment",
    ]);
    expect(bookingCreditStatuses).toEqual(["available", "exhausted", "expired", "voided"]);
    expect(Object.isFrozen(waitlistStatuses)).toBe(true);
    expect(Object.isFrozen(bookingCreditReasons)).toBe(true);
    expect(Object.isFrozen(bookingCreditStatuses)).toBe(true);
  });

  it("parses a waitlist request and builds its deterministic id", () => {
    const result = parseJoinWaitlistInput({
      sessionId: " session-1 ",
      studentId: "student-1",
      membershipId: "membership-1",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.sessionId).toBe("session-1");
      expect(Object.isFrozen(result.value)).toBe(true);
    }
    expect(buildWaitlistId(" session-1 ", " student-1 ")).toBe("session-1__student-1");
  });

  it("rejects malformed waitlist input and invalid status timestamps", () => {
    expect(
      parseJoinWaitlistInput({
        sessionId: "session-1",
        studentId: "",
        membershipId: "membership-1",
        role: "admin",
      }).ok,
    ).toBe(false);
    expect(parseJoinWaitlistInput(null).ok).toBe(false);
    expect(
      parseWaitlistEntryRecord(
        waitlistRecord({
          status: "offered",
          offeredAt: "2026-09-01T10:00:00Z",
          offerExpiresAt: "2026-09-01T09:00:00Z",
        }),
      ).ok,
    ).toBe(false);
    expect(
      parseWaitlistEntryRecord(
        waitlistRecord({
          status: "cancelled",
          cancelledAt: "2026-09-01T11:00:00Z",
          acceptedAt: "2026-09-01T11:01:00Z",
        }),
      ).ok,
    ).toBe(false);
  });

  it("accepts offered and accepted waitlist states", () => {
    expect(
      parseWaitlistEntryRecord(
        waitlistRecord({
          status: "offered",
          offeredAt: "2026-09-01T10:00:00Z",
          offerExpiresAt: "2026-09-01T11:00:00Z",
        }),
      ).ok,
    ).toBe(true);
    expect(
      parseWaitlistEntryRecord(
        waitlistRecord({
          status: "accepted",
          offeredAt: "2026-09-01T10:00:00Z",
          offerExpiresAt: "2026-09-01T11:00:00Z",
          acceptedAt: "2026-09-01T10:30:00Z",
        }),
      ).ok,
    ).toBe(true);
  });

  it("parses grant input and credit records", () => {
    expect(
      parseGrantBookingCreditInput({
        studentId: "student-1",
        units: 2,
        reason: "admin_grant",
        expiresAt: null,
        relatedSessionId: null,
      }).ok,
    ).toBe(true);
    expect(parseBookingCreditRecord(creditRecord()).ok).toBe(true);
  });

  it("rejects invalid credit input and records", () => {
    expect(parseBookingCreditRecord(creditRecord({ remainingUnits: 4 })).ok).toBe(false);
    expect(
      parseBookingCreditRecord(creditRecord({ status: "available", remainingUnits: 0 })).ok,
    ).toBe(false);
    expect(
      parseGrantBookingCreditInput({
        studentId: "student-1",
        units: 0,
        reason: "admin_grant",
        expiresAt: null,
        relatedSessionId: null,
      }).ok,
    ).toBe(false);
  });

  it("supports partial use and exhaustion without mutation", () => {
    const balance = { units: 3, remainingUnits: 3, status: "available" as const };
    expect(applyCreditUsage(balance, 2)).toEqual({
      ok: true,
      value: { units: 3, remainingUnits: 1, status: "available" },
    });
    expect(balance.remainingUnits).toBe(3);
    expect(applyCreditUsage(balance, 3)).toEqual({
      ok: true,
      value: { units: 3, remainingUnits: 0, status: "exhausted" },
    });
  });

  it("reverses usage but never exceeds original units", () => {
    expect(
      reverseCreditUsage({ units: 3, remainingUnits: 0, status: "exhausted" }, 1),
    ).toMatchObject({
      ok: true,
      value: { remainingUnits: 1, status: "available" },
    });
    expect(reverseCreditUsage({ units: 3, remainingUnits: 3, status: "available" }, 1).ok).toBe(
      false,
    );
    expect(reverseCreditUsage({ units: 3, remainingUnits: 1, status: "available" }, 3).ok).toBe(
      false,
    );
    expect(
      reverseCreditUsage({ units: 3, remainingUnits: 1, status: "expired" as never }, 1).ok,
    ).toBe(false);
  });

  it("fails closed for invalid balances", () => {
    expect(applyCreditUsage({ units: 3, remainingUnits: 0, status: "available" }, 1).ok).toBe(
      false,
    );
    expect(applyCreditUsage({ units: 3, remainingUnits: 2, status: "exhausted" }, 1).ok).toBe(
      false,
    );
  });
});

describe("advanced booking strict validation regressions", () => {
  it("rejects impossible calendar dates", () => {
    expect(
      parseWaitlistEntryRecord(
        waitlistRecord({
          requestedAt: "2026-02-30T10:00:00Z",
          createdAt: "2026-02-30T10:00:00Z",
          updatedAt: "2026-02-30T10:00:00Z",
        }),
      ).ok,
    ).toBe(false);
  });

  it("rejects invalid credit reason, expiry, and related session identifiers", () => {
    expect(parseBookingCreditRecord(creditRecord({ reason: "unknown" })).ok).toBe(false);
    expect(parseBookingCreditRecord(creditRecord({ expiresAt: "2026-02-30T00:00:00Z" })).ok).toBe(
      false,
    );
    expect(parseBookingCreditRecord(creditRecord({ relatedSessionId: "bad id" })).ok).toBe(false);
  });
});
