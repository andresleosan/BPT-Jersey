import { getFirestore, type Firestore } from "firebase-admin/firestore";

import type {
  EmptyCanonicalDirectoryStore,
  EmptyCanonicalInitializationDocuments,
} from "./member-directory-empty-initializer.js";

type SnapshotLike = Readonly<{ exists?: boolean; empty?: boolean }>;
type ReferenceLike = Readonly<{ path?: string }>;
type QueryLike = Readonly<{ path?: string }>;
type TransactionLike = Readonly<{
  get(target: ReferenceLike | QueryLike): Promise<SnapshotLike>;
  create(target: ReferenceLike, value: unknown): unknown;
}>;

export type EmptyCanonicalFirestoreLike = Readonly<{
  projectId: string;
  doc(path: string): ReferenceLike;
  collection(path: string): Readonly<{ limit(value: number): QueryLike }>;
  runTransaction<T>(callback: (transaction: TransactionLike) => Promise<T>): Promise<T>;
}>;

function unsafeEmptyTarget(): never {
  throw new Error("Member directory academy is not completely empty.");
}

async function initializeAtomically(
  firestore: EmptyCanonicalFirestoreLike,
  documents: EmptyCanonicalInitializationDocuments,
): Promise<void> {
  const academyRoot = `academies/${documents.academyId}`;
  const stateReference = firestore.doc(`${academyRoot}/memberDirectoryStates/current`);
  const guardReference = firestore.doc(`memberDirectoryRestoreGuards/${documents.academyId}`);
  const eventReference = firestore.doc(
    `memberDirectoryRestoreGuards/${documents.academyId}/events/0`,
  );
  const eventQuery = firestore
    .collection(`memberDirectoryRestoreGuards/${documents.academyId}/events`)
    .limit(1);
  const requiredEmptyCollections = [
    "members",
    "students",
    "studentAdminProfiles",
    "studentIdentityKeys",
    "studentRestrictedReadLimits",
    "memberDirectoryCursorStates",
    "memberDirectoryStates",
    "memberDirectoryMigrations",
    "memberDirectoryMigrationChunks",
    "memberDirectoryApprovals",
    "memberDirectoryApprovalConsumptions",
    "memberDirectoryWriteReceipts",
    "familyWriteReceipts",
    "profileWriteReceipts",
    "memberDirectoryImportReceipts",
    "memberDirectoryImportSessions",
    "auditEvents",
  ] as const;
  const collectionQueries = [
    eventQuery,
    ...requiredEmptyCollections.map((collection) =>
      firestore.collection(`${academyRoot}/${collection}`).limit(1),
    ),
  ] as const;

  await firestore.runTransaction(async (transaction) => {
    const [state, guard, ...queries] = await Promise.all([
      transaction.get(stateReference),
      transaction.get(guardReference),
      ...collectionQueries.map(async (query) => transaction.get(query)),
    ]);
    if (
      state?.exists !== false ||
      guard?.exists !== false ||
      queries.length !== collectionQueries.length ||
      queries.some((snapshot) => snapshot?.empty !== true)
    ) {
      return unsafeEmptyTarget();
    }

    transaction.create(stateReference, documents.state);
    transaction.create(guardReference, documents.guard);
    transaction.create(eventReference, documents.event);
  });
}

/** @internal Runner-only adapter; never exported by the Functions entrypoint. */
export function createEmptyCanonicalMemberDirectoryFirestoreStore(
  firestore: Firestore | EmptyCanonicalFirestoreLike = getFirestore(),
): EmptyCanonicalDirectoryStore {
  const database = firestore as unknown as EmptyCanonicalFirestoreLike;
  return Object.freeze({
    projectId: database.projectId,
    initializeAtomically: async (documents) => initializeAtomically(database, documents),
  });
}
