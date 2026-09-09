import { memberDirectoryChunkReceiptSchema } from "@bpt-jersey/domain/members/directory-migration";
import {
  memberDirectoryMaxChunksPerOperation,
  memberDirectoryMaxRowsPerOperation,
} from "@bpt-jersey/domain/members/directory-transitions";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

import type {
  MemberDirectoryForwardClosureControlPlane,
  MemberDirectoryForwardClosureStore,
  MemberDirectoryForwardCutoverWrite,
  MemberDirectoryForwardVerificationWrite,
} from "./member-directory-forward-closure-runner.js";
import type {
  MemberDirectoryForwardChunkDocuments,
  MemberDirectoryForwardControlPlaneStore,
  MemberDirectoryForwardReadRequest,
  MemberDirectoryForwardSourceStore,
} from "./member-directory-forward-runner.js";

/**
 * The Firestore adapters behind the forward runner's three ports (T108, slice 16).
 *
 * They follow the shape the chunk runner's adapter already established: read outside a transaction,
 * and turn each decision into a **compare-and-set** inside one that refuses unless state and guard
 * still stand exactly where the decision was made. Nothing here pretends to hold a transaction open
 * across a read and a later commit, because no Firestore transaction can span the two calls the port
 * is deliberately split into.
 *
 * **Every read is bounded by something the plan already fixed.** The chunk documents are fetched by
 * the exact IDs the frozen plan names - never by query - so a chunk cannot widen its own read set,
 * and the closure's receipt page is capped at what a legal operation may own. An unbounded scan here
 * would be the one place in the migration where the transaction budget stops being provable.
 */

/** At most eight chunks per phase, and forward may be followed by compensation under one operation. */
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

