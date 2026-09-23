import type { MemberReviewFlag } from "@bpt-jersey/domain/members/overview";

export const flagLabels: Readonly<Record<MemberReviewFlag, string>> = {
  "centre-unconfirmed": "Centre to be confirmed",
  "date-of-birth-missing": "Date of birth needed (booking as adult)",
  "guardian-required": "Guardian needed",
  "plan-band-differs": "Plan band differs from age band",
};

/** "white-1st-stripe" → "White · 1st stripe", "blue-belt" → "Blue belt". */
export function levelLabel(key: string | undefined): string {
  if (!key) return "Level to be confirmed";
  const [colour = "", ...rest] = key.split("-");
  const name = colour.charAt(0).toUpperCase() + colour.slice(1);
  return rest[0] === "belt" || rest.length === 0 ? `${name} belt` : `${name} · ${rest.join(" ")}`;
}
