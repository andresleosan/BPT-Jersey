import type { z } from "zod";

import { competitorsResponseSchema } from "@bpt-jersey/domain/members/engagement";

import { httpsCallable } from "./callable";
import { getFirebaseFunctions } from "./firebase-client";

export type CompetitorsResponse = z.infer<typeof competitorsResponseSchema>;

/** Any failure (network, not deployed, denied, bad shape) throws this text; the page shows it as is. */
export const competitorsUnavailable = "Competitors aren't available right now.";

export async function getCompetitors(studentId: string): Promise<CompetitorsResponse> {
  try {
    const response = await httpsCallable<unknown, unknown>(getFirebaseFunctions(), "getCompetitors")({ studentId });
    const parsed = competitorsResponseSchema.safeParse(response.data);
    if (parsed.success) return parsed.data;
  } catch {
    /* fixed message below */
  }
  throw new Error(competitorsUnavailable);
}
