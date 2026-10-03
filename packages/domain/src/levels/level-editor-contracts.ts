import { z } from "zod";

/**
 * The academy's belt catalogue is one `custom` system named `bpt-<yyyymmdd>-<n>`, edited in place.
 * Code versions `ibjjf-v1..v3` only seed fresh environments and are never edited. Which belts and
 * stripes exist is fixed; their names, colours, criteria and the techniques they require are not.
 */
export const customLevelSystemIdPattern = /^bpt-\d{8}-\d{1,3}$/u;

export function isCustomLevelSystemId(value: unknown): value is string {
  return typeof value === "string" && customLevelSystemIdPattern.test(value);
}

/** ibjjf-v3 kids belts carry 11 degrees. */
export const maxStripesPerBelt = 11;

const hexColourSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/u);
const identifierSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u);
const customSystemIdSchema = z.string().regex(customLevelSystemIdPattern);
const labelSchema = z.string().trim().min(1).max(80);
const ageSchema = z.number().int().min(3).max(99);
const ratingSchema = z.number().int().min(1).max(5);
const stampSchema = z.string().min(1).max(64);

const criteriaSchema = z.strictObject({
  minAge: ageSchema.nullable(),
  maxAge: ageSchema.nullable(),
  minClasses: z.number().int().min(0).max(10_000).nullable(),
  minimumTime: z
    .strictObject({
      years: z.number().int().min(0).max(99),
      months: z.number().int().min(0).max(1_200),
      days: z.number().int().min(0).max(36_500),
    })
    .nullable(),
});

export const catalogLevelSchema = z.strictObject({
  definitionKey: identifierSchema,
  kind: z.enum(["belt", "stripe"]),
  parentDefinitionKey: identifierSchema.nullable(),
  name: labelSchema,
  sequence: z.number().int().min(1).max(10_000),
  stripeNumber: z.number().int().min(1).max(maxStripesPerBelt).nullable(),
  criteria: criteriaSchema,
  visual: z.strictObject({
    colors: z.array(hexColourSchema).min(1).max(4),
    stripeColor: hexColourSchema.nullable(),
    // Read-only: the number of stripes under a belt. The server never takes it from the client.
    stripeCount: z.number().int().min(0).max(maxStripesPerBelt),
  }),
});
export type CatalogLevel = z.infer<typeof catalogLevelSchema>;

export const catalogSkillSchema = z.strictObject({
  key: identifierSchema,
  displayLabel: labelSchema,
  minimumRating: ratingSchema,
  sequence: z.number().int().min(1).max(10_000),
});
export type CatalogSkill = z.infer<typeof catalogSkillSchema>;

/** A technique a belt requires; it applies to the belt and every stripe under it. */
export const beltTechniqueSchema = z.strictObject({
  beltKey: identifierSchema,
  skillKey: identifierSchema,
  minimumRating: ratingSchema,
});
export type BeltTechnique = z.infer<typeof beltTechniqueSchema>;

const contentShape = {
  displayName: labelSchema,
  levels: z.array(catalogLevelSchema).min(1).max(400),
  skills: z.array(catalogSkillSchema).max(300),
  beltTechniques: z.array(beltTechniqueSchema).max(3_000),
};

type Content = Readonly<{
  levels: readonly CatalogLevel[];
  skills: readonly CatalogSkill[];
  beltTechniques: readonly BeltTechnique[];
}>;

function checkContent(value: Content, context: z.RefinementCtx): void {
  const levels = new Map<string, CatalogLevel>();
  value.levels.forEach((level, index) => {
    if (levels.has(level.definitionKey)) {
      context.addIssue({ code: "custom", path: ["levels", index], message: "Duplicate level" });
    }
    levels.set(level.definitionKey, level);
    const { minAge, maxAge } = level.criteria;
    if (minAge !== null && maxAge !== null && minAge > maxAge) {
      context.addIssue({ code: "custom", path: ["levels", index], message: "Age range" });
    }
  });
  value.levels.forEach((level, index) => {
    const parent =
      level.parentDefinitionKey === null ? undefined : levels.get(level.parentDefinitionKey);
    const valid =
      level.kind === "belt"
        ? level.parentDefinitionKey === null
        : parent !== undefined && parent.kind === "belt";
    if (!valid) {
      context.addIssue({ code: "custom", path: ["levels", index], message: "Invalid parent" });
    }
  });
  const skills = new Set<string>();
  value.skills.forEach((skill, index) => {
    if (skills.has(skill.key)) {
      context.addIssue({ code: "custom", path: ["skills", index], message: "Duplicate skill" });
    }
    skills.add(skill.key);
  });
  const pairs = new Set<string>();
  value.beltTechniques.forEach((technique, index) => {
    const pair = `${technique.beltKey}__${technique.skillKey}`;
    if (
      levels.get(technique.beltKey)?.kind !== "belt" ||
      !skills.has(technique.skillKey) ||
      pairs.has(pair)
    ) {
      context.addIssue({
        code: "custom",
        path: ["beltTechniques", index],
        message: "Invalid technique",
      });
    }
    pairs.add(pair);
  });
}

export const editableLevelCatalogSchema = z
  .strictObject({ systemId: customSystemIdSchema, updatedAt: stampSchema, ...contentShape })
  .superRefine(checkContent);
export type EditableLevelCatalog = z.infer<typeof editableLevelCatalogSchema>;

export const saveLevelCatalogInputSchema = z
  .strictObject({ expectedUpdatedAt: stampSchema, ...contentShape })
  .superRefine(checkContent);
export type SaveLevelCatalogInput = z.infer<typeof saveLevelCatalogInputSchema>;

/** A new technique's key: its label as a slug, suffixed until it is free. */
export function techniqueKey(label: string, taken: ReadonlySet<string>): string {
  const base =
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/gu, "-")
      .replace(/^-+|-+$/gu, "")
      .slice(0, 100) || "technique";
  let key = base;
  for (let n = 2; taken.has(key); n += 1) key = `${base}-${n}`;
  return key;
}
