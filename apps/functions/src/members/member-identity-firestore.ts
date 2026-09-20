import type { Firestore } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import { canonicalMemberIdentityIds } from "./member-identity-resolution.js";
import { createMemberDirectoryReadTransaction } from "./member-directory-firestore.js";

export function readCanonicalMemberIdentityIds(db: Firestore, academyId: string, studentId: string) {
  return db.runTransaction((tx) => canonicalMemberIdentityIds(createMemberDirectoryReadTransaction(db, tx), academyId, studentId));
}
/** Original record IDs and payer references survive; only the query's identity union changes. */
export function readCanonicalMemberHistoryDocuments(db: Firestore, academyId: string, studentId: string,
  collection: "bookings" | "attendance" | "checkouts" | "assessments" | "medicalLeaves" | "levelPromotions", limit = 500) {
  return db.runTransaction(async (tx) => {
    const ids = await canonicalMemberIdentityIds(createMemberDirectoryReadTransaction(db, tx), academyId, studentId);
    const pages = await Promise.all(ids.map((id) => tx.get(db.collection(`academies/${academyId}/${collection}`)
      .where("studentId", "==", id).limit(limit + 1))));
    const docs = pages.flatMap((page) => page.docs);
    if (docs.length > limit) throw new HttpsError("failed-precondition", "Use the paginated member history for this record");
    for (const doc of docs) {
      if (doc.data().academyId !== academyId || !ids.includes(String(doc.data().studentId))) {
        throw new HttpsError("failed-precondition", "Historical identity ownership needs review");
      }
    }
    return { ids, docs };
  });
}
