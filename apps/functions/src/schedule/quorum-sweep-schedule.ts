import { randomUUID } from "node:crypto";
import { getFirestore } from "firebase-admin/firestore";
import * as logger from "firebase-functions/logger";
import { onSchedule } from "firebase-functions/v2/scheduler";

import { classifyQuorumSweepFailure } from "./quorum-sweep-diagnostics.js";
import { createFirestoreQuorumSweepStore } from "./quorum-sweep-firestore.js";
import { sweepSessionQuorums } from "./quorum-sweep-job.js";

export const sweepSessionQuorumsSchedule = onSchedule(
  {
    schedule: "every 5 minutes",
    timeZone: "UTC",
    maxInstances: 1,
    concurrency: 1,
    timeoutSeconds: 540,
    retryCount: 3,
  },
  async () => {
    const correlationId = randomUUID();
    let report;
    try {
      report = await sweepSessionQuorums(
        createFirestoreQuorumSweepStore(getFirestore()),
        new Date().toISOString(),
        correlationId,
      );
    } catch (error) {
      // SDK errors can contain document data or paths; never pass them to platform logs.
      logger.error("session-quorum-sweep-failed", {
        correlationId,
        failures: [classifyQuorumSweepFailure(error, "initialise")],
      });
      throw new Error("Session quorum sweep failed");
    }
    logger.info("session-quorum-sweep", report);
    if (report.failures.length > 0) {
      logger.error("session-quorum-sweep-failed", report);
      throw new Error("Session quorum sweep failed");
    }
  },
);
