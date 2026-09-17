import { describe, expect, it } from "vitest";

import type { MemberDetails } from "@bpt-jersey/domain/members/profile";

import {
  countryOptions,
  draftFromDetails,
  idExpiryNotice,
  isDraftDirty,
  joinPhoneNumber,
  payloadFromDraft,
  splitPhoneNumber,
} from "./details-form-model";

const requestId = "41cbb1aa-7020-4bb5-88a4-dbc73c5f0123";

const details: MemberDetails = {
  studentId: "student-1",
  fullName: "Test Member A",
  dateOfBirth: "2000-09-17",
  phoneNumber: "+44 7700900000",
  email: "member-a@example.test",
  trainingCenter: "West",
  trainingTimePreferences: ["morning", "evening"],
  participantType: "adult",
  active: true,
  status: "active",
  membershipNumber: "0000",
  gender: "female",
  frequencyNote: "Twice weekly",
  postalAddress: { line: "1 Test Street", postCode: "JE0 0AA" },
  details: {
    shortName: "Test A",
    country: "JE",
    weightKg: 70.5,
    heightCm: 175,
    howHeard: "Website",
    internalNotes: "Line one\nLine two",
  },
};

describe("DETAILS form model", () => {
  it("round-trips a loaded record into the same update payload", () => {
    const draft = draftFromDetails(details);
    expect(draft.phoneCountryCode).toBe("+44");
    expect(draft.phoneLocalNumber).toBe("7700900000");
    expect(draft.weightKg).toBe("70.5");
    const result = payloadFromDraft(details, draft, requestId);
    expect(result).toEqual({
      ok: true,
      payload: {
        studentId: "student-1",
        requestId,
        fullName: "Test Member A",
        dateOfBirth: "2000-09-17",
        phoneNumber: "+44 7700900000",
        email: "member-a@example.test",
        trainingCenter: "West",
        trainingTimePreferences: ["morning", "evening"],
        membershipNumber: "0000",
        gender: "female",
        frequencyNote: "Twice weekly",
        postalAddress: { line: "1 Test Street", postCode: "JE0 0AA" },
        details: {
          shortName: "Test A",
          country: "JE",
          weightKg: 70.5,
          heightCm: 175,
          howHeard: "Website",
          internalNotes: "Line one\nLine two",
        },
      },
    });
    expect(isDraftDirty(draft, draftFromDetails(details))).toBe(false);
    expect(isDraftDirty(draft, { ...draft, nickname: "Tester" })).toBe(true);
    const padded = payloadFromDraft(details, { ...draft, fullName: " Test Member A " }, requestId);
    expect(padded.ok && padded.payload.fullName).toBe("Test Member A");
  });

  it("sends an empty details object when every DETAILS field is cleared", () => {
    const draft = {
      ...draftFromDetails(details),
      shortName: "",
      country: "",
      weightKg: "",
      heightCm: "",
      howHeard: "",
      internalNotes: "   ",
    };
    const result = payloadFromDraft(details, draft, requestId);
    expect(result.ok && result.payload.details).toEqual({});
    expect(result.ok && Object.keys(result.payload.details ?? {})).toEqual([]);
  });

  it("names the fields that stop a save", () => {
    const draft = draftFromDetails(details);
    expect(payloadFromDraft(details, { ...draft, weightKg: "500" }, requestId)).toEqual({
      ok: false,
      fields: ["weightKg"],
    });
    expect(payloadFromDraft(details, { ...draft, weightKg: "heavy" }, requestId)).toEqual({
      ok: false,
      fields: ["weightKg"],
    });
    expect(
      payloadFromDraft(details, { ...draft, emergencyContactFullName: "Test Contact" }, requestId),
    ).toEqual({
      ok: false,
      fields: ["emergencyContactRelationship", "emergencyContactPhoneNumber"],
    });
    expect(payloadFromDraft(details, { ...draft, postCode: "" }, requestId)).toEqual({
      ok: false,
      fields: ["postCode"],
    });
    expect(payloadFromDraft(details, { ...draft, fullName: " " }, requestId)).toEqual({
      ok: false,
      fields: ["fullName"],
    });
  });

  it("splits and joins phone numbers with a known dialling code only", () => {
    expect(splitPhoneNumber("+351 912000000")).toEqual({
      countryCode: "+351",
      localNumber: "912000000",
    });
    expect(splitPhoneNumber("07700 900000")).toEqual({
      countryCode: "",
      localNumber: "07700 900000",
    });
    expect(splitPhoneNumber("+999 1234")).toEqual({ countryCode: "", localNumber: "+999 1234" });
    expect(splitPhoneNumber(undefined)).toEqual({ countryCode: "", localNumber: "" });
    expect(joinPhoneNumber("+44", " 7700900000 ")).toBe("+44 7700900000");
    expect(joinPhoneNumber("", "07700 900000")).toBe("07700 900000");
    expect(joinPhoneNumber("+44", " ")).toBeUndefined();
  });

  it("lists ISO countries by English name without macro-regions", () => {
    const options = countryOptions();
    expect(options.find((option) => option.code === "JE")?.name).toBe("Jersey");
    expect(options.find((option) => option.code === "PT")?.name).toBe("Portugal");
    expect(options.some((option) => ["EU", "UN", "ZZ", "EZ", "QO"].includes(option.code))).toBe(
      false,
    );
    expect(options.length).toBeGreaterThan(240);
    expect(options.every((option) => option.name !== option.code)).toBe(true);
    expect(
      options.every(
        (option, index) =>
          index === 0 || options[index - 1]!.name.localeCompare(option.name, "en-GB") <= 0,
      ),
    ).toBe(true);
  });

  it("flags an expired ID card and one expiring within 30 days", () => {
    expect(idExpiryNotice("2026-09-16", "2026-09-17")).toEqual({ kind: "expired" });
    expect(idExpiryNotice("2026-09-17", "2026-09-17")).toEqual({ kind: "soon", days: 0 });
    expect(idExpiryNotice("2026-10-17", "2026-09-17")).toEqual({ kind: "soon", days: 30 });
    expect(idExpiryNotice("2026-10-18", "2026-09-17")).toBeNull();
    expect(idExpiryNotice("", "2026-09-17")).toBeNull();
  });
});
