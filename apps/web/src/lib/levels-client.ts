import { httpsCallable } from "./callable";
import { z } from "zod";

import businessCriteriaJson from "../../../../docs/data/ibjjf-levels-business-criteria.sanitized.json";
import observedJson from "../../../../docs/data/ibjjf-levels-observed.sanitized.json";
import {
  assignLevelInputSchema,
  assignLevelResultSchema,
  parseApprovePromotionInput,
  parseLevelCatalogProjection,
  parseOpenStudentLevelInput,
  parseLevelCatalogSource,
  parseRecordEvaluationInput,
  parseRecordMedicalLeaveInput,
  parseRejectPromotionInput,
  recordSkillRatingsInputSchema,
  recordSkillRatingsResultSchema,
  studentLevelCardSchema,
  studentLevelHistorySchema,
  studentSkillSummaryResponseSchema,
  voidPromotionInputSchema,
  voidPromotionResultSchema,
  type AssignLevelInput,
  type AssignLevelResult,
  type ApprovePromotionInput,
  type EvaluationRecord,
  type GraduationRecord,
  type LevelCatalogProjection,
  type MedicalLeaveRecord,
  type OpenStudentLevelInput,
  type ProgressReport,
  type RecognitionCandidate,
  type RecordEvaluationInput,
  type RecordMedicalLeaveInput,
  type RecordSkillRatingsInput,
  type RecordSkillRatingsResult,
  type RejectPromotionInput,
  type StudentLevelCard,
  type StudentLevelHistory,
  type StudentProgressSummary,
  type VoidPromotionInput,
  type VoidPromotionResult,
  type AgeBandEvaluation,
} from "@bpt-jersey/domain/levels";
import { getFirebaseFunctions } from "./firebase-client";

const safeCatalogError = "Unable to load level catalog. Please try again.";
const safeRecordEvalError = "Unable to record evaluation. Please try again.";
const safeListEvalError = "Unable to load student evaluations. Please try again.";
const safeProgressError = "Unable to load student progress. Please try again.";
const safeRecordMedicalLeaveError = "Unable to record medical leave. Please try again.";
const safeListMedicalLeavesError = "Unable to load medical leaves. Please try again.";
const safeListCandidatesError = "Unable to load recognition candidates. Please try again.";
const safeApprovePromotionError = "Unable to approve promotion. Please try again.";
const safeRejectPromotionError = "Unable to reject promotion. Please try again.";
const safeListGraduationsError = "Unable to load graduation history. Please try again.";
const safeProgressReportError = "Unable to load progress report. Please try again.";

let bundledLevelCatalog: LevelCatalogProjection | undefined;

function getBundledLevelCatalog(): LevelCatalogProjection {
  if (bundledLevelCatalog) return bundledLevelCatalog;

  const source = parseLevelCatalogSource(observedJson, businessCriteriaJson);
  const observedSourceHash =
    typeof observedJson.contentHash === "string" ? observedJson.contentHash.trim() : "";
  if (!source.ok || observedSourceHash.length === 0) {
    throw new Error(safeCatalogError);
  }

  const projection = parseLevelCatalogProjection({
    ...source.value,
    sourceHash: `bundled:${observedSourceHash}:business-${businessCriteriaJson.schemaVersion}`,
  });
  if (!projection.ok) {
    throw new Error(safeCatalogError);
  }

  bundledLevelCatalog = projection.value;
  return bundledLevelCatalog;
}

function isConnectedLevelsBackendEnabled(): boolean {
  return process.env.NEXT_PUBLIC_LEVELS_BACKEND === "true";
}

