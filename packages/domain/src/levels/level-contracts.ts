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
  sessionId: string;
  definitionKey: string;
  skillKey: string;
  score: EvaluationScore;
  evidenceNotes: string;
  evaluatorId: string;
  evaluatorRole: "headCoach" | "coach";
  evaluatedAt: string;
  schemaVersion: "1";
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
}>;

export type RecordEvaluationInput = Readonly<{
  studentId: string;
  sessionId: string;
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

  const { studentId, sessionId, definitionKey, skillKey, score, evidenceNotes } = input;

  if (typeof studentId !== "string" || !safeIdPattern.test(studentId)) {
    issues.push(issue(["input", "studentId"], "invalid_student_id"));
  }

  if (typeof sessionId !== "string" || !safeIdPattern.test(sessionId)) {
    issues.push(issue(["input", "sessionId"], "invalid_session_id"));
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
      sessionId: (sessionId as string).trim(),
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

export type InitializedStudentProgressSummary = Readonly<{
  state: "initialized";
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

export type UninitializedStudentProgressSummary = Readonly<{
  state: "uninitialized";
  studentId: string;
  calculatedAt: string;
}>;

export type StudentProgressSummary =
  InitializedStudentProgressSummary | UninitializedStudentProgressSummary;

export function buildUninitializedStudentProgressSummary(
  studentId: string,
  calculatedAt = new Date().toISOString(),
): UninitializedStudentProgressSummary {
  return Object.freeze({ state: "uninitialized", studentId, calculatedAt });
}

export type ProgressReportLevelBreakdown = Readonly<{
  definitionKey: string;
  definitionName: string;
  studentCount: number;
  assessedStudentCount: number;
  eligibleForPromotionCount: number;
}>;

export type ProgressReportSkillCoverage = Readonly<{
  skillKey: string;
  displayLabel: string;
  assessedStudentCount: number;
  coveragePercentage: number;
}>;

export type ProgressReport = Readonly<{
  activeStudentCount: number;
  assessedStudentCount: number;
  unassessedStudentCount: number;
  totalEvaluationCount: number;
  assessmentCoveragePercentage: number;
  recognitionCandidateCount: number;
  eligibleForPromotionCount: number;
  levelBreakdown: readonly ProgressReportLevelBreakdown[];
  skillCoverage: readonly ProgressReportSkillCoverage[];
  calculatedAt: string;
}>;

export type ProgressReportStudent = Readonly<{
  studentId: string;
  currentDefinitionKey?: string | undefined;
  currentLevelStartedAt?: string | null | undefined;
}>;

export function buildProgressReport(options: {
  catalog: CanonicalLevelCatalog | LevelCatalogProjection;
  students: readonly ProgressReportStudent[];
  evaluations: readonly EvaluationRecord[];
  attendances: readonly { studentId: string; attendedAt: string }[];
  now?: string;
}): ProgressReport {
  const { catalog, evaluations, attendances, now = new Date().toISOString() } = options;
  const students = Array.from(
    new Map(
      options.students
        .filter((student) => student.studentId.trim().length > 0)
        .map((student) => [student.studentId, student]),
    ).values(),
  );
  const studentIds = new Set(students.map((student) => student.studentId));
  const evaluationsByStudent = new Map<string, EvaluationRecord[]>();
  for (const evaluation of evaluations) {
    if (!studentIds.has(evaluation.studentId)) continue;
    const bucket = evaluationsByStudent.get(evaluation.studentId) ?? [];
    bucket.push(evaluation);
    evaluationsByStudent.set(evaluation.studentId, bucket);
  }
  const attendedCountByStudent = new Map<string, number>();
  for (const attendance of attendances) {
    if (!studentIds.has(attendance.studentId)) continue;
    attendedCountByStudent.set(
      attendance.studentId,
      (attendedCountByStudent.get(attendance.studentId) ?? 0) + 1,
    );
  }

  const levelMetrics = new Map<
    string,
    { definitionName: string; studentCount: number; assessedStudentCount: number; eligible: number }
  >();
  const assessedStudentIds = new Set<string>();
  let recognitionCandidateCount = 0;
  let eligibleForPromotionCount = 0;

  for (const student of students) {
    const studentEvaluations = evaluationsByStudent.get(student.studentId) ?? [];
    if (studentEvaluations.length > 0) assessedStudentIds.add(student.studentId);
    if (student.currentDefinitionKey === undefined) {
      continue;
    }
    const progress = buildStudentProgressSummary({
      catalog,
      studentId: student.studentId,
      currentDefinitionKey: student.currentDefinitionKey,
      evaluations: studentEvaluations,
      attendedClassesCount: attendedCountByStudent.get(student.studentId) ?? 0,
      totalHours: (attendedCountByStudent.get(student.studentId) ?? 0) * 1.5,
      currentLevelStartedAt: student.currentLevelStartedAt ?? null,
      now,
    });

    const current = levelMetrics.get(progress.currentDefinition.definitionKey) ?? {
      definitionName: progress.currentDefinition.name,
      studentCount: 0,
      assessedStudentCount: 0,
      eligible: 0,
    };
    current.studentCount += 1;
    if (studentEvaluations.length > 0) current.assessedStudentCount += 1;
    if (progress.targetDefinition) {
      recognitionCandidateCount += 1;
      if (progress.criteria.overallEligible) {
        current.eligible += 1;
        eligibleForPromotionCount += 1;
      }
    }
    levelMetrics.set(progress.currentDefinition.definitionKey, current);
  }

  const skillCoverage = catalog.skills.map((skill) => {
    const assessedStudentCount = students.filter((student) =>
      (evaluationsByStudent.get(student.studentId) ?? []).some(
        (evaluation) => evaluation.skillKey === skill.key,
      ),
    ).length;
    return Object.freeze({
      skillKey: skill.key,
      displayLabel: skill.displayLabel,
      assessedStudentCount,
      coveragePercentage:
        students.length === 0 ? 0 : Math.round((assessedStudentCount / students.length) * 100),
    });
  });

  const assessedStudentCount = assessedStudentIds.size;
  return Object.freeze({
    activeStudentCount: students.length,
    assessedStudentCount,
    unassessedStudentCount: Math.max(0, students.length - assessedStudentCount),
    totalEvaluationCount: Array.from(evaluationsByStudent.values()).reduce(
      (total, bucket) => total + bucket.length,
      0,
    ),
    assessmentCoveragePercentage:
      students.length === 0 ? 0 : Math.round((assessedStudentCount / students.length) * 100),
    recognitionCandidateCount,
    eligibleForPromotionCount,
    levelBreakdown: Object.freeze(
      Array.from(levelMetrics.entries())
        .map(([definitionKey, metrics]) =>
          Object.freeze({
            definitionKey,
            definitionName: metrics.definitionName,
            studentCount: metrics.studentCount,
            assessedStudentCount: metrics.assessedStudentCount,
            eligibleForPromotionCount: metrics.eligible,
          }),
        )
        .sort((left, right) => left.definitionName.localeCompare(right.definitionName)),
    ),
    skillCoverage: Object.freeze(skillCoverage),
    calculatedAt: now,
  });
}
export function buildStudentProgressSummary(options: {
  catalog: CanonicalLevelCatalog | LevelCatalogProjection;
  studentId: string;
  currentDefinitionKey: string;
  evaluations: readonly EvaluationRecord[];
  attendedClassesCount?: number;
  totalHours?: number;
  currentLevelStartedAt?: string | null;
  now?: string;
}): InitializedStudentProgressSummary {
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

  const currentDefinition = catalog.definitions.find(
    (definition) => definition.definitionKey === currentDefinitionKey,
  );
  if (currentDefinition === undefined) {
    throw new Error("Current level definition is not available");
  }

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
    state: "initialized",
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

export const medicalLeaveReasonCodes = Object.freeze([
  "injury",
  "illness",
  "recovery",
  "other",
] as const);
export type MedicalLeaveReasonCode = (typeof medicalLeaveReasonCodes)[number];

export type MedicalLeaveRecord = Readonly<{
  leaveId: string;
  academyId: string;
  studentId: string;
  startDate: string;
  endDate: string;
  reasonCode: MedicalLeaveReasonCode;
  status: "active";
  schemaVersion: "1";
  recordedBy: string;
  recordedAt: string;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
}>;

export type RecordMedicalLeaveInput = Readonly<{
  studentId: string;
  startDate: string;
  endDate: string;
  reasonCode: MedicalLeaveReasonCode;
}>;

export function parseRecordMedicalLeaveInput(
  raw: unknown,
): Result<RecordMedicalLeaveInput, readonly ValidationIssue[]> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return err(Object.freeze([issue(["input"], "expected_object")]));
  }

  const record = raw as Record<string, unknown>;
  const issues: ValidationIssue[] = [];

  const studentId = record["studentId"];
  const startDate = record["startDate"];
  const endDate = record["endDate"];
  const reasonCode = record["reasonCode"];

  if (typeof studentId !== "string" || !safeIdPattern.test(studentId)) {
    issues.push(issue(["input", "studentId"], "invalid_student_id"));
  }

  const startMs = typeof startDate === "string" ? new Date(startDate).getTime() : NaN;
  const endMs = typeof endDate === "string" ? new Date(endDate).getTime() : NaN;

  if (typeof startDate !== "string" || Number.isNaN(startMs)) {
    issues.push(issue(["input", "startDate"], "invalid_start_date_iso"));
  }

  if (typeof endDate !== "string" || Number.isNaN(endMs)) {
    issues.push(issue(["input", "endDate"], "invalid_end_date_iso"));
  }

  if (!Number.isNaN(startMs) && !Number.isNaN(endMs) && endMs < startMs) {
    issues.push(issue(["input", "endDate"], "end_date_must_be_after_start_date"));
  }

  if (!medicalLeaveReasonCodes.includes(reasonCode as MedicalLeaveReasonCode)) {
    issues.push(issue(["input", "reasonCode"], "invalid_reason_code"));
  }

  if (issues.length > 0) {
    return err(Object.freeze(issues));
  }

  return ok(
    Object.freeze({
      studentId: (studentId as string).trim(),
      startDate: (startDate as string).trim(),
      endDate: (endDate as string).trim(),
      reasonCode: reasonCode as MedicalLeaveReasonCode,
    }),
  );
}

export type AttendanceStreak = Readonly<{
  currentStreakWeeks: number;
  longestStreakWeeks: number;
  activeMedicalLeave: boolean;
}>;

function getWeekNumber(dateStr: string): number {
  const ts = new Date(dateStr).getTime();
  if (Number.isNaN(ts)) return 0;
  return Math.floor(ts / (7 * 86400 * 1000));
}

export function calculateAttendanceStreak(options: {
  attendanceDates: readonly string[];
  medicalLeaves?: readonly MedicalLeaveRecord[];
  now?: string;
}): AttendanceStreak {
  const { attendanceDates, medicalLeaves = [], now = new Date().toISOString() } = options;

  const nowMs = new Date(now).getTime();
  const activeMedicalLeave = medicalLeaves.some((l) => {
    const s = new Date(l.startDate).getTime();
    const e = new Date(l.endDate).getTime();
    return !Number.isNaN(s) && !Number.isNaN(e) && s <= nowMs && nowMs <= e;
  });

  if (attendanceDates.length === 0) {
    return Object.freeze({
      currentStreakWeeks: 0,
      longestStreakWeeks: 0,
      activeMedicalLeave,
    });
  }

  const attendedWeeks = new Set<number>();
  for (const date of attendanceDates) {
    const w = getWeekNumber(date);
    if (w > 0) attendedWeeks.add(w);
  }

  const leaveWeeks = new Set<number>();
  for (const leave of medicalLeaves) {
    const sw = getWeekNumber(leave.startDate);
    const ew = getWeekNumber(leave.endDate);
    if (sw > 0 && ew >= sw) {
      for (let w = sw; w <= ew; w++) {
        leaveWeeks.add(w);
      }
    }
  }

  const sortedAttendedWeeks = Array.from(attendedWeeks).sort((a, b) => a - b);
  const nowWeek = getWeekNumber(now);

  // Compute current streak: scan backward from nowWeek (or latest attended/leave week)
  let currentStreak = 0;
  let cursor = nowWeek;

  // If nowWeek hasn't attended yet, check if nowWeek - 1 was attended/leave
  if (!attendedWeeks.has(cursor) && !leaveWeeks.has(cursor)) {
    cursor = nowWeek - 1;
  }

  while (cursor >= 0) {
    if (attendedWeeks.has(cursor)) {
      currentStreak++;
      cursor--;
    } else if (leaveWeeks.has(cursor)) {
      // Leave week preserves the streak without adding or breaking
      cursor--;
    } else {
      break;
    }
  }

  // Compute longest streak across history
  let longestStreak = 0;
  let running = 0;

  if (sortedAttendedWeeks.length > 0) {
    const minWeek = sortedAttendedWeeks[0]!;
    const maxWeek = sortedAttendedWeeks[sortedAttendedWeeks.length - 1]!;

    for (let w = minWeek; w <= maxWeek; w++) {
      if (attendedWeeks.has(w)) {
        running++;
        if (running > longestStreak) longestStreak = running;
      } else if (leaveWeeks.has(w)) {
        // preserve running
      } else {
        running = 0;
      }
    }
  }

  if (currentStreak > longestStreak) {
    longestStreak = currentStreak;
  }

  return Object.freeze({
    currentStreakWeeks: currentStreak,
    longestStreakWeeks: longestStreak,
    activeMedicalLeave,
  });
}

export type RecognitionCandidate = Readonly<{
  studentId: string;
  studentName: string;
  currentDefinitionKey: string;
  currentDefinitionName: string;
  targetDefinitionKey: string;
  targetDefinitionName: string;
  classesAttended: number;
  classesRequired: number | null;
  timeInLevelDays: number;
  timeRequiredDays: number | null;
  skillsCompletedCount: number;
  skillsRequiredCount: number;
  currentStreakWeeks: number;
  readinessPercentage: number;
  isEligibleForPromotion: boolean;
  reasons: readonly string[];
  calculatedAt: string;
}>;

export function generateRecognitionCandidates(options: {
  catalog: CanonicalLevelCatalog | LevelCatalogProjection;
  students: readonly {
    studentId: string;
    studentName: string;
    currentDefinitionKey?: string | undefined;
    currentLevelStartedAt?: string | null | undefined;
  }[];
  evaluations: readonly EvaluationRecord[];
  attendances: readonly { studentId: string; attendedAt: string }[];
  medicalLeaves?: readonly MedicalLeaveRecord[];
  now?: string;
}): readonly RecognitionCandidate[] {
  const {
    catalog,
    students,
    evaluations,
    attendances,
    medicalLeaves = [],
    now = new Date().toISOString(),
  } = options;

  const candidates: RecognitionCandidate[] = [];

  for (const student of students) {
    if (student.currentDefinitionKey === undefined) continue;
    const defKey = student.currentDefinitionKey;
    const studentEvals = evaluations.filter((e) => e.studentId === student.studentId);
    const studentAtts = attendances.filter((a) => a.studentId === student.studentId);
    const studentLeaves = medicalLeaves.filter((l) => l.studentId === student.studentId);

    const streak = calculateAttendanceStreak({
      attendanceDates: studentAtts.map((a) => a.attendedAt),
      medicalLeaves: studentLeaves,
      now,
    });

    const progress = buildStudentProgressSummary({
      catalog,
      studentId: student.studentId,
      currentDefinitionKey: defKey,
      evaluations: studentEvals,
      attendedClassesCount: studentAtts.length,
      totalHours: studentAtts.length * 1.5,
      currentLevelStartedAt: student.currentLevelStartedAt ?? null,
      now,
    });

    if (!progress.targetDefinition) {
      continue; // Student is already at highest rank
    }

    const { classes, time, skills, overallEligible } = progress.criteria;

    const classRatio = classes.required ? Math.min(1, classes.completed / classes.required) : 1;
    const timeRatio = time.requiredDays ? Math.min(1, time.elapsedDays / time.requiredDays) : 1;
    const skillRatio = skills.total > 0 ? skills.completed / skills.total : 1;

    const readinessPercentage = Math.round(((classRatio + timeRatio + skillRatio) / 3) * 100);

    const reasons: string[] = [];
    if (overallEligible) {
      reasons.push(
        "All requirements met: classes attended, minimum time in rank, and required skills validated.",
      );
    } else {
      if (classes.met) {
        reasons.push(`Classes: ${classes.completed}/${classes.required ?? 0} (Met)`);
      } else {
        reasons.push(
          `Classes: ${classes.completed}/${classes.required} (Needs ${(classes.required ?? 0) - classes.completed} more)`,
        );
      }

      if (time.met) {
        reasons.push(`Time in rank: ${time.elapsedDays}/${time.requiredDays ?? 0} days (Met)`);
      } else {
        reasons.push(
          `Time in rank: ${time.elapsedDays}/${time.requiredDays} days (Needs ${(time.requiredDays ?? 0) - time.elapsedDays} more days)`,
        );
      }

      if (skills.met) {
        reasons.push(`Skills: ${skills.completed}/${skills.total} completed (Met)`);
      } else {
        const pending = progress.skillChecklist
          .filter((s) => !s.isCompleted)
          .map((s) => s.displayLabel);
        reasons.push(
          `Skills: ${skills.completed}/${skills.total} completed (Pending: ${pending.join(", ")})`,
        );
      }
    }

    candidates.push(
      Object.freeze({
        studentId: student.studentId,
        studentName: student.studentName,
        currentDefinitionKey: progress.currentDefinition.definitionKey,
        currentDefinitionName: progress.currentDefinition.name,
        targetDefinitionKey: progress.targetDefinition.definitionKey,
        targetDefinitionName: progress.targetDefinition.name,
        classesAttended: classes.completed,
        classesRequired: classes.required,
        timeInLevelDays: time.elapsedDays,
        timeRequiredDays: time.requiredDays,
        skillsCompletedCount: skills.completed,
        skillsRequiredCount: skills.total,
        currentStreakWeeks: streak.currentStreakWeeks,
        readinessPercentage,
        isEligibleForPromotion: overallEligible,
        reasons: Object.freeze(reasons),
        calculatedAt: now,
      }),
    );
  }

  // Sort: eligible first, then readinessPercentage desc, then currentStreakWeeks desc
  candidates.sort((a, b) => {
    if (a.isEligibleForPromotion !== b.isEligibleForPromotion) {
      return a.isEligibleForPromotion ? -1 : 1;
    }
    if (b.readinessPercentage !== a.readinessPercentage) {
      return b.readinessPercentage - a.readinessPercentage;
    }
    if (b.currentStreakWeeks !== a.currentStreakWeeks) {
      return b.currentStreakWeeks - a.currentStreakWeeks;
    }
    return a.studentName.localeCompare(b.studentName);
  });

  return Object.freeze(candidates);
}

export type PromotionDecisionStatus = "approved" | "rejected" | "deferred";

export type GraduationRecord = Readonly<{
  graduationId: string;
  academyId: string;
  studentId: string;
  fromDefinitionKey: string;
  toDefinitionKey: string;
  status: PromotionDecisionStatus;
  decisionNotes: string;
  decidedBy: string;
  decidedByRole: "headCoach";
  decidedAt: string;
  ceremonyDate: string | null;
  schemaVersion: "1";
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
}>;

export function buildGraduationId(
  studentId: string,
  toDefinitionKey: string,
  decidedAt: string,
): string {
  return `grad_${studentId}_${toDefinitionKey}_${decidedAt}`;
}

export type ApprovePromotionInput = Readonly<{
  studentId: string;
  fromDefinitionKey: string;
  toDefinitionKey: string;
  decisionNotes: string;
  ceremonyDate?: string | null;
}>;

export function parseApprovePromotionInput(
  raw: unknown,
): Result<ApprovePromotionInput, readonly ValidationIssue[]> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return err(Object.freeze([issue(["input"], "expected_object")]));
  }

  const record = raw as Record<string, unknown>;
  const issues: ValidationIssue[] = [];

  const studentId = record["studentId"];
  const fromDefinitionKey = record["fromDefinitionKey"];
  const toDefinitionKey = record["toDefinitionKey"];
  const decisionNotes = record["decisionNotes"];
  const ceremonyDate = record["ceremonyDate"];

  if (typeof studentId !== "string" || !safeIdPattern.test(studentId)) {
    issues.push(issue(["input", "studentId"], "invalid_student_id"));
  }

  if (typeof fromDefinitionKey !== "string" || !safeIdPattern.test(fromDefinitionKey)) {
    issues.push(issue(["input", "fromDefinitionKey"], "invalid_from_definition_key"));
  }

  if (typeof toDefinitionKey !== "string" || !safeIdPattern.test(toDefinitionKey)) {
    issues.push(issue(["input", "toDefinitionKey"], "invalid_to_definition_key"));
  }

  if (
    typeof decisionNotes !== "string" ||
    decisionNotes.trim().length < 3 ||
    decisionNotes.trim().length > 1000
  ) {
    issues.push(issue(["input", "decisionNotes"], "decision_notes_length_3_to_1000"));
  }

  let parsedCeremonyDate: string | null = null;
  if (ceremonyDate !== undefined && ceremonyDate !== null) {
    if (typeof ceremonyDate === "string" && !Number.isNaN(new Date(ceremonyDate).getTime())) {
      parsedCeremonyDate = ceremonyDate.trim();
    } else {
      issues.push(issue(["input", "ceremonyDate"], "invalid_ceremony_date_iso"));
    }
  }

  if (issues.length > 0) {
    return err(Object.freeze(issues));
  }

  return ok(
    Object.freeze({
      studentId: (studentId as string).trim(),
      fromDefinitionKey: (fromDefinitionKey as string).trim(),
      toDefinitionKey: (toDefinitionKey as string).trim(),
      decisionNotes: (decisionNotes as string).trim(),
      ceremonyDate: parsedCeremonyDate,
    }),
  );
}

