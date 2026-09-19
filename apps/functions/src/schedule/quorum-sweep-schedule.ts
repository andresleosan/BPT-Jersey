import { getFirestore } from "firebase-admin/firestore";
import * as logger from "firebase-functions/logger";
import { onSchedule } from "firebase-functions/v2/scheduler";

import { createFirestoreQuorumSweepStore } from "./quorum-sweep-firestore.js";
import { sweepSessionQuorums } from "./quorum-sweep-job.js";

export const sweepSessionQuorumsSchedule = onSchedule(
  {
    schedule: "every 1 minutes",
    timeZone: "UTC",
    region: "us-central1", // Same region as the existing schedules (SDK default).
    maxInstances: 1,
    concurrency: 1,
    timeoutSeconds: 540,
    retryCount: 3,
  },
  async () => {
    try {
      const report = await sweepSessionQuorums(
        createFirestoreQuorumSweepStore(getFirestore()),
        new Date().toISOString(),
      );
      logger.info("session-quorum-sweep", report);
      if (report.failedSessions > 0) throw new Error("Incomplete sweep");
    } catch {
      // SDK errors can contain document data or paths; never pass them to platform logs.
      logger.error("session-quorum-sweep-failed");
      throw new Error("Session quorum sweep failed");
    }
  },
);