export type StudentEvaluationsResponse = Readonly<{
  evaluations: readonly EvaluationRecord[];
  summary: Record<
    string,
    { count: number; maxScore: number; latestScore: number; lastEvaluatedAt: string }
  >;
}>;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSafeProgressReport(value: unknown): value is ProgressReport {
  if (!isPlainRecord(value)) return false;
  const fields = [
    "activeStudentCount",
    "assessedStudentCount",
    "unassessedStudentCount",
    "totalEvaluationCount",
    "assessmentCoveragePercentage",
    "recognitionCandidateCount",
    "eligibleForPromotionCount",
    "levelBreakdown",
    "skillCoverage",
    "calculatedAt",
  ];
  if (Object.keys(value).some((field) => !fields.includes(field))) return false;
  const counts = [
    "activeStudentCount",
    "assessedStudentCount",
    "unassessedStudentCount",
    "totalEvaluationCount",
    "recognitionCandidateCount",
    "eligibleForPromotionCount",
  ];
  if (
    counts.some((field) => !Number.isSafeInteger(value[field]) || (value[field] as number) < 0) ||
    !Number.isSafeInteger(value.assessmentCoveragePercentage) ||
    (value.assessmentCoveragePercentage as number) < 0 ||
    (value.assessmentCoveragePercentage as number) > 100 ||
    typeof value.calculatedAt !== "string"
  ) {
    return false;
  }
  if (!Array.isArray(value.levelBreakdown) || !Array.isArray(value.skillCoverage)) return false;
  return (
    value.levelBreakdown.every(
      (entry) =>
        isPlainRecord(entry) &&
        typeof entry.definitionKey === "string" &&
        typeof entry.definitionName === "string" &&
        Number.isSafeInteger(entry.studentCount) &&
        (entry.studentCount as number) >= 0 &&
        Number.isSafeInteger(entry.assessedStudentCount) &&
        (entry.assessedStudentCount as number) >= 0 &&
        Number.isSafeInteger(entry.eligibleForPromotionCount) &&
        (entry.eligibleForPromotionCount as number) >= 0 &&
        Object.keys(entry).every((field) =>
          [
            "definitionKey",
            "definitionName",
            "studentCount",
            "assessedStudentCount",
            "eligibleForPromotionCount",
          ].includes(field),
        ),
    ) &&
    value.skillCoverage.every(
      (entry) =>
        isPlainRecord(entry) &&
        typeof entry.skillKey === "string" &&
        typeof entry.displayLabel === "string" &&
        Number.isSafeInteger(entry.assessedStudentCount) &&
        (entry.assessedStudentCount as number) >= 0 &&
        Number.isSafeInteger(entry.coveragePercentage) &&
        (entry.coveragePercentage as number) >= 0 &&
        (entry.coveragePercentage as number) <= 100 &&
        Object.keys(entry).every((field) =>
          ["skillKey", "displayLabel", "assessedStudentCount", "coveragePercentage"].includes(field),
        ),
    )
  );
}
export async function getLevelCatalog(): Promise<LevelCatalogProjection> {
  if (!isConnectedLevelsBackendEnabled()) {
    return getBundledLevelCatalog();
  }

  const functions = getFirebaseFunctions();
  const callable = httpsCallable<null, unknown>(functions, "listLevelCatalog");

  try {
    const response = await callable(null);
    const result = parseLevelCatalogProjection(response.data);
    if (!result.ok) {
      throw new Error(safeCatalogError);
    }
    return result.value;
  } catch (error) {
    if (error instanceof Error && error.message === safeCatalogError) {
      throw error;
    }
    throw new Error(safeCatalogError);
  }
}

export async function recordEvaluation(
  input: RecordEvaluationInput,
): Promise<EvaluationRecord> {
  const parsed = parseRecordEvaluationInput(input);
  if (!parsed.ok) {
    throw new Error(safeRecordEvalError);
  }

  const functions = getFirebaseFunctions();
  const callable = httpsCallable<RecordEvaluationInput, { evaluation: EvaluationRecord }>(
    functions,
    "recordEvaluation",
  );

  try {
    const response = await callable(parsed.value);
    return response.data.evaluation;
  } catch (error) {
    if (error instanceof Error && error.message === safeRecordEvalError) {
      throw error;
    }
    throw new Error(safeRecordEvalError);
  }
}

