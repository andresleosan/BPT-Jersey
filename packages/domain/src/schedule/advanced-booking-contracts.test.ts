import { describe, expect, it } from "vitest";
import {
  applyCreditUsage,
  bookingCreditReasons,
  bookingCreditStatuses,
  buildWaitlistId,
  buildWaitlistIdCandidates,
  buildWaitlistIdV2,
  buildLegacyWaitlistId,
  compareDateTimes,
  parseBookingCreditRecord,
  parseGrantBookingCreditInput,
  parseIssueNextWaitlistOfferInput,
  parseJoinWaitlistInput,
  parseRespondToWaitlistOfferInput,
  parseWaitlistEntryRecord,
  reverseCreditUsage,
  waitlistOfferResponses,
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
    expect(waitlistOfferResponses).toEqual(["accept", "decline"]);
    expect(Object.isFrozen(waitlistStatuses)).toBe(true);
    expect(Object.isFrozen(bookingCreditReasons)).toBe(true);
    expect(Object.isFrozen(bookingCreditStatuses)).toBe(true);
    expect(Object.isFrozen(waitlistOfferResponses)).toBe(true);
  });

  it("parses a waitlist request and exposes canonical plus legacy ids explicitly", () => {
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
    const canonical = "v2:9:session-1:9:student-1";
    expect(buildWaitlistId(" session-1 ", " student-1 ")).toBe(canonical);
    expect(buildWaitlistIdV2(" session-1 ", " student-1 ")).toBe(canonical);
    expect(buildLegacyWaitlistId(" session-1 ", " student-1 ")).toBe("session-1__student-1");
    expect(buildWaitlistIdCandidates(" session-1 ", " student-1 ")).toEqual([
      canonical,
      "session-1__student-1",
    ]);
    expect(Object.isFrozen(buildWaitlistIdCandidates("session-1", "student-1"))).toBe(true);
  });

  it("keeps v2 waitlist ids injective when legacy ids collide", () => {
    expect(buildLegacyWaitlistId("session__student", "one")).toBe(
      buildLegacyWaitlistId("session", "student__one"),
    );
    expect(buildWaitlistIdV2("session__student", "one")).not.toBe(
      buildWaitlistIdV2("session", "student__one"),
    );
  });

  it("compares RFC 3339 instants across offsets and nanosecond precision", () => {
    expect(compareDateTimes("2099-09-01T11:30:00+01:00", "2099-09-01T11:00:00Z")).toBe(-1);
    expect(
      compareDateTimes("2099-09-01T10:00:00.000000002Z", "2099-09-01T10:00:00.000000001Z"),
    ).toBe(1);
    expect(compareDateTimes("2099-09-01T10:00:00Z", "2099-09-01T11:00:00+01:00")).toBe(0);
  });

  it("parses exact issue and response commands", () => {
    const issue = parseIssueNextWaitlistOfferInput({ sessionId: " session-1 " });
    expect(issue).toEqual({ ok: true, value: { sessionId: "session-1" } });
    if (issue.ok) {
      expect(Object.isFrozen(issue.value)).toBe(true);
    }

    const response = parseRespondToWaitlistOfferInput({
      sessionId: " session-1 ",
      studentId: " student-1 ",
      response: "accept",
    });
    expect(response).toEqual({
      ok: true,
      value: {
        sessionId: "session-1",
        studentId: "student-1",
        response: "accept",
      },
    });
    if (response.ok) {
      expect(Object.isFrozen(response.value)).toBe(true);
    }
  });

  it("rejects hostile or over-posted offer commands without invoking accessors", () => {
    let getterCalls = 0;
    const accessor = Object.defineProperty({}, "sessionId", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return "session-1";
      },
    });
    const inherited = Object.create({ sessionId: "session-1" }) as Record<string, unknown>;
    const hostileProxy = new Proxy(
      {},
      {
        getPrototypeOf: () => Object.prototype,
        ownKeys: () => {
          throw new Error("hostile ownKeys");
        },
      },
    );

    expect(parseIssueNextWaitlistOfferInput(null).ok).toBe(false);
    expect(parseIssueNextWaitlistOfferInput({ sessionId: "" }).ok).toBe(false);
    expect(parseIssueNextWaitlistOfferInput({ sessionId: "bad id" }).ok).toBe(false);
    expect(
      parseIssueNextWaitlistOfferInput({ sessionId: "session-1", academyId: "academy-1" }).ok,
    ).toBe(false);
    expect(parseIssueNextWaitlistOfferInput(accessor).ok).toBe(false);
    expect(getterCalls).toBe(0);
    expect(parseIssueNextWaitlistOfferInput(inherited).ok).toBe(false);
    expect(() => parseIssueNextWaitlistOfferInput(hostileProxy)).not.toThrow();
    expect(parseIssueNextWaitlistOfferInput(hostileProxy).ok).toBe(false);
    expect(
      parseRespondToWaitlistOfferInput({
        sessionId: "session-1",
        studentId: "student-1",
        response: "approve",
      }).ok,
    ).toBe(false);
    expect(
      parseRespondToWaitlistOfferInput({
        sessionId: "session-1",
        studentId: "student-1",
        response: "decline",
        membershipId: "membership-1",
      }).ok,
    ).toBe(false);
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
          updatedAt: "2026-09-01T10:30:00Z",
        }),
      ).ok,
    ).toBe(true);
  });

  it("accepts only before the exclusive offer expiration boundary", () => {
    expect(
      parseWaitlistEntryRecord(
        waitlistRecord({
          status: "accepted",
          offeredAt: "2026-09-01T10:00:00Z",
          offerExpiresAt: "2026-09-01T11:00:00Z",
          acceptedAt: "2026-09-01T10:59:59.999Z",
          updatedAt: "2026-09-01T10:59:59.999Z",
        }),
      ).ok,
    ).toBe(true);
    expect(
      parseWaitlistEntryRecord(
        waitlistRecord({
          status: "accepted",
          offeredAt: "2026-09-01T10:00:00Z",
          offerExpiresAt: "2026-09-01T11:00:00.000000002Z",
          acceptedAt: "2026-09-01T11:00:00.000000001Z",
          updatedAt: "2026-09-01T11:00:00.000000001Z",
        }),
      ).ok,
    ).toBe(true);
    for (const acceptedAt of ["2026-09-01T09:59:59Z", "2026-09-01T11:00:00Z"]) {
      expect(
        parseWaitlistEntryRecord(
          waitlistRecord({
            status: "accepted",
            offeredAt: "2026-09-01T10:00:00Z",
            offerExpiresAt: "2026-09-01T11:00:00Z",
            acceptedAt,
            updatedAt: "2026-09-01T11:00:00Z",
          }),
        ).ok,
      ).toBe(false);
    }
  });

  it("treats expiration as active at the exact boundary and decline as pre-boundary only", () => {
    expect(
      parseWaitlistEntryRecord(
        waitlistRecord({
          status: "expired",
          offeredAt: "2026-09-01T10:00:00Z",
          offerExpiresAt: "2026-09-01T11:00:00Z",
          updatedAt: "2026-09-01T11:00:00Z",
        }),
      ).ok,
    ).toBe(true);
    expect(
      parseWaitlistEntryRecord(
        waitlistRecord({
          status: "expired",
          offeredAt: "2026-09-01T10:00:00Z",
          offerExpiresAt: "2026-09-01T11:00:00Z",
          updatedAt: "2026-09-01T10:59:59.999Z",
        }),
      ).ok,
    ).toBe(false);
    expect(
      parseWaitlistEntryRecord(
        waitlistRecord({
          status: "cancelled",
          offeredAt: "2026-09-01T10:00:00Z",
          offerExpiresAt: "2026-09-01T11:00:00Z",
          cancelledAt: "2026-09-01T10:30:00Z",
          updatedAt: "2026-09-01T10:30:00Z",
        }),
      ).ok,
    ).toBe(true);
    expect(
      parseWaitlistEntryRecord(
        waitlistRecord({
          status: "cancelled",
          offeredAt: "2026-09-01T10:00:00Z",
          offerExpiresAt: "2026-09-01T11:00:00Z",
          cancelledAt: "2026-09-01T11:00:00Z",
          updatedAt: "2026-09-01T11:00:00Z",
        }),
      ).ok,
    ).toBe(false);
  });

  it("rejects waitlist timelines that move backwards or omit offer context", () => {
    expect(
      parseWaitlistEntryRecord(
        waitlistRecord({
          status: "offered",
          offeredAt: "2026-09-01T09:59:59Z",
          offerExpiresAt: "2026-09-01T11:00:00Z",
        }),
      ).ok,
    ).toBe(false);
    expect(
      parseWaitlistEntryRecord(
        waitlistRecord({
          status: "accepted",
          offeredAt: "2026-09-01T10:00:00Z",
          acceptedAt: "2026-09-01T10:30:00Z",
          updatedAt: "2026-09-01T10:30:00Z",
        }),
      ).ok,
    ).toBe(false);
  });

  it("accepts canonical waitlist ids longer than a single identifier", () => {
    const sessionId = `s${"a".repeat(127)}`;
    const studentId = `u${"b".repeat(127)}`;
    const waitlistId = buildWaitlistIdV2(sessionId, studentId);

    expect(waitlistId.length).toBeGreaterThan(128);
    expect(
      parseWaitlistEntryRecord(
        waitlistRecord({
          waitlistId,
          sessionId,
          studentId,
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
