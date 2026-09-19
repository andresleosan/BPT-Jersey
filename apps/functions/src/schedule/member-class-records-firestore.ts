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
            getState: async () =>
              (await tx.get(base.collection("memberDirectoryStates").doc("current"))).data(),
            getStudent: async (studentId) =>
              (await tx.get(base.collection("students").doc(studentId))).data(),
            getRecord: async (kind, recordId) =>
              document(await tx.get(base.collection(kind).doc(recordId))),
            queryRecords: async (input, limit) => {
              let query = base.collection(input.kind).where("studentId", "==", input.studentId);
              if (input.kind === "attendance") query = query.where("correctionOf", "==", null);
              query = query
                .orderBy(input.kind === "bookings" ? "requestedAt" : "occurredAt", "desc")
                .orderBy(FieldPath.documentId(), "desc");
              if (input.cursor) query = query.startAfter(input.cursor.at, input.cursor.recordId);
              return (await tx.get(query.limit(limit))).docs.map(document);
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