export async function listStudentEvaluations(
  studentId?: string,
): Promise<StudentEvaluationsResponse> {
  const functions = getFirebaseFunctions();
  const callable = httpsCallable<{ studentId?: string }, StudentEvaluationsResponse>(
    functions,
    "listStudentEvaluations",
  );

  try {
    const response = await callable(studentId ? { studentId } : {});
    return response.data;
  } catch (error) {
    if (error instanceof Error && error.message === safeListEvalError) {
      throw error;
    }
    throw new Error(safeListEvalError);
  }
}

export async function getStudentProgressSummary(
  studentId?: string,
): Promise<StudentProgressSummary> {
  const functions = getFirebaseFunctions();
  const callable = httpsCallable<
    { studentId?: string },
    { progress: StudentProgressSummary }
  >(functions, "getStudentProgressSummary");

  try {
    const response = await callable(studentId ? { studentId } : {});
    return response.data.progress;
  } catch (error) {
    if (error instanceof Error && error.message === safeProgressError) {
      throw error;
    }
    throw new Error(safeProgressError);
  }
}

export async function getProgressReport(): Promise<ProgressReport> {
  const functions = getFirebaseFunctions();
  const callable = httpsCallable<null, { report: unknown }>(functions, "getProgressReport");

  try {
    const response = await callable(null);
    if (!isSafeProgressReport(response.data.report)) throw new Error(safeProgressReportError);
    return response.data.report;
  } catch (error) {
    if (error instanceof Error && error.message === safeProgressReportError) {
      throw error;
    }
    throw new Error(safeProgressReportError);
  }
}
export async function recordMedicalLeave(
  input: RecordMedicalLeaveInput,
): Promise<MedicalLeaveRecord> {
  const parsed = parseRecordMedicalLeaveInput(input);
  if (!parsed.ok) {
    throw new Error(safeRecordMedicalLeaveError);
  }

  const functions = getFirebaseFunctions();
  const callable = httpsCallable<
    RecordMedicalLeaveInput,
    { medicalLeave: MedicalLeaveRecord }
  >(functions, "recordMedicalLeave");

  try {
    const response = await callable(parsed.value);
    return response.data.medicalLeave;
  } catch (error) {
    if (error instanceof Error && error.message === safeRecordMedicalLeaveError) {
      throw error;
    }
    throw new Error(safeRecordMedicalLeaveError);
  }
}

export async function listMedicalLeaves(
  studentId?: string,
): Promise<readonly MedicalLeaveRecord[]> {
  const functions = getFirebaseFunctions();
  const callable = httpsCallable<
    { studentId?: string },
    { medicalLeaves: readonly MedicalLeaveRecord[] }
  >(functions, "listMedicalLeaves");

  try {
    const response = await callable(studentId ? { studentId } : {});
    return response.data.medicalLeaves;
  } catch (error) {
    if (error instanceof Error && error.message === safeListMedicalLeavesError) {
      throw error;
    }
    throw new Error(safeListMedicalLeavesError);
  }
}

export async function listRecognitionCandidates(): Promise<readonly RecognitionCandidate[]> {
  const functions = getFirebaseFunctions();
  const callable = httpsCallable<
    Record<string, never>,
    { candidates: readonly RecognitionCandidate[] }
  >(functions, "listRecognitionCandidates");

  try {
    const response = await callable({});
    return response.data.candidates;
  } catch (error) {
    if (error instanceof Error && error.message === safeListCandidatesError) {
      throw error;
    }
    throw new Error(safeListCandidatesError);
  }
}

export async function approvePromotion(
  input: ApprovePromotionInput,
): Promise<GraduationRecord> {
  const parsed = parseApprovePromotionInput(input);
  if (!parsed.ok) {
    throw new Error(safeApprovePromotionError);
  }

  const functions = getFirebaseFunctions();
  const callable = httpsCallable<
    ApprovePromotionInput,
    { graduation: GraduationRecord }
  >(functions, "approvePromotion");

  try {
    const response = await callable(parsed.value);
    return response.data.graduation;
  } catch (error) {
    if (error instanceof Error && error.message === safeApprovePromotionError) {
      throw error;
    }
    throw new Error(safeApprovePromotionError);
  }
}

