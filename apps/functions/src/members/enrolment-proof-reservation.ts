import { createHash, randomUUID } from "node:crypto";
import type { Firestore } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import type { UserActorContext } from "@bpt-jersey/domain";

/** Reserve before writing R2: 10 attempts per 24-hour window, 3 images per request. */
export async function reserveEnrolmentProof(
  db: Firestore,
  actor: UserActorContext,
  requestId: string,
  proofId: string,
) {
  const owner = createHash("sha256").update(actor.userId).digest("hex");
  const root = `academies/${actor.academyId}`;
  const quotaRef = db.doc(`${root}/enrolmentProofLimits/${owner}`);
  const reservationRef = db.doc(`${root}/enrolmentProofReservations/${requestId}`);
  const requestRef = db.doc(`${root}/enrolmentRequests/enrolment-${requestId}`);
  const leaseId = randomUUID();
  const ready = await db.runTransaction(async (tx) => {
    const [quotaSnapshot, reservationSnapshot, submitted] = await Promise.all([
      tx.get(quotaRef), tx.get(reservationRef), tx.get(requestRef),
    ]);
    const quota = quotaSnapshot.data();
    const reservation = reservationSnapshot.data();
    if (reservation && reservation.userId !== actor.userId)
      throw new HttpsError("permission-denied", "This upload belongs to another account.");
    if (submitted.exists)
      throw new HttpsError("failed-precondition", "This request has already been submitted.");
    const now = Date.now();
    const proofs: Record<string, { state: string; leaseId: string; leaseUntil: number }> =
      reservation?.proofs ?? {};
    const prior = proofs[proofId];
    if (prior?.state === "ready") return true;
    if (prior?.state === "uploading" && prior.leaseUntil > now)
      throw new HttpsError("aborted", "This screenshot is uploading. Try again shortly.");
    if (!prior && Object.keys(proofs).length >= 3)
      throw new HttpsError("resource-exhausted", "This request has reached its screenshot limit.", { reason: "request-limit" });
    const fresh = typeof quota?.until !== "number" || quota.until <= now;
    const count = fresh ? 0 : Number(quota.count);
    if (!Number.isSafeInteger(count) || count < 0 || count >= 10)
      throw new HttpsError("resource-exhausted", "Screenshot limit reached. Try again tomorrow.", { reason: "daily-limit" });
    tx.set(quotaRef, { count: count + 1, until: fresh ? now + 86_400_000 : quota!.until });
    tx.set(reservationRef, {
      userId: actor.userId, academyId: actor.academyId, requestId,
      proofs: { ...proofs, [proofId]: { state: "uploading", leaseId, leaseUntil: now + 120_000 } },
    });
    return false;
  });
  return {
    ready,
    async finish(state: "ready" | "failed") {
      await db.runTransaction(async (tx) => {
        const current = (await tx.get(reservationRef)).data();
        if (current?.userId !== actor.userId || current.proofs?.[proofId]?.leaseId !== leaseId)
          throw new HttpsError("aborted", "Upload changed. Try again.");
        tx.update(reservationRef, { [`proofs.${proofId}.state`]: state });
      });
    },
  };
}
