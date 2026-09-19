import { randomUUID } from "node:crypto";

import {
  classifyQuorumSweepFailure,
  type QuorumSweepFailure,
  type QuorumSweepStage,
} from "./quorum-sweep-diagnostics.js";
import type { SessionQuorumSweepResult } from "./quorum-sweep-service.js";

export type QuorumSweepCandidate = Readonly<{ academyId: string; sessionId: string }>;
export type QuorumSweepStore = Readonly<{
  materialise: (
    window: Readonly<{ from: string; to: string }>,
    onFailure: (error: unknown, stage: "materialise-academy" | "materialise-series") => void,
  ) => Promise<void>;
  listPage: (
    input: Readonly<{ from: string; to: string; limit: number; cursor: unknown }>,
  ) => Promise<Readonly<{ sessions: readonly QuorumSweepCandidate[]; nextCursor: unknown }>>;
  reconcile: (
    session: QuorumSweepCandidate,
    now: string,
  ) => Promise<Pick<SessionQuorumSweepResult, "outcome" | "releasedBookings">>;
}>;

/** No SDK, clock or logging dependencies: the existing transaction owns all writes and audit. */
export async function sweepSessionQuorums(
  store: QuorumSweepStore,
  now: string,
  correlationId: string = randomUUID(),
) {
  const timestamp = Date.parse(now);
  if (!Number.isFinite(timestamp)) throw new Error("Invalid quorum sweep time");
  // Match the manual runner's trailing day for delayed runs; do not sweep all historical sessions.
  const from = new Date(timestamp - 86_400_000).toISOString();
  const to = new Date(timestamp + 3_600_000).toISOString();
  const report = {
    correlationId,
    failures: [] as QuorumSweepFailure[],
    evaluatedSessions: 0,
    cancelledSessions: 0,
    releasedBookings: 0,
    failedSessions: 0,
    failedMaterialisations: 0,
  };
  const onMaterialisationFailure = (error: unknown, stage: QuorumSweepStage = "materialise") => {
    report.failedMaterialisations += 1;
    report.failures.push(classifyQuorumSweepFailure(error, stage));
  };
  try {
    await store.materialise({ from, to }, onMaterialisationFailure);
  } catch (error) {
    onMaterialisationFailure(error);
  }
  let cursor: unknown = null;
  do {
    let page;
    try {
      page = await store.listPage({ from, to, limit: 200, cursor });
    } catch (error) {
      report.failures.push(classifyQuorumSweepFailure(error, "list-candidates"));
      break;
    }
    for (const session of page.sessions) {
      report.evaluatedSessions += 1;
      try {
        const result = await store.reconcile(session, now);
        if (result.outcome === "cancelled") report.cancelledSessions += 1;
        report.releasedBookings += result.releasedBookings;
      } catch (error) {
        report.failures.push(classifyQuorumSweepFailure(error, "reconcile"));
        // One malformed session must not starve the other academies; the entry point retries.
        report.failedSessions += 1;
      }
    }
    cursor = page.nextCursor;
  } while (cursor !== null);
  return Object.freeze(report);
}
