import { createHash } from "node:crypto";
import { HttpsError } from "firebase-functions/v2/https";
import type { R2Client } from "../storage/r2-client.js";

export const INTRO_PROOF_MAX_BYTES = 2 * 1024 * 1024;
export type IntroProofUpload = Readonly<{ academyId: string; userId: string; requestId: string; contentType: "image/png" | "image/jpeg"; base64: string }>;

export function introProofKey(academyId: string, userId: string, requestId: string, proofId: string): string {
  const owner = createHash("sha256").update(userId).digest("hex");
  return `academies/${academyId}/membership-application-proofs/${owner}/${requestId}/${proofId}`;
}

export function validateIntroProof(contentType: "image/png" | "image/jpeg", base64: string): Readonly<{ bytes: Buffer; proofId: string }> {
  if (!/^[A-Za-z0-9+/]+={0,2}$/u.test(base64) || base64.length > Math.ceil(INTRO_PROOF_MAX_BYTES / 3) * 4) throw new HttpsError("invalid-argument", "Choose a PNG or JPEG screenshot up to 2 MB.");
  const bytes = Buffer.from(base64, "base64");
  const png = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (!bytes.length || bytes.length > INTRO_PROOF_MAX_BYTES || bytes.toString("base64") !== base64 || !(contentType === "image/png" ? png : jpeg)) throw new HttpsError("invalid-argument", "Choose a valid PNG or JPEG screenshot up to 2 MB.");
  return { bytes, proofId: createHash("sha256").update(bytes).digest("hex") };
}

export async function uploadIntroProof(input: IntroProofUpload, storage: R2Client): Promise<{ proofId: string }> {
  const validated = validateIntroProof(input.contentType, input.base64);
  await storage.putObject(introProofKey(input.academyId, input.userId, input.requestId, validated.proofId), validated.bytes, input.contentType);
  return { proofId: validated.proofId };
}

export async function assertIntroProof(storage: R2Client, input: Omit<IntroProofUpload, "contentType" | "base64"> & { proofId: string }): Promise<void> {
  const bytes = Buffer.from(await storage.readObject(introProofKey(input.academyId, input.userId, input.requestId, input.proofId)));
  if (!bytes.length || bytes.length > INTRO_PROOF_MAX_BYTES || createHash("sha256").update(bytes).digest("hex") !== input.proofId) throw new HttpsError("failed-precondition", "Payment evidence is unavailable.");
  const validMagic = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) || (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255);
  if (!validMagic) throw new HttpsError("failed-precondition", "Payment evidence is unavailable.");
}
