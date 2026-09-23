import { httpsCallable } from "./callable";
import { z } from "zod";
import { memberRecoveryHistorySchema } from "@bpt-jersey/domain/members/recovery";
import { getFirebaseFunctions } from "./firebase-client";

async function call<T>(name: string, input: unknown, schema: z.ZodType<T>): Promise<T> {
  // Parse every response before it can unlock a UI state. Raw backend errors never reach the page.
  const result = await httpsCallable<unknown, unknown>(getFirebaseFunctions(), name)(input);
  return schema.parse(result.data);
}
export const getMemberRecoveryHistory = (studentId?: string, cursor?: string) => call("getMemberRecoveryHistory", studentId ? { studentId, ...(cursor ? { cursor } : {}) } : null, memberRecoveryHistorySchema);