export type MemberDirectoryForwardFirestoreLike = Readonly<{
  doc(path: string): DocumentReferenceLike;
  collection(path: string): Readonly<{
    where(
      field: string,
      operator: "==",
      value: unknown,
    ): Readonly<{ limit(value: number): QueryLike }>;
    limit(value: number): QueryLike;
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

/** State, guard, the guard's head event and the parent, read together. */
async function readForwardControlPlane(
  firestore: MemberDirectoryForwardFirestoreLike,
  input: Readonly<{ academyId: string; operationId: string }>,
): Promise<
  Readonly<{ state: unknown; guard: unknown; event: unknown; operation: unknown }> &
    Readonly<{ guardData: DocumentDataLike }>
> {
  const [state, guard, operation] = await Promise.all([
    firestore.doc(statePath(input.academyId)).get(),
    firestore.doc(guardPath(input.academyId)).get(),
    firestore.doc(operationPath(input.academyId, input.operationId)).get(),
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
  return Object.freeze({
    state: state.data(),
    guard: guardData,
    guardData,
    event: event.data(),
    operation: operation.data(),
  });
}

/** @internal Runner-only adapter; never exported by the Functions entrypoint. */
export function createMemberDirectoryForwardControlPlaneFirestoreStore(
  firestore: Firestore | MemberDirectoryForwardFirestoreLike = getFirestore(),
): MemberDirectoryForwardControlPlaneStore {
  const database = firestore as unknown as MemberDirectoryForwardFirestoreLike;
  return Object.freeze({
    read: async (input) => {
      const read = await readForwardControlPlane(database, input);
      return Object.freeze({
        state: read.state,
        guard: read.guard,
        event: read.event,
        operation: read.operation,
      });
    },
  });
}

/**
 * Reads one collection's documents by exact ID into a map, skipping the absent ones.
 *
 * Absence is the normal answer for most of these - a created student has no prior document, and a
 * planned reservation has no prior holder - so a missing document is a fact the executor decides
 * about, not an error the adapter raises.
 */
async function readById(
  firestore: MemberDirectoryForwardFirestoreLike,
  academyId: string,
  collection: string,
  ids: readonly string[],
): Promise<ReadonlyMap<string, unknown>> {
  const unique = [...new Set(ids)];
  const snapshots = await Promise.all(
    unique.map(async (id) => ({
      id,
      snapshot: await firestore.doc(`academies/${academyId}/${collection}/${id}`).get(),
    })),
  );
  const documents = new Map<string, unknown>();
  for (const { id, snapshot } of snapshots) {
    if (snapshot.exists) documents.set(id, snapshot.data());
  }
  return documents;
}

/** @internal Runner-only adapter; never exported by the Functions entrypoint. */
export function createMemberDirectoryForwardSourceFirestoreStore(
  firestore: Firestore | MemberDirectoryForwardFirestoreLike = getFirestore(),
): MemberDirectoryForwardSourceStore {
  const database = firestore as unknown as MemberDirectoryForwardFirestoreLike;
  return Object.freeze({
    read: async (
      request: MemberDirectoryForwardReadRequest,
    ): Promise<MemberDirectoryForwardChunkDocuments> => {
      const [sourceRows, students, adminProfiles, families, relationships, identityKeys] =
        await Promise.all([
          readById(database, request.academyId, "members", request.sourceLegacyIds),
          readById(database, request.academyId, "students", request.targetStudentIds),
          readById(database, request.academyId, "studentAdminProfiles", request.targetStudentIds),
          readById(database, request.academyId, "families", request.familyIds),
          readById(database, request.academyId, "relationships", request.relationshipIds),
          readById(database, request.academyId, "studentIdentityKeys", request.expectedKeyIds),
        ]);
      return Object.freeze({
        sourceRows,
        students,
        adminProfiles,
        families,
        relationships,
        identityKeys,
      });
    },
  });
}

async function readForwardClosureControlPlane(
  firestore: MemberDirectoryForwardFirestoreLike,
  input: Readonly<{ academyId: string; operationId: string }>,
): Promise<MemberDirectoryForwardClosureControlPlane> {
  const [plane, receipts, students] = await Promise.all([
    readForwardControlPlane(firestore, input),
    firestore
      .collection(`academies/${input.academyId}/memberDirectoryMigrationChunks`)
      .where("operationId", "==", input.operationId)
      .limit(maxOperationChunkReceipts)
      .get(),
    firestore
      .collection(`academies/${input.academyId}/students`)
      // One past the v1 bound: a tenant at 401 is out of scope for this protocol entirely, and the
      // closure must say so rather than cut over on a count it silently truncated.
      .limit(memberDirectoryMaxRowsPerOperation + 1)
      .get(),
  ]);

  if (receipts.size >= maxOperationChunkReceipts) {
    // Verifying a truncated page would prove the migration over some of its chunks and call it all.
    throw new Error("Member directory operation has more chunk receipts than it may own");
  }
  if (students.size > memberDirectoryMaxRowsPerOperation) {
    throw new Error(
      `Member directory holds more than ${String(memberDirectoryMaxRowsPerOperation)} students, which member-directory-v1 does not cover`,
    );
  }

  // Sorted here so the runner receives them ascending, which is the order its sequence check reads.
  const ordered = receipts.docs
    .map((document) => document.data())
    .sort(
      (left, right) =>
        memberDirectoryChunkReceiptSchema.parse(left).chunkNo -
        memberDirectoryChunkReceiptSchema.parse(right).chunkNo,
    );

  return Object.freeze({
    state: plane.state,
    guard: plane.guard,
    event: plane.event,
    operation: plane.operation,
    receipts: Object.freeze(ordered),
    admittedStudentCount: students.size,
  });
}

async function commitForwardVerification(
  firestore: MemberDirectoryForwardFirestoreLike,
  write: MemberDirectoryForwardVerificationWrite,
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
      // The control plane moved between the proof and this write, so the migration was proven about
      // a state that no longer exists.
      throw new Error(
        "Member directory control plane moved while the migration was being verified",
      );
    }

    // The parent, and deliberately nothing else: the reader does not switch here.
    transaction.set(operationReference, write.operation);
  });
}

async function commitForwardCutover(
  firestore: MemberDirectoryForwardFirestoreLike,
  write: MemberDirectoryForwardCutoverWrite,
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
      throw new Error("Member directory control plane disappeared before the cutover committed");
    }
    if (!operation.exists) {
      throw new Error("Member directory parent operation disappeared before the cutover committed");
    }

    const stateData = state.data();
    const guardData = guard.data();
    if (
      requiredNumber(stateData?.["stateRevision"], "state revision") !== expectedRevision ||
      requiredNumber(guardData?.["highestStateRevision"], "guard revision") !== expectedRevision ||
      requiredString(guardData?.["lastEventMac"], "guard event MAC") !==
        write.event.previousEventMac
    ) {
      throw new Error("Member directory control plane moved while the cutover was being planned");
    }

    transaction.set(stateReference, write.nextState);
    transaction.set(guardReference, write.guard);
    // Created, never overwritten: a second cutover attempt fails on the event rather than rewriting
    // the audit entry that recorded the reader switch.
    transaction.create(eventReference, write.event);
    transaction.set(operationReference, write.operation);
  });
}

/** @internal Runner-only adapter; never exported by the Functions entrypoint. */
export function createMemberDirectoryForwardClosureFirestoreStore(
  firestore: Firestore | MemberDirectoryForwardFirestoreLike = getFirestore(),
): MemberDirectoryForwardClosureStore {
  const database = firestore as unknown as MemberDirectoryForwardFirestoreLike;
  return Object.freeze({
    read: async (input) => readForwardClosureControlPlane(database, input),
    commitVerification: async (write) => commitForwardVerification(database, write),
    commitCutover: async (write) => commitForwardCutover(database, write),
  });
}
