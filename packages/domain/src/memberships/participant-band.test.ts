import { describe, expect, it } from "vitest";
import { bookingBandAt, participantBandAt } from "./participant-band";

const on = "2026-09-24T10:00:00.000Z";
describe("participantBandAt", () => {
  it("cuts at 12 and 16 on the Jersey calendar", () => {
    expect(participantBandAt({ dateOfBirth: "2014-09-25", onIso: on })).toBe("kids"); // 11
    expect(participantBandAt({ dateOfBirth: "2014-09-24", onIso: on })).toBe("teens"); // 12
    expect(participantBandAt({ dateOfBirth: "2010-09-25", onIso: on })).toBe("teens"); // 15
    expect(participantBandAt({ dateOfBirth: "2010-09-24", onIso: on })).toBe("adult"); // 16
    expect(participantBandAt({ dateOfBirth: "1990-01-01", onIso: on })).toBe("adult");
  });
  it("uses the Jersey day, not the UTC day", () => {
    // 23 Sept 23:30Z is already 24 Sept in Jersey (BST).
    expect(participantBandAt({ dateOfBirth: "2014-09-24", onIso: "2026-09-23T23:30:00.000Z" })).toBe("teens");
  });
  it("treats a missing or unreadable date of birth as adult", () => {
    expect(participantBandAt({ dateOfBirth: null, onIso: on })).toBe("adult");
    expect(participantBandAt({ dateOfBirth: "not-a-date", onIso: on })).toBe("adult");
  });
});

describe("bookingBandAt", () => {
  // Birth dates relative to `on` (2026-09-24): 15, 16, 17 and 18 on that day.
  const at = (dateOfBirth: string, livePlanTypes: readonly ("kids" | "teens" | "adult")[] | null) =>
    bookingBandAt({ dateOfBirth, onIso: on, livePlanTypes });
  it("keeps a live teens plan bookable for 16 and 17 year olds (D9)", () => {
    expect(at("2010-09-24", ["teens"])).toBe("teens"); // 16
    expect(at("2010-09-24", ["kids", "teens"])).toBe("teens"); // 16
    expect(at("2009-09-24", ["teens"])).toBe("teens"); // 17
  });
  it("otherwise follows the one age band", () => {
    expect(at("2010-09-24", ["adult"])).toBe("adult"); // 16
    expect(at("2010-09-24", null)).toBe("adult"); // 16
    expect(at("2008-09-24", ["teens"])).toBe("adult"); // 18
    expect(at("2010-09-25", ["adult"])).toBe("teens"); // 15
  });
});
