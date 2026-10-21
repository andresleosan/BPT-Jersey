import { getFirestore, type Firestore } from "firebase-admin/firestore";

import {
  isNestedLegacyHistoryPath,
  nestedLegacyHistoryCollectionIds,
  type GlobalLegacyEliminationStore,
  type NestedLegacyHistoryCounts,
} from "./member-directory-global-elimination.js";

/**
 * The Firestore side of T097. The nested pre-read asks for paths only (`select()` with no field),
 * and the transaction reads state, guard, event and `members` (limit 1) before it writes anything.
 */
export function createGlobalLegacyEliminationFirestoreStore(
  firestore: Firestore = getFirestore(),
): GlobalLegacyEliminationStore {
  return Object.freeze({
    async countNestedLegacyHistory(academyId: string): Promise<NestedLegacyHistoryCounts> {
      const count = async (collectionId: (typeof nestedLegacyHistoryCollectionIds)[number]) => {
        const snapshot = await firestore.collectionGroup(collectionId).select().get();
        return snapshot.docs.filter((document) =>
          isNestedLegacyHistoryPath(academyId, document.ref.path),
        ).length;
      };
      const [evaluations, graduations, medicalLeaves] = await Promise.all([
        count("evaluations"),
        count("graduations"),
        count("medicalLeaves"),
      ]);
      return Object.freeze({ evaluations, graduations, medicalLeaves });
    },
    runTransaction(callback, options) {
      return firestore.runTransaction(
        async (transaction) =>
          callback({
            async get(path) {
              const snapshot = await transaction.get(firestore.doc(path));
              return { exists: snapshot.exists, data: () => snapshot.data() };
            },
            async countLegacyMembers(academyId) {
              const snapshot = await transaction.get(
                firestore.collection(`academies/${academyId}/members`).limit(1),
              );
              return snapshot.size;
            },
            set(path, data) {
              transaction.set(firestore.doc(path), { ...data });
            },
            create(path, data) {
              transaction.create(firestore.doc(path), { ...data });
            },
          }),
        options.readOnly ? { readOnly: true } : undefined,
      );
    },
  });
}
