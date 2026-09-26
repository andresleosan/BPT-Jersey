import { z } from "zod";

/**
 * T04: belt catalogue editor. Versions `ibjjf-v1..v3` are generated in code and pinned by hash,
 * so they are never edited. Every editable version is a `custom` system named
 * `bpt-<yyyymmdd>-<n>`, validated here instead of by an approved source hash.
 */
export const customLevelSystemIdPattern = /^bpt-\d{8}-\d{1,3}$/u;

export function isCustomLevelSystemId(value: unknown): value is string {
  return typeof value === "string" && customLevelSystemIdPattern.test(value);
}

/**
 * The spec asked for 0–10 stripes, but ibjjf-v3 kids belts carry 11 degrees; a draft cloned from
 * the active catalogue must save unchanged, so 11 is the ceiling.
 */
export const maxStripesPerBelt = 11;

const hexColourSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/u);
const identifierSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u);
const customSystemIdSchema = z.string().regex(customLevelSystemIdPattern);
const systemIdSchema = identifierSchema;
const labelSchema = z.string().trim().min(1).max(80);
const ageSchema = z.number().int().min(3).max(99);
const ratingSchema = z.number().int().min(1).max(5);

export const levelDraftCriteriaSchema = z.strictObject({
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

export const levelDraftVisualSchema = z.strictObject({
  colors: z.array(hexColourSchema).min(1).max(4),
  stripeColor: hexColourSchema.nullable(),
  stripeCount: z.number().int().min(0).max(maxStripesPerBelt),
});

export const levelDraftLevelSchema = z.strictObject({
  definitionKey: identifierSchema,
  kind: z.enum(["belt", "stripe"]),
  parentDefinitionKey: identifierSchema.nullable(),
  name: labelSchema,
  sequence: z.number().int().min(1).max(10_000),
  stripeNumber: z.number().int().min(1).max(maxStripesPerBelt).nullable(),
  criteria: levelDraftCriteriaSchema,
  visual: levelDraftVisualSchema,
});
export type LevelDraftLevel = z.infer<typeof levelDraftLevelSchema>;

export const levelDraftSkillSchema = z.strictObject({
  key: identifierSchema,
  displayLabel: labelSchema,
  minimumRating: ratingSchema,
  sequence: z.number().int().min(1).max(10_000),
});
export type LevelDraftSkill = z.infer<typeof levelDraftSkillSchema>;

export const levelDraftRequirementSchema = z.strictObject({
  definitionKey: identifierSchema,
  skillKey: identifierSchema,
  minimumRating: ratingSchema,
});
export type LevelDraftRequirement = z.infer<typeof levelDraftRequirementSchema>;

const draftContentShape = {
  displayName: labelSchema,
  levels: z.array(levelDraftLevelSchema).min(1).max(400),
  skills: z.array(levelDraftSkillSchema).max(300),
  requirements: z.array(levelDraftRequirementSchema).max(3_000),
};

type DraftContent = Readonly<{
  levels: readonly LevelDraftLevel[];
  skills: readonly LevelDraftSkill[];
  requirements: readonly LevelDraftRequirement[];
}>;

function checkDraftReferences(value: DraftContent, context: z.RefinementCtx): void {
  const levels = new Map<string, LevelDraftLevel>();
  value.levels.forEach((level, index) => {
    if (levels.has(level.definitionKey)) {
      context.addIssue({ code: "custom", path: ["levels", index], message: "Duplicate level" });
    }
    levels.set(level.definitionKey, level);
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
  const requirements = new Set<string>();
  value.requirements.forEach((requirement, index) => {
    const key = `${requirement.definitionKey}__${requirement.skillKey}`;
    if (
      !levels.has(requirement.definitionKey) ||
      !skills.has(requirement.skillKey) ||
      requirements.has(key)
    ) {
      context.addIssue({
        code: "custom",
        path: ["requirements", index],
        message: "Invalid requirement",
      });
    }
    requirements.add(key);
  });
}

export const saveLevelCatalogDraftInputSchema = z
  .strictObject({ systemId: customSystemIdSchema, ...draftContentShape })
  .superRefine(checkDraftReferences);
export type SaveLevelCatalogDraftInput = z.infer<typeof saveLevelCatalogDraftInputSchema>;

export const createLevelCatalogDraftInputSchema = z.strictObject({ fromSystemId: systemIdSchema });
export type CreateLevelCatalogDraftInput = z.infer<typeof createLevelCatalogDraftInputSchema>;

export const publishLevelCatalogDraftInputSchema = z.strictObject({
  systemId: customSystemIdSchema,
});
export type PublishLevelCatalogDraftInput = z.infer<typeof publishLevelCatalogDraftInputSchema>;

export const activateLevelCatalogInputSchema = z.strictObject({ systemId: systemIdSchema });
export type ActivateLevelCatalogInput = z.infer<typeof activateLevelCatalogInputSchema>;

export const getLevelCatalogVersionInputSchema = z.strictObject({ systemId: systemIdSchema });
export type GetLevelCatalogVersionInput = z.infer<typeof getLevelCatalogVersionInputSchema>;

export const levelCatalogVersionSummarySchema = z.strictObject({
  systemId: systemIdSchema,
  displayName: z.string().max(200),
  origin: z.enum(["code", "custom"]),
  status: z.enum(["draft", "published"]),
  active: z.boolean(),
  publishedAt: z.string().nullable(),
});
export type LevelCatalogVersionSummary = z.infer<typeof levelCatalogVersionSummarySchema>;

export const listLevelCatalogVersionsResultSchema = z.strictObject({
  versions: z.array(levelCatalogVersionSummarySchema),
});
export type ListLevelCatalogVersionsResult = z.infer<typeof listLevelCatalogVersionsResultSchema>;

/** A whole version in editor form: what `getLevelCatalogVersion` returns and `save` takes back. */
export const levelCatalogVersionContentSchema = z.strictObject({
  systemId: systemIdSchema,
  origin: z.enum(["code", "custom"]),
  status: z.enum(["draft", "published"]),
  displayName: z.string().max(200),
  levels: z.array(levelDraftLevelSchema),
  skills: z.array(levelDraftSkillSchema),
  requirements: z.array(levelDraftRequirementSchema),
});
export type LevelCatalogVersionContent = z.infer<typeof levelCatalogVersionContentSchema>;

export const levelCatalogMissingKeySchema = z.strictObject({
  definitionKey: identifierSchema,
  students: z.number().int().min(1),
});
export type LevelCatalogMissingKey = z.infer<typeof levelCatalogMissingKeySchema>;

/** `details` of the `failed-precondition` refusal when a target version drops held levels. */
export const levelCatalogActivationRefusalSchema = z.strictObject({
  reason: z.literal("missing-levels"),
  missing: z.array(levelCatalogMissingKeySchema).min(1),
});
export type LevelCatalogActivationRefusal = z.infer<typeof levelCatalogActivationRefusalSchema>;

export const activateLevelCatalogResultSchema = z.strictObject({
  activeSystemId: systemIdSchema,
  previousSystemId: systemIdSchema,
  movedStudents: z.number().int().min(0),
});
export type ActivateLevelCatalogResult = z.infer<typeof activateLevelCatalogResultSchema>;

/**
 * Every level a student currently holds must exist in the version being activated. Returns the
 * held keys the target lacks, with how many students hold each, sorted by key; empty means safe.
 */
export function missingProgressKeys(
  targetKeys: ReadonlySet<string>,
  progress: readonly { studentId: string; currentDefinitionKey: string }[],
): readonly { definitionKey: string; students: number }[] {
  const students = new Map<string, Set<string>>();
  for (const head of progress) {
    if (targetKeys.has(head.currentDefinitionKey)) continue;
    const holders = students.get(head.currentDefinitionKey) ?? new Set<string>();
    holders.add(head.studentId);
    students.set(head.currentDefinitionKey, holders);
  }
  return [...students.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([definitionKey, holders]) => ({ definitionKey, students: holders.size }));
}
