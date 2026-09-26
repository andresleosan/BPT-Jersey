import {
  administrativePlanIds,
  PLAN_CATALOG,
  retiredPlanIds,
  type PlanDraft,
  type Site,
} from "@bpt-jersey/domain/memberships";
import { PRIVATE_LESSON_OPTIONS, type PrivateLessonOptionId } from "@bpt-jersey/domain/private-lessons";

const money = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" });
const periodLabel = { "per-session": "per class", monthly: "per month", term: "per term" } as const;

export function formatPlanPrice(plan: Pick<PlanDraft, "priceMinor" | "billingPeriod">): string {
  // Whole pounds read as "£85"; pence stay visible ("£7.50").
  const amount =
    plan.priceMinor % 100 === 0 ? `£${plan.priceMinor / 100}` : money.format(plan.priceMinor / 100);
  return `${amount} ${periodLabel[plan.billingPeriod]}`;
}

function sites(values: readonly Site[]): string {
  return values.join(" and ");
}

export function describePlanAccess(
  plan: Pick<
    PlanDraft,
    "billingPeriod" | "eligibleParticipantTypes" | "classSites" | "weeklyClassLimit" | "openMatSites"
  >,
): string {
  const at = sites(plan.classSites);
  const classes =
    plan.billingPeriod === "per-session"
      ? `Pay per class at ${at}`
      : plan.weeklyClassLimit === null
        ? `Unlimited classes at ${at}`
        : `${plan.weeklyClassLimit} class${plan.weeklyClassLimit === 1 ? "" : "es"} a week at ${at}`;
  if (plan.openMatSites.length === 0) return classes;
  // The session's age band decides which open mat a child can book; the copy names the kids one.
  const openMat = plan.eligibleParticipantTypes.includes("adult")
    ? "open mats"
    : plan.eligibleParticipantTypes.includes("teens")
      ? "kids and teens full access to open mat"
      : "kids open mat";
  return `${classes} · ${openMat} at ${sites(plan.openMatSites)}`;
}

export type PlanGroup = Readonly<{ title: string; plans: readonly PlanDraft[] }>;

export function publicPlanGroups(site?: Site): readonly PlanGroup[] {
  // Administrative plans (Transit Free) are owner-assigned only and never advertised publicly.
  const live = PLAN_CATALOG.filter(
    (plan) =>
      !retiredPlanIds.includes(plan.planId) && !administrativePlanIds.includes(plan.planId),
  );
  const only = (value: Site) =>
    live.filter((plan) => plan.classSites.length === 1 && plan.classSites[0] === value);
  const groups: PlanGroup[] = [
    { title: "Town & West", plans: live.filter((plan) => plan.classSites.length === 2) },
    { title: "BPT West", plans: only("West") },
    { title: "BPT Town", plans: only("Town") },
  ];
  return groups.filter(
    (group) =>
      group.plans.length > 0 &&
      (site === undefined || group.plans.every((plan) => plan.classSites.includes(site))),
  );
}

/** "£65.00", "£200.00 a month", "£500.00": private lesson prices come from the fixed catalogue. */
export function privateLessonPriceLabel(optionId: PrivateLessonOptionId): string {
  const price = money.format(PRIVATE_LESSON_OPTIONS[optionId].priceMinor / 100);
  return optionId === "monthly" ? `${price} a month` : price;
}
