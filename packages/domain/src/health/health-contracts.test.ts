import { describe, expect, it } from "vitest";
import {
  parseHealthProfileSaveInput,
  parseHealthProfileChangeRequestInput,
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
});
