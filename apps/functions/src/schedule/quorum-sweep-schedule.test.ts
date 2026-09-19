import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ sweep: vi.fn(), info: vi.fn(), error: vi.fn() }));
vi.mock("node:crypto", () => ({ randomUUID: () => "46f60a32-1d98-4a44-b6e9-83c5d347b282" }));
vi.mock("firebase-admin/firestore", () => ({ getFirestore: () => ({}) }));
vi.mock("firebase-functions/logger", () => ({ info: mocks.info, error: mocks.error }));
vi.mock("./quorum-sweep-firestore", () => ({ createFirestoreQuorumSweepStore: () => ({}) }));
vi.mock("./quorum-sweep-job", () => ({ sweepSessionQuorums: mocks.sweep }));

import { sweepSessionQuorumsSchedule } from "./quorum-sweep-schedule";

const report = {
  correlationId: "46f60a32-1d98-4a44-b6e9-83c5d347b282",
  failures: [],
  failedMaterialisations: 0,
  evaluatedSessions: 2,
  cancelledSessions: 1,
  releasedBookings: 2,
  failedSessions: 0,
};

describe("quorum schedule entry point", () => {
  beforeEach(() => vi.clearAllMocks());

  it("exports a v2 five-minute schedule with UTC, bounded concurrency and retries", () => {
    expect(sweepSessionQuorumsSchedule.__endpoint).toMatchObject({
      platform: "gcfv2",
      region: ["us-central1"],
      maxInstances: 1,
      concurrency: 1,
      scheduleTrigger: {
        schedule: "every 5 minutes",
        timeZone: "UTC",
        retryConfig: { retryCount: 3 },
      },
    });
    expect(readFileSync(new URL("../index.ts", import.meta.url), "utf8")).toContain(
      'export { sweepSessionQuorumsSchedule } from "./schedule/quorum-sweep-schedule.js";',
    );
  });

  it("declares the collection-group index required outside the emulator", () => {
    const indexes = JSON.parse(
      readFileSync(new URL("../../../../firestore.indexes.json", import.meta.url), "utf8"),
    );
    expect(indexes.fieldOverrides).toContainEqual(
      expect.objectContaining({
        collectionGroup: "sessions",
        fieldPath: "startAt",
        indexes: expect.arrayContaining([{ order: "ASCENDING", queryScope: "COLLECTION_GROUP" }]),
      }),
    );
  });

  it.each([report, { ...report, evaluatedSessions: 0, cancelledSessions: 0, releasedBookings: 0 }])(
    "logs an empty or successful run with safe diagnostics: %j",
    async (summary) => {
      mocks.sweep.mockResolvedValue(summary);
      await sweepSessionQuorumsSchedule.run({ scheduleTime: "2026-09-19T17:00:00Z" });
      expect(mocks.info).toHaveBeenCalledWith("session-quorum-sweep", summary);
      expect(mocks.sweep).toHaveBeenCalledWith({}, expect.any(String), report.correlationId);
    },
  );

  it.each([
    { failedSessions: 1, failures: [{ stage: "reconcile", code: "aborted", retryable: true }] },
    {
      failedMaterialisations: 1,
      failures: [{ stage: "materialise-series", code: "malformed-series", retryable: false }],
    },
    { failures: [{ stage: "list-candidates", code: "failed-precondition", retryable: false }] },
  ])("fails incomplete runs for retry with safe diagnostics: %j", async (failure) => {
    const summary = { ...report, ...failure };
    mocks.sweep.mockResolvedValue(summary);
    await expect(
      sweepSessionQuorumsSchedule.run({ scheduleTime: "2026-09-19T17:00:00Z" }),
    ).rejects.toThrow("Session quorum sweep failed");
    expect(mocks.error).toHaveBeenCalledWith("session-quorum-sweep-failed", summary);
  });

  it("replaces adapter errors with a constant error safe for platform logs", async () => {
    mocks.sweep.mockRejectedValue(new Error("private member data"));
    await expect(
      sweepSessionQuorumsSchedule.run({ scheduleTime: "2026-09-19T17:00:00Z" }),
    ).rejects.toThrow(/^Session quorum sweep failed$/u);
    expect(mocks.error).toHaveBeenCalledWith("session-quorum-sweep-failed", {
      correlationId: report.correlationId,
      failures: [{ stage: "initialise", code: "unknown", retryable: null }],
    });
    expect(mocks.info).not.toHaveBeenCalled();
  });
});
