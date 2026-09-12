import { describe, expect, it, vi } from "vitest";
import {
  getHealthProfileHandler,
  listHealthReferencesHandler,
  saveHealthProfileHandler,
  type HealthCallableServices,
} from "./health-callables.js";
const row = {
  studentId: "student-1",
  displayName: "Ana Coelho",
  staffReferenceLabel: "ASTHMA-INHALER",
} as const;
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
      listReferences: vi.fn(async () => [row]),
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

  it("lists the references for every staff role and for nobody else", async () => {
    const current = services();
    for (const role of ["owner", "administrator", "headCoach", "coach"]) {
      await expect(listHealthReferencesHandler(request(null, role), current)).resolves.toEqual({
        references: [row],
      });
    }
    await expect(
      listHealthReferencesHandler(request(null, "guardian"), current),
    ).rejects.toMatchObject({ code: "permission-denied" });
    await expect(
      listHealthReferencesHandler(request({ studentId: "x" }), current),
    ).rejects.toMatchObject({ code: "invalid-argument" });
    await expect(listHealthReferencesHandler(request(null), services(false))).rejects.toMatchObject(
      { code: "failed-precondition" },
    );
  });

  it("lets the mat save the staff reference label", async () => {
    const payload = {
      studentId: "student-1",
      minimumOperationalSupport: ["mobility"],
      conditionSummary: null,
      staffReferenceLabel: "ASTHMA-INHALER",
      expiresAt: null,
    };
    for (const role of ["headCoach", "coach"]) {
      await expect(
        saveHealthProfileHandler(request(payload, role), services()),
      ).resolves.toMatchObject({ studentId: "student-1" });
    }
  });
});
