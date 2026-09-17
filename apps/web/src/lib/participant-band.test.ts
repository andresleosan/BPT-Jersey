import { describe, expect, it } from "vitest";

import { participantBand } from "./participant-band";

describe("participantBand", () => {
  const today = new Date("2026-09-17T12:00:00Z");
  it.each([
    ["2014-09-18", "kids"],
    ["2014-09-17", "teens"],
    ["2008-09-18", "teens"],
    ["2008-09-17", "adult"],
    ["not-a-date", "adult"],
  ])("maps %s to %s", (dateOfBirth, band) => {
    expect(participantBand(dateOfBirth, today)).toBe(band);
  });
});
