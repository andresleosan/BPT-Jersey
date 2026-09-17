import { getFirestore, Timestamp, type Firestore } from "firebase-admin/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";

/**
 * Design promise (see the classes-services-history design doc, G5 / ADR-008 amendment): the IP
 * address on a class audit event is kept for twelve months and then cleared, while the event
 * itself stays in the ledger forever. This module is the enforcer of that promise - nothing
 * before it deleted anything (`apps/functions/src/retention/` only produces alerts).
 *
 * WARNING for whoever next stores an IP on a non-class audit action: this sweep does not filter
 * by `action`. It clears `actorIp` on EVERY audit event older than twelve months, across every
 * academy, regardless of what wrote it. Today that is harmless because only the four class
 * actions (`classAuditActions`) ever populate `actorIp` - but a new action that starts writing an
 * IP inherits this same twelve-month policy silently, with no separate decision. If that action
 * needs a different retention period, change this sweep (and the policy docs it points at:
 * `docs/operations/t011-retention-residency-erasure-policy.md`, `docs/adr/ADR-008-...`) rather than
 * assuming it is already covered.
 */

const batchSize = 400;

/** Opaque reference to one audit event document, produced and consumed only by the store. */
export type ClassIpRetentionEventRef = Readonly<{ path: string }>;

export type ClassIpRetentionCandidate = Readonly<{
  ref: ClassIpRetentionEventRef;
  actorIp: string | null;
}>;

/** Opaque pagination cursor; a store hands one back and takes it as-is on the next call. */
export type ClassIpRetentionCursor = unknown;

export type ClassIpRetentionPage = Readonly<{
  candidates: readonly ClassIpRetentionCandidate[];
  cursor: ClassIpRetentionCursor;
}>;

/**
 * The reads and writes the sweep needs. `listOlderThan` is not required to filter out events
 * whose IP is already cleared - the sweep does that itself, which is what makes a second run over
 * the same history safe (it finds nothing left to write).
 */
export type ClassIpRetentionStore = Readonly<{
  listOlderThan: (
    cutoff: string,
    limit: number,
    cursor: ClassIpRetentionCursor,
  ) => Promise<ClassIpRetentionPage>;
  clearActorIp: (refs: readonly ClassIpRetentionEventRef[]) => Promise<void>;
}>;

export type ClassIpRetentionSweepResult = Readonly<{ cleared: number }>;

function twelveMonthsBefore(now: string): string {
  const parsed = new Date(now);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("Class IP retention sweep requires a valid timestamp");
  }
  const cutoff = new Date(parsed.getTime());
  cutoff.setUTCMonth(cutoff.getUTCMonth() - 12);
  return cutoff.toISOString();
}

/**
 * Clears `actorIp` on every audit event (of any action, in any academy) whose `occurredAt` is
 * more than twelve months before `now`, leaving every other field - including the event itself -
 * untouched. See the module-level warning above: it does not check `action`. Runs in batches of
 * at most `batchSize` writes so a long history never breaks a single sweep, and is idempotent: an
 * event whose IP is already null is read but never rewritten, so a repeat run over the same
 * history clears nothing and writes nothing.
 */
export async function sweepClassIpRetention(
  store: ClassIpRetentionStore,
  now: string,
): Promise<ClassIpRetentionSweepResult> {
  const cutoff = twelveMonthsBefore(now);
  let cursor: ClassIpRetentionCursor = null;
  let cleared = 0;
  for (;;) {
    const page = await store.listOlderThan(cutoff, batchSize, cursor);
    const toClear = page.candidates
      .filter((candidate) => candidate.actorIp !== null)
      .map((candidate) => candidate.ref);
    if (toClear.length > 0) {
      await store.clearActorIp(toClear);
      cleared += toClear.length;
    }
    if (page.candidates.length < batchSize) break;
    cursor = page.cursor;
  }
  return Object.freeze({ cleared });
}

/**
 * The Firestore adapter reaches across every academy with a collection-group query on
 * `auditEvents`, ordered and filtered by `occurredAt` alone (a single-field index, already
 * enabled for collection-group queries the same way `memberDirectoryImportSessions` cleanup
 * relies on it - see `canonical-member-import-firestore.ts`). It does not also filter on
 * `actorIp`: Firestore cannot combine two inequality filters on different fields without a new
 * composite index, and the sweep's own actorIp check already makes the extra reads harmless.
 */
export function createFirestoreClassIpRetentionStore(firestore: Firestore): ClassIpRetentionStore {
  return {
    async listOlderThan(cutoff, limit, cursor) {
      let query = firestore
        .collectionGroup("auditEvents")
        .where("occurredAt", "<", Timestamp.fromDate(new Date(cutoff)))
        .orderBy("occurredAt", "asc")
        .limit(limit);
      if (cursor !== null && cursor !== undefined) {
        query = query.startAfter(cursor);
      }
      const snapshot = await query.get();
      const candidates = snapshot.docs.map((document) => {
        const data = document.data();
        const actorIp = typeof data.actorIp === "string" ? data.actorIp : null;
        return Object.freeze({ ref: Object.freeze({ path: document.ref.path }), actorIp });
      });
      const lastDocument = snapshot.docs[snapshot.docs.length - 1];
      return Object.freeze({
        candidates: Object.freeze(candidates),
        cursor: lastDocument ?? cursor,
      });
    },
    async clearActorIp(refs) {
      if (refs.length === 0) return;
      const batch = firestore.batch();
      for (const ref of refs) {
        batch.update(firestore.doc(ref.path), { actorIp: null });
      }
      await batch.commit();
    },
  };
}

export const sweepClassIpRetentionSchedule = onSchedule(
  { schedule: "every day 03:00", timeZone: "UTC" },
  async () => {
    const store = createFirestoreClassIpRetentionStore(getFirestore());
    const result = await sweepClassIpRetention(store, new Date().toISOString());
    // No personal data here - only a count, per LECCIONES.md's ban on logging personal data.
    console.log("class-ip-retention-sweep", { cleared: result.cleared });
  },
);
