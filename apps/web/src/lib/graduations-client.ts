import { z } from "zod";
import {
  graduationBoardSchema,
  graduationNoticesSchema,
  type DecideGraduationInput,
  type GraduationBoard,
  type GraduationNotices,
} from "@bpt-jersey/domain/graduations";

import { httpsCallable } from "./callable";
import { getFirebaseFunctions } from "./firebase-client";

const pendingGone = "This graduation is no longer pending. The list has been refreshed.";
const generic = "Graduations are unavailable right now. Try again in a moment.";

export function graduationErrorMessage(error: unknown): string {
  const code = (error as { code?: string } | null)?.code ?? "";
  if (code.endsWith("failed-precondition")) return pendingGone;
  if (code.endsWith("permission-denied")) return "Only the owner can decide graduations.";
  return generic;
}

async function call<T>(name: string, data: unknown, schema: z.ZodType<T>): Promise<T> {
  const response = await httpsCallable<unknown, unknown>(getFirebaseFunctions(), name)(data);
  return schema.parse(response.data);
}

export const listGraduationBoard = (): Promise<GraduationBoard> =>
  call("listGraduationBoard", {}, graduationBoardSchema);
export const decideGraduation = async (input: DecideGraduationInput): Promise<void> => {
  await call("decideGraduation", input, z.strictObject({ ok: z.literal(true) }));
};
export const getGraduationNotices = (studentId: string): Promise<GraduationNotices | null> =>
  call("getGraduationNotices", { studentId }, graduationNoticesSchema.nullable());
