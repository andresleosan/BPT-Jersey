import { TENANT_BACKUP_COLLECTIONS, type TenantBackupSource } from "./backup-contracts.js";

type BackupFirestoreDocument = Readonly<{
  id: string;
  data: () => Record<string, unknown>;
}>;

type BackupFirestore = Readonly<{
  collection: (path: string) => Readonly<{
    get: () => Promise<Readonly<{ docs: readonly BackupFirestoreDocument[] }>>;
  }>;
}>;

const academyIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

export function createFirestoreTenantBackupSource({
  firestore,
}: {
  firestore: BackupFirestore;
}): TenantBackupSource {
  return {
    async listTenantDocuments(academyId) {
      if (!academyIdPattern.test(academyId)) throw new Error("Invalid academy scope");
      const snapshots = await Promise.all(
        TENANT_BACKUP_COLLECTIONS.map(async (collection) => ({
          collection,
          snapshot: await firestore.collection(`academies/${academyId}/${collection}`).get(),
        })),
      );
      return snapshots.flatMap(({ collection, snapshot }) =>
        snapshot.docs.map((document) => ({
          collection,
          documentId: document.id,
          data: document.data(),
        })),
      );
    },
  };
}