export type RejectPromotionInput = Readonly<{
  studentId: string;
  targetDefinitionKey: string;
  decisionNotes: string;
}>;

export function parseRejectPromotionInput(
  raw: unknown,
): Result<RejectPromotionInput, readonly ValidationIssue[]> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return err(Object.freeze([issue(["input"], "expected_object")]));
  }

  const record = raw as Record<string, unknown>;
  const issues: ValidationIssue[] = [];

  const studentId = record["studentId"];
  const targetDefinitionKey = record["targetDefinitionKey"];
  const decisionNotes = record["decisionNotes"];

  if (typeof studentId !== "string" || !safeIdPattern.test(studentId)) {
    issues.push(issue(["input", "studentId"], "invalid_student_id"));
  }

  if (typeof targetDefinitionKey !== "string" || !safeIdPattern.test(targetDefinitionKey)) {
    issues.push(issue(["input", "targetDefinitionKey"], "invalid_target_definition_key"));
  }

  if (
    typeof decisionNotes !== "string" ||
    decisionNotes.trim().length < 3 ||
    decisionNotes.trim().length > 1000
  ) {
    issues.push(issue(["input", "decisionNotes"], "decision_notes_length_3_to_1000"));
  }

  if (issues.length > 0) {
    return err(Object.freeze(issues));
  }

  return ok(
    Object.freeze({
      studentId: (studentId as string).trim(),
      targetDefinitionKey: (targetDefinitionKey as string).trim(),
      decisionNotes: (decisionNotes as string).trim(),
    }),
  );
}

