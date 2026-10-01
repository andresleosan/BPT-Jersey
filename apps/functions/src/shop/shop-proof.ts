import { createHash } from "node:crypto";

import type { R2Client } from "../storage/r2-client.js";

export type ShopProofStorage = Pick<R2Client, "putObject" | "readObject" | "createPrivateImageUrl">;

// An R2 lifecycle rule deletes everything under shop-proofs/ after 90 days, abandoned checkouts included.
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

/** R2 answers a read of a deleted key with NoSuchKey (HTTP 404). */
export function isMissingObjectError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const value = error as {
    name?: unknown;
    Code?: unknown;
    $metadata?: { httpStatusCode?: unknown };
  };
  return (
    value.name === "NoSuchKey" ||
    value.Code === "NoSuchKey" ||
    value.$metadata?.httpStatusCode === 404
  );
}

export type ShopProofRead =
  Readonly<{ status: "ok"; bytes: Buffer }> | Readonly<{ status: "missing" | "unreadable" }>;

/** The stored screenshot, telling a deleted object apart from one that cannot be trusted or read. */
export async function loadShopProof(
  storage: ShopProofStorage,
  key: string,
  proofId: string,
): Promise<ShopProofRead> {
  let bytes: Buffer;
  try {
    bytes = Buffer.from(await storage.readObject(key));
  } catch (error) {
    return { status: isMissingObjectError(error) ? "missing" : "unreadable" };
  }
  if (!bytes.length || createHash("sha256").update(bytes).digest("hex") !== proofId)
    return { status: "unreadable" };
  return { status: "ok", bytes };
}

/** The stored screenshot's bytes, only when they hash to the declared proof id. */
export async function readShopProof(
  storage: ShopProofStorage,
  key: string,
  proofId: string,
): Promise<Buffer | undefined> {
  const loaded = await loadShopProof(storage, key, proofId);
  return loaded.status === "ok" ? loaded.bytes : undefined;
}

export function shopProofContentType(bytes: Buffer): "image/png" | "image/jpeg" | undefined {
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
    return "image/png";
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return "image/jpeg";
  return undefined;
}
