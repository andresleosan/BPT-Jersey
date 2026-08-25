import { beforeEach, describe, expect, it, vi } from "vitest";

const callableState = vi.hoisted(() => ({
  call: vi.fn(),
}));
const functionsState = vi.hoisted(() => ({
  getFirebaseFunctions: vi.fn(() => ({})),
}));

vi.mock("firebase/functions", () => ({
  httpsCallable: vi.fn(() => callableState.call),
}));
vi.mock("./firebase-client", () => functionsState);

import {
  cancelHealthProfileChangeRequest,
  createHealthProfileChangeRequest,
  getHealthProfile,
} from "./health-client";

const projection = {
  healthProfileId: "student-1",
  studentId: "student-1",
  minimumOperationalSupport: ["supervision"],
  conditionSummary: "Meet guardian at reception.",
  reviewState: "current",
  expiresAt: null,
  status: "active",
  schemaVersion: "1",
} as const;

const request = {
  requestId: "request-1",
  academyId: "academy-1",
  healthProfileId: "student-1",
  studentId: "student-1",
  requestedBy: "guardian-1",
  proposedMinimumOperationalSupport: ["supervision"],
  proposedConditionSummary: "Meet guardian at reception.",
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

describe("health client", () => {
  beforeEach(() => {
    callableState.call.mockReset();
    functionsState.getFirebaseFunctions.mockClear();
  });

  it("parses a redacted guardian projection and omits staff-only fields", async () => {
    callableState.call.mockResolvedValue({ data: projection });
    await expect(getHealthProfile("student-1")).resolves.toEqual(projection);
    expect(callableState.call).toHaveBeenCalledWith({ studentId: "student-1" });
  });

  it("normalizes failures to safe messages and validates request responses", async () => {
    callableState.call.mockRejectedValue(new Error("private backend detail"));
    await expect(getHealthProfile("student-1")).rejects.toThrow("Unable to load health support");
    await expect(getHealthProfile("../private")).rejects.toThrow("Unable to load health support");
  });

  it("creates and cancels a change request through callable boundaries", async () => {
    callableState.call.mockResolvedValueOnce({ data: request }).mockResolvedValueOnce({
      data: { ...request, status: "cancelled", updatedBy: "guardian-1" },
    });
    await expect(
      createHealthProfileChangeRequest({
        studentId: "student-1",
        proposedMinimumOperationalSupport: ["supervision"],
        proposedConditionSummary: "Meet guardian at reception.",
        proposedExpiresAt: null,
      }),
    ).resolves.toEqual(request);
    await expect(cancelHealthProfileChangeRequest("request-1")).resolves.toMatchObject({
      status: "cancelled",
    });
  });
});
