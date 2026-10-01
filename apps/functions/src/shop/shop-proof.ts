import { createHash } from "node:crypto";

import type { R2Client } from "../storage/r2-client.js";

export type ShopProofStorage = Pick<R2Client, "putObject" | "readObject" | "createPrivateImageUrl">;

// ponytail: orphan screenshots possible when checkout is abandoned; add an R2 lifecycle rule on shop-proofs/ if volume matters.
/** The uid is hashed so object keys never carry an account id in clear. */
export function shopProofKey(
  academyId: string,
  userId: string,
  requestId: string,
  proofId: string,
): string {
  const owner = createHash("sha256").update(userId).digest("hex");
  return `academies/${academyId}/shop-proofs/${owner}/${requestId}/${proofId}`;
}

/** The stored screenshot's bytes, only when they hash to the declared proof id. */
export async function readShopProof(
  storage: ShopProofStorage,
  key: string,
  proofId: string,
): Promise<Buffer | undefined> {
  const bytes = await storage
    .readObject(key)
    .then((value) => Buffer.from(value))
    .catch(() => undefined);
  if (!bytes?.length || createHash("sha256").update(bytes).digest("hex") !== proofId)
    return undefined;
  return bytes;
}

export function shopProofContentType(bytes: Buffer): "image/png" | "image/jpeg" | undefined {
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
    return "image/png";
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return "image/jpeg";
  return undefined;
}