export type OpenedStudentLevel = Readonly<{
  studentId: string;
  currentDefinitionKey: string;
  currentLevelStartedAt: string;
  state: "initialized";
  /** T113: whether the student sits inside the belt's catalog age band. A warning, never a gate. */
  ageBand: AgeBandEvaluation;
}>;

function isAgeBand(value: unknown): value is AgeBandEvaluation {
  if (typeof value !== "object" || value === null) return false;
  const band = value as Record<string, unknown>;
  const wholeOrNull = (candidate: unknown) =>
    candidate === null || (typeof candidate === "number" && Number.isSafeInteger(candidate));
  return (
    typeof band.met === "boolean" &&
    wholeOrNull(band.requiredMinAge) &&
    wholeOrNull(band.requiredMaxAge) &&
    wholeOrNull(band.ageYears)
  );
}

/** Office and historical head coaches open the student's initial level. */
export async function openStudentLevel(input: OpenStudentLevelInput): Promise<OpenedStudentLevel> {
  const parsed = parseOpenStudentLevelInput(input);
  if (!parsed.ok) throw new Error(levelsSafeErrors.open);
  const callable = httpsCallable<
    OpenStudentLevelInput,
    { head: Omit<OpenedStudentLevel, "ageBand">; ageBand: unknown }
  >(getFirebaseFunctions(), "openStudentLevel");
  try {
    const response = await callable(parsed.value);
    const head = response.data.head;
    if (
      head.studentId !== parsed.value.studentId ||
      head.currentDefinitionKey !== parsed.value.definitionKey ||
      head.state !== "initialized" ||
      !isAgeBand(response.data.ageBand)
    ) {
      throw new Error(levelsSafeErrors.open);
    }
    return { ...head, ageBand: response.data.ageBand };
  } catch {
    throw new Error(levelsSafeErrors.open);
  }
}

export async function rejectPromotion(
  input: RejectPromotionInput,
): Promise<GraduationRecord> {
  const parsed = parseRejectPromotionInput(input);
  if (!parsed.ok) {
    throw new Error(safeRejectPromotionError);
  }

  const functions = getFirebaseFunctions();
  const callable = httpsCallable<
    RejectPromotionInput,
    { graduation: GraduationRecord }
  >(functions, "rejectPromotion");

  try {
    const response = await callable(parsed.value);
    return response.data.graduation;
  } catch (error) {
    if (error instanceof Error && error.message === safeRejectPromotionError) {
      throw error;
    }
    throw new Error(safeRejectPromotionError);
  }
}

export async function listGraduations(
  studentId?: string,
): Promise<readonly GraduationRecord[]> {
  const functions = getFirebaseFunctions();
  const callable = httpsCallable<
    { studentId?: string },
    { graduations: readonly GraduationRecord[] }
  >(functions, "listGraduations");

  try {
    const response = await callable(studentId ? { studentId } : {});
    return response.data.graduations;
  } catch (error) {
    if (error instanceof Error && error.message === safeListGraduationsError) {
      throw error;
    }
    throw new Error(safeListGraduationsError);
  }
}



/* T051V2 IBJJF — the Manage view's clients: card, history, assignment, void, ratings, scores. */

export type { StudentLevelCard, StudentLevelHistory };

/**
 * The only level-management wording the browser ever shows. Sixteen distinct store refusals reach
 * the callable boundary as one of four collapsed strings (`Levels request is invalid`,
 * `Levels state conflicts`, `Levels access is not permitted`, `Levels record is not available`),
 * so a message here names the action that failed, never the cause. In particular a void refusal
 * covers four causes (not the latest promotion, already voided, no restore snapshot, no such
 * promotion) and the UI must not guess which one fired.
 *
 * `assignInput` is the ONE exception, and only because the client itself knows the cause: it is
 * used solely for an assignment this code refused before any call, where the date and the note are
 * the only things that can be wrong. Every refusal that came back from the backend gets `assign`,
 * which asks for nothing, because a refused administrator (G12) or a level-start conflict can
 * never be fixed by editing the date or the note.
 *
 * All strings end in "try again" wording. That is deliberate and it is the best available: the
 * four collapsed backend strings do not say whether a refusal is permanent, so the client cannot
 * tell a transient failure from a final one, and any wording that did claim finality would be
 * both a guess and a hint at the cause the void string must not give.
 */
