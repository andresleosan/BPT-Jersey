import { memberDirectoryChunkReceiptSchema } from "@bpt-jersey/domain/members/directory-migration";
import { memberDirectoryMaxChunksPerOperation } from "@bpt-jersey/domain/members/directory-transitions";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

import type {
  MemberDirectoryBootstrapClosureControlPlane,
  MemberDirectoryBootstrapClosureStore,
  MemberDirectoryBootstrapCompletionWrite,
  MemberDirectoryBootstrapVerificationWrite,
} from "./member-directory-bootstrap-closure-runner.js";

/**
 * The Firestore adapter behind the bootstrap closure runner's port (T108, slice 9).
 *
 * It follows the chunk adapter's shape for the same reason: the port is read-then-plan-then-commit,
 * which no Firestore transaction can span, so the commit is a **compare-and-set** that re-reads
 * state and guard and refuses unless they are still exactly the revision and event MAC the proof
 * was established against. A concurrent writer that moved the control plane in between aborts this
 * transaction with nothing written.
 *
 * The verification commit is the one place in this migration that writes a single document. That is
 * not an oversight - the spec requires the state to stay blocked, frozen and incomplete across
 * verification - and it is precisely why the compare-and-set matters more here than anywhere else:
 * without it, "the parent alone" would mean a parent moved against a control plane nobody rechecked.
 */

/** At most eight bootstrap chunks per operation; a ninth receipt means the collection is not what this thinks. */
const maxOperationChunkReceipts = memberDirectoryMaxChunksPerOperation + 1;

/** Reservation reads are issued in bounded batches rather than one fan-out of up to 2000 gets. */
const identityKeyReadBatchSize = 250;

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

