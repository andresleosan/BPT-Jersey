import { getFirestore } from "firebase-admin/firestore";
import { parsePaymentInstructionsRecord } from "@bpt-jersey/domain/finance";
import { createHash } from "node:crypto";
import { z } from "zod";
import { HttpsError, onCall, type CallableRequest } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { requireUserActor } from "../auth/user-authorization.js";
import { browserAdminCallableOptions } from "../auth/callable-options.js";
import { createPrivateStorageR2Client, type R2Client } from "../storage/r2-client.js";

export const enrolmentStorageSecrets = [
  "R2_ACCOUNT_ID",
  "R2_BUCKET_NAME",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_JURISDICTION",
].map((name) => defineSecret(name));
const maxBytes = 2 * 1024 * 1024;
const uploadSchema = z.strictObject({
  requestId: z.uuid(),
  contentType: z.enum(["image/png", "image/jpeg"]),
  base64: z
    .string()
    .min(4)
    .max(Math.ceil(maxBytes / 3) * 4)
    .regex(/^[A-Za-z0-9+/]+={0,2}$/u),
});
export function enrolmentProofKey(
  academyId: string,
  userId: string,
  requestId: string,
  proofId: string,
): string {
  const owner = createHash("sha256").update(userId).digest("hex");
  return `academies/${academyId}/enrolment-proofs/${owner}/${requestId}/${proofId}`;
}
export async function uploadEnrolmentPaymentProofHandler(
  request: CallableRequest,
  storage: R2Client,
) {
  if (!request.app) throw new HttpsError("unauthenticated", "Verified application required.");
  const actor = requireUserActor(request);
  if (!["shopper", "adultStudent", "guardian"].includes(actor.role))
    throw new HttpsError("permission-denied", "A client account is required.");
  const parsed = uploadSchema.safeParse(request.data);
  if (!parsed.success)
    throw new HttpsError("invalid-argument", "Choose a PNG or JPEG screenshot up to 2 MB.");
  const { requestId, contentType, base64 } = parsed.data;
  const bytes = Buffer.from(base64, "base64");
  const png = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (
    !bytes.length ||
    bytes.length > maxBytes ||
    bytes.toString("base64") !== base64 ||
    !(contentType === "image/png" ? png : jpeg)
  )
    throw new HttpsError("invalid-argument", "Choose a valid PNG or JPEG screenshot up to 2 MB.");
  const proofId = createHash("sha256").update(bytes).digest("hex");
  await storage.putObject(
    enrolmentProofKey(actor.academyId, actor.userId, requestId, proofId),
    bytes,
    contentType,
  );
  return { proofId };
}
export const uploadEnrolmentPaymentProof = onCall(
  { ...browserAdminCallableOptions, secrets: enrolmentStorageSecrets },
  (request) => uploadEnrolmentPaymentProofHandler(request, createPrivateStorageR2Client()),
);

export const getEnrolmentPaymentInstructions = onCall(
  browserAdminCallableOptions,
  async (request) => {
    if (!request.app) throw new HttpsError("unauthenticated", "Verified application required.");
    const actor = requireUserActor(request);
    if (!["shopper", "adultStudent", "guardian"].includes(actor.role))
      throw new HttpsError("permission-denied", "A client account is required.");
    if (!z.strictObject({}).safeParse(request.data).success)
      throw new HttpsError("invalid-argument", "This request takes no fields.");
    const parsed = parsePaymentInstructionsRecord(
      (
        await getFirestore().doc(`academies/${actor.academyId}/settings/paymentInstructions`).get()
      ).data(),
    );
    if (!parsed.ok || parsed.value.academyId !== actor.academyId) return { instructions: null };
    const { accountName, sortCode, accountNumber, bankName, referenceHint, acceptsCash } =
      parsed.value;
    return {
      instructions: { accountName, sortCode, accountNumber, bankName, referenceHint, acceptsCash },
    };
  },
);
