import {
  FieldPath,
  getFirestore,
  type DocumentData,
  type DocumentSnapshot,
  type Firestore,
  type Transaction,
} from "firebase-admin/firestore";

import type {
  MemberDirectoryDocumentData,
  MemberDirectoryDocumentSnapshot,
  MemberDirectoryFirestore,
  MemberDirectoryTransaction,
} from "./canonical-member-directory-service.js";
import type {
  CanonicalDirectoryReadStore,
  CanonicalDirectoryReadTransaction,
  DirectoryReadData,
  DirectoryReadDocument,
} from "./canonical-member-directory-read-service.js";

export type MemberDirectoryFirestoreAdapters = Readonly<{
  writer: MemberDirectoryFirestore;
  reader: CanonicalDirectoryReadStore;
}>;

// Keep contention retries above the SDK default without allowing a Restricted
// read burst to occupy one callable for an unbounded backoff queue.
const canonicalDirectoryReadTransactionMaxAttempts = 10;

function copyData(value: DocumentData | undefined): DirectoryReadData | undefined {
  return value === undefined ? undefined : Object.freeze({ ...value });
}

function toWriterSnapshot(snapshot: DocumentSnapshot): MemberDirectoryDocumentSnapshot {
  const data = copyData(snapshot.data());
  return Object.freeze({
    id: snapshot.id,
    exists: snapshot.exists,
    data: () => data,
  });
}

function toReaderSnapshot(snapshot: DocumentSnapshot): DirectoryReadDocument {
  return Object.freeze({
    id: snapshot.id,
    exists: snapshot.exists,
    data: copyData(snapshot.data()),
  });
}

function mutableData(value: MemberDirectoryDocumentData): DocumentData {
  return { ...value };
}

function writerTransaction(
  firestore: Firestore,
  transaction: Transaction,
): MemberDirectoryTransaction {
  const adapter: MemberDirectoryTransaction = Object.freeze({
    async get(reference) {
      return toWriterSnapshot(await transaction.get(firestore.doc(reference.path)));
    },
    create(reference, data) {
      transaction.create(firestore.doc(reference.path), mutableData(data));
      return adapter;
    },
    set(reference, data) {
      transaction.set(firestore.doc(reference.path), mutableData(data));
      return adapter;
    },
  });
  return adapter;
}

function readerTransaction(
  firestore: Firestore,
  transaction: Transaction,
): CanonicalDirectoryReadTransaction {
  return Object.freeze({
    async get(path) {
      return toReaderSnapshot(await transaction.get(firestore.doc(path)));
    },
    async listStudents({ academyId, afterDocumentId, limit }) {
      let query = firestore
        .collection(`academies/${academyId}/students`)
        .orderBy(FieldPath.documentId());
      if (afterDocumentId !== undefined) query = query.startAfter(afterDocumentId);
      query = query.limit(limit);
      const snapshot = await transaction.get(query);
      return Object.freeze(snapshot.docs.map((document) => toReaderSnapshot(document)));
    },
    create(path, data) {
      transaction.create(firestore.doc(path), mutableData(data));
    },
    set(path, data) {
      transaction.set(firestore.doc(path), mutableData(data));
    },
  });
}

export function createMemberDirectoryFirestoreAdapters(
  firestore: Firestore = getFirestore(),
): MemberDirectoryFirestoreAdapters {
  const writer: MemberDirectoryFirestore = Object.freeze({
    doc(path) {
      const reference = firestore.doc(path);
      return Object.freeze({ id: reference.id, path: reference.path });
    },
    runTransaction<T>(callback: (transaction: MemberDirectoryTransaction) => Promise<T>) {
      return firestore.runTransaction((transaction) =>
        callback(writerTransaction(firestore, transaction)),
      );
    },
  });
  const reader: CanonicalDirectoryReadStore = Object.freeze({
    runTransaction<T>(callback: (transaction: CanonicalDirectoryReadTransaction) => Promise<T>) {
      return firestore.runTransaction(
        (transaction) => callback(readerTransaction(firestore, transaction)),
        { maxAttempts: canonicalDirectoryReadTransactionMaxAttempts },
      );
    },
  });
  return Object.freeze({ writer, reader });
}