export type MemberDirectoryClosureFirestoreLike = Readonly<{
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

function operationPath(academyId: string, operationId: string): string {
  return `academies/${academyId}/memberDirectoryMigrations/${operationId}`;
}

function identityKeyPath(academyId: string, keyId: string): string {
  return `academies/${academyId}/studentIdentityKeys/${keyId}`;
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

async function readIdentityKeys(
  firestore: MemberDirectoryClosureFirestoreLike,
  academyId: string,
  keyIds: readonly string[],
): Promise<ReadonlyMap<string, unknown>> {
  const stored = new Map<string, unknown>();
  for (let offset = 0; offset < keyIds.length; offset += identityKeyReadBatchSize) {
    const batch = keyIds.slice(offset, offset + identityKeyReadBatchSize);
    const snapshots = await Promise.all(
      batch.map(async (keyId) => firestore.doc(identityKeyPath(academyId, keyId)).get()),
    );
    snapshots.forEach((snapshot, index) => {
      const keyId = batch[index];
      // A missing reservation is simply absent from the map: the runner is the one that decides
      // that an expected reservation which does not exist ends the closure.
      if (keyId !== undefined && snapshot.exists) {
        stored.set(keyId, snapshot.data());
      }
    });
  }
  return stored;
}

async function readClosureControlPlane(
  firestore: MemberDirectoryClosureFirestoreLike,
  input: Readonly<{ academyId: string; operationId: string; expectedKeyIds: readonly string[] }>,
): Promise<MemberDirectoryBootstrapClosureControlPlane> {
  const [state, guard, operation, receipts] = await Promise.all([
    firestore.doc(statePath(input.academyId)).get(),
    firestore.doc(guardPath(input.academyId)).get(),
    firestore.doc(operationPath(input.academyId, input.operationId)).get(),
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
    throw new Error("Member directory parent operation is missing");
  }
  const guardData = guard.data();
  const event = await firestore
    .doc(eventPath(input.academyId, requiredString(guardData?.["lastEventId"], "guard event ID")))
    .get();
  if (!event.exists) {
    throw new Error("Member directory guard event is missing");
  }

  if (receipts.size >= maxOperationChunkReceipts) {
    // More receipts than a bootstrap operation may own. Verifying a truncated page would prove a
    // baseline over some of the chunks and call it all of them.
    throw new Error("Member directory operation has more chunk receipts than it may own");
  }

  // Sorted here so the runner receives them ascending, which is the order its sequence check reads.
  const ordered = receipts.docs
    .map((document) => document.data())
    .sort(
      (left, right) =>
        memberDirectoryChunkReceiptSchema.parse(left).chunkNo -
        memberDirectoryChunkReceiptSchema.parse(right).chunkNo,
    );

  const identityKeys = await readIdentityKeys(firestore, input.academyId, input.expectedKeyIds);

  return Object.freeze({
    state: state.data(),
    guard: guardData,
    event: event.data(),
    operation: operation.data(),
    receipts: Object.freeze(ordered),
    identityKeys,
  });
}

async function commitVerification(
  firestore: MemberDirectoryClosureFirestoreLike,
  write: MemberDirectoryBootstrapVerificationWrite,
): Promise<void> {
  const stateReference = firestore.doc(statePath(write.academyId));
  const guardReference = firestore.doc(guardPath(write.academyId));
  const operationReference = firestore.doc(
    operationPath(write.academyId, write.operation.operationId),
  );

  await firestore.runTransaction(async (transaction) => {
    const [state, guard, operation] = await Promise.all([
      transaction.get(stateReference),
      transaction.get(guardReference),
      transaction.get(operationReference),
    ]);
    if (!state.exists || !guard.exists) {
      throw new Error("Member directory control plane disappeared before verification committed");
    }
    if (!operation.exists) {
      throw new Error(
        "Member directory parent operation disappeared before verification committed",
      );
    }

    const stateData = state.data();
    const guardData = guard.data();
    if (
      requiredNumber(stateData?.["stateRevision"], "state revision") !==
        write.expectedStateRevision ||
      requiredNumber(guardData?.["highestStateRevision"], "guard revision") !==
        write.expectedStateRevision ||
      requiredString(guardData?.["lastEventMac"], "guard event MAC") !== write.expectedEventMac
    ) {
      // The control plane moved between the proof and this write, so the baseline was established
      // about a state that no longer exists.
      throw new Error("Member directory control plane moved while the baseline was being verified");
    }

    // The parent, and deliberately nothing else.
    transaction.set(operationReference, write.operation);
  });
}

async function commitCompletion(
  firestore: MemberDirectoryClosureFirestoreLike,
  write: MemberDirectoryBootstrapCompletionWrite,
): Promise<void> {
  const expectedRevision = write.nextState.stateRevision - 1;
  const stateReference = firestore.doc(statePath(write.academyId));
  const guardReference = firestore.doc(guardPath(write.academyId));
  const eventReference = firestore.doc(eventPath(write.academyId, write.event.eventId));
  const operationReference = firestore.doc(
    operationPath(write.academyId, write.operation.operationId),
  );

  await firestore.runTransaction(async (transaction) => {
    const [state, guard, operation] = await Promise.all([
      transaction.get(stateReference),
      transaction.get(guardReference),
      transaction.get(operationReference),
    ]);
    if (!state.exists || !guard.exists) {
      throw new Error("Member directory control plane disappeared before the bootstrap completed");
    }
    if (!operation.exists) {
      throw new Error(
        "Member directory parent operation disappeared before the bootstrap completed",
      );
    }

    const stateData = state.data();
    const guardData = guard.data();
    if (
      requiredNumber(stateData?.["stateRevision"], "state revision") !== expectedRevision ||
      requiredNumber(guardData?.["highestStateRevision"], "guard revision") !== expectedRevision ||
      requiredString(guardData?.["lastEventMac"], "guard event MAC") !==
        write.event.previousEventMac
    ) {
      throw new Error("Member directory control plane moved while the bootstrap was being closed");
    }

    transaction.set(stateReference, write.nextState);
    transaction.set(guardReference, write.guard);
    // Created, never overwritten: a second completion attempt fails on the event rather than
    // rewriting the audit entry the first one wrote.
    transaction.create(eventReference, write.event);
    transaction.set(operationReference, write.operation);
  });
}

/** @internal Runner-only adapter; never exported by the Functions entrypoint. */
export function createMemberDirectoryBootstrapClosureFirestoreStore(
  firestore: Firestore | MemberDirectoryClosureFirestoreLike = getFirestore(),
): MemberDirectoryBootstrapClosureStore {
  const database = firestore as unknown as MemberDirectoryClosureFirestoreLike;
  return Object.freeze({
    read: async (input) => readClosureControlPlane(database, input),
    commitVerification: async (write) => commitVerification(database, write),
    commitCompletion: async (write) => commitCompletion(database, write),
  });
}
