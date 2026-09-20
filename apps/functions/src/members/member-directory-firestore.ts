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
    ...(snapshot.updateTime ? { version: `${snapshot.updateTime.seconds}:${snapshot.updateTime.nanoseconds}` } : {}),
    data: () => data,
  });
}

function toReaderSnapshot(snapshot: DocumentSnapshot): DirectoryReadDocument {
  return Object.freeze({
    id: snapshot.id,
    exists: snapshot.exists,
    data: copyData(snapshot.data()),
    ...(snapshot.updateTime ? { version: `${snapshot.updateTime.seconds}:${snapshot.updateTime.nanoseconds}` } : {}),
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

export function createMemberDirectoryReadTransaction(
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
    async listCollection({ academyId, collection, equal, afterDocumentId, limit }) {
      if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(academyId) ||
          !/^[A-Za-z][A-Za-z0-9]*$/u.test(collection) || limit < 1 || limit > 101) {
        throw new Error("Invalid bounded directory query");
      }
      let query = firestore.collection(`academies/${academyId}/${collection}`)
        .orderBy(FieldPath.documentId());
      if (equal !== undefined) {
        if (!["studentId", "canonicalStudentId", "membershipId", "invoiceId"].includes(equal.field) ||
            !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(equal.value)) {
          throw new Error("Invalid directory query filter");
        }
        query = query.where(equal.field, "==", equal.value);
      }
      if (afterDocumentId !== undefined) query = query.startAfter(afterDocumentId);
      const result = await transaction.get(query.limit(limit));
      return result.docs.map(toReaderSnapshot);
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
        (transaction) => callback(createMemberDirectoryReadTransaction(firestore, transaction)),
        { maxAttempts: canonicalDirectoryReadTransactionMaxAttempts },
      );
    },
  });
  return Object.freeze({ writer, reader });
}
