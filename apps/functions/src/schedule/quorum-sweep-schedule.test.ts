import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ sweep: vi.fn(), info: vi.fn(), error: vi.fn() }));
vi.mock("firebase-admin/firestore", () => ({ getFirestore: () => ({}) }));
vi.mock("firebase-functions/logger", () => ({ info: mocks.info, error: mocks.error }));
vi.mock("./quorum-sweep-firestore", () => ({ createFirestoreQuorumSweepStore: () => ({}) }));
vi.mock("./quorum-sweep-job", () => ({ sweepSessionQuorums: mocks.sweep }));

import { sweepSessionQuorumsSchedule } from "./quorum-sweep-schedule";

const report = {
  evaluatedSessions: 2,
  cancelledSessions: 1,
  releasedBookings: 2,
  failedSessions: 0,
};

describe("quorum schedule entry point", () => {
  beforeEach(() => vi.clearAllMocks());

  it("exports a v2 minute schedule with UTC, bounded concurrency and retries", () => {
    expect(sweepSessionQuorumsSchedule.__endpoint).toMatchObject({
      platform: "gcfv2",
      region: ["us-central1"],
      maxInstances: 1,
      concurrency: 1,
      scheduleTrigger: {
        schedule: "every 1 minutes",
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

  it.each([
    report,
    { evaluatedSessions: 0, cancelledSessions: 0, releasedBookings: 0, failedSessions: 0 },
  ])("logs an empty or successful run using counts only: %j", async (summary) => {
    mocks.sweep.mockResolvedValue(summary);
    await sweepSessionQuorumsSchedule.run({ scheduleTime: "2026-09-19T17:00:00Z" });
    expect(mocks.info).toHaveBeenCalledWith("session-quorum-sweep", summary);
  });

  it("fails partial runs for retry without logging sensitive errors", async () => {
    mocks.sweep.mockResolvedValue({ ...report, failedSessions: 1 });
    await expect(
      sweepSessionQuorumsSchedule.run({ scheduleTime: "2026-09-19T17:00:00Z" }),
    ).rejects.toThrow("Session quorum sweep failed");
    expect(mocks.error).toHaveBeenCalledWith("session-quorum-sweep-failed");
  });

  it("replaces adapter errors with a constant error safe for platform logs", async () => {
    mocks.sweep.mockRejectedValue(new Error("private member data"));
    await expect(
      sweepSessionQuorumsSchedule.run({ scheduleTime: "2026-09-19T17:00:00Z" }),
    ).rejects.toThrow(/^Session quorum sweep failed$/u);
    expect(mocks.error).toHaveBeenCalledWith("session-quorum-sweep-failed");
    expect(mocks.info).not.toHaveBeenCalled();
  });
});
