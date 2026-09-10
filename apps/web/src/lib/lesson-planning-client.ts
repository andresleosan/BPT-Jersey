import { httpsCallable } from "firebase/functions";

import {
  parseLessonPlanRecord,
  parseTechniqueLibraryVersion,
  type LessonPlanRecord,
  type TechniqueLibraryVersion,
} from "@bpt-jersey/domain";

import { getFirebaseFunctions } from "./firebase-client";

const safeLoadError = "Unable to load the lesson plan. Please try again.";
const safeIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

type LessonPlanResponse = Readonly<{ plan: unknown; library: unknown }>;

function isSafeId(value: unknown): value is string {
  return typeof value === "string" && safeIdPattern.test(value);
}

export type LessonPlanView = Readonly<{
  plan: LessonPlanRecord;
  library: TechniqueLibraryVersion;
}>;

export async function getLessonPlan(planId: string): Promise<LessonPlanView> {
  if (!isSafeId(planId)) throw new Error(safeLoadError);

  try {
    const callable = httpsCallable<{ planId: string }, LessonPlanResponse>(
      getFirebaseFunctions(),
      "getLessonPlan",
    );
    const result = await callable({ planId });
    const library = parseTechniqueLibraryVersion(result.data.library);
    if (!library.ok) throw new Error(safeLoadError);
    const plan = parseLessonPlanRecord(result.data.plan, library.value);
    if (!plan.ok) throw new Error(safeLoadError);
    return Object.freeze({ plan: plan.value, library: library.value });
  } catch (error) {
    if (error instanceof Error && error.message === safeLoadError) throw error;
    throw new Error(safeLoadError);
  }
}

export async function approveLessonPlan(
  planId: string,
  library: TechniqueLibraryVersion,
): Promise<LessonPlanRecord> {
  if (!isSafeId(planId)) throw new Error(safeLoadError);

  try {
    const callable = httpsCallable<{ planId: string }, { plan: unknown }>(
      getFirebaseFunctions(),
      "approveLessonPlan",
    );
    const result = await callable({ planId });
    const parsed = parseLessonPlanRecord(result.data.plan, library);
    if (!parsed.ok) throw new Error(safeLoadError);
    return parsed.value;
  } catch (error) {
    if (error instanceof Error && error.message === safeLoadError) throw error;
    throw new Error("Unable to approve the lesson plan. Please try again.");
  }
}