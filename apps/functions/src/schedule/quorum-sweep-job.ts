import type { SessionQuorumSweepResult } from "./quorum-sweep-service.js";

export type QuorumSweepCandidate = Readonly<{ academyId: string; sessionId: string }>;
export type QuorumSweepStore = Readonly<{
  materialise: (window: Readonly<{ from: string; to: string }>) => Promise<void>;
  listPage: (
    input: Readonly<{ from: string; to: string; limit: number; cursor: unknown }>,
  ) => Promise<Readonly<{ sessions: readonly QuorumSweepCandidate[]; nextCursor: unknown }>>;
  reconcile: (
    session: QuorumSweepCandidate,
    now: string,
  ) => Promise<Pick<SessionQuorumSweepResult, "outcome" | "releasedBookings">>;
}>;

/** No SDK, clock or logging dependencies: the existing transaction owns all writes and audit. */
export async function sweepSessionQuorums(store: QuorumSweepStore, now: string) {
  const timestamp = Date.parse(now);
  if (!Number.isFinite(timestamp)) throw new Error("Invalid quorum sweep time");
  // Match the manual runner's trailing day for delayed runs; do not sweep all historical sessions.
  const from = new Date(timestamp - 86_400_000).toISOString();
  const to = new Date(timestamp + 3_600_000).toISOString();
  await store.materialise({ from, to });
  const report = {
    evaluatedSessions: 0,
    cancelledSessions: 0,
    releasedBookings: 0,
    failedSessions: 0,
  };
  let cursor: unknown = null;
  do {
    const page = await store.listPage({ from, to, limit: 200, cursor });
    for (const session of page.sessions) {
      report.evaluatedSessions += 1;
      try {
        const result = await store.reconcile(session, now);
        if (result.outcome === "cancelled") report.cancelledSessions += 1;
        report.releasedBookings += result.releasedBookings;
      } catch {
        // One malformed session must not starve the other academies; the entry point retries.
        report.failedSessions += 1;
      }
    }
    cursor = page.nextCursor;
  } while (cursor !== null);
  return Object.freeze(report);
}
