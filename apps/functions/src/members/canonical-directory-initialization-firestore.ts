import { getFirestore, type Firestore } from "firebase-admin/firestore";

import type { AuditEventDraft } from "@bpt-jersey/domain/audit";

import { appendAuditEventInTransaction } from "../audit/audit-writer.js";
import {
  canonicalDirectoryRequiredEmptyCollections,
  CanonicalDirectoryInitializationError,
  type CanonicalDirectoryInitializationStore,
} from "./canonical-directory-initialization.js";

function statePath(academyId: string): string {
  return `academies/${academyId}/memberDirectoryStates/current`;
}

function guardPath(academyId: string): string {
  return `memberDirectoryRestoreGuards/${academyId}`;
}

function guardEventPath(academyId: string): string {
  return `memberDirectoryRestoreGuards/${academyId}/events/0`;
}

function guardEventsCollectionPath(academyId: string): string {
  return `memberDirectoryRestoreGuards/${academyId}/events`;
}

/**
 * The Firestore side of initializing a real academy's canonical directory.
 *
 * Everything is re-read inside the transaction, so a concurrent initializer cannot slip between the
 * check and the write, and every write is `create`, so this can never overwrite a directory that
 * already exists. The audit event goes in the same transaction: an initialization that left no
 * trace would be exactly the kind of unattributable act the directory's whole integrity model is
 * built to prevent.
 */
export function createCanonicalDirectoryInitializationFirestoreStore(
  firestore: Firestore = getFirestore(),
): CanonicalDirectoryInitializationStore {
  return Object.freeze({
    async initializeAtomically({ documents, actorId, auditAction }) {
      const { academyId } = documents;
      const stateReference = firestore.doc(statePath(academyId));
      const guardReference = firestore.doc(guardPath(academyId));
      const eventReference = firestore.doc(guardEventPath(academyId));
      const eventQuery = firestore.collection(guardEventsCollectionPath(academyId)).limit(1);
      const emptyQueries = canonicalDirectoryRequiredEmptyCollections.map((collection) =>
        firestore.collection(`academies/${academyId}/${collection}`).limit(1),
      );
      const auditReference = firestore.collection(`academies/${academyId}/auditEvents`).doc();

      return firestore.runTransaction(async (transaction) => {
        const [stateSnapshot, guardSnapshot, eventSnapshot, ...emptySnapshots] = await Promise.all([
          transaction.get(stateReference),
          transaction.get(guardReference),
          transaction.get(eventQuery),
          ...emptyQueries.map(async (query) => transaction.get(query)),
        ]);

        // A second click is not an incident. If the state is already there the directory works, and
        // saying so is more useful than an error that sends somebody looking for a problem.
        if (stateSnapshot.exists) {
          return Object.freeze({ alreadyInitialized: true });
        }
        if (guardSnapshot.exists || !eventSnapshot.empty) {
          throw new CanonicalDirectoryInitializationError(
            "not-empty",
            "Member directory restore guard already exists without its state",
          );
        }
        if (emptySnapshots.length !== emptyQueries.length) {
          throw new CanonicalDirectoryInitializationError(
            "unavailable",
            "Member directory emptiness could not be established",
          );
        }
        const occupied = canonicalDirectoryRequiredEmptyCollections.filter(
          (_collection, index) => emptySnapshots[index]?.empty !== true,
        );
        if (occupied.length > 0) {
          // The names travel in the message on purpose: whoever runs this needs to know which
          // collection stopped it, because a non-empty directory is a migration, not an
          // initialization, and the two must never be confused.
          throw new CanonicalDirectoryInitializationError(
            "not-empty",
            `Member directory is not empty: ${occupied.join(", ")}`,
          );
        }

        appendAuditEventInTransaction(transaction, auditReference, {
          academyId,
          actorId,
          action: auditAction,
          targetRef: statePath(academyId),
          purpose: "canonical member directory initialization",
          correlationId: `${actorId}:${academyId}:${auditReference.id}`,
        } as unknown as AuditEventDraft);
        transaction.create(stateReference, documents.state);
        transaction.create(guardReference, documents.guard);
        transaction.create(eventReference, documents.event);
        return Object.freeze({ alreadyInitialized: false });
      });
    },
  });
}
