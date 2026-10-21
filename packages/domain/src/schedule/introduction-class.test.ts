import { describe, expect, it } from "vitest";

import {
  admitsEveryAdultBeginner,
  introductionClassAudienceAllowed,
  parseCreateProgramInputV2,
  parseUpdateProgramInput,
} from "./classes-services-contracts";
import { introductionClassAdmitsAge } from "./member-calendar-contracts";
import { isIntroductionClass, isIntroductionClassName } from "./schedule-contracts";

describe("Introduction Class marker (2026-10-20 item 3)", () => {
  it("lets the type's explicit marker win over its name, both ways", () => {
    const named = { name: "Introduction Class Saturdays", introductionClass: false };
    expect(isIntroductionClass({}, named)).toBe(false);
    expect(isIntroductionClass({}, { name: "Saturday Beginners", introductionClass: true })).toBe(
      true,
    );
  });

  it("keeps the legacy rules for types saved before the marker and for intro sessions", () => {
    expect(isIntroductionClass({}, { name: "  introduction class Saturdays" })).toBe(true);
    expect(isIntroductionClass({}, { name: "Intro Class" })).toBe(false);
    const unmarked = { name: "GI", introductionClass: false };
    expect(isIntroductionClass({ accessMode: "intro" }, unmarked)).toBe(true);
    expect(isIntroductionClass({}, undefined)).toBe(false);
    expect(isIntroductionClassName("Introduction Class")).toBe(true);
  });

  it("accepts the marker only as a boolean, on create and on update", () => {
    const base = { name: "Saturday Beginners", abbreviation: "SAT_BEG" };
    const created = parseCreateProgramInputV2({ ...base, introductionClass: true });
    expect(created.ok && created.value.introductionClass).toBe(true);
    const omitted = parseCreateProgramInputV2(base);
    expect(omitted.ok && "introductionClass" in omitted.value).toBe(false);
    expect(parseCreateProgramInputV2({ ...base, introductionClass: "yes" }).ok).toBe(false);
    const updated = parseUpdateProgramInput({ programId: "p1", introductionClass: false });
    expect(updated.ok && updated.value).toEqual({ programId: "p1", introductionClass: false });
    expect(parseUpdateProgramInput({ programId: "p1", introductionClass: 1 }).ok).toBe(false);
  });

  it("opens the marker only to a type every adult beginner may join", () => {
    expect(admitsEveryAdultBeginner({ ageRange: null, ageBand: "all" })).toBe(true);
    expect(admitsEveryAdultBeginner({ ageRange: { minAge: 16, maxAge: null } })).toBe(true);
    expect(admitsEveryAdultBeginner({ ageRange: { minAge: 4, maxAge: 7 } })).toBe(false);
    expect(admitsEveryAdultBeginner({ ageRange: { minAge: 18, maxAge: null } })).toBe(false);
    expect(admitsEveryAdultBeginner({ ageRange: { minAge: 16, maxAge: 17 } })).toBe(false);
    expect(admitsEveryAdultBeginner({ ageRange: null, ageBand: "kids" })).toBe(false);
  });
});

describe("children's Introduction Classes (operator 2026-10-21)", () => {
  it("allows the marker on a type for every adult beginner or for children only", () => {
    expect(introductionClassAudienceAllowed({ ageRange: { minAge: 4, maxAge: 7 } })).toBe(true);
    expect(introductionClassAudienceAllowed({ ageRange: { minAge: 0, maxAge: 15 } })).toBe(true);
    expect(introductionClassAudienceAllowed({ ageRange: null, ageBand: "kids" })).toBe(true);
    expect(introductionClassAudienceAllowed({ ageRange: { minAge: 16, maxAge: null } })).toBe(true);
    // Children and adults in one type, or only some adults, stay refused.
    expect(introductionClassAudienceAllowed({ ageRange: { minAge: 12, maxAge: 17 } })).toBe(false);
    // 16 is an adult here: a range reaching it is a mix.
    expect(introductionClassAudienceAllowed({ ageRange: { minAge: 4, maxAge: 16 } })).toBe(false);
    expect(introductionClassAudienceAllowed({ ageRange: { minAge: 16, maxAge: 17 } })).toBe(false);
    expect(introductionClassAudienceAllowed({ ageRange: { minAge: 18, maxAge: null } })).toBe(
      false,
    );
  });

  it("books a children's type by its own ages and every other intro type from 16", () => {
    const kids = { name: "Kids trial", introductionClass: true, ageBand: "all" as const };
    const kidsType = { ...kids, ageRange: { minAge: 4, maxAge: 7 } };
    expect(introductionClassAdmitsAge(kidsType, 4)).toBe(true);
    expect(introductionClassAdmitsAge(kidsType, 7)).toBe(true);
    expect(introductionClassAdmitsAge(kidsType, 8)).toBe(false);
    expect(introductionClassAdmitsAge(kidsType, 30)).toBe(false);
    const underSixteen = { ...kids, ageRange: { minAge: 4, maxAge: 15 } };
    expect(introductionClassAdmitsAge(underSixteen, 15)).toBe(true);
    expect(introductionClassAdmitsAge(underSixteen, 16)).toBe(false);

    const adults = { ...kids, name: "Trail Class", ageRange: { minAge: 16, maxAge: null } };
    expect(introductionClassAdmitsAge(adults, 16)).toBe(true);
    expect(introductionClassAdmitsAge(adults, 15)).toBe(false);
    // Open-ended from 4 is not a children's type, so its intro stays adult-only.
    const openEnded = { ...kids, ageRange: { minAge: 4, maxAge: null } };
    expect(introductionClassAdmitsAge(openEnded, 10)).toBe(false);
    expect(introductionClassAdmitsAge(openEnded, 16)).toBe(true);
    // A children's type that is not an Introduction Class (a legacy intro session on it) too.
    const kidsGi = { ...kidsType, name: "Kids GI", introductionClass: false };
    expect(introductionClassAdmitsAge(kidsGi, 5)).toBe(false);
    expect(introductionClassAdmitsAge(undefined, 20)).toBe(true);
    // A legacy type named Introduction Class with a children's band and no range of its own.
    const legacyKids = {
      name: "Introduction Class Kids",
      ageBand: "kids" as const,
      ageRange: null,
    };
    expect(introductionClassAdmitsAge(legacyKids, 9)).toBe(true);
    expect(introductionClassAdmitsAge(legacyKids, 13)).toBe(false);
    expect(introductionClassAdmitsAge(legacyKids, 30)).toBe(false);
  });
});
