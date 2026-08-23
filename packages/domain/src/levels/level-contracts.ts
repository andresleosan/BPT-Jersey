import type { ValidationIssue } from "../errors";
import { err, ok, type Result } from "../result";

export const levelDefinitionKinds = Object.freeze(["belt", "stripe"] as const);
export type LevelDefinitionKind = (typeof levelDefinitionKinds)[number];

export const levelRequirementInheritanceModes = Object.freeze([
  "inherit",
  "replace",
  "none",
] as const);
export type LevelRequirementInheritanceMode = (typeof levelRequirementInheritanceModes)[number];

export type LevelCriteria = Readonly<{
  minAge: number | null;
  maxAge: number | null;
  minClasses: number | null;
  minimumTime: Readonly<{
    years: number;
    months: number;
    days: number;
  }> | null;
}>;

export type LevelVisual = Readonly<{
  colorMode: number;
  colors: readonly string[];
  stripeColor: string | null;
  stripeCenter: number | null;
  stripeWidth: number | null;
  stripePosition: number | null;
}>;

export type SkillDefinition = Readonly<{
  key: string;
  displayLabel: string;
  observedLabel: string | null;
  minimumRating: number;
  sequence: number;
}>;

export type LevelSystemRecord = Readonly<{
  systemId: string;
  displayName: string;
  schemaVersion: 1;
  precedence: Readonly<{
    businessRules: string;
    hierarchyVisualsAndObservedSkills: string;
    conflicts: string;
  }>;
  counts: Readonly<{
    definitions: number;
    belts: number;
    stripes: number;
  }>;
  skillCatalog: readonly SkillDefinition[];
}>;

export type LevelDefinitionRecord = Readonly<{
  definitionKey: string;
  systemId: string;
  kind: LevelDefinitionKind;
  parentDefinitionKey: string | null;
  name: string;
  sequence: number;
  stripeNumber: number | null;
  criteria: LevelCriteria;
  observedCriteria: LevelCriteria;
  visual: LevelVisual;
  observedSkillRequirementSetKey: string | null;
  observedSkillRequirementsState: string;
  anomalyFlags: readonly string[];
  schemaVersion: 1;
}>;

export type LevelRequirementRecord = Readonly<{
  requirementKey: string;
  systemId: string;
  definitionKey: string;
  skillKey: string;
  minimumRating: number;
  inheritance: LevelRequirementInheritanceMode;
  schemaVersion: 1;
}>;

export type CanonicalLevelCatalog = Readonly<{
  system: LevelSystemRecord;
  definitions: readonly LevelDefinitionRecord[];
  skills: readonly SkillDefinition[];
  requirements: readonly LevelRequirementRecord[];
}>;

export type LevelCatalogProjection = Readonly<{
  system: LevelSystemRecord;
  definitions: readonly LevelDefinitionRecord[];
  skills: readonly SkillDefinition[];
  requirements: readonly LevelRequirementRecord[];
  sourceHash: string;
}>;

const hexColorPattern = /^#[0-9a-fA-F]{6}$/u;
const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

