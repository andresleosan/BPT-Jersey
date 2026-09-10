import { describe, expect, it } from "vitest";

import {
  PLAN_CATALOG,
  billingPeriods,
  evaluatePlanAccess,
  parsePlanDraft,
  parsePlanRecord,
  participantTypes,
  planIds,
  sessionTypes,
  siteValues,
  type PlanDraft,
  type PlanAccessInput,
  type PlanRecord,
} from "./plan-contracts";

const expectedCatalog = [
  [
    "payg",
    "Pay as you go",
    1000,
    "per-session",
    ["adult", "kids", "teens"],
    ["Town", "West"],
    null,
    ["Town", "West"],
    null,
  ],
  [
    "bpt-jersey-adult",
    "BPT Jersey Adult",
    12500,
    "monthly",
    ["adult"],
    ["Town", "West"],
    null,
    ["Town", "West"],
    null,
  ],
  ["west-kids-1x", "West Kids 1x", 9500, "monthly", ["kids"], ["West"], 1, ["West"], null],
  ["west-kids-2x", "West Kids 2x", 11500, "monthly", ["kids"], ["West"], 2, ["Town"], null],
  ["west-adult", "West Adult", 6500, "monthly", ["adult"], ["West"], null, ["Town", "West"], null],
  ["west-teens", "West Teens", 4500, "monthly", ["teens"], ["West"], 2, ["West"], 750],
  ["town-adult", "Town Adult", 8500, "monthly", ["adult"], ["Town"], null, ["Town"], null],
  ["town-kids-1x", "Town Kids 1x", 9500, "monthly", ["kids"], ["Town"], 1, ["Town"], null],
  ["town-kids-2x", "Town Kids 2x", 13500, "monthly", ["kids"], ["Town"], 2, ["Town"], null],
  ["town-teens", "Town Teens", 4500, "monthly", ["teens"], ["Town"], 2, ["Town"], 750],
] as const;

function record(overrides: Partial<PlanDraft> = {}, active = true): PlanRecord {
  const draft = { ...PLAN_CATALOG[0], ...overrides } as PlanDraft;
  return {
    ...draft,
    academyId: "academy-1",
    active,
    schemaVersion: "1",
    createdAt: "2026-08-19T10:00:00Z",
    createdBy: "user-1",
    updatedAt: "2026-08-19T10:00:00Z",
    updatedBy: "user-1",
  };
}

