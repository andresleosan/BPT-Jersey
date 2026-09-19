import type { Firestore } from "firebase-admin/firestore";

import type { BookingFirestore } from "./booking-transaction-service.js";
import type { QuorumSweepStore } from "./quorum-sweep-job.js";
import { createQuorumSweepService } from "./quorum-sweep-service.js";
import { createWeeklySessionStore } from "./weekly-session-service.js";

export function createFirestoreQuorumSweepStore(firestore: Firestore): QuorumSweepStore {
  const service = createQuorumSweepService({ firestore: firestore as unknown as BookingFirestore });
  return {
    async materialise(window, onFailure) {
      const weekly = createWeeklySessionStore(firestore);
      const academies = new Set<string>();
      const query = firestore.collectionGroup("sessionSeries").limit(200);
      let page = await query.get();
      while (!page.empty) {
        for (const document of page.docs) {
          const parts = document.ref.path.split("/");
          if (parts.length !== 4 || parts[0] !== "academies") continue;
          const academyId = parts[1]!;
          if (academies.has(academyId)) continue;
          // Reuse the calendar's transactional materialisation; it preserves cancellations and
          // re-reads series revisions so a concurrent office edit cannot resurrect an occurrence.
          academies.add(academyId);
          try {
            await weekly.materialise(academyId, window, (error) =>
              onFailure(error, "materialise-series"),
            );
          } catch (error) {
            onFailure(error, "materialise-academy");
          }
        }
        if (page.size < 200) break;
        page = await query.startAfter(page.docs.at(-1)!).get();
      }
    },
    async listPage({ from, to, limit, cursor }) {
      // Single-field collection-group index is declared in firestore.indexes.json.
      // Widen the upper second to include stored ISO strings without milliseconds; the pure
      // decision still enforces the exact cutoff using Date.parse, including sub-second values.
      let query = firestore
        .collectionGroup("sessions")
        .where("startAt", ">=", from)
        .where("startAt", "<=", to.replace(/\.\d{3}Z$/u, "Z"))
        .orderBy("startAt")
        .limit(limit);
      if (cursor !== null) query = query.startAfter(cursor);
      const page = await query.get();
      const sessions = page.docs.flatMap((doc) => {
        const parts = doc.ref.path.split("/");
        if (parts.length !== 4 || parts[0] !== "academies" || doc.get("status") !== "scheduled")
          return [];
        // Derive tenant and session identity from the path, never from untrusted document fields.
        // The transaction validates the stored bindings again before writing.
        return [{ academyId: parts[1]!, sessionId: doc.id }];
      });
      return { sessions, nextCursor: page.size === limit ? page.docs.at(-1)! : null };
    },
    reconcile: (session, now) =>
      service.reconcileSessionQuorum({
        ...session,
        now,
        actorId: "system:quorum-sweep",
      }),
  };
}
