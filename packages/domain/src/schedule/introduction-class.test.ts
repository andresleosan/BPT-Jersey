import { describe, expect, it } from "vitest";

import {
  admitsEveryAdultBeginner,
  parseCreateProgramInputV2,
  parseUpdateProgramInput,
} from "./classes-services-contracts";
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
