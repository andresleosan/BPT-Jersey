import type { z } from "zod";

import { memberStreakSummarySchema, promotionOutlookSchema } from "@bpt-jersey/domain/members/engagement";

import { httpsCallable } from "./callable";
import { getFirebaseFunctions } from "./firebase-client";

export type MemberStreak = z.infer<typeof memberStreakSummarySchema>;
export type PromotionOutlook = z.infer<typeof promotionOutlookSchema>;

/** Any failure (network, not deployed, not found, bad shape) throws this text; the panel hides itself. */
const safe = "Your streak is unavailable right now.";
async function call<T>(name: string, data: unknown, schema: z.ZodType<T>): Promise<T> {
  try {
    const response = await httpsCallable<unknown, unknown>(getFirebaseFunctions(), name)(data);
    const parsed = schema.safeParse(response.data);
    if (parsed.success) return parsed.data;
  } catch {
    /* fixed message below */
  }
  throw new Error(safe);
}

export const getMemberStreak = (studentId: string) => call("getMemberStreak", { studentId }, memberStreakSummarySchema);
export const getPromotionOutlook = (studentId: string) =>
  call("getPromotionOutlook", { studentId }, promotionOutlookSchema);
