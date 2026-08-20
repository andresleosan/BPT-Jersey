import { describe, expect, it } from "vitest";

import {
  familyPermissions,
  familyStatuses,
  parseFamilyRecord,
  parseFamilyRelationship,
  parseFamilyStudentDraft,
  relationshipStatuses,
  relationshipTypes,
} from "./family-contracts";

const audit = {
  active: true,
  status: "active" as const,
  schemaVersion: "1" as const,
  createdAt: "2026-08-19T10:00:00.000Z",
  createdBy: "admin-1",
  updatedAt: "2026-08-19T10:00:00.000Z",
  updatedBy: "admin-1",
};

const family = {
  familyId: "family-1",
  academyId: "academy-1",
  primaryContactUserId: "user-1",
  billingContactUserId: "user-1",
  ...audit,
};

const relationship = {
  ...audit,
  relationshipId: "family-1--student-1",
  academyId: "academy-1",
  familyId: "family-1",
  studentId: "student-1",
  adultUserId: "user-1",
  relationshipType: "guardian" as const,
  permissions: ["readProfile"] as const,
  validFrom: "2026-08-19T10:00:00.000Z",
  active: true,
  status: "active" as const,
};

const studentDraft = {
  fullName: "Synthetic Minor",
  dateOfBirth: "2015-08-19",
  phoneNumber: "+441234567890",
  email: "minor-contact@example.test",
  trainingCenter: "Town" as const,
  trainingTimePreferences: ["afternoon", "evening"] as const,
};

describe("family contracts", () => {
  it("exposes the exact immutable family and relationship enums", () => {
    expect(familyStatuses).toEqual(["active", "inactive"]);
    expect(relationshipStatuses).toEqual(["active", "inactive"]);
    expect(relationshipTypes).toEqual(["guardian"]);
    expect(familyPermissions).toEqual(["readProfile"]);
    expect(Object.isFrozen(familyStatuses)).toBe(true);
    expect(Object.isFrozen(relationshipStatuses)).toBe(true);
    expect(Object.isFrozen(relationshipTypes)).toBe(true);
    expect(Object.isFrozen(familyPermissions)).toBe(true);
  });

  it("parses and freezes a valid family, guardian relationship, and minor draft", () => {
    const parsedFamily = parseFamilyRecord(family);
    const parsedRelationship = parseFamilyRelationship(relationship);
    const parsedDraft = parseFamilyStudentDraft(studentDraft);

    expect(parsedFamily).toEqual({ ok: true, value: family });
    expect(parsedRelationship).toEqual({ ok: true, value: relationship });
    expect(parsedDraft).toEqual({ ok: true, value: studentDraft });
    expect(parsedFamily.ok && Object.isFrozen(parsedFamily.value)).toBe(true);
    expect(parsedRelationship.ok && Object.isFrozen(parsedRelationship.value)).toBe(true);
    expect(parsedRelationship.ok && Object.isFrozen(parsedRelationship.value.permissions)).toBe(
      true,
    );
    expect(parsedDraft.ok && Object.isFrozen(parsedDraft.value)).toBe(true);
    expect(parsedDraft.ok && Object.isFrozen(parsedDraft.value.trainingTimePreferences)).toBe(true);
  });

  it("accepts an optional familyId on an existing T021 participant", async () => {
    const { parseStudentProfile } = await import("../profiles/profile-contracts");
    const result = parseStudentProfile({
      studentId: "student-1",
      academyId: "academy-1",
      familyId: "family-1",
      userId: "user-1",
      fullName: "Synthetic Adult",
      dateOfBirth: "1990-01-02",
      trainingCenter: "Town",
      trainingTimePreferences: ["morning"],
      participantType: "adult",
      active: true,
      status: "active",
      schemaVersion: "1",
      createdAt: "2026-08-19T10:00:00.000Z",
      createdBy: "user-1",
      updatedAt: "2026-08-19T10:00:00.000Z",
      updatedBy: "user-1",
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.familyId).toBe("family-1");
  });

  it("rejects duplicate or empty permissions and invalid relationship values", () => {
    const cases = [
      { ...relationship, permissions: [] },
      { ...relationship, permissions: ["readProfile", "readProfile"] },
      { ...relationship, relationshipType: "parent" },
      { ...relationship, status: "deleted" },
      { ...relationship, validFrom: "2026-02-30T10:00:00.000Z" },
      { ...relationship, academyId: "other/academy" },
    ];

    for (const candidate of cases) {
      expect(parseFamilyRelationship(candidate).ok).toBe(false);
    }
  });

  it("rejects invalid family status, contacts, dates, and tenant-shaped IDs", () => {
    const cases = [
      { ...family, status: "deleted" },
      { ...family, primaryContactUserId: "" },
      { ...family, billingContactUserId: "user-2" },
      { ...family, createdAt: "2026-02-30T10:00:00.000Z" },
      { ...family, familyId: "academy-1/family-1" },
      { ...family, academyId: "  academy-1" },
    ];

    for (const candidate of cases) {
      expect(parseFamilyRecord(candidate).ok).toBe(false);
    }
  });

  it("rejects forbidden minor authority and cross-domain fields", () => {
    const forbiddenFields = [
      "medicalConditions",
      "waiver",
      "membershipId",
      "belt",
      "stripe",
      "userId",
      "participantType",
      "familyId",
    ];

    for (const field of forbiddenFields) {
      expect(parseFamilyStudentDraft({ ...studentDraft, [field]: "forbidden" }).ok).toBe(false);
    }
  });

  it("rejects duplicate preferences, impossible dates, empty text, and invalid centers", () => {
    const cases = [
      { ...studentDraft, fullName: "" },
      { ...studentDraft, dateOfBirth: "2099-08-20" },
      { ...studentDraft, dateOfBirth: "2015-02-30" },
      { ...studentDraft, trainingCenter: "South" },
      { ...studentDraft, trainingTimePreferences: [] },
      { ...studentDraft, trainingTimePreferences: ["morning", "morning"] },
      { ...studentDraft, trainingTimePreferences: ["night"] },
      { ...studentDraft, phoneNumber: "\u0000" },
      { ...studentDraft, email: "not-an-email" },
    ];

    for (const candidate of cases) {
      expect(parseFamilyStudentDraft(candidate).ok).toBe(false);
    }
  });

  it("rejects enumerable, non-enumerable, symbol, prototype, and extra fields", () => {
    const customPrototype = Object.assign(Object.create({ inherited: true }), family);
    const symbolic = { ...family };
    Object.defineProperty(symbolic, Symbol("secret"), { value: "hidden", enumerable: true });
    const hidden = { ...family };
    Object.defineProperty(hidden, "secret", { value: "hidden", enumerable: false });

    expect(parseFamilyRecord(customPrototype).ok).toBe(false);
    expect(parseFamilyRecord(symbolic).ok).toBe(false);
    expect(parseFamilyRecord(hidden).ok).toBe(false);
    expect(parseFamilyRecord({ ...family, medicalConditions: "never" }).ok).toBe(false);
  });
});