export const levelsSafeErrors = Object.freeze({
  card: "Levels are unavailable right now. Please try again later.",
  history: "Unable to load the level history. Please try again.",
  /** Local, pre-call refusal of an assignment form: the advice is actionable and true. */
  assignInput: "Unable to assign the level. Check the date and the note, then try again.",
  /** Any assignment refusal that came from the backend: names the action, asks for nothing. */
  assign: "Unable to assign the level. Please try again later.",
  void: "Unable to void the promotion. Please try again.",
  /**
   * T051V2 review of Task 16 (Major-2): opening a level had its own module-local string, so the
   * Manage view could not recognise it and rendered a literal of its own instead. Every refusal
   * this client raises now lives in this one allowlist, which is what the views check against.
   */
  open: "Unable to open the student level. Please try again.",
  ratings: "Unable to save the ratings. Please try again.",
  scores: "Unable to load the skill ratings. Please try again.",
} as const);

const opaqueStudentIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

/** Calls one callable and returns only what the schema accepts; every failure becomes `safeError`. */
async function callValidated<Output>(
  name: string,
  data: unknown,
  schema: z.ZodType<Output>,
  safeError: string,
): Promise<Output> {
  try {
    const response = await httpsCallable<unknown, unknown>(getFirebaseFunctions(), name)(data);
    const parsed = schema.safeParse(response.data);
    if (!parsed.success) throw new Error(safeError);
    return parsed.data;
  } catch {
    throw new Error(safeError);
  }
}

/**
 * Parses a caller-supplied input object. The `safeParse` is INSIDE the try because zod reads the
 * input's fields and does not catch a getter that throws while being read: outside a try, that
 * getter's own message reaches the operator verbatim. Nothing but `safeError` may leave here.
 */
function parseInput<Output>(schema: z.ZodType<Output>, input: unknown, safeError: string): Output {
  try {
    const parsed = schema.safeParse(input);
    if (parsed.success) return parsed.data;
  } catch {
    throw new Error(safeError);
  }
  throw new Error(safeError);
}

/**
 * The type is not the guard: `useParams()`, a search param and a `string | null` record field all
 * reach here as something other than a string, and `RegExp.prototype.test` would COERCE each one
 * and let it through. `undefined` is the dangerous one — it would make the wire payload `{}`,
 * which is the backend's "my own progress" shape, so the signed-in coach's own data would come
 * back and be rendered under the target member's name.
 */
function requireStudentId(studentId: unknown, safeError: string): asserts studentId is string {
  if (typeof studentId !== "string" || !opaqueStudentIdPattern.test(studentId)) {
    throw new Error(safeError);
  }
}

export async function getStudentLevelCard(studentId: string): Promise<StudentLevelCard> {
  requireStudentId(studentId, levelsSafeErrors.card);
  const response = await callValidated(
    "getStudentProgressSummary",
    { studentId },
    z.object({ progress: studentLevelCardSchema }),
    levelsSafeErrors.card,
  );
  if (response.progress.studentId !== studentId) throw new Error(levelsSafeErrors.card);
  return response.progress;
}

export async function getStudentLevelHistory(studentId: string): Promise<StudentLevelHistory> {
  requireStudentId(studentId, levelsSafeErrors.history);
  const history = await callValidated(
    "getStudentLevelHistory",
    { studentId },
    studentLevelHistorySchema,
    levelsSafeErrors.history,
  );
  if (history.studentId !== studentId) throw new Error(levelsSafeErrors.history);
  return history;
}