function issue(path: readonly (string | number)[], code: string): ValidationIssue {
  return { path, code };
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function parseCriteria(
  value: unknown,
  path: readonly (string | number)[],
  issues: ValidationIssue[],
): LevelCriteria | null {
  if (!isPlainRecord(value)) {
    issues.push(issue(path, "invalid_criteria_object"));
    return null;
  }

  const { minAge, maxAge, minClasses, minimumTime } = value;

  if (minAge !== null && (typeof minAge !== "number" || minAge < 0 || !Number.isInteger(minAge))) {
    issues.push(issue([...path, "minAge"], "invalid_min_age"));
  }
  if (maxAge !== null && (typeof maxAge !== "number" || maxAge < 0 || !Number.isInteger(maxAge))) {
    issues.push(issue([...path, "maxAge"], "invalid_max_age"));
  }
  if (
    minClasses !== null &&
    (typeof minClasses !== "number" || minClasses < 0 || !Number.isInteger(minClasses))
  ) {
    issues.push(issue([...path, "minClasses"], "invalid_min_classes"));
  }

  let parsedTime: { years: number; months: number; days: number } | null = null;
  if (minimumTime !== null && minimumTime !== undefined) {
    if (!isPlainRecord(minimumTime)) {
      issues.push(issue([...path, "minimumTime"], "invalid_minimum_time"));
    } else {
      const { years, months, days } = minimumTime;
      if (
        typeof years !== "number" ||
        years < 0 ||
        !Number.isInteger(years) ||
        typeof months !== "number" ||
        months < 0 ||
        !Number.isInteger(months) ||
        typeof days !== "number" ||
        days < 0 ||
        !Number.isInteger(days)
      ) {
        issues.push(issue([...path, "minimumTime"], "invalid_minimum_time_values"));
      } else {
        parsedTime = Object.freeze({ years, months, days });
      }
    }
  }

  return Object.freeze({
    minAge: typeof minAge === "number" ? minAge : null,
    maxAge: typeof maxAge === "number" ? maxAge : null,
    minClasses: typeof minClasses === "number" ? minClasses : null,
    minimumTime: parsedTime,
  });
}

function parseVisual(
  value: unknown,
  path: readonly (string | number)[],
  issues: ValidationIssue[],
): LevelVisual | null {
  if (!isPlainRecord(value)) {
    issues.push(issue(path, "invalid_visual_object"));
    return null;
  }

  const { colorMode, colors, stripeColor, stripeCenter, stripeWidth, stripePosition } = value;

  if (typeof colorMode !== "number" || !Number.isInteger(colorMode)) {
    issues.push(issue([...path, "colorMode"], "invalid_color_mode"));
  }

  if (!Array.isArray(colors) || colors.length === 0) {
    issues.push(issue([...path, "colors"], "invalid_colors_array"));
  } else {
    for (let i = 0; i < colors.length; i++) {
      const c = colors[i];
      if (typeof c !== "string" || !hexColorPattern.test(c)) {
        issues.push(issue([...path, "colors", i], "invalid_hex_color"));
      }
    }
  }

  if (
    stripeColor !== null &&
    stripeColor !== undefined &&
    (typeof stripeColor !== "string" || !hexColorPattern.test(stripeColor))
  ) {
    issues.push(issue([...path, "stripeColor"], "invalid_stripe_color"));
  }

  return Object.freeze({
    colorMode: typeof colorMode === "number" ? colorMode : 1,
    colors: Object.freeze(Array.isArray(colors) ? [...colors] : []),
    stripeColor: typeof stripeColor === "string" ? stripeColor : null,
    stripeCenter: typeof stripeCenter === "number" ? stripeCenter : null,
    stripeWidth: typeof stripeWidth === "number" ? stripeWidth : null,
    stripePosition: typeof stripePosition === "number" ? stripePosition : null,
  });
}

export function parseLevelCatalogSource(
  observedInput: unknown,
  businessInput: unknown,
): Result<CanonicalLevelCatalog, readonly ValidationIssue[]> {
  const issues: ValidationIssue[] = [];

  if (!isPlainRecord(observedInput)) {
    return err([issue(["observed"], "invalid_observed_source")]);
  }
  if (!isPlainRecord(businessInput)) {
    return err([issue(["business"], "invalid_business_source")]);
  }

  if (observedInput.schemaVersion !== 1) {
    issues.push(issue(["observed", "schemaVersion"], "unsupported_schema_version"));
  }
  if (businessInput.schemaVersion !== 1) {
    issues.push(issue(["business", "schemaVersion"], "unsupported_schema_version"));
  }

  const businessLevels = isPlainRecord(businessInput.levels) ? businessInput.levels : null;
  if (!businessLevels) {
    issues.push(issue(["business", "levels"], "missing_business_levels"));
    return err(issues);
  }

  const observedSkills = Array.isArray(observedInput.skillCatalog)
    ? observedInput.skillCatalog
    : [];
  const parsedSkills: SkillDefinition[] = [];
  const seenSkillKeys = new Set<string>();

  for (let i = 0; i < observedSkills.length; i++) {
    const s = observedSkills[i];
    if (!isPlainRecord(s)) {
      issues.push(issue(["observed", "skillCatalog", i], "invalid_skill_object"));
      continue;
    }
    const { key, displayLabel, observedLabel, minimumRating, sequence } = s;
    if (typeof key !== "string" || !identifierPattern.test(key) || seenSkillKeys.has(key)) {
      issues.push(issue(["observed", "skillCatalog", i, "key"], "invalid_or_duplicate_skill_key"));
    } else {
      seenSkillKeys.add(key);
    }
    if (typeof displayLabel !== "string" || displayLabel.length === 0) {
      issues.push(issue(["observed", "skillCatalog", i, "displayLabel"], "invalid_display_label"));
    }
    if (
      typeof minimumRating !== "number" ||
      !Number.isInteger(minimumRating) ||
      minimumRating < 1 ||
      minimumRating > 5
    ) {
      issues.push(issue(["observed", "skillCatalog", i, "minimumRating"], "invalid_skill_rating"));
    }
    if (typeof sequence !== "number" || !Number.isInteger(sequence) || sequence < 1) {
      issues.push(issue(["observed", "skillCatalog", i, "sequence"], "invalid_sequence"));
    }

    parsedSkills.push(
      Object.freeze({
        key: typeof key === "string" ? key : "",
        displayLabel: typeof displayLabel === "string" ? displayLabel : "",
        observedLabel: typeof observedLabel === "string" ? observedLabel : null,
        minimumRating: typeof minimumRating === "number" ? minimumRating : 3,
        sequence: typeof sequence === "number" ? sequence : i + 1,
      }),
    );
  }

  if (parsedSkills.length !== 11) {
    issues.push(issue(["observed", "skillCatalog"], "expected_11_skills"));
  }

  const systemId = "ibjjf-v1";
  const observedLevels = Array.isArray(observedInput.levels) ? observedInput.levels : [];
  const parsedDefinitions: LevelDefinitionRecord[] = [];
  const levelKeys = new Set<string>();

  for (let i = 0; i < observedLevels.length; i++) {
    const l = observedLevels[i];
    if (!isPlainRecord(l)) {
      issues.push(issue(["observed", "levels", i], "invalid_level_object"));
      continue;
    }

    const {
      key,
      parentKey,
      kind,
      name,
      sequence,
      stripeNumber,
      observedCriteria,
      visual,
      observedSkillRequirementSetKey,
      observedSkillRequirementsState,
      anomalyFlags,
    } = l;

    if (typeof key !== "string" || !identifierPattern.test(key) || levelKeys.has(key)) {
      issues.push(issue(["observed", "levels", i, "key"], "invalid_or_duplicate_level_key"));
    } else {
      levelKeys.add(key);
    }

    if (!levelDefinitionKinds.includes(kind as LevelDefinitionKind)) {
      issues.push(issue(["observed", "levels", i, "kind"], "invalid_level_kind"));
    }

    if (typeof name !== "string" || name.length === 0) {
      issues.push(issue(["observed", "levels", i, "name"], "invalid_level_name"));
    }

    if (typeof sequence !== "number" || sequence < 1 || !Number.isInteger(sequence)) {
      issues.push(issue(["observed", "levels", i, "sequence"], "invalid_level_sequence"));
    }

    const parsedObservedCriteria = parseCriteria(
      observedCriteria,
      ["observed", "levels", i, "observedCriteria"],
      issues,
    );
    const businessCriteriaRaw = typeof key === "string" ? businessLevels[key] : undefined;
    if (!businessCriteriaRaw) {
      issues.push(
        issue(["business", "levels", key as string], "missing_business_criteria_for_level"),
      );
    }
    const parsedBusinessCriteria = parseCriteria(
      businessCriteriaRaw,
      ["business", "levels", key as string],
      issues,
    );
    const parsedVisual = parseVisual(visual, ["observed", "levels", i, "visual"], issues);

    parsedDefinitions.push(
      Object.freeze({
        definitionKey: typeof key === "string" ? key : "",
        systemId,
        kind: kind as LevelDefinitionKind,
        parentDefinitionKey: typeof parentKey === "string" ? parentKey : null,
        name: typeof name === "string" ? name : "",
        sequence: typeof sequence === "number" ? sequence : i + 1,
        stripeNumber: typeof stripeNumber === "number" ? stripeNumber : null,
        criteria: parsedBusinessCriteria ??
          parsedObservedCriteria ?? {
            minAge: null,
            maxAge: null,
            minClasses: null,
            minimumTime: null,
          },
        observedCriteria: parsedObservedCriteria ?? {
          minAge: null,
          maxAge: null,
          minClasses: null,
          minimumTime: null,
        },
        visual: parsedVisual ?? {
          colorMode: 1,
          colors: ["#ffffff"],
          stripeColor: null,
          stripeCenter: null,
          stripeWidth: null,
          stripePosition: null,
        },
        observedSkillRequirementSetKey:
          typeof observedSkillRequirementSetKey === "string"
            ? observedSkillRequirementSetKey
            : null,
        observedSkillRequirementsState:
          typeof observedSkillRequirementsState === "string"
            ? observedSkillRequirementsState
            : "none",
        anomalyFlags: Object.freeze(
          Array.isArray(anomalyFlags)
            ? anomalyFlags.filter((f): f is string => typeof f === "string")
            : [],
        ),
        schemaVersion: 1,
      }),
    );
  }

  // Validate parentKey references
  for (let i = 0; i < parsedDefinitions.length; i++) {
    const def = parsedDefinitions[i];
    if (def && def.parentDefinitionKey !== null && !levelKeys.has(def.parentDefinitionKey)) {
      issues.push(issue(["observed", "levels", i, "parentKey"], "orphan_parent_key"));
    }
  }

  if (parsedDefinitions.length !== 171) {
    issues.push(issue(["observed", "levels"], "expected_171_definitions"));
  }

  const belts = parsedDefinitions.filter((d) => d.kind === "belt");
  const stripes = parsedDefinitions.filter((d) => d.kind === "stripe");
  if (belts.length !== 27) issues.push(issue(["observed", "levels"], "expected_27_belts"));
  if (stripes.length !== 144) issues.push(issue(["observed", "levels"], "expected_144_stripes"));

  // Build requirements from skillRequirementSets
  const skillRequirementSets = Array.isArray(observedInput.skillRequirementSets)
    ? observedInput.skillRequirementSets
    : [];
  const reqSetsMap = new Map<string, readonly { skillKey: string; minimumRating: number }[]>();
  for (const set of skillRequirementSets) {
    if (isPlainRecord(set) && typeof set.key === "string" && Array.isArray(set.requirements)) {
      const validReqs = set.requirements.filter(isPlainRecord).map((r) => ({
        skillKey: String(r.skillKey),
        minimumRating: Number(r.minimumRating),
      }));
      reqSetsMap.set(set.key, validReqs);
    }
  }

  const parsedRequirements: LevelRequirementRecord[] = [];
  for (const def of parsedDefinitions) {
    if (def.observedSkillRequirementSetKey && reqSetsMap.has(def.observedSkillRequirementSetKey)) {
      const reqs = reqSetsMap.get(def.observedSkillRequirementSetKey);
      if (reqs) {
        for (const r of reqs) {
          parsedRequirements.push(
            Object.freeze({
              requirementKey: `${def.definitionKey}__${r.skillKey}`,
              systemId,
              definitionKey: def.definitionKey,
              skillKey: r.skillKey,
              minimumRating: r.minimumRating,
              inheritance: "inherit",
              schemaVersion: 1,
            }),
          );
        }
      }
    }
  }

  if (issues.length > 0) {
    return err(Object.freeze(issues));
  }

  const systemRecord: LevelSystemRecord = Object.freeze({
    systemId,
    displayName: "JIU-JITSU - IBJJF",
    schemaVersion: 1,
    precedence: Object.freeze({
      businessRules: "BPTJ FUNCTIONS APP.docx and BPT-memberships.docx",
      hierarchyVisualsAndObservedSkills: "Regyfit",
      conflicts: "DOCX wins; unresolved Regyfit anomalies remain flagged",
    }),
    counts: Object.freeze({
      definitions: parsedDefinitions.length,
      belts: belts.length,
      stripes: stripes.length,
    }),
    skillCatalog: Object.freeze(parsedSkills),
  });

  return ok(
    Object.freeze({
      system: systemRecord,
      definitions: Object.freeze(parsedDefinitions),
      skills: Object.freeze(parsedSkills),
      requirements: Object.freeze(parsedRequirements),
    }),
  );
}

export function parseLevelCatalogProjection(
  input: unknown,
): Result<LevelCatalogProjection, readonly ValidationIssue[]> {
  const issues: ValidationIssue[] = [];

  if (!isPlainRecord(input)) {
    return err([issue(["projection"], "invalid_projection_object")]);
  }

  const { system, definitions, skills, requirements, sourceHash } = input;

  if (!isPlainRecord(system)) {
    issues.push(issue(["projection", "system"], "invalid_system"));
  }
  if (!Array.isArray(definitions) || definitions.length !== 171) {
    issues.push(issue(["projection", "definitions"], "expected_171_definitions"));
  }
  if (!Array.isArray(skills) || skills.length !== 11) {
    issues.push(issue(["projection", "skills"], "expected_11_skills"));
  }
  if (!Array.isArray(requirements) || requirements.length !== 165) {
    issues.push(issue(["projection", "requirements"], "expected_165_requirements"));
  }
  if (typeof sourceHash !== "string" || sourceHash.length === 0) {
    issues.push(issue(["projection", "sourceHash"], "invalid_source_hash"));
  }

  if (issues.length > 0) {
    return err(Object.freeze(issues));
  }

  return ok(
    Object.freeze({
      system: Object.freeze(system as LevelSystemRecord),
      definitions: Object.freeze([...(definitions as readonly LevelDefinitionRecord[])]),
      skills: Object.freeze([...(skills as readonly SkillDefinition[])]),
      requirements: Object.freeze([...(requirements as readonly LevelRequirementRecord[])]),
      sourceHash: sourceHash as string,
    }),
  );
}

export const evaluationScores = Object.freeze([1, 2, 3, 4, 5] as const);
export type EvaluationScore = (typeof evaluationScores)[number];

export type EvaluationRecord = Readonly<{
  evaluationId: string;
  academyId: string;
  studentId: string;
  definitionKey: string;
  skillKey: string;
  score: EvaluationScore;
  evidenceNotes: string;
  evaluatorId: string;
  evaluatorRole: "owner" | "administrator" | "headCoach" | "coach";
  evaluatedAt: string;
  schemaVersion: "1";
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
}>;

export type RecordEvaluationInput = Readonly<{
  studentId: string;
  definitionKey: string;
  skillKey: string;
  score: EvaluationScore;
  evidenceNotes: string;
}>;

export function buildEvaluationId(
  studentId: string,
  skillKey: string,
  evaluatedAt?: string,
): string {
  const ts = evaluatedAt ? evaluatedAt : new Date().toISOString();
  return `eval_${studentId}_${skillKey}_${ts}`;
}

const safeIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

export function parseRecordEvaluationInput(
  input: unknown,
): Result<RecordEvaluationInput, readonly ValidationIssue[]> {
  const issues: ValidationIssue[] = [];

  if (!isPlainRecord(input)) {
    return err([issue(["input"], "invalid_evaluation_object")]);
  }

  const { studentId, definitionKey, skillKey, score, evidenceNotes } = input;

  if (typeof studentId !== "string" || !safeIdPattern.test(studentId)) {
    issues.push(issue(["input", "studentId"], "invalid_student_id"));
  }

  if (typeof definitionKey !== "string" || !safeIdPattern.test(definitionKey)) {
    issues.push(issue(["input", "definitionKey"], "invalid_definition_key"));
  }

  if (typeof skillKey !== "string" || !safeIdPattern.test(skillKey)) {
    issues.push(issue(["input", "skillKey"], "invalid_skill_key"));
  }

  if (
    typeof score !== "number" ||
    !Number.isInteger(score) ||
    !evaluationScores.includes(score as EvaluationScore)
  ) {
    issues.push(issue(["input", "score"], "score_must_be_integer_between_1_and_5"));
  }

  if (
    typeof evidenceNotes !== "string" ||
    evidenceNotes.trim().length < 3 ||
    evidenceNotes.trim().length > 1000
  ) {
    issues.push(issue(["input", "evidenceNotes"], "evidence_notes_length_3_to_1000"));
  }

  if (issues.length > 0) {
    return err(Object.freeze(issues));
  }

  return ok(
    Object.freeze({
      studentId: (studentId as string).trim(),
      definitionKey: (definitionKey as string).trim(),
      skillKey: (skillKey as string).trim(),
      score: score as EvaluationScore,
      evidenceNotes: (evidenceNotes as string).trim(),
    }),
  );
}

export type SkillChecklistItem = Readonly<{
  skillKey: string;
  displayLabel: string;
  requiredScore: number;
  currentScore: number;
  latestScore: number;
  isCompleted: boolean;
  lastEvaluatedAt: string | null;
  evaluationCount: number;
}>;

export type ProgressCriteriaSummary = Readonly<{
  classes: Readonly<{
    required: number | null;
    completed: number;
    met: boolean;
  }>;
  time: Readonly<{
    requiredDays: number | null;
    elapsedDays: number;
    met: boolean;
  }>;
  skills: Readonly<{
    total: number;
    completed: number;
    met: boolean;
    percentage: number;
  }>;
  overallEligible: boolean;
}>;

export type StudentProgressSummary = Readonly<{
  studentId: string;
  currentDefinition: LevelDefinitionRecord;
  targetDefinition: LevelDefinitionRecord | null;
  skillChecklist: readonly SkillChecklistItem[];
  criteria: ProgressCriteriaSummary;
  totalAttendedClasses: number;
  totalHours: number;
  currentLevelStartedAt: string | null;
  calculatedAt: string;
}>;

export function buildStudentProgressSummary(options: {
  catalog: CanonicalLevelCatalog | LevelCatalogProjection;
  studentId: string;
  currentDefinitionKey: string;
  evaluations: readonly EvaluationRecord[];
  attendedClassesCount?: number;
  totalHours?: number;
  currentLevelStartedAt?: string | null;
  now?: string;
}): StudentProgressSummary {
  const {
    catalog,
    studentId,
    currentDefinitionKey,
    evaluations,
    attendedClassesCount = 0,
    totalHours = 0,
    currentLevelStartedAt = null,
    now = new Date().toISOString(),
  } = options;

  const currentDefinition =
    catalog.definitions.find((d) => d.definitionKey === currentDefinitionKey) ??
    catalog.definitions[0]!;

  const targetDefinition =
    catalog.definitions.find((d) => d.sequence === currentDefinition.sequence + 1) ?? null;

  // Build skill checklist based on target definition requirements
  const targetReqs = targetDefinition
    ? catalog.requirements.filter((r) => r.definitionKey === targetDefinition.definitionKey)
    : [];

  const skillsMap = new Map(catalog.skills.map((s) => [s.key, s]));

  const skillChecklist: SkillChecklistItem[] = targetReqs.map((req) => {
    const skillDef = skillsMap.get(req.skillKey);
    const label = skillDef ? skillDef.displayLabel : req.skillKey;

    const studentSkillEvals = evaluations
      .filter((e) => e.studentId === studentId && e.skillKey === req.skillKey)
      .sort((a, b) => b.evaluatedAt.localeCompare(a.evaluatedAt));

    const count = studentSkillEvals.length;
    let maxScore = 0;
    let latestScore = 0;
    let lastEvaluatedAt: string | null = null;

    if (count > 0) {
      latestScore = studentSkillEvals[0]!.score;
      lastEvaluatedAt = studentSkillEvals[0]!.evaluatedAt;
      for (const ev of studentSkillEvals) {
        if (ev.score > maxScore) maxScore = ev.score;
      }
    }

    const isCompleted = maxScore >= req.minimumRating;

    return Object.freeze({
      skillKey: req.skillKey,
      displayLabel: label,
      requiredScore: req.minimumRating,
      currentScore: maxScore,
      latestScore,
      isCompleted,
      lastEvaluatedAt,
      evaluationCount: count,
    });
  });

  // Calculate classes criteria
  const requiredClasses = targetDefinition?.criteria.minClasses ?? null;
  const classesMet = requiredClasses === null || attendedClassesCount >= requiredClasses;

  // Calculate time criteria
  let requiredDays: number | null = null;
  if (targetDefinition?.criteria.minimumTime) {
    const mt = targetDefinition.criteria.minimumTime;
    requiredDays = mt.years * 365 + mt.months * 30 + mt.days;
  }

  let elapsedDays = 0;
  if (currentLevelStartedAt) {
    const startMs = new Date(currentLevelStartedAt).getTime();
    const nowMs = new Date(now).getTime();
    if (!Number.isNaN(startMs) && !Number.isNaN(nowMs) && nowMs >= startMs) {
      elapsedDays = Math.floor((nowMs - startMs) / (1000 * 86400));
    }
  }

  const timeMet = requiredDays === null || elapsedDays >= requiredDays;

  // Calculate skills criteria
  const totalSkills = skillChecklist.length;
  const completedSkills = skillChecklist.filter((s) => s.isCompleted).length;
  const skillsMet = totalSkills === 0 || completedSkills === totalSkills;
  const skillsPercentage =
    totalSkills === 0 ? 100 : Math.round((completedSkills / totalSkills) * 100);

  const overallEligible = targetDefinition === null ? true : classesMet && timeMet && skillsMet;

  const criteria: ProgressCriteriaSummary = Object.freeze({
    classes: Object.freeze({
      required: requiredClasses,
      completed: attendedClassesCount,
      met: classesMet,
    }),
    time: Object.freeze({
      requiredDays,
      elapsedDays,
      met: timeMet,
    }),
    skills: Object.freeze({
      total: totalSkills,
      completed: completedSkills,
      met: skillsMet,
      percentage: skillsPercentage,
    }),
    overallEligible,
  });

  return Object.freeze({
    studentId,
    currentDefinition,
    targetDefinition,
    skillChecklist: Object.freeze(skillChecklist),
    criteria,
    totalAttendedClasses: attendedClassesCount,
    totalHours,
    currentLevelStartedAt,
    calculatedAt: now,
  });
}
