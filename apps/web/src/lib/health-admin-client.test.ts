import { beforeEach, describe, expect, it, vi } from "vitest";

const callableState = vi.hoisted(() => ({
  call: vi.fn(),
}));

vi.mock("firebase/functions", () => ({
  httpsCallable: vi.fn(() => callableState.call),
}));
vi.mock("./firebase-client", () => ({
  getFirebaseFunctions: vi.fn(() => ({})),
}));

import {
  getHealthAdminProfile,
  reviewHealthProfileChangeRequest,
  saveHealthProfile,
} from "./health-client";

const request = {
  requestId: "request-1",
  academyId: "academy-1",
  healthProfileId: "student-1",
  studentId: "student-1",
  requestedBy: "guardian-1",
  proposedMinimumOperationalSupport: ["mobility"],
  proposedConditionSummary: "Clear route.",
  proposedExpiresAt: null,
  status: "pending",
  createdAt: "2026-08-24T10:00:00Z",
  createdBy: "guardian-1",
  updatedAt: "2026-08-24T10:00:00Z",
  updatedBy: "guardian-1",
  schemaVersion: "1",
  reviewedAt: null,
  reviewedBy: null,
} as const;

const profile = {
  healthProfileId: "student-1",
  academyId: "academy-1",
  studentId: "student-1",
  minimumOperationalSupport: ["supervision"],
  conditionSummary: "Meet guardian at reception.",
  staffReferenceLabel: "Meet at reception",
  reviewState: "current",
  expiresAt: null,
  status: "active",
  schemaVersion: "1",
  createdAt: "2026-08-24T09:00:00Z",
  createdBy: "admin-1",
  updatedAt: "2026-08-24T09:00:00Z",
  updatedBy: "admin-1",
  pendingChangeRequest: request,
} as const;

describe("health admin client", () => {
  beforeEach(() => callableState.call.mockReset());

  it("parses the admin projection including a pending request", async () => {
    callableState.call.mockResolvedValue({ data: profile });
    await expect(getHealthAdminProfile("student-1")).resolves.toEqual(profile);
  });

  it("saves a profile through the callable boundary", async () => {
    callableState.call.mockResolvedValue({ data: profile });
    await expect(
      saveHealthProfile({
        studentId: "student-1",
        minimumOperationalSupport: ["supervision"],
        conditionSummary: "Meet guardian at reception.",
        staffReferenceLabel: "Meet at reception",
        expiresAt: null,
      }),
    ).resolves.toEqual(profile);
  });

  it("validates review decisions and normalizes failures", async () => {
    callableState.call.mockResolvedValue({ data: { ...request, status: "approved" } });
    await expect(reviewHealthProfileChangeRequest("request-1", "approve")).resolves.toMatchObject({
      status: "approved",
    });
    await expect(reviewHealthProfileChangeRequest("../private", "approve")).rejects.toThrow(
      "Unable to review the health support request",
    );
  });
});
