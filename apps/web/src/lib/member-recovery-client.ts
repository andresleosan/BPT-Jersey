import { httpsCallable } from "firebase/functions";
import { z } from "zod";
import {
  beginMemberRecoveryInputSchema,
  beginMemberRecoveryResultSchema,
  completeMemberRecoveryInputSchema,
  completeMemberRecoveryResultSchema,
  listMemberRecoveryRequestsResultSchema,
  getMemberRecoveryDetailInputSchema,
  getMemberRecoveryDetailResultSchema,
  reviewMemberRecoveryInputSchema,
  reviewMemberRecoveryResultSchema,
} from "@bpt-jersey/domain/members/recovery";
import { getFirebaseFunctions } from "./firebase-client";

async function call<T>(name: string, input: unknown, schema: z.ZodType<T>): Promise<T> {
  // Parse every response before it can unlock a UI state. Raw backend errors never reach the page.
  const result = await httpsCallable<unknown, unknown>(getFirebaseFunctions(), name)(input);
  return schema.parse(result.data);
}
export const beginMemberRecovery = (input: z.input<typeof beginMemberRecoveryInputSchema>) =>
  call(
    "beginMemberRecovery",
    beginMemberRecoveryInputSchema.parse(input),
    beginMemberRecoveryResultSchema,
  );
export const completeMemberRecovery = (input: z.input<typeof completeMemberRecoveryInputSchema>) =>
  call(
    "completeMemberRecovery",
    completeMemberRecoveryInputSchema.parse(input),
    completeMemberRecoveryResultSchema,
  );
export const listMemberRecoveryRequests = () =>
  call("listMemberRecoveryRequests", null, listMemberRecoveryRequestsResultSchema);
export const getMemberRecoveryDetail = (requestId: string) =>
  call(
    "getMemberRecoveryDetail",
    getMemberRecoveryDetailInputSchema.parse({ requestId }),
    getMemberRecoveryDetailResultSchema,
  );
export const reviewMemberRecovery = (input: z.input<typeof reviewMemberRecoveryInputSchema>) =>
  call(
    "reviewMemberRecovery",
    reviewMemberRecoveryInputSchema.parse(input),
    reviewMemberRecoveryResultSchema,
  );
