import { httpsCallable } from "./callable";
import {
  deleteMemberAccountInputSchema,
  deleteMemberAccountResultSchema,
  memberOverviewSchema,
  type MemberOverview,
} from "@bpt-jersey/domain/members/overview";
import type { z } from "zod";
import { getFirebaseFunctions, memberFunctionsRegion } from "./firebase-client";

const safeError = "Unable to load the member directory. Please try again.";

/** The whole directory for the office, read next to the data in europe-west9. */
export async function getMemberOverview(): Promise<MemberOverview> {
  try {
    const result = await httpsCallable<null, unknown>(
      getFirebaseFunctions(memberFunctionsRegion),
      "getMemberOverview",
    )(null);
    return memberOverviewSchema.parse(result.data);
  } catch {
    throw new Error(safeError);
  }
}

/** Owner-only hard delete of a member record; the server's fixed sentence explains a refusal. */
export async function deleteMemberAccount(input: z.input<typeof deleteMemberAccountInputSchema>) {
  let error: unknown;
  try {
    const result = await httpsCallable<unknown, unknown>(
      getFirebaseFunctions(memberFunctionsRegion),
      "deleteMemberAccount",
    )(deleteMemberAccountInputSchema.parse(input));
    return deleteMemberAccountResultSchema.parse(result.data);
  } catch (failure) {
    error = failure;
  }
  const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";
  const message = typeof error === "object" && error && "message" in error ? String(error.message) : "";
  if (code.endsWith("permission-denied")) throw new Error("Only the owner can delete a member account.");
  if (code.endsWith("not-found")) throw new Error("This member no longer exists.");
  if (code.endsWith("failed-precondition") && message) throw new Error(message);
  throw new Error("Could not delete the account. Please try again.");
}
