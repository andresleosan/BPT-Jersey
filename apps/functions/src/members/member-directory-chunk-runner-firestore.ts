import {
  parseMemberDirectoryChunkId,
  memberDirectoryChunkReceiptSchema,
} from "@bpt-jersey/domain/members/directory-migration";
import { memberDirectoryMaxChunksPerOperation } from "@bpt-jersey/domain/members/directory-transitions";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

import type {
  MemberDirectoryChunkCommitWrite,
  MemberDirectoryChunkControlPlane,
  MemberDirectoryChunkStore,
} from "./member-directory-chunk-runner.js";

/**
 * The Firestore adapter behind the chunk runner's port (T108).
 *
 * The port is deliberately read-then-commit, which no Firestore transaction can span: the runner
 * does its planning between the two calls. So the adapter does not pretend to hold one open. It
 * reads outside a transaction and turns the runner's decision into a **compare-and-set** inside
 * one: the commit re-reads state and guard and refuses unless they are still exactly the revision
 * and event MAC the plan was made against.
 *
 * That is what makes the split safe. A concurrent writer that advanced the control plane between
 * the read and the commit changes the revision or the chain head, and this transaction aborts with
 * nothing written - the same outcome as losing a race inside a single transaction, reached by
 * comparison rather than by holding a lock. A torn read is caught for the same reason.
 *
 * The receipt, the guard event and every domain document are created, never overwritten, so a
 * second attempt at an already-committed chunk fails on the receipt rather than silently rewriting
 * documents the first attempt wrote.
 */

/** At most eight chunks per phase, and only forward can be followed by compensation under one operation. */
const maxOperationChunkReceipts = 2 * memberDirectoryMaxChunksPerOperation + 1;

type DocumentDataLike = Record<string, unknown> | undefined;

type DocumentSnapshotLike = Readonly<{
  exists: boolean;
  data(): DocumentDataLike;
}>;

type QuerySnapshotLike = Readonly<{
  size: number;
  docs: readonly Readonly<{ id: string; data(): DocumentDataLike }>[];
}>;

type DocumentReferenceLike = Readonly<{
  get(): Promise<DocumentSnapshotLike>;
}>;

type QueryLike = Readonly<{ get(): Promise<QuerySnapshotLike> }>;

type TransactionLike = Readonly<{
  get(target: DocumentReferenceLike): Promise<DocumentSnapshotLike>;
  set(target: DocumentReferenceLike, value: unknown): unknown;
  create(target: DocumentReferenceLike, value: unknown): unknown;
}>;

export type MemberDirectoryChunkFirestoreLike = Readonly<{
  doc(path: string): DocumentReferenceLike;
  collection(path: string): Readonly<{
    where(
      field: string,
      operator: "==",
      value: unknown,
    ): Readonly<{ limit(value: number): QueryLike }>;
  }>;
  runTransaction<T>(callback: (transaction: TransactionLike) => Promise<T>): Promise<T>;
}>;

function statePath(academyId: string): string {
  return `academies/${academyId}/memberDirectoryStates/current`;
}

function guardPath(academyId: string): string {
  return `memberDirectoryRestoreGuards/${academyId}`;
}

function eventPath(academyId: string, eventId: string): string {
  return `memberDirectoryRestoreGuards/${academyId}/events/${eventId}`;
}

function chunkPath(academyId: string, chunkId: string): string {
  return `academies/${academyId}/memberDirectoryMigrationChunks/${chunkId}`;
}

function operationPath(academyId: string, operationId: string): string {
  return `academies/${academyId}/memberDirectoryMigrations/${operationId}`;
}

function requiredNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new Error(`Member directory ${label} is missing or not an integer`);
  }
  return value;
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Member directory ${label} is missing`);
  }
  return value;
}

async function readControlPlane(
  firestore: MemberDirectoryChunkFirestoreLike,
  input: Readonly<{ academyId: string; operationId: string; chunkId: string }>,
): Promise<MemberDirectoryChunkControlPlane> {
  const [state, guard, operation, ownReceipt, operationReceipts] = await Promise.all([
    firestore.doc(statePath(input.academyId)).get(),
    firestore.doc(guardPath(input.academyId)).get(),
    firestore.doc(operationPath(input.academyId, input.operationId)).get(),
    firestore.doc(chunkPath(input.academyId, input.chunkId)).get(),
    firestore
      .collection(`academies/${input.academyId}/memberDirectoryMigrationChunks`)
      .where("operationId", "==", input.operationId)
      .limit(maxOperationChunkReceipts)
      .get(),
  ]);

  if (!state.exists || !guard.exists) {
    throw new Error("Member directory control plane is missing");
  }
  if (!operation.exists) {
    // A chunk with no parent operation has nothing that authorised it, whatever the state says.
    throw new Error("Member directory parent operation is missing");
  }
  const guardData = guard.data();
  const event = await firestore
    .doc(eventPath(input.academyId, requiredString(guardData?.["lastEventId"], "guard event ID")))
    .get();
  if (!event.exists) {
    throw new Error("Member directory guard event is missing");
  }

  if (operationReceipts.size >= maxOperationChunkReceipts) {
    // More receipts than any legal operation can own means the collection is not what this runner
    // thinks it is. Summing a truncated page would understate the row budget.
    throw new Error("Member directory operation has more chunk receipts than it may own");
  }
  let priorRowCount = 0;
  for (const document of operationReceipts.docs) {
    if (document.id === input.chunkId) continue;
    const receipt = memberDirectoryChunkReceiptSchema.parse(document.data());
    priorRowCount += receipt.writtenCount;
  }

  const ownReceiptData = ownReceipt.exists
    ? memberDirectoryChunkReceiptSchema.parse(ownReceipt.data())
    : undefined;

  return Object.freeze({
    state: state.data(),
    guard: guardData,
    event: event.data(),
    operation: operation.data(),
    priorRowCount,
    // Spread conditionally: "no stored receipt" has to mean the property is absent, not present
    // and undefined, or the runner cannot tell a first attempt from a receipt-less replay.
    ...(ownReceiptData === undefined ? {} : { committedOutputSetMac: ownReceiptData.outputSetMac }),
  });
}

async function commitChunk(
  firestore: MemberDirectoryChunkFirestoreLike,
  write: MemberDirectoryChunkCommitWrite,
): Promise<void> {
  const nextState = write.nextState as Readonly<Record<string, unknown>>;
  const expectedRevision = requiredNumber(nextState["stateRevision"], "next state revision") - 1;
  const stateReference = firestore.doc(statePath(write.academyId));
  const guardReference = firestore.doc(guardPath(write.academyId));
  const receiptReference = firestore.doc(chunkPath(write.academyId, write.chunkId));
  const eventReference = firestore.doc(eventPath(write.academyId, write.event.eventId));
  const operationReference =
    write.operation === undefined
      ? undefined
      : firestore.doc(operationPath(write.academyId, write.operation.operationId));
  const domainReferences = write.domainWrites.map((domainWrite) => ({
    reference: firestore.doc(domainWrite.path),
    data: domainWrite.data,
  }));

  await firestore.runTransaction(async (transaction) => {
    const [state, guard, receipt] = await Promise.all([
      transaction.get(stateReference),
      transaction.get(guardReference),
      transaction.get(receiptReference),
    ]);
    if (!state.exists || !guard.exists) {
      throw new Error("Member directory control plane disappeared before the chunk committed");
    }
    if (receipt.exists) {
      throw new Error("Member directory chunk receipt already exists");
    }

    const stateData = state.data();
    const guardData = guard.data();
    if (
      requiredNumber(stateData?.["stateRevision"], "state revision") !== expectedRevision ||
      requiredNumber(guardData?.["highestStateRevision"], "guard revision") !== expectedRevision ||
      requiredString(guardData?.["lastEventMac"], "guard event MAC") !==
        write.event.previousEventMac
    ) {
      // The control plane moved between the runner's read and this commit. Everything the runner
      // decided was decided about a state that no longer exists.
      throw new Error("Member directory control plane moved while the chunk was being planned");
    }

    transaction.set(stateReference, write.nextState);
    transaction.set(guardReference, write.guard);
    if (operationReference !== undefined) {
      transaction.set(operationReference, write.operation);
    }
    transaction.create(eventReference, write.event);
    transaction.create(receiptReference, write.receipt);
    for (const domainWrite of domainReferences) {
      transaction.create(domainWrite.reference, domainWrite.data);
    }
  });
}

/** @internal Runner-only adapter; never exported by the Functions entrypoint. */
export function createMemberDirectoryChunkFirestoreStore(
  firestore: Firestore | MemberDirectoryChunkFirestoreLike = getFirestore(),
): MemberDirectoryChunkStore {
  const database = firestore as unknown as MemberDirectoryChunkFirestoreLike;
  return Object.freeze({
    read: async (input) => {
      // Rejects a malformed chunk ID before any read, so a path is never built from one.
      parseMemberDirectoryChunkId(input.chunkId);
      return readControlPlane(database, input);
    },
    commit: async (write) => commitChunk(database, write),
  });
}
