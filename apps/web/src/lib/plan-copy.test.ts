import { PLAN_CATALOG } from "@bpt-jersey/domain/memberships";
import { describe, expect, it } from "vitest";

import { describePlanAccess, formatPlanPrice, publicPlanGroups } from "./plan-copy";

const byId = (planId: string) => PLAN_CATALOG.find((plan) => plan.planId === planId)!;

describe("plan copy", () => {
  it.each([
    ["bpt-jersey-adult", "£125 per month", "Unlimited classes at Town and West · open mats at Town and West"],
    ["payg", "£10 per class", "Pay per class at West"],
    ["west-adult", "£65 per month", "2 classes a week at West · open mats at Town"],
    ["west-kids-1x", "£95 per term", "1 class a week at West"],
    ["west-kids-2x", "£115 per term", "2 classes a week at West · kids open mat at Town"],
    ["west-teens", "£45 per month", "2 classes a week at West"],
    ["west-teens-payg", "£7.50 per class", "Pay per class at West"],
    ["town-adult", "£85 per month", "Unlimited classes at Town · open mats at Town"],
    ["town-kids-1x", "£95 per term", "1 class a week at Town"],
    ["town-kids-2x", "£135 per term", "3 classes a week at Town · kids open mat at Town"],
  ])("describes %s", (planId, price, access) => {
    expect(formatPlanPrice(byId(planId))).toBe(price);
    expect(describePlanAccess(byId(planId))).toBe(access);
  });

  it("groups live public plans by site and hides retired ones", () => {
    const groups = publicPlanGroups();
    expect(groups.map((group) => group.title)).toEqual(["Town & West", "BPT West", "BPT Town"]);
    const ids = groups.flatMap((group) => group.plans.map((plan) => plan.planId));
    expect(ids).not.toContain("town-teens");
    expect(ids).toHaveLength(10);
  });

  it("keeps only the groups that train at the chosen site", () => {
    expect(publicPlanGroups("West").map((group) => group.title)).toEqual(["Town & West", "BPT West"]);
    expect(publicPlanGroups("Town").map((group) => group.title)).toEqual(["Town & West", "BPT Town"]);
  });
});
