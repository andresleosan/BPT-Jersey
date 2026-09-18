import { z } from "zod";

export const levelCatalogVersions = Object.freeze(["ibjjf-v1", "ibjjf-v2"] as const);
export type LevelCatalogVersion = (typeof levelCatalogVersions)[number];

export function isLevelCatalogVersion(value: unknown): value is LevelCatalogVersion {
  return typeof value === "string" && (levelCatalogVersions as readonly string[]).includes(value);
}

export type LevelCatalogVersionShape = Readonly<{
  definitions: number;
  belts: number;
  stripes: number;
  skills: number;
  requirements: number;
  displayName: string;
  precedence: Readonly<{
    businessRules: string;
    hierarchyVisualsAndObservedSkills: string;
    conflicts: string;
  }>;
}>;

export const levelCatalogVersionShapes: Readonly<
  Record<LevelCatalogVersion, LevelCatalogVersionShape>
> = Object.freeze({
  "ibjjf-v1": Object.freeze({
    definitions: 171,
    belts: 27,
    stripes: 144,
    skills: 11,
    requirements: 165,
    displayName: "JIU-JITSU - IBJJF",
    precedence: Object.freeze({
      businessRules: "BPTJ FUNCTIONS APP.docx and BPT-memberships.docx",
      hierarchyVisualsAndObservedSkills: "Regyfit",
      conflicts: "DOCX wins; unresolved Regyfit anomalies remain flagged",
    }),
  }),
  "ibjjf-v2": Object.freeze({
    definitions: 177,
    belts: 27,
    stripes: 150,
    skills: 58,
    requirements: 165,
    displayName: "JIU-JITSU - IBJJF",
    precedence: Object.freeze({
      businessRules: "Regyfit capture 2026-09-17 (operator ruling G9)",
      hierarchyVisualsAndObservedSkills: "Regyfit; belt visuals from ibjjf-v1",
      conflicts:
        "Regyfit wins; differences listed in docs/data/ibjjf-criteria-diff-bpt-vs-regyfit.md",
    }),
  }),
});

const identifier = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u);
const regyfitId = z.string().regex(/^\d{1,9}$/u);
const label = z.string().min(1).max(160);
const nullableCount = z.number().int().min(0).max(100_000).nullable();

const regyfitStructureSchema = z.strictObject({
  schemaVersion: z.literal(1),
  observedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
  source: z.strictObject({
    system: z.literal("Regyfit"),
    levelSystem: z.literal("JIU-JITSU - IBJJF"),
    method: z.string().min(1).max(200),
    mutationsPerformed: z.literal(false),
  }),
  skills: z.array(
    z.strictObject({
      regyfitId,
      key: identifier,
      displayLabel: label,
      observedLabel: label.nullable(),
      category: z.string().min(1).max(60),
      sequence: z.number().int().min(1),
    }),
  ),
  levels: z.array(
    z.strictObject({
      regyfitId,
      name: label,
      kind: z.enum(["belt", "stripe"]),
      parentName: label.nullable(),
      sequence: z.number().int().min(1),
      criteria: z.strictObject({
        minAge: nullableCount,
        maxAge: nullableCount,
        minClasses: nullableCount,
        minDays: nullableCount,
      }),
      skillMinimums: z.array(
        z.strictObject({ skillKey: identifier, minimumRating: z.number().int().min(1).max(5) }),
      ),
    }),
  ),
});

function levelKeyFromName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * ibjjf-v2 = Regyfit hierarchy, criteria and skills (operator ruling G9) with the v1 keys and belt
 * visuals, so existing records keep their definition keys. Levels new in Regyfit take the visual of
 * their parent belt.
 *
 * Operator overrides, one table so every deviation from the capture is visible in one place and the
 * diff report stays a faithful BPT-vs-Regyfit comparison:
 * - 2026-09-17, ruling G11: adult WHITE BELT keeps BPT's own rule, 25 classes and 90 days, instead
 *   of Regyfit's 20/60.
 * - 2026-09-18: RED BELT keeps BPT's zero-length minimum time (`minDays: 0`); Regyfit carries no
 *   time criterion there at all.
 *
 * Every other criteria difference in the report is the years/months/days rounding, which v2 adopts.
 * A `null` in this table is an override too: it replaces whatever the capture holds.
 */
