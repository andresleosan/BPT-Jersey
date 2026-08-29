import { describe, expect, it } from "vitest";

import { parseStoredWaitlist, WaitlistStoreError } from "./advanced-booking-service";

const record = (overrides: Record<string, unknown> = {}) => ({
  waitlistId: "session-1__student-1",
  academyId: "academy-1",
  sessionId: "session-1",
  studentId: "student-1",
  membershipId: "membership-1",
  position: 1,
  status: "waiting",
  requestedAt: "2026-08-28T12:00:00Z",
  offeredAt: null,
  offerExpiresAt: null,
  acceptedAt: null,
  cancelledAt: null,
  schemaVersion: "1",
  createdAt: "2026-08-28T12:00:00Z",
  createdBy: "actor-1",
  updatedAt: "2026-08-28T12:00:00Z",
  updatedBy: "actor-1",
  ...overrides,
});

describe("advanced booking waitlist store boundary", () => {
  it("accepts an exact deterministic tenant-scoped record", () => {
    const parsed = parseStoredWaitlist(record(), "academy-1", "session-1__student-1");
    expect(parsed.status).toBe("waiting");
    expect(parsed.position).toBe(1);
  });

  it("rejects cross-tenant and altered document identities", () => {
    expect(() => parseStoredWaitlist(record(), "academy-2")).toThrowError(
      expect.objectContaining<Partial<WaitlistStoreError>>({ code: "tenant" }),
    );
    expect(() => parseStoredWaitlist(record(), "academy-1", "other-id")).toThrowError(
      expect.objectContaining<Partial<WaitlistStoreError>>({ code: "conflict" }),
    );
  });

  it("rejects unknown fields and impossible calendar dates", () => {
    expect(() =>
      parseStoredWaitlist({ ...record(), email: "hidden@example.test" }, "academy-1"),
    ).toThrowError(expect.objectContaining<Partial<WaitlistStoreError>>({ code: "invalid" }));
    expect(() =>
      parseStoredWaitlist(
        record({
          requestedAt: "2026-02-30T12:00:00Z",
          createdAt: "2026-02-30T12:00:00Z",
          updatedAt: "2026-02-30T12:00:00Z",
        }),
        "academy-1",
      ),
    ).toThrowError(expect.objectContaining<Partial<WaitlistStoreError>>({ code: "invalid" }));
  });
});
