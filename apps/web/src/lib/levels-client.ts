import { httpsCallable } from "firebase/functions";

import {
  parseLevelCatalogProjection,
  parseRecordEvaluationInput,
  parseRecordMedicalLeaveInput,
  type EvaluationRecord,
  type LevelCatalogProjection,
  type MedicalLeaveRecord,
  type RecognitionCandidate,
  type RecordEvaluationInput,
  type RecordMedicalLeaveInput,
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

export type StudentEvaluationsResponse = Readonly<{
  evaluations: readonly EvaluationRecord[];
  summary: Record<
    string,
    { count: number; maxScore: number; latestScore: number; lastEvaluatedAt: string }
  >;
}>;

export async function getLevelCatalog(): Promise<LevelCatalogProjection> {
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



