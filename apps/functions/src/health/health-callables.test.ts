import { describe, expect, it, vi } from "vitest";
import {
  getHealthProfileHandler,
  saveHealthProfileHandler,
  type HealthCallableServices,
} from "./health-callables.js";
const projection = {
  healthProfileId: "student-1",
  studentId: "student-1",
  minimumOperationalSupport: ["mobility"],
  conditionSummary: null,
  reviewState: "current",
  expiresAt: null,
  status: "active",
  schemaVersion: "1",
} as const;
function request(data: unknown, role = "owner") {
  return { data, auth: { uid: "owner-1", token: { academyId: "academy-1", role } } } as never;
}
function services(pilotEnabled = true): HealthCallableServices {
  return {
    pilotEnabled,
    store: {
      getHealthProfile: vi.fn(async () => projection),
      saveHealthProfile: vi.fn(async () => ({
        ...projection,
        academyId: "academy-1",
        staffReferenceLabel: null,
        createdAt: "2026-08-24T12:00:00Z",
        createdBy: "owner-1",
        updatedAt: "2026-08-24T12:00:00Z",
        updatedBy: "owner-1",
        pendingChangeRequest: null,
      })),
      deactivateHealthProfile: vi.fn(),
      createChangeRequest: vi.fn(),
      cancelChangeRequest: vi.fn(),
      reviewChangeRequest: vi.fn(),
    } as never,
  };
}
describe("health callables", () => {
  it("fails closed outside the synthetic pilot", async () => {
    await expect(
      getHealthProfileHandler(request({ studentId: "student-1" }), services(false)),
    ).rejects.toMatchObject({ code: "failed-precondition" });
  });
  it("verifies role and delegates only a validated payload", async () => {
    const current = services();
    await expect(
      saveHealthProfileHandler(
        request({
          studentId: "student-1",
          minimumOperationalSupport: ["mobility"],
          conditionSummary: null,
          staffReferenceLabel: null,
          expiresAt: null,
        }),
        current,
      ),
    ).resolves.toMatchObject({ studentId: "student-1" });
    await expect(
      saveHealthProfileHandler(
        request(
          {
            studentId: "student-1",
            minimumOperationalSupport: ["mobility"],
            conditionSummary: null,
            staffReferenceLabel: null,
            expiresAt: null,
          },
          "guardian",
        ),
        current,
      ),
    ).rejects.toMatchObject({ code: "permission-denied" });
  });
});
