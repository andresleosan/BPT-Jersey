import { describe, expect, it, vi } from "vitest";

import { sweepSessionQuorums, type QuorumSweepStore } from "./quorum-sweep-job";

const now = "2026-09-19T17:00:00.000Z";
const candidate = { academyId: "academy-1", sessionId: "session-1" };

function fixture() {
  const cancelled = new Set<string>();
  const reconcile = vi.fn<QuorumSweepStore["reconcile"]>(async (session) => {
    const replay = cancelled.has(session.sessionId);
    cancelled.add(session.sessionId);
    return {
      outcome: replay ? "alreadyCancelledForQuorum" : "cancelled",
      releasedBookings: replay ? 0 : 2,
    };
  });
  const listPage = vi.fn<QuorumSweepStore["listPage"]>().mockResolvedValue({
    sessions: [candidate],
    nextCursor: null,
  });
  return {
    listPage,
    reconcile,
    materialise: vi.fn<QuorumSweepStore["materialise"]>().mockResolvedValue(undefined),
  };
}

describe("scheduled quorum sweep orchestration", () => {
  it("uses a fixed one-hour horizon and the existing runner's one-day catch-up window", async () => {
    const store = fixture();
    expect(await sweepSessionQuorums(store, now)).toEqual({
      correlationId: expect.any(String),
      failures: [],
      evaluatedSessions: 1,
      cancelledSessions: 1,
      releasedBookings: 2,
      failedSessions: 0,
      failedMaterialisations: 0,
    });
    expect(store.listPage).toHaveBeenCalledWith({
      from: "2026-09-18T17:00:00.000Z",
      to: "2026-09-19T18:00:00.000Z",
      limit: 200,
      cursor: null,
    });
    expect(store.reconcile).toHaveBeenCalledWith(candidate, now);
    expect(store.materialise).toHaveBeenCalledWith(
      {
        from: "2026-09-18T17:00:00.000Z",
        to: "2026-09-19T18:00:00.000Z",
      },
      expect.any(Function),
    );
  });

  it("paginates even when a full page contains no scheduled sessions", async () => {
    const store = fixture();
    store.listPage
      .mockReset()
      .mockResolvedValueOnce({ sessions: [], nextCursor: "page-1" })
      .mockResolvedValueOnce({ sessions: [candidate], nextCursor: null });
    await sweepSessionQuorums(store, now);
    expect(store.listPage).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ cursor: "page-1" }),
    );
    expect(store.reconcile).toHaveBeenCalledTimes(1);
  });

  it("a repeat does not count previous cancellations or releases again", async () => {
    const store = fixture();
    await sweepSessionQuorums(store, now);
    expect(await sweepSessionQuorums(store, now)).toEqual({
      correlationId: expect.any(String),
      failures: [],
      evaluatedSessions: 1,
      cancelledSessions: 0,
      releasedBookings: 0,
      failedSessions: 0,
      failedMaterialisations: 0,
    });
  });

  it("continues after a transaction failure and returns safe diagnostics", async () => {
    const store = fixture();
    store.listPage.mockResolvedValue({
      sessions: [candidate, { ...candidate, sessionId: "session-2" }],
      nextCursor: null,
    });
    store.reconcile.mockRejectedValueOnce(
      Object.assign(new Error("private member data"), { code: 10 }),
    );
    expect(await sweepSessionQuorums(store, now)).toEqual({
      correlationId: expect.any(String),
      failures: [{ stage: "reconcile", code: "aborted", retryable: true }],
      evaluatedSessions: 2,
      cancelledSessions: 1,
      releasedBookings: 2,
      failedSessions: 1,
      failedMaterialisations: 0,
    });
    expect(store.reconcile).toHaveBeenCalledTimes(2);
  });

  it("returns a safe classified listing failure with a run correlation id", async () => {
    const store = fixture();
    store.listPage.mockRejectedValueOnce(
      Object.assign(new Error("private SDK index URL"), { code: 9 }),
    );
    const report = await sweepSessionQuorums(store, now);
    expect(report).toEqual({
      correlationId: expect.stringMatching(/^[0-9a-f-]{36}$/u),
      evaluatedSessions: 0,
      cancelledSessions: 0,
      releasedBookings: 0,
      failedSessions: 0,
      failedMaterialisations: 0,
      failures: [{ stage: "list-candidates", code: "failed-precondition", retryable: false }],
    });
  });

  it("continues sweeping existing candidates after a failed materialisation", async () => {
    const store = fixture();
    store.materialise.mockRejectedValueOnce(
      Object.assign(new Error("private SDK data"), { code: 7 }),
    );
    expect(await sweepSessionQuorums(store, now)).toMatchObject({
      cancelledSessions: 1,
      failedMaterialisations: 1,
      failures: [{ stage: "materialise", code: "permission-denied", retryable: false }],
    });
    expect(store.listPage).toHaveBeenCalled();
  });

  it("rejects an invalid clock before accessing the store", async () => {
    const store = fixture();
    await expect(sweepSessionQuorums(store, "invalid")).rejects.toThrow();
    expect(store.listPage).not.toHaveBeenCalled();
  });
});
