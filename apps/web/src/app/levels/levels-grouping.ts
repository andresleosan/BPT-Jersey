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

const tipBlack = "#1a1a18";
const tipRed = "#b3202a";

function isDark(hex: string | undefined): boolean {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/iu.exec(hex ?? "");
  if (!match) return false;
  const [r, g, b] = match.slice(1).map((part) => Number.parseInt(part, 16));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b! < 30;
}

/**
 * `stripeColor` is the colour of the stripe tape (white on every level of the catalogue), not of
 * the tip. The tip is black, and red where the belt itself ends in black, as on a black belt.
 */
export function beltTipColors(
  visual: LevelDefinitionRecord["visual"],
): Readonly<{ tip: string; stripe: string }> {
  return {
    tip: isDark(visual.colors.at(-1)) ? tipRed : tipBlack,
    stripe: visual.stripeColor ?? "#ffffff",
  };
}

export function ordinal(n: number): string {
  return `${n}${["th", "st", "nd", "rd"][n % 10 > 3 || Math.floor((n % 100) / 10) === 1 ? 0 : n % 10]}`;
}

/**
 * The catalogue leaves `stripeNumber` null on every stripe, so the number is the stripe's
 * position under its belt; groupBelts has already ordered them by sequence.
 */
export function stripeOrdinal(stripe: LevelDefinitionRecord, position: number): number {
  return stripe.stripeNumber ?? position + 1;
}

export type TechniqueSet = Readonly<{
  appliesTo: string;
  techniques: readonly string[];
}>;

function describeStripeRange(numbers: readonly number[]): string {
  const ranges: string[] = [];
  let start = numbers[0]!;
  let end = start;
  for (const n of [...numbers.slice(1), Number.NaN]) {
    if (n === end + 1) {
      end = n;
      continue;
    }
    ranges.push(start === end ? ordinal(start) : `${ordinal(start)}–${ordinal(end)}`);
    start = n;
    end = n;
  }
  return `${ranges.join(", ")} stripe`;
}

/**
 * Techniques are attached to the belt and to each stripe separately, and most levels repeat the
 * same list. One entry per distinct list keeps every requirement visible without repeating it.
 */
export function techniqueSets(
  group: BeltGroup,
  techniquesByDefinition: ReadonlyMap<string, readonly string[]>,
): readonly TechniqueSet[] {
  const sets = new Map<
    string,
    { belt: boolean; stripes: number[]; techniques: readonly string[] }
  >();
  const levels = [
    { definition: group.belt, stripe: null },
    ...group.stripes.map((definition, position) => ({
      definition,
      stripe: stripeOrdinal(definition, position),
    })),
  ];
  for (const { definition, stripe } of levels) {
    const techniques = techniquesByDefinition.get(definition.definitionKey) ?? [];
    if (techniques.length === 0) continue;
    const key = [...techniques].sort().join("\n");
    const set = sets.get(key) ?? { belt: false, stripes: [], techniques };
    if (stripe === null) set.belt = true;
    else set.stripes.push(stripe);
    sets.set(key, set);
  }
  return Object.freeze(
    [...sets.values()].map(({ belt, stripes, techniques }) =>
      Object.freeze({
        appliesTo: [belt ? "Belt" : "", stripes.length > 0 ? describeStripeRange(stripes) : ""]
          .filter(Boolean)
          .join(", "),
        techniques,
      }),
    ),
  );
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

export type BeltPosition = Readonly<{
  belt: LevelDefinitionRecord;
  definition: LevelDefinitionRecord;
  stripeCount: number;
}>;

/** The belt a level sits on and how many stripe marks its bar carries. */
export function beltPosition(
  groups: readonly BeltGroup[],
  definitionKey: string,
): BeltPosition | null {
  for (const group of groups) {
    if (group.belt.definitionKey === definitionKey) {
      return { belt: group.belt, definition: group.belt, stripeCount: 0 };
    }
    const index = group.stripes.findIndex((stripe) => stripe.definitionKey === definitionKey);
    if (index >= 0) {
      return { belt: group.belt, definition: group.stripes[index]!, stripeCount: index + 1 };
    }
  }
  return null;
}
