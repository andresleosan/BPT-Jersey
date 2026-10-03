"use client";
import { z } from "zod";
import {
  progressManagementSchema,
  type AddManualAttendanceInput,
  type EditLevelHistoryInput,
  type ProgressManagement,
  type SetAttendanceVoidInput,
  type SetProgressClassCountInput,
  type SetProgressLevelInput,
} from "@bpt-jersey/domain/levels";

import { httpsCallable } from "./callable";
import { getFirebaseFunctions } from "./firebase-client";

/** Our callables send short owner-facing sentences for these codes; anything else gets the fallback. */
const ownMessageCodes = new Set([
  "functions/invalid-argument",
  "functions/failed-precondition",
  "functions/not-found",
  "functions/permission-denied",
]);

async function call<T>(name: string, input: unknown, schema: z.ZodType<T>, fallback: string): Promise<T> {
  try {
    return schema.parse((await httpsCallable<unknown, unknown>(getFirebaseFunctions(), name)(input)).data);
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string" && ownMessageCodes.has(code) && error instanceof Error && error.message) {
      throw new Error(error.message);
    }
    throw new Error(fallback);
  }
}

export function getProgressManagement(studentId: string): Promise<ProgressManagement> {
  return call("getProgressManagement", { studentId }, progressManagementSchema, "Unable to load this member's progress. Please try again.");
}
export function setProgressLevel(input: SetProgressLevelInput) {
  return call("setProgressLevel", input, z.object({ promotionId: z.string() }), "Unable to save the level. Please try again.");
}
export function setProgressClassCount(input: SetProgressClassCountInput) {
  return call("setProgressClassCount", input, z.object({ classes: z.number() }), "Unable to save the class count. Please try again.");
}
export function addManualAttendance(input: AddManualAttendanceInput) {
  return call("addManualAttendance", input, z.object({ id: z.string() }), "Unable to add this date. Please try again.");
}
export function setAttendanceVoid(input: SetAttendanceVoidInput) {
  return call("setAttendanceVoid", input, z.object({ voided: z.boolean() }), "Unable to change this attendance. Please try again.");
}
export function editLevelHistory(input: EditLevelHistoryInput) {
  return call("editLevelHistory", input, z.object({ ok: z.literal(true) }), "Unable to change the level history. Please try again.");
}