export async function assignLevel(input: AssignLevelInput): Promise<AssignLevelResult> {
  const parsed = parseInput(assignLevelInputSchema, input, levelsSafeErrors.assignInput);
  // What keeps a `ratings` key off this payload is the STRICT parse above, which refuses an input
  // carrying one outright; the spelling below is belt-and-braces and pins the wire shape. What the
  // spelling does carry on its own is the note: `{ note: undefined }` survives the parse as an OWN
  // key with an undefined value, and an own `note` key is not the same wire payload as no note.
  const payload = {
    studentId: parsed.studentId,
    fromDefinitionKey: parsed.fromDefinitionKey,
    toDefinitionKey: parsed.toDefinitionKey,
    promotedOn: parsed.promotedOn,
    ...(parsed.note === undefined ? {} : { note: parsed.note }),
  };
  const result = await callValidated(
    "assignLevel",
    payload,
    assignLevelResultSchema,
    levelsSafeErrors.assign,
  );
  if (
    result.toDefinitionKey !== payload.toDefinitionKey ||
    result.promotedOn !== payload.promotedOn
  ) {
    throw new Error(levelsSafeErrors.assign);
  }
  return result;
}

export async function voidPromotion(input: VoidPromotionInput): Promise<VoidPromotionResult> {
  const parsed = parseInput(voidPromotionInputSchema, input, levelsSafeErrors.void);
  const payload = {
    studentId: parsed.studentId,
    promotionId: parsed.promotionId,
    reason: parsed.reason,
  };
  const result = await callValidated(
    "voidPromotion",
    payload,
    voidPromotionResultSchema,
    levelsSafeErrors.void,
  );
  if (result.voidsPromotionId !== payload.promotionId) throw new Error(levelsSafeErrors.void);
  return result;
}

/**
 * The batch half of the overloaded `recordEvaluation` callable. The dispatch is taken on an OWN
 * `ratings` key, and what keeps the LEGACY payload from ever routing here is that its own strict
 * input schema refuses a stray `ratings` key before anything is sent. The spelling below pins this
 * payload's wire shape and, on its own, keeps `evidenceNotes: undefined` from becoming an own key.
 */
export async function recordSkillRatings(
  input: RecordSkillRatingsInput,
): Promise<RecordSkillRatingsResult> {
  const parsed = parseInput(recordSkillRatingsInputSchema, input, levelsSafeErrors.ratings);
  // `evidenceNotes` is `min(1)` at both the contract and the store, so an absent note must be an
  // absent key — never an empty string, and never an `undefined` value.
  const payload = {
    studentId: parsed.studentId,
    definitionKey: parsed.definitionKey,
    ratings: parsed.ratings,
    ...(parsed.evidenceNotes === undefined ? {} : { evidenceNotes: parsed.evidenceNotes }),
  };
  const result = await callValidated(
    "recordEvaluation",
    payload,
    recordSkillRatingsResultSchema,
    levelsSafeErrors.ratings,
  );
  // Both halves are load-bearing: the count says the whole batch landed, and the echoed student
  // says it landed on the member this call named (Major-2).
  if (result.recorded !== payload.ratings.length || result.studentId !== payload.studentId) {
    throw new Error(levelsSafeErrors.ratings);
  }
  return result;
}

export async function getStudentSkillScores(
  studentId: string,
): Promise<
  Readonly<{ latest: Readonly<Record<string, number>>; best: Readonly<Record<string, number>> }>
> {
  requireStudentId(studentId, levelsSafeErrors.scores);
  const response = await callValidated(
    "listStudentEvaluations",
    { studentId },
    studentSkillSummaryResponseSchema,
    levelsSafeErrors.scores,
  );
  // Scores decide a promotion about a named member, so a summary that names another member (or
  // the signed-in coach, which is what an omitted student id would return) is refused (Major-2).
  if (response.studentId !== studentId) throw new Error(levelsSafeErrors.scores);
  const latest: Record<string, number> = {};
  const best: Record<string, number> = {};
  for (const [skillKey, item] of Object.entries(response.summary)) {
    latest[skillKey] = item.latestScore;
    best[skillKey] = item.maxScore;
  }
  return { latest, best };
}
