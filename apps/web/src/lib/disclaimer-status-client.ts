import { z } from "zod";

import { httpsCallable } from "./callable";
import { getFirebaseFunctions } from "./firebase-client";

const statusSchema = z.strictObject({
  participants: z
    .array(
      z.strictObject({
        studentId: z.string(),
        fullName: z.string(),
        terms: z.boolean(),
        disclaimers: z.boolean(),
      }),
    )
    .max(100),
});
export type DisclaimerStatus = z.infer<typeof statusSchema>;

const acceptancesSchema = z.strictObject({
  rows: z.array(
    z.strictObject({
      studentId: z.string(),
      fullName: z.string(),
      termsVersion: z.string().nullable(),
      termsAcceptedAt: z.string().nullable(),
      disclaimers: z.boolean(),
    }),
  ),
});
export type DisclaimerAcceptanceRow = z.infer<typeof acceptancesSchema>["rows"][number];

/** Any failure (network, not deployed, denied, bad shape) throws this text. */
export const disclaimerStatusUnavailable = "We couldn't check your terms.";
export const disclaimerAcceptancesUnavailable =
  "Acceptances are unavailable right now. Only the owner or an administrator can see them.";

/** Terms and required disclaimers for every participant on this account (Q5). */
export async function getMyDisclaimerStatus(): Promise<DisclaimerStatus> {
  try {
    const response = await httpsCallable<Record<string, never>, unknown>(
      getFirebaseFunctions(),
      "getMyDisclaimerStatus",
    )({});
    const parsed = statusSchema.safeParse(response.data);
    if (parsed.success) return parsed.data;
  } catch {
    /* fixed message below */
  }
  throw new Error(disclaimerStatusUnavailable);
}

/** Office audit of who accepted the academy terms (owner/administrator only). */
export async function listDisclaimerAcceptances(input: {
  missingOnly: boolean;
}): Promise<readonly DisclaimerAcceptanceRow[]> {
  try {
    const response = await httpsCallable<typeof input, unknown>(
      getFirebaseFunctions(),
      "listDisclaimerAcceptances",
    )(input);
    const parsed = acceptancesSchema.safeParse(response.data);
    if (parsed.success) return parsed.data.rows;
  } catch {
    /* fixed message below */
  }
  throw new Error(disclaimerAcceptancesUnavailable);
}
