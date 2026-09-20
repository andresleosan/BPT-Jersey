import type { Firestore, Transaction } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import { courseCollection, courseHash } from "./course-store.js";

/** Read before any transaction writes; commit the returned closure only for a new event. */
export async function readCourseRateLimit(db: Firestore, tx: Transaction, academyId: string, subject: string, action: "reserve" | "upload" | "submit", nowMs: number): Promise<() => void> {
  const minute = Math.floor(nowMs / 60_000);
  // Include the partial oldest minute: a conservative rolling hour cannot admit an extra event.
  const refs = Array.from({length: 61}, (_, index) => courseCollection(db, academyId, "courseRateLimits").doc(courseHash(subject, action, String(minute - index))));
  const buckets = await tx.getAll(...refs);
  const count = buckets.reduce((total, bucket) => total + Number(bucket.data()?.count ?? 0), 0);
  const maximum = action === "upload" ? 20 : 10;
  if (count >= maximum) throw new HttpsError("resource-exhausted", "Please wait before trying again.", {reason: "rate_limited", retryAfterSeconds: 60});
  return () => tx.set(refs[0]!, {count: Number(buckets[0]?.data()?.count ?? 0) + 1, expiresAt: new Date((minute + 62) * 60_000).toISOString()});
}
