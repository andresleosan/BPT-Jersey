import type {
  LevelCatalogProjection,
  LevelCriteria,
  LevelDefinitionRecord,
} from "@bpt-jersey/domain/levels";

export type BeltAgeGroup = "kids" | "adults";

export type BeltGroup = Readonly<{
  belt: LevelDefinitionRecord;
  stripes: readonly LevelDefinitionRecord[];
  ageGroup: BeltAgeGroup;
  primaryColor: string;
}>;

/** ponytail: the catalogue encodes age in criteria; anything capped below 16 is a kids' belt. */
export function beltAgeGroup(criteria: LevelCriteria): BeltAgeGroup {
  return criteria.maxAge !== null && criteria.maxAge < 16 ? "kids" : "adults";
}

export function groupBelts(
  catalog: Pick<LevelCatalogProjection, "definitions">,
): readonly BeltGroup[] {
  const belts = catalog.definitions
    .filter((d) => d.kind === "belt")
    .sort((a, b) => a.sequence - b.sequence);
  const stripesByParent = new Map<string, LevelDefinitionRecord[]>();
  for (const stripe of catalog.definitions.filter(
    (d) => d.kind === "stripe" && d.parentDefinitionKey,
  )) {
    const list = stripesByParent.get(stripe.parentDefinitionKey!) ?? [];
    list.push(stripe);
    stripesByParent.set(stripe.parentDefinitionKey!, list);
  }
  return Object.freeze(
    belts.map((belt) =>
      Object.freeze({
        belt,
        stripes: Object.freeze(
          (stripesByParent.get(belt.definitionKey) ?? []).sort(
            (a, b) => (a.stripeNumber ?? 0) - (b.stripeNumber ?? 0) || a.sequence - b.sequence,
          ),
        ),
        ageGroup: beltAgeGroup(belt.criteria),
        primaryColor: belt.visual.colors[0] ?? "#ffffff",
      }),
    ),
  );
}

export function distinctBeltColors(
  groups: readonly BeltGroup[],
): readonly Readonly<{ color: string; name: string }>[] {
  const seen = new Map<string, string>();
  for (const group of groups) {
    if (!seen.has(group.primaryColor)) seen.set(group.primaryColor, group.belt.name);
  }
  return Object.freeze([...seen.entries()].map(([color, name]) => Object.freeze({ color, name })));
}

export function formatAgeRange(minAge: number | null, maxAge: number | null): string {
  if (minAge !== null && maxAge !== null) return `${minAge}–${maxAge} yrs`;
  if (minAge !== null) return `${minAge}+ yrs`;
  if (maxAge !== null) return `Up to ${maxAge} yrs`;
  return "All ages";
}

export function formatMinimumTime(time: LevelCriteria["minimumTime"]): string {
  if (!time) return "None";
  const parts: string[] = [];
  if (time.years > 0) parts.push(`${time.years} ${time.years === 1 ? "yr" : "yrs"}`);
  if (time.months > 0) parts.push(`${time.months} ${time.months === 1 ? "mo" : "mos"}`);
  if (time.days > 0) parts.push(`${time.days} ${time.days === 1 ? "day" : "days"}`);
  return parts.length > 0 ? parts.join(" ") : "None";
}