describe("membership plan contracts", () => {
  it("publishes the closed vocabularies", () => {
    expect(planIds).toEqual(expectedCatalog.map(([planId]) => planId));
    expect(participantTypes).toEqual(["adult", "kids", "teens"]);
    expect(billingPeriods).toEqual(["per-session", "monthly"]);
    expect(siteValues).toEqual(["Town", "West"]);
    expect(sessionTypes).toEqual(["class", "openMat"]);
    for (const values of [planIds, participantTypes, billingPeriods, siteValues, sessionTypes]) {
      expect(Object.isFrozen(values)).toBe(true);
    }
  });

  it("contains exactly the approved ten-plan catalog", () => {
    expect(PLAN_CATALOG).toHaveLength(10);
    expect(Object.isFrozen(PLAN_CATALOG)).toBe(true);
    expect(PLAN_CATALOG).toEqual(
      expectedCatalog.map(
        ([
          planId,
          displayName,
          priceMinor,
          billingPeriod,
          eligibleParticipantTypes,
          classSites,
          weeklyClassLimit,
          openMatSites,
          openMatFeeMinor,
        ]) => ({
          planId,
          displayName,
          priceMinor,
          currency: "GBP",
          billingPeriod,
          eligibleParticipantTypes,
          classSites,
          weeklyClassLimit,
          openMatSites,
          openMatFeeMinor,
        }),
      ),
    );
    for (const plan of PLAN_CATALOG) {
      expect(Object.isFrozen(plan)).toBe(true);
      expect(Object.isFrozen(plan.eligibleParticipantTypes)).toBe(true);
      expect(Object.isFrozen(plan.classSites)).toBe(true);
      expect(Object.isFrozen(plan.openMatSites)).toBe(true);
      expect(Number.isSafeInteger(plan.priceMinor)).toBe(true);
    }
  });

  it("parses and freezes a valid draft while canonicalizing arrays", () => {
    const result = parsePlanDraft({
      ...PLAN_CATALOG[0],
      eligibleParticipantTypes: ["teens", "adult", "kids"],
      classSites: ["West", "Town"],
      openMatSites: ["West", "Town"],
    });

    expect(result).toEqual({
      ok: true,
      value: PLAN_CATALOG[0],
    });
    if (result.ok) {
      expect(Object.isFrozen(result.value)).toBe(true);
      expect(Object.isFrozen(result.value.eligibleParticipantTypes)).toBe(true);
      expect(Object.isFrozen(result.value.classSites)).toBe(true);
      expect(Object.isFrozen(result.value.openMatSites)).toBe(true);
    }
  });

  it("rejects hostile drafts and records every invalid boundary", () => {
    const cases: readonly unknown[] = [
      null,
      { ...PLAN_CATALOG[0], planId: "unknown" },
      { ...PLAN_CATALOG[0], currency: "EUR" },
      { ...PLAN_CATALOG[0], priceMinor: 10.5 },
      { ...PLAN_CATALOG[0], weeklyClassLimit: 3 },
      { ...PLAN_CATALOG[0], eligibleParticipantTypes: [] },
      { ...PLAN_CATALOG[0], eligibleParticipantTypes: ["adult", "adult"] },
      { ...PLAN_CATALOG[0], eligibleParticipantTypes: ["none"] },
      { ...PLAN_CATALOG[0], classSites: ["North"] },
      { ...PLAN_CATALOG[0], openMatSites: [] },
      { ...PLAN_CATALOG[0], openMatFeeMinor: 1.25 },
      { ...PLAN_CATALOG[0], active: true },
      { ...PLAN_CATALOG[0], [Symbol("unexpected")]: true },
      Object.defineProperty({ ...PLAN_CATALOG[0] }, "hidden", { value: true }),
      Object.assign(Object.create({ inherited: true }), PLAN_CATALOG[0]),
    ];

    for (const value of cases) {
      const result = parsePlanDraft(value);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.length).toBeGreaterThan(0);
    }
  });

  it("parses the exact stored envelope and rejects authority or invalid envelope fields", () => {
    const valid = record();
    const result = parsePlanRecord(valid);
    expect(result).toEqual({ ok: true, value: valid });
    if (result.ok) expect(Object.isFrozen(result.value)).toBe(true);

    const invalidValues = [
      { ...valid, academyId: "" },
      { ...valid, schemaVersion: "2" },
      { ...valid, createdAt: "2026-02-30T10:00:00Z" },
      { ...valid, updatedBy: " " },
      { ...valid, unexpected: true },
      { ...valid, [Symbol("unexpected")]: true },
    ];
    for (const value of invalidValues) expect(parsePlanRecord(value).ok).toBe(false);
  });

  it("evaluates class eligibility, limits, inactive plans, and Open Mat fees without I/O", () => {
    const unlimited = record({
      planId: "bpt-jersey-adult",
      billingPeriod: "monthly",
      classSites: ["Town", "West"],
    });
    expect(
      evaluatePlanAccess(unlimited, {
        participantType: "adult",
        site: "West",
        sessionType: "class",
        weeklyClassesUsed: 99,
      }),
    ).toEqual({ allowed: true, code: "ALLOWED", feeMinor: 0 });

    const limited = record({
      planId: "west-kids-1x",
      billingPeriod: "monthly",
      eligibleParticipantTypes: ["kids"],
      classSites: ["West"],
      weeklyClassLimit: 1,
    });
    expect(
      evaluatePlanAccess(limited, {
        participantType: "kids",
        site: "West",
        sessionType: "class",
        weeklyClassesUsed: 0,
      }),
    ).toEqual({
      allowed: true,
      code: "ALLOWED",
      feeMinor: 0,
    });
    expect(
      evaluatePlanAccess(limited, {
        participantType: "kids",
        site: "West",
        sessionType: "class",
        weeklyClassesUsed: 1,
      }),
    ).toEqual({
      allowed: false,
      code: "WEEKLY_LIMIT_REACHED",
      feeMinor: 0,
    });
    expect(
      evaluatePlanAccess(limited, {
        participantType: "adult",
        site: "West",
        sessionType: "class",
        weeklyClassesUsed: 0,
      }).code,
    ).toBe("PARTICIPANT_TYPE_NOT_ELIGIBLE");
    expect(
      evaluatePlanAccess(limited, {
        participantType: "kids",
        site: "Town",
        sessionType: "class",
        weeklyClassesUsed: 0,
      }).code,
    ).toBe("CLASS_SITE_NOT_ELIGIBLE");

    const teens = record({
      planId: "west-teens",
      eligibleParticipantTypes: ["teens"],
      classSites: ["West"],
      weeklyClassLimit: 2,
      openMatSites: ["West"],
      openMatFeeMinor: 750,
    });
    expect(
      evaluatePlanAccess(teens, {
        participantType: "teens",
        site: "West",
        sessionType: "openMat",
        weeklyClassesUsed: 2,
      }),
    ).toEqual({
      allowed: true,
      code: "ALLOWED",
      feeMinor: 750,
    });
    expect(
      evaluatePlanAccess(teens, {
        participantType: "teens",
        site: "Town",
        sessionType: "openMat",
        weeklyClassesUsed: 0,
      }).code,
    ).toBe("OPEN_MAT_SITE_NOT_ELIGIBLE");
    expect(
      evaluatePlanAccess(
        { ...teens, active: false },
        { participantType: "teens", site: "West", sessionType: "openMat", weeklyClassesUsed: 0 },
      ),
    ).toEqual({
      allowed: false,
      code: "PLAN_INACTIVE",
      feeMinor: 0,
    });
  });

  it("uses the PAYG price for both class and Open Mat sessions", () => {
    const payg = record();
    expect(
      evaluatePlanAccess(payg, {
        participantType: "adult",
        site: "Town",
        sessionType: "class",
        weeklyClassesUsed: 0,
      }),
    ).toMatchObject({
      allowed: true,
      feeMinor: 1000,
    });
    expect(
      evaluatePlanAccess(payg, {
        participantType: "teens",
        site: "West",
        sessionType: "openMat",
        weeklyClassesUsed: 0,
      }),
    ).toMatchObject({
      allowed: true,
      feeMinor: 1000,
    });
  });

  it("fails closed for malformed eligibility plans and inputs", () => {
    expect(
      evaluatePlanAccess({ ...record(), weeklyClassLimit: 3 } as unknown as PlanRecord, {
        participantType: "adult",
        site: "Town",
        sessionType: "class",
        weeklyClassesUsed: 0,
      }),
    ).toEqual({ allowed: false, code: "INVALID_PLAN", feeMinor: 0 });
    expect(
      evaluatePlanAccess(record(), {
        participantType: "none",
        site: "Town",
        sessionType: "class",
        weeklyClassesUsed: -1,
      } as unknown as PlanAccessInput),
    ).toEqual({ allowed: false, code: "INVALID_INPUT", feeMinor: 0 });
  });

  it("returns validation errors instead of executing hostile draft getters", () => {
    const hostile = { ...PLAN_CATALOG[0] };
    Object.defineProperty(hostile, "displayName", {
      enumerable: true,
      get: () => {
        throw new Error("hostile draft getter");
      },
    });

    expect(() => parsePlanDraft(hostile)).not.toThrow();
    expect(parsePlanDraft(hostile).ok).toBe(false);
  });

  it("returns validation errors instead of executing hostile array index getters", () => {
    const eligibleParticipantTypes = ["adult"] as string[];
    Object.defineProperty(eligibleParticipantTypes, "0", {
      enumerable: true,
      get: () => {
        throw new Error("hostile array getter");
      },
    });

    const hostile = { ...PLAN_CATALOG[0], eligibleParticipantTypes };
    expect(() => parsePlanDraft(hostile)).not.toThrow();
    expect(parsePlanDraft(hostile).ok).toBe(false);
  });

  it("returns INVALID_INPUT instead of executing hostile eligibility getters", () => {
    const hostile = {} as Record<string, unknown>;
    Object.defineProperty(hostile, "participantType", {
      enumerable: true,
      get: () => {
        throw new Error("hostile eligibility getter");
      },
    });

    expect(() => evaluatePlanAccess(record(), hostile as PlanAccessInput)).not.toThrow();
    expect(evaluatePlanAccess(record(), hostile as PlanAccessInput)).toEqual({
      allowed: false,
      code: "INVALID_INPUT",
      feeMinor: 0,
    });
  });
});
