import { describe, expect, it } from "vitest";

import {
  localInstant,
  parseCopyWeekInput,
  parseCreateLocationInput,
  parseCreateProgramInputV2,
  parseDeleteWeekInput,
  parseSessionBookingRules,
  parseUpdateLocationInput,
  parseUpdateProgramInput,
  programDefaultsV2,
  shiftIsoInZone,
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

  it("shifts an instant by whole days when the clocks do not move", () => {
    expect(shiftIsoInZone("2026-09-14T05:00:00.000Z", 7, "Europe/Jersey")).toBe(
      "2026-09-21T05:00:00.000Z",
    );
    expect(shiftIsoInZone("2026-09-21T05:00:00.000Z", -7, "Europe/Jersey")).toBe(
      "2026-09-14T05:00:00.000Z",
    );
  });

  it("keeps the local wall-clock time across the October clock change", () => {
    // Jersey leaves BST on 2026-10-25. An 18:00 class on Wednesday 21 October is 17:00Z; a week
    // later it is still an 18:00 class, and that is 18:00Z.
    expect(shiftIsoInZone("2026-10-21T17:00:00.000Z", 7, "Europe/Jersey")).toBe(
      "2026-10-28T18:00:00.000Z",
    );
    expect(shiftIsoInZone("2026-10-28T18:00:00.000Z", -7, "Europe/Jersey")).toBe(
      "2026-10-21T17:00:00.000Z",
    );
  });

  it("keeps the local wall-clock time across the March clock change", () => {
    // Jersey enters BST on 2027-03-28. An 18:00 class on Wednesday 24 March is 18:00Z; a week
    // later the same 18:00 class is 17:00Z.
    expect(shiftIsoInZone("2027-03-24T18:00:00.000Z", 7, "Europe/Jersey")).toBe(
      "2027-03-31T17:00:00.000Z",
    );
  });

  it("shifts in the given timezone, not the host one", () => {
    // UTC never changes its clocks, so the same instants shift by exactly seven days.
    expect(shiftIsoInZone("2026-10-21T17:00:00.000Z", 7, "UTC")).toBe("2026-10-28T17:00:00.000Z");
  });

  it("puts a local wall-clock time on the right instant across the March clock change", () => {
    // Jersey enters BST at 01:00 on 2026-03-29, so a 10:00 class that day is 09:00Z — the offset
    // at local midnight (GMT) no longer holds by the time the class starts.
    expect(new Date(localInstant("2026-03-29", "10:00", "Europe/Jersey")).toISOString()).toBe(
      "2026-03-29T09:00:00.000Z",
    );
  });

  it("puts a local wall-clock time on the right instant across the October clock change", () => {
    // Jersey leaves BST at 02:00 on 2026-10-25, so a 10:00 class that day is 10:00Z even though
    // local midnight was still BST.
    expect(new Date(localInstant("2026-10-25", "10:00", "Europe/Jersey")).toISOString()).toBe(
      "2026-10-25T10:00:00.000Z",
    );
  });

  it("puts a local wall-clock time on the right instant on an ordinary day", () => {
    expect(new Date(localInstant("2026-09-16", "10:00", "Europe/Jersey")).toISOString()).toBe(
      "2026-09-16T09:00:00.000Z",
    );
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
