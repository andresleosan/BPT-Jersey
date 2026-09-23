import { describe, expect, it } from "vitest";
import { participantBandAt } from "./participant-band";

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