export type PeerComparisonStudent = Readonly<{
  studentId: string;
  studentName: string;
  beltName: string;
  beltColor?: string;
  stripes: number;
  streakWeeks: number;
  techniquesLearned: number;
  totalTechniques: number;
  sequence: number;
  classesInRank: number;
}>;

export type PeerComparisonResult = Readonly<{
  currentStudent: PeerComparisonStudent;
  peersAbove: readonly PeerComparisonStudent[];
  peersBelow: readonly PeerComparisonStudent[];
}>;

export function buildPeerComparison(input: {
  currentStudentId: string;
  students: readonly PeerComparisonStudent[];
}): PeerComparisonResult | null {
  const { currentStudentId, students } = input;
  const current = students.find((s) => s.studentId === currentStudentId);
  if (!current) return null;

  // Sort descending: highest rank / progression first
  const sorted = [...students].sort((a, b) => {
    if (a.sequence !== b.sequence) return b.sequence - a.sequence;
    if (a.stripes !== b.stripes) return b.stripes - a.stripes;
    if (a.techniquesLearned !== b.techniquesLearned)
      return b.techniquesLearned - a.techniquesLearned;
    if (a.streakWeeks !== b.streakWeeks) return b.streakWeeks - a.streakWeeks;
    if (a.classesInRank !== b.classesInRank) return b.classesInRank - a.classesInRank;
    return a.studentName.localeCompare(b.studentName);
  });

  const currentIndex = sorted.findIndex((s) => s.studentId === currentStudentId);
  if (currentIndex === -1) return null;

  const peersAbove = sorted.slice(Math.max(0, currentIndex - 2), currentIndex);
  const peersBelow = sorted.slice(currentIndex + 1, currentIndex + 3);

  return Object.freeze({
    currentStudent: current,
    peersAbove: Object.freeze(peersAbove),
    peersBelow: Object.freeze(peersBelow),
  });
}
