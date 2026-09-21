import { describe, expect, it } from "vitest";

import type { MemberDetails } from "@bpt-jersey/domain/members/profile";

import {
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
  membershipNumber: "1",
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
        membershipNumber: "1",
        gender: "female",
        frequencyNote: "Twice weekly",
        details: {
          shortName: "Test A",
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

  it("omits legacy location fields from the current draft and update payload", () => {
    const draft = draftFromDetails(details);
    expect(draft).not.toHaveProperty("addressLine");
    expect(draft).not.toHaveProperty("city");
    expect(draft).not.toHaveProperty("postCode");
    expect(draft).not.toHaveProperty("country");

    const result = payloadFromDraft(details, draft, requestId);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload).not.toHaveProperty("postalAddress");
    expect(result.payload.details).not.toHaveProperty("city");
    expect(result.payload.details).not.toHaveProperty("country");
  });

  it("sends an empty details object when every DETAILS field is cleared", () => {
    const draft = {
      ...draftFromDetails(details),
      shortName: "",
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

  it("flags an expired ID card and one expiring within 30 days", () => {
    expect(idExpiryNotice("2026-09-16", "2026-09-17")).toEqual({ kind: "expired" });
    expect(idExpiryNotice("2026-09-17", "2026-09-17")).toEqual({ kind: "soon", days: 0 });
    expect(idExpiryNotice("2026-10-17", "2026-09-17")).toEqual({ kind: "soon", days: 30 });
    expect(idExpiryNotice("2026-10-18", "2026-09-17")).toBeNull();
    expect(idExpiryNotice("", "2026-09-17")).toBeNull();
    // A half-typed date still parses as an instant, so only the date-only shape keeps the notice
    // quiet while the admin types.
    expect(idExpiryNotice("2026-09", "2026-09-17")).toBeNull();
    expect(idExpiryNotice("2026", "2026-09-17")).toBeNull();
  });
});
