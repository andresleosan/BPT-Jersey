import { describe, expect, it } from "vitest";

import {
  parseCopyWeekInput,
  parseCreateLocationInput,
  parseCreateProgramInputV2,
  parseDeleteWeekInput,
  parseSessionBookingRules,
  parseUpdateLocationInput,
  parseUpdateProgramInput,
  programDefaultsV2,
  shiftIso,
  slugifyLocationId,
  weekRangeFor,
} from "./classes-services-contracts";

describe("locations", () => {
  it("accepts a name, abbreviation and kind and trims them", () => {
    const parsed = parseCreateLocationInput({
      name: " BPT Town ",
      abbreviation: "tow",
      kind: "presential",
    });
    expect(parsed).toEqual({
      ok: true,
      value: { name: "BPT Town", abbreviation: "tow", kind: "presential" },
    });
  });

  it("rejects an unknown kind, a short abbreviation and extra keys", () => {
    expect(
      parseCreateLocationInput({ name: "BPT Town", abbreviation: "tow", kind: "metaverse" }).ok,
    ).toBe(false);
    expect(parseCreateLocationInput({ name: "BPT Town", abbreviation: "t", kind: "zoom" }).ok).toBe(
      false,
    );
    expect(
      parseCreateLocationInput({ name: "BPT Town", abbreviation: "tow", kind: "zoom", extra: 1 })
        .ok,
    ).toBe(false);
  });

  it("slugifies a name into a stable id", () => {
    expect(slugifyLocationId("BPT Town")).toBe("bpt-town");
    expect(slugifyLocationId("  Salle  Ünique! ")).toBe("salle-unique");
  });

  it("updates only the given fields and requires the id", () => {
    expect(parseUpdateLocationInput({ locationId: "west", active: false })).toEqual({
      ok: true,
      value: { locationId: "west", active: false },
    });
    expect(parseUpdateLocationInput({ active: false }).ok).toBe(false);
    expect(parseUpdateLocationInput({ locationId: "west" }).ok).toBe(false);
  });
});

describe("programs v2", () => {
  it("creates from name and abbreviation only", () => {
    expect(
      parseCreateProgramInputV2({ name: "GI All Levels Evenings", abbreviation: "LEV_EVE" }),
    ).toEqual({
      ok: true,
      value: { name: "GI All Levels Evenings", abbreviation: "LEV_EVE" },
    });
  });

  it("validates colour, kind, drop-in policy and message length on update", () => {
    expect(
      parseUpdateProgramInput({
        programId: "p1",
        colour: "#d9d7ff",
        kind: "service",
        dropInPolicy: "3",
      }).ok,
    ).toBe(true);
    expect(parseUpdateProgramInput({ programId: "p1", colour: "purple" }).ok).toBe(false);
    expect(parseUpdateProgramInput({ programId: "p1", dropInPolicy: "9" }).ok).toBe(false);
    expect(parseUpdateProgramInput({ programId: "p1", message: "x".repeat(201) }).ok).toBe(false);
  });

  it("ships defaults that DESIGN.md allows", () => {
    expect(programDefaultsV2.colour).toBe("#F0EFFF");
    expect(programDefaultsV2.showInList).toBe(true);
  });
});

describe("session booking rules", () => {
  it("accepts 'defined' and a custom rule set", () => {
    expect(parseSessionBookingRules("defined")).toEqual({ ok: true, value: "defined" });
    expect(
      parseSessionBookingRules({
        bookUntilMinutesBefore: 30,
        cancelUntil: { minutesBefore: 60 },
        advanceMinutes: 10080,
      }),
    ).toEqual({
      ok: true,
      value: {
        bookUntilMinutesBefore: 30,
        cancelUntil: { minutesBefore: 60 },
        advanceMinutes: 10080,
      },
    });
    expect(
      parseSessionBookingRules({
        bookUntilMinutesBefore: -1,
        cancelUntil: "start",
        advanceMinutes: 0,
      }).ok,
    ).toBe(false);
  });
});

describe("weeks", () => {
  it("turns a Monday into a 7-day UTC range in the academy timezone", () => {
    expect(weekRangeFor("2026-09-14", "Europe/Jersey")).toEqual({
      ok: true,
      value: { from: "2026-09-13T23:00:00.000Z", to: "2026-09-20T22:59:59.999Z" },
    });
  });

  it("rejects days that are not a Monday", () => {
    expect(weekRangeFor("2026-09-16", "Europe/Jersey").ok).toBe(false);
  });

  it("shifts an ISO instant by whole days", () => {
    expect(shiftIso("2026-09-14T05:00:00.000Z", 7)).toBe("2026-09-21T05:00:00.000Z");
  });

  it("parses copy and delete week inputs", () => {
    expect(
      parseCopyWeekInput({
        fromWeekStart: "2026-09-14",
        toWeekStart: "2026-09-21",
        copyBookings: false,
      }).ok,
    ).toBe(true);
    expect(
      parseCopyWeekInput({
        fromWeekStart: "2026-09-14",
        toWeekStart: "2026-09-14",
        copyBookings: false,
      }).ok,
    ).toBe(false);
    expect(parseDeleteWeekInput({ weekStart: "2026-09-14", reason: "Bank holiday week" }).ok).toBe(
      true,
    );
    expect(parseDeleteWeekInput({ weekStart: "2026-09-14", reason: "x" }).ok).toBe(false);
  });
});
