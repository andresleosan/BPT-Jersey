import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

import { createFirestoreScheduleStore } from "./schedule-service.js";
import type { SessionQuorumSweepResult } from "./quorum-sweep-service.js";

/**
 * T110 manual runner: applies the quorum rule to every session whose booking cutoff has just passed.
 *
 * Deliberately NOT exported from `index.ts` and deliberately not a scheduled function. BRIEF
 * decision 3 asks for an idempotent task, and the task is implemented and idempotent; enabling it
 * automatically in production is a separate operator checkpoint, exactly as recorded for the T062
 * producer. The runner refuses to touch anything but the demo Firestore Emulator.
 */
const demoProjectId = "demo-bpt-jersey";
const demoFirestoreEmulatorHost = "127.0.0.1:8080";
const academyIdPattern = /^[a-z][a-z0-9-]{2,60}$/u;
const optionNames = Object.freeze(["--academy-id", "--window-hours", "--actor-id"] as const);
type RunnerOption = (typeof optionNames)[number];

export type QuorumSweepRunnerInput = Readonly<{
  academyId: string;
  windowHours: number;
  actorId: string;
}>;

export type QuorumSweepRunnerEnvironment = Readonly<
  Partial<Pick<NodeJS.ProcessEnv, "GCLOUD_PROJECT" | "FIRESTORE_EMULATOR_HOST">>
>;

export type QuorumSweepRunnerReport = Readonly<{
  academyId: string;
  windowHours: number;
  evaluatedSessions: number;
  cancelledSessions: number;
  releasedBookings: number;
  outcomes: Readonly<Record<string, number>>;
}>;

export function parseQuorumSweepRunnerArgs(argv: readonly string[]): QuorumSweepRunnerInput {
  const values = new Map<RunnerOption, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const option = argv[index];
    const value = argv[index + 1];
    if (!optionNames.includes(option as RunnerOption)) {
      throw new Error("Unknown runner option");
    }
    if (value === undefined || value.startsWith("--")) {
      throw new Error("Missing value for " + option);
    }
    if (values.has(option as RunnerOption)) {
      throw new Error("Duplicate runner option");
    }
    values.set(option as RunnerOption, value);
  }
  if (values.size !== optionNames.length) {
    throw new Error("All runner options are required");
  }

  const academyId = values.get("--academy-id")!;
  const actorId = values.get("--actor-id")!;
  const windowHours = values.get("--window-hours")!;
  if (!academyIdPattern.test(academyId)) {
    throw new Error("Invalid value for --academy-id");
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(actorId)) {
    throw new Error("Invalid value for --actor-id");
  }
  if (!/^\d{1,3}$/u.test(windowHours) || Number(windowHours) < 1 || Number(windowHours) > 168) {
    throw new Error("Invalid value for --window-hours");
  }

  return Object.freeze({ academyId, actorId, windowHours: Number(windowHours) });
}

export function assertQuorumSweepRunnerEnvironment(
  environment: QuorumSweepRunnerEnvironment,
): void {
  if (
    environment.GCLOUD_PROJECT?.trim() !== demoProjectId ||
    environment.FIRESTORE_EMULATOR_HOST?.trim() !== demoFirestoreEmulatorHost
  ) {
    throw new Error(
      "Quorum sweep runner requires the demo Firestore Emulator at " + demoFirestoreEmulatorHost,
    );
  }
}

export function summariseQuorumSweep(
  input: Readonly<{ academyId: string; windowHours: number }>,
  results: readonly SessionQuorumSweepResult[],
): QuorumSweepRunnerReport {
  const outcomes: Record<string, number> = {};
  for (const result of results) {
    outcomes[result.outcome] = (outcomes[result.outcome] ?? 0) + 1;
  }
  return Object.freeze({
    academyId: input.academyId,
    windowHours: input.windowHours,
    evaluatedSessions: results.length,
    cancelledSessions: results.filter((result) => result.outcome === "cancelled").length,
    releasedBookings: results.reduce((total, result) => total + result.releasedBookings, 0),
    outcomes: Object.freeze(outcomes),
  });
}

export async function runQuorumSweep(
  argv: readonly string[],
  environment: QuorumSweepRunnerEnvironment,
): Promise<QuorumSweepRunnerReport> {
  const input = parseQuorumSweepRunnerArgs(argv);
  assertQuorumSweepRunnerEnvironment(environment);
  const app = initializeApp({ projectId: demoProjectId }, "t110-quorum-sweep-runner");
  try {
    const firestore = getFirestore(app);
    const store = createFirestoreScheduleStore({
      firestore: firestore as unknown as Parameters<
        typeof createFirestoreScheduleStore
      >[0]["firestore"],
    });
    const now = new Date();
    // Sessions from a day back (a sweep may run late) to the end of the window; each one decides
    // for itself whether its cutoff has passed.
    const sessions = await store.listSessions(input.academyId, {
      from: new Date(now.getTime() - 86_400_000).toISOString(),
      to: new Date(now.getTime() + input.windowHours * 3_600_000).toISOString(),
    });
    const results: SessionQuorumSweepResult[] = [];
    for (const session of sessions) {
      results.push(
        await store.reconcileSessionQuorum(input.academyId, session.sessionId, input.actorId),
      );
    }
    return summariseQuorumSweep(input, results);
  } finally {
    await deleteApp(app);
  }
}