const operatorCriteriaOverrides: ReadonlyMap<
  string,
  Readonly<{ minClasses: number | null; minDays: number | null }>
> = new Map([
  ["WHITE BELT", { minClasses: 25, minDays: 90 }],
  ["RED BELT", { minClasses: null, minDays: 0 }],
]);

export function buildIbjjfV2CatalogSources(
  v1Observed: unknown,
  regyfit: unknown,
): Readonly<{ observed: Record<string, unknown>; business: Record<string, unknown> }> {
  const structure = regyfitStructureSchema.parse(regyfit);
  const v1Levels = record(v1Observed)?.levels;
  if (!Array.isArray(v1Levels)) throw new Error("Level catalogue v1 source is invalid");
  const v1ByName = new Map(
    v1Levels.flatMap((level) => {
      const value = record(level);
      return value !== null && typeof value.name === "string" ? [[value.name, value] as const] : [];
    }),
  );
  const keyByName = new Map(
    structure.levels.map((level) => {
      const v1Key = v1ByName.get(level.name)?.key;
      return [
        level.name,
        typeof v1Key === "string" ? v1Key : levelKeyFromName(level.name),
      ] as const;
    }),
  );

  const setKeyBySignature = new Map<string, string>();
  const skillRequirementSets: Record<string, unknown>[] = [];
  const lowestRatingBySkill = new Map<string, number>();
  const levels = structure.levels.map((level) => {
    const parentKey = level.parentName === null ? null : keyByName.get(level.parentName);
    if (parentKey === undefined) throw new Error("Level parent is missing");
    const visual =
      v1ByName.get(level.name)?.visual ??
      (level.parentName === null ? undefined : v1ByName.get(level.parentName)?.visual);
    if (visual === undefined) throw new Error("Level visual is missing");

    let setKey: string | null = null;
    if (level.skillMinimums.length > 0) {
      const signature = JSON.stringify(
        [...level.skillMinimums].sort((left, right) => left.skillKey.localeCompare(right.skillKey)),
      );
      setKey = setKeyBySignature.get(signature) ?? `regyfit-skills-${setKeyBySignature.size + 1}`;
      if (!setKeyBySignature.has(signature)) {
        setKeyBySignature.set(signature, setKey);
        skillRequirementSets.push({ key: setKey, requirements: level.skillMinimums });
      }
      for (const minimum of level.skillMinimums) {
        const lowest = lowestRatingBySkill.get(minimum.skillKey);
        lowestRatingBySkill.set(
          minimum.skillKey,
          lowest === undefined ? minimum.minimumRating : Math.min(lowest, minimum.minimumRating),
        );
      }
    }
    const override = operatorCriteriaOverrides.get(level.name);
    const minClasses = override === undefined ? level.criteria.minClasses : override.minClasses;
    const minDays = override === undefined ? level.criteria.minDays : override.minDays;
    const criteria = {
      minAge: level.criteria.minAge,
      maxAge: level.criteria.maxAge,
      minClasses,
      minimumTime: minDays === null ? null : { years: 0, months: 0, days: minDays },
    };
    return {
      key: keyByName.get(level.name)!,
      parentKey,
      kind: level.kind,
      name: level.name,
      sequence: level.sequence,
      stripeNumber: null,
      observedCriteria: criteria,
      visual,
      observedSkillRequirementSetKey: setKey,
      observedSkillRequirementsState: setKey === null ? "none" : "configured",
      anomalyFlags: [],
    };
  });

  // ponytail: a skill with no level minimum gets rating 1; SkillDefinition requires 1..5 and nothing
  // reads SkillDefinition.minimumRating for gating (requirements carry the real minimums).
  const skillCatalog = structure.skills.map((skill) => ({
    key: skill.key,
    displayLabel: skill.displayLabel,
    observedLabel: skill.observedLabel,
    minimumRating: lowestRatingBySkill.get(skill.key) ?? 1,
    sequence: skill.sequence,
  }));

  return Object.freeze({
    observed: {
      schemaVersion: 1,
      systemId: "ibjjf-v2",
      observedAt: structure.observedAt,
      source: structure.source,
      skillRequirementSets,
      skillCatalog,
      levels,
    },
    business: {
      schemaVersion: 1,
      systemId: "ibjjf-v2",
      levels: Object.fromEntries(levels.map((level) => [level.key, level.observedCriteria])),
    },
  });
}
