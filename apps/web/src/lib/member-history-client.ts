import { httpsCallable } from "./callable";
import { memberHistoryPageSchema, type MemberHistoryEntry } from "@bpt-jersey/domain/members/history";
import type { z } from "zod";
import { getFirebaseFunctions } from "./firebase-client";

export type MemberHistoryPage = Readonly<z.infer<typeof memberHistoryPageSchema>>;
export type { MemberHistoryEntry };

const safeError = "Unable to load this member's history. Please try again.";

/** The linked archive's payments, attendance and level lines for one canonical member. */
export async function getMemberHistory(studentId: string, cursor?: string): Promise<MemberHistoryPage> {
  try {
    const result = await httpsCallable<unknown, unknown>(getFirebaseFunctions(), "getMemberHistory")({
      studentId,
      ...(cursor === undefined ? {} : { cursor }),
    });
    return memberHistoryPageSchema.parse(result.data);
  } catch {
    throw new Error(safeError);
  }
}
