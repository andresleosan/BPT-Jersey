import { canonicalMemberIdentityIds } from "../members/member-identity-resolution.js";
import { createMemberDirectoryReadTransaction } from "../members/member-directory-firestore.js";
import { FieldPath, type DocumentSnapshot, type Firestore } from "firebase-admin/firestore";
import type { ClassDocument, MemberClassStore } from "./member-class-records-service.js";
const document = (snapshot: DocumentSnapshot): ClassDocument => ({
  id: snapshot.id,
  data: snapshot.data(),
});
export function createMemberClassFirestoreStore(db: Firestore): MemberClassStore {
  return {
    read: (academyId, work) =>
      db.runTransaction(
        async (tx) => {
          const base = db.doc(`academies/${academyId}`);
          return work({
            getIdentityIds: (studentId) => canonicalMemberIdentityIds(createMemberDirectoryReadTransaction(db, tx), academyId, studentId),
            getState: async () =>
              (await tx.get(base.collection("memberDirectoryStates").doc("current"))).data(),
            getStudent: async (studentId) =>
              (await tx.get(base.collection("students").doc(studentId))).data(),
            getRecord: async (kind, recordId) =>
              document(await tx.get(base.collection(kind).doc(recordId))),
            queryRecords: async (input, limit) => {
              const ids = await canonicalMemberIdentityIds(createMemberDirectoryReadTransaction(db, tx), academyId, input.studentId);
              const timeField = input.kind === "bookings" ? "requestedAt" : "occurredAt";
              const docs = (await Promise.all(ids.map(async (studentId) => {
                let query = base.collection(input.kind).where("studentId", "==", studentId);
                if (input.kind === "attendance") query = query.where("correctionOf", "==", null);
                query = query.orderBy(timeField, "desc").orderBy(FieldPath.documentId(), "desc");
                if (input.cursor) query = query.startAfter(input.cursor.at, input.cursor.recordId);
                return (await tx.get(query.limit(limit))).docs;
              }))).flat().sort((a, b) => String(b.data()[timeField]).localeCompare(String(a.data()[timeField])) || b.id.localeCompare(a.id));
              return docs.slice(0, limit).map(document);
            },
            getSessions: async (ids) =>
              ids.length === 0
                ? []
                : (await tx.getAll(...ids.map((id) => base.collection("sessions").doc(id)))).map(
                    document,
                  ),
          });
        },
        { readOnly: true },
      ),
  };
}
