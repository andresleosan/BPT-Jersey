import { describe, expect, it } from "vitest";
import {
  parseHealthProfileSaveInput,
  parseHealthProfileChangeRequestInput,
  toHealthProfileProjection,
  type HealthProfile,
} from "./health-contracts.js";

const valid = {
  studentId: "student-1",
  minimumOperationalSupport: ["none"],
  conditionSummary: null,
  staffReferenceLabel: null,
  expiresAt: null,
};
describe("health contracts", () => {
  it("accepts the closed minimum-data vocabulary and rejects none with another code", () => {
    expect(parseHealthProfileSaveInput(valid).ok).toBe(true);
    expect(
      parseHealthProfileSaveInput({ ...valid, minimumOperationalSupport: ["none", "mobility"] }).ok,
    ).toBe(false);
    expect(
      parseHealthProfileSaveInput({ ...valid, minimumOperationalSupport: ["unknown"] }).ok,
    ).toBe(false);
  });
  it("enforces the 1000/25 limits and exact fields", () => {
    expect(parseHealthProfileSaveInput({ ...valid, conditionSummary: "x".repeat(1001) }).ok).toBe(
      false,
    );
    expect(parseHealthProfileSaveInput({ ...valid, staffReferenceLabel: "x".repeat(26) }).ok).toBe(
      false,
    );
    expect(parseHealthProfileSaveInput({ ...valid, extra: true }).ok).toBe(false);
  });
  it("validates guardian request fields independently", () => {
    expect(
      parseHealthProfileChangeRequestInput({
        studentId: "student-1",
        proposedMinimumOperationalSupport: ["communication"],
        proposedConditionSummary: "One step.",
        proposedExpiresAt: null,
      }).ok,
    ).toBe(true);
    expect(
      parseHealthProfileChangeRequestInput({
        studentId: "student-1",
        proposedMinimumOperationalSupport: ["communication"],
        proposedConditionSummary: "<script>",
        proposedExpiresAt: null,
      }).ok,
    ).toBe(false);
  });

  describe("the staff label and the clinical note (T115)", () => {
    const profile: HealthProfile = Object.freeze({
      healthProfileId: "health-1",
      academyId: "academy-1",
      studentId: "student-1",
      minimumOperationalSupport: ["supervision"] as const,
      conditionSummary:
        "Diagnosed asthma since 2019, salbutamol inhaler twice daily, avoids cold rooms.",
      staffReferenceLabel: "Asthma - inhaler in bag",
      reviewState: "current",
      expiresAt: null,
      status: "active",
      schemaVersion: "1",
      createdAt: "2026-01-01T00:00:00.000Z",
      createdBy: "admin-1",
      updatedAt: "2026-01-01T00:00:00.000Z",
      updatedBy: "admin-1",
    });

    it("gives a coach the short label and never the clinical note", () => {
      const staff = toHealthProfileProjection(profile, "staff");
      expect(staff).toEqual({
        healthProfileId: "health-1",
        studentId: "student-1",
        minimumOperationalSupport: ["supervision"],
        staffReferenceLabel: "Asthma - inhaler in bag",
        reviewState: "current",
        expiresAt: null,
        status: "active",
        schemaVersion: "1",
      });
      expect(Object.keys(staff)).not.toContain("conditionSummary");
      expect(JSON.stringify(staff)).not.toContain("salbutamol");
    });

    it("gives the guardian back the note they wrote, and never the staff label", () => {
      const guardian = toHealthProfileProjection(profile, "guardian");
      expect(guardian).toMatchObject({ conditionSummary: profile.conditionSummary });
      expect(Object.keys(guardian)).not.toContain("staffReferenceLabel");
    });

    it("keeps both for administration, which owns the record", () => {
      const admin = toHealthProfileProjection(profile, "admin");
      expect(admin).toMatchObject({
        conditionSummary: profile.conditionSummary,
        staffReferenceLabel: profile.staffReferenceLabel,
      });
    });

    it("keeps the label within the 25 characters the official form allows", () => {
      const label = profile.staffReferenceLabel ?? "";
      expect(label.length).toBeLessThanOrEqual(25);
      expect(
        parseHealthProfileSaveInput({ ...valid, staffReferenceLabel: "x".repeat(25) }).ok,
      ).toBe(true);
      expect(
        parseHealthProfileSaveInput({ ...valid, staffReferenceLabel: "x".repeat(26) }).ok,
      ).toBe(false);
    });

    it("never lets a guardian propose the staff label: it is administration's wording", () => {
      expect(
        parseHealthProfileChangeRequestInput({
          studentId: "student-1",
          proposedMinimumOperationalSupport: ["supervision"],
          proposedConditionSummary: "One step.",
          proposedExpiresAt: null,
          staffReferenceLabel: "Asthma",
        }).ok,
      ).toBe(false);
    });
  });
});
