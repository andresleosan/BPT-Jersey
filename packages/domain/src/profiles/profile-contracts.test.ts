import { describe, expect, it } from "vitest";

import {
  deriveParticipantType,
  parseStudentProfile,
  parseStudentProfileAt,
  parseUserProfile,
  participantTypes,
  trainingCenters,
  trainingTimePreferences,
} from "./profile-contracts";

const userProfile = {
  userId: "user-1",
  academyId: "academy-1",
  accountType: "client",
  displayName: "Synthetic Adult",
  email: "adult@example.test",
  phoneNumber: "+441234567890",
  active: true,
  status: "active",
  schemaVersion: "1",
  createdAt: "2026-08-18T10:00:00.000Z",
  createdBy: "user-1",
  updatedAt: "2026-08-18T10:00:00.000Z",
  updatedBy: "user-1",
} as const;

const studentProfile = {
  studentId: "student-1",
  academyId: "academy-1",
  userId: "user-1",
  fullName: "Synthetic Adult",
  dateOfBirth: "1990-01-02",
  phoneNumber: "+441234567890",
  email: "adult@example.test",
  trainingCenter: "Town",
  trainingTimePreferences: ["morning", "evening"],
  participantType: "adult",
  active: true,
  status: "active",
  schemaVersion: "1",
  createdAt: "2026-08-18T10:00:00.000Z",
  createdBy: "user-1",
  updatedAt: "2026-08-18T10:00:00.000Z",
  updatedBy: "user-1",
} as const;

describe("profile contracts", () => {
  it("exposes exact immutable profile enums", () => {
    expect(trainingCenters).toEqual(["Town", "West"]);
    expect(trainingTimePreferences).toEqual(["morning", "afternoon", "evening"]);
    expect(participantTypes).toEqual(["adult", "minor"]);
    expect(Object.isFrozen(trainingCenters)).toBe(true);
    expect(Object.isFrozen(trainingTimePreferences)).toBe(true);
    expect(Object.isFrozen(participantTypes)).toBe(true);
  });

  it("parses and freezes a valid adult user and student profile", () => {
    const user = parseUserProfile(userProfile);
    const student = parseStudentProfile(studentProfile);

    expect(user).toEqual({ ok: true, value: userProfile });
    expect(student).toEqual({ ok: true, value: studentProfile });
    expect(user.ok && Object.isFrozen(user.value)).toBe(true);
    expect(student.ok && Object.isFrozen(student.value)).toBe(true);
    expect(student.ok && Object.isFrozen(student.value.trainingTimePreferences)).toBe(true);
  });

  it("parses a minor without an Auth user or family relationship", () => {
    const minorInput = { ...studentProfile } as Record<string, unknown>;
    delete minorInput.userId;
    delete minorInput.email;
    delete minorInput.phoneNumber;
    const minor = parseStudentProfile({
      ...minorInput,
      studentId: "student-minor-1",
      fullName: "Synthetic Minor",
      dateOfBirth: "2015-08-19",
      participantType: "minor",
    });

    expect(minor.ok).toBe(true);
    if (minor.ok) {
      expect(minor.value).not.toHaveProperty("userId");
      expect(minor.value).not.toHaveProperty("familyId");
    }
  });

  it("derives age boundary using the server day", () => {
    expect(deriveParticipantType("2008-08-18", "2026-08-18")).toBe("adult");
    expect(deriveParticipantType("2008-08-19", "2026-08-18")).toBe("minor");
    expect(deriveParticipantType("2008-08-17", "2026-08-18")).toBe("adult");
  });

  it("validates stored participant type against an explicit server effective date", () => {
    expect(parseStudentProfileAt(studentProfile, "2026-09-03").ok).toBe(true);
    expect(
      parseStudentProfileAt(
        { ...studentProfile, dateOfBirth: "2008-09-04", participantType: "minor" },
        "2026-09-03",
      ).ok,
    ).toBe(true);
    expect(
      parseStudentProfileAt(
        { ...studentProfile, dateOfBirth: "2008-09-04", participantType: "adult" },
        "2026-09-03",
      ),
    ).toEqual({
      ok: false,
      error: expect.arrayContaining([{ path: ["participantType"], code: "age_mismatch" }]),
    });
    expect(parseStudentProfileAt(studentProfile, "2026-02-30")).toEqual({
      ok: false,
      error: [{ path: ["effectiveDate"], code: "invalid_date" }],
    });
  });

  it("rejects impossible dates, future birth dates, and invalid enum values", () => {
    const cases = [
      { ...studentProfile, dateOfBirth: "2026-02-30" },
      { ...studentProfile, dateOfBirth: "2099-01-01" },
      { ...studentProfile, trainingCenter: "South" },
      { ...studentProfile, trainingTimePreferences: [] },
      { ...studentProfile, trainingTimePreferences: ["morning", "morning"] },
      { ...studentProfile, trainingTimePreferences: ["night"] },
      { ...studentProfile, participantType: "guardian" },
      { ...studentProfile, status: "deleted" },
    ];

    for (const candidate of cases) {
      expect(parseStudentProfile(candidate).ok).toBe(false);
    }
  });

  it("rejects unexpected and domain-mixing fields", () => {
    const cases = [
      { ...studentProfile, medicalConditions: "never" },
      { ...studentProfile, guardian: { userId: "guardian-1" } },
      { ...studentProfile, waiver: true },
      { ...studentProfile, belt: "white" },
      { ...studentProfile, stripe: 1 },
      { ...studentProfile, token: "secret" },
    ];

    for (const candidate of cases) {
      expect(parseStudentProfile(candidate).ok).toBe(false);
    }
  });

  it("rejects custom prototypes, symbols, and non-enumerable fields", () => {
    const customPrototype = Object.assign(Object.create({ inherited: true }), studentProfile);
    const symbolic = { ...studentProfile };
    Object.defineProperty(symbolic, Symbol("secret"), { value: "hidden", enumerable: true });
    const hidden = { ...studentProfile };
    Object.defineProperty(hidden, "secret", { value: "hidden", enumerable: false });

    expect(parseStudentProfile(customPrototype).ok).toBe(false);
    expect(parseStudentProfile(symbolic).ok).toBe(false);
    expect(parseStudentProfile(hidden).ok).toBe(false);
  });
});
