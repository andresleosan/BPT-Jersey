import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import { parseFamilyRecord } from "@bpt-jersey/domain/families";
import { reviewIdentifierSchema } from "@bpt-jersey/domain/members/reconciliation";

/** Historical billing access is based on the recorded payer, independent of child profile access. */
export async function listPayerFamilyIds(academyId: string, actorId: string, db: Firestore = getFirestore()): Promise<readonly string[]> {
  reviewIdentifierSchema.parse(academyId); reviewIdentifierSchema.parse(actorId);
  const result = await db.collection(`academies/${academyId}/families`).where("billingContactUserId", "==", actorId).limit(101).get();
  if (result.size > 100) throw new HttpsError("failed-precondition", "Billing ownership requires office review");
  return result.docs.map((doc) => {
    const family = parseFamilyRecord(doc.data());
    if (!family.ok || family.value.familyId !== doc.id || family.value.academyId !== academyId || family.value.billingContactUserId !== actorId) throw new HttpsError("permission-denied", "Billing access is unavailable");
    return doc.id;
  });
}
