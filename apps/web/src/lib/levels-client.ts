import { httpsCallable } from "firebase/functions";

import businessCriteriaJson from "../../../../docs/data/ibjjf-levels-business-criteria.sanitized.json";
import observedJson from "../../../../docs/data/ibjjf-levels-observed.sanitized.json";
import {
  parseApprovePromotionInput,
  parseLevelCatalogProjection,
  parseLevelCatalogSource,
  parseRecordEvaluationInput,
  parseRecordMedicalLeaveInput,
  parseRejectPromotionInput,
  type ApprovePromotionInput,
  type EvaluationRecord,
  type GraduationRecord,
  type LevelCatalogProjection,
  type MedicalLeaveRecord,
  type ProgressReport,
  type RecognitionCandidate,
  type RecordEvaluationInput,
  type RecordMedicalLeaveInput,
  type RejectPromotionInput,
  type StudentProgressSummary,
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


