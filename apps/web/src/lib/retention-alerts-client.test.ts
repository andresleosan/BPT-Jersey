import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  callable: vi.fn(),
  httpsCallable: vi.fn(),
}));

vi.mock("firebase/functions", () => ({
  httpsCallable: mocks.httpsCallable,
}));
vi.mock("./firebase-client", () => ({
  getFirebaseFunctions: () => ({}),
}));

import { listRetentionAlerts } from "./retention-alerts-client";

const validAlert = {
  studentReference: "student-retention",
  kind: "attendance_gap",
  severity: "warning",
  status: "open",
  evidence: {
    lastAttendedAt: "2026-08-01T10:00:00Z",
    noShowCount: 0,
    membershipEndsAt: null,
  },
  createdAt: "2026-08-28T12:00:00Z",
};

describe("retention alerts callable client", () => {
  beforeEach(() => {
    mocks.callable.mockReset();
    mocks.httpsCallable.mockReset();
    mocks.httpsCallable.mockReturnValue(mocks.callable);
  });

  it("calls the read-only callable with null and returns a frozen projection", async () => {
    mocks.callable.mockResolvedValue({ data: { alerts: [validAlert] } });

    const result = await listRetentionAlerts();

    expect(mocks.httpsCallable).toHaveBeenCalledWith({}, "listRetentionAlerts");
    expect(mocks.callable).toHaveBeenCalledWith(null);
    expect(result).toEqual([validAlert]);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result[0])).toBe(true);
  });

  it.each([
    { ...validAlert, academyId: "academy-a" },
    { ...validAlert, alertId: "private-alert-id" },
    { ...validAlert, studentReference: "bad/reference" },
    { ...validAlert, kind: "unknown" },
    { ...validAlert, createdAt: "2026-02-30T12:00:00Z" },
    { ...validAlert, evidence: { ...validAlert.evidence, email: "private@example.test" } },
  ])("rejects malformed or over-broad projections", async (alert) => {
    mocks.callable.mockResolvedValue({ data: { alerts: [alert] } });
    await expect(listRetentionAlerts()).rejects.toThrow(
      "Unable to load retention alerts. Please try again.",
    );
  });

  it("maps backend details and invalid envelopes to one safe error", async () => {
    mocks.callable.mockRejectedValueOnce(new Error("private Firebase stack"));
    await expect(listRetentionAlerts()).rejects.toThrow(
      "Unable to load retention alerts. Please try again.",
    );

    mocks.callable.mockResolvedValueOnce({ data: { alerts: null } });
    await expect(listRetentionAlerts()).rejects.toThrow(
      "Unable to load retention alerts. Please try again.",
    );
  });
});