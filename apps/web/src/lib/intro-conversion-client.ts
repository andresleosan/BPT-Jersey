import { httpsCallable } from "firebase/functions";
import { z } from "zod";
import { introConversionStateSchema, membershipApplicationSchema } from "@bpt-jersey/domain";
import { planIds, siteValues } from "@bpt-jersey/domain/memberships";
import { getFirebaseFunctions } from "./firebase-client";

const contextSchema = z.strictObject({
  conversions: z.array(introConversionStateSchema).max(20), applications: z.array(membershipApplicationSchema).max(20),
  plans: z.array(z.strictObject({ planId: z.enum(planIds), displayName: z.string(), priceMinor: z.number().int().positive(), currency: z.literal("GBP"), billingPeriod: z.enum(["monthly", "term"]), eligibleParticipantTypes: z.array(z.enum(["kids", "teens", "adult"])), classSites: z.array(z.enum(siteValues)) })).max(20),
  instructions: z.strictObject({ accountName: z.string(), sortCode: z.string(), accountNumber: z.string(), bankName: z.string(), referenceHint: z.string() }).nullable(),
});
export type IntroMembershipContext = z.infer<typeof contextSchema>;
const safeError = "Membership application is unavailable. Please try again.";
export async function getIntroMembershipContext(): Promise<IntroMembershipContext> {
  try { const response = await httpsCallable<null, unknown>(getFirebaseFunctions(), "getIntroMembershipContext")(null); return contextSchema.parse(response.data); }
  catch { throw new Error(safeError); }
}
export async function uploadIntroMembershipProof(requestId: string, file: File): Promise<string> {
  if (!["image/png", "image/jpeg"].includes(file.type) || file.size < 1 || file.size > 2 * 1024 * 1024) throw new Error("Choose a PNG or JPEG screenshot up to 2 MB.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = ""; for (const byte of bytes) binary += String.fromCharCode(byte);
  try { const response = await httpsCallable<unknown, unknown>(getFirebaseFunctions(), "uploadIntroMembershipProof")({ requestId, contentType: file.type, base64: btoa(binary) }); return z.strictObject({ proofId: z.string().regex(/^[a-f0-9]{64}$/u) }).parse(response.data).proofId; }
  catch { throw new Error("The payment screenshot could not be uploaded."); }
}
export async function submitIntroMembershipApplication(input: { requestId: string; conversionId: string; studentId: string; site: "Town" | "West"; planId: (typeof planIds)[number]; proofId: string; bankReference: string }) {
  try { const response = await httpsCallable<typeof input, unknown>(getFirebaseFunctions(), "submitIntroMembershipApplication")(input); return membershipApplicationSchema.parse(response.data); }
  catch { throw new Error(safeError); }
}

export async function listIntroMembershipApplications() {
  try { const response = await httpsCallable<null, unknown>(getFirebaseFunctions(), "listIntroMembershipApplications")(null); return z.strictObject({ applications: z.array(membershipApplicationSchema).max(100) }).parse(response.data).applications; }
  catch { throw new Error("Membership applications are unavailable."); }
}
export async function getIntroMembershipProofUrl(applicationId: string) {
  try { const response = await httpsCallable<{applicationId:string}, unknown>(getFirebaseFunctions(), "getIntroMembershipProofUrl")({ applicationId }); return z.strictObject({ url: z.url().refine((value) => value.startsWith("https://")), expiresAt: z.iso.datetime() }).parse(response.data); }
  catch { throw new Error("Payment evidence is unavailable."); }
}
export async function reviewIntroMembershipApplication(input: { applicationId: string; expectedRevision: number; decision: "approve"; occurredAt: string } | { applicationId: string; expectedRevision: number; decision: "needs_correction"|"reject"; reason: string }) {
  try { const response = await httpsCallable<typeof input, unknown>(getFirebaseFunctions(), "reviewIntroMembershipApplication")(input); return response.data; }
  catch { throw new Error("The application could not be reviewed."); }
}
