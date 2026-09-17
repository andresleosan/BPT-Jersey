import { describe, expect, it } from "vitest";

import {
  academyDateOf,
  deriveBirthdayBadge,
  deriveBmi,
  deriveShortNameVariants,
  memberAgeOn,
  nextFreeMemberNumber,
  wholeMonthsBetween,
} from "./member-profile-contracts";

describe("birthday badge (reuses deriveUpcomingBirthdays)", () => {
  const today = "2026-09-17";

  it("is today, a count of 1..7 days, or nothing", () => {
    expect(deriveBirthdayBadge("1990-09-17", today)).toEqual({ kind: "today" });
    expect(deriveBirthdayBadge("1990-09-18", today)).toEqual({ kind: "inDays", days: 1 });
    expect(deriveBirthdayBadge("1990-09-24", today)).toEqual({ kind: "inDays", days: 7 });
    expect(deriveBirthdayBadge("1990-09-25", today)).toBeNull();
    expect(deriveBirthdayBadge("1990-09-16", today)).toBeNull();
  });

  it("crosses the year boundary", () => {
    expect(deriveBirthdayBadge("2001-01-02", "2026-12-30")).toEqual({ kind: "inDays", days: 3 });
  });

  it("greets 29 February on 28 February in a non-leap year", () => {
    expect(deriveBirthdayBadge("2000-02-29", "2027-02-28")).toEqual({ kind: "today" });
    expect(deriveBirthdayBadge("2000-02-29", "2028-02-28")).toEqual({ kind: "inDays", days: 1 });
  });

  it("returns nothing for an unusable date", () => {
    expect(deriveBirthdayBadge("not-a-date", today)).toBeNull();
    expect(deriveBirthdayBadge("1990-02-30", today)).toBeNull();
  });
});

describe("BMI", () => {
  it("rounds to one decimal and uses the WHO adult bands", () => {
    expect(deriveBmi(70.5, 175)).toEqual({ value: 23, category: "healthy" });
    expect(deriveBmi(50, 175)).toEqual({ value: 16.3, category: "underweight" });
    expect(deriveBmi(56.65625, 175)).toEqual({ value: 18.5, category: "healthy" });
    expect(deriveBmi(80, 175)).toEqual({ value: 26.1, category: "overweight" });
    expect(deriveBmi(95, 175)).toEqual({ value: 31, category: "obese" });
  });

  it("is absent when either measurement is missing or out of range", () => {
    expect(deriveBmi(undefined, 175)).toBeNull();
    expect(deriveBmi(70, undefined)).toBeNull();
    expect(deriveBmi(0, 175)).toBeNull();
    expect(deriveBmi(70, 29)).toBeNull();
    expect(deriveBmi(Number.NaN, 175)).toBeNull();
  });
});

describe("dates and ages", () => {
  it("reads the academy day in Europe/Jersey", () => {
    expect(academyDateOf("2026-06-30T23:30:00.000Z")).toBe("2026-07-01");
    expect(academyDateOf("2026-12-31T23:30:00.000Z")).toBe("2026-12-31");
  });

  it("computes completed years and whole months", () => {
    expect(memberAgeOn("2000-09-18", "2026-09-17")).toBe(25);
    expect(memberAgeOn("2000-09-17", "2026-09-17")).toBe(26);
    expect(memberAgeOn("bad", "2026-09-17")).toBeNull();
    expect(wholeMonthsBetween("2026-01-15", "2026-09-17")).toBe(8);
    expect(wholeMonthsBetween("2026-01-31", "2026-02-28")).toBe(0);
    expect(wholeMonthsBetween("2026-09-18", "2026-09-17")).toBe(0);
  });
});

describe("DETAILS helpers", () => {
  it("offers short name variants from the full name", () => {
    expect(deriveShortNameVariants("Test Member Alpha")).toEqual([
      "Test",
      "Test Alpha",
      "Test A.",
      "Test Member",
    ]);
    expect(deriveShortNameVariants("Tester")).toEqual(["Tester"]);
    expect(deriveShortNameVariants("  Test   Member ")).toEqual(["Test", "Test Member", "Test M."]);
  });

  it("drops a variant longer than the stored field allows", () => {
    const first = "T".repeat(60);
    expect(deriveShortNameVariants(`${first} Beta`)).toEqual([first, `${first} B.`]);
  });

  it("suggests the next free numeric member number", () => {
    expect(nextFreeMemberNumber(["1", "0152", "A-7", undefined, "99"])).toBe("153");
    expect(nextFreeMemberNumber([])).toBe("1");
    expect(nextFreeMemberNumber(["BPT 0001"])).toBe("1");
  });
});
