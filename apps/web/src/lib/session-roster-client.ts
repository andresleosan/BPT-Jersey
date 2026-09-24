import type { z } from "zod";

import { sessionDetailResponseSchema } from "@bpt-jersey/domain/members/engagement";

import { httpsCallable } from "./callable";
import { getFirebaseFunctions } from "./firebase-client";

export type SessionDetailResponse = z.infer<typeof sessionDetailResponseSchema>;

/** Any failure (network, not deployed, denied, bad shape) throws this text; the dialog shows it as is. */
export const sessionDetailUnavailable = "We couldn't load this class. Try again.";

export async function getSessionDetail(sessionId: string, studentId: string): Promise<SessionDetailResponse> {
  try {
    const response = await httpsCallable<unknown, unknown>(getFirebaseFunctions(), "getSessionDetail")({
      sessionId,
      studentId,
    });
    const parsed = sessionDetailResponseSchema.safeParse(response.data);
    if (parsed.success) return parsed.data;
  } catch {
    /* fixed message below */
  }
  throw new Error(sessionDetailUnavailable);
}
