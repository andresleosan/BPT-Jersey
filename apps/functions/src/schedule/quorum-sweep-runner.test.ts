import { describe, expect, it } from "vitest";

import {
  assertQuorumSweepRunnerEnvironment,
  parseQuorumSweepRunnerArgs,
  summariseQuorumSweep,
} from "./quorum-sweep-runner";
import type { SessionQuorumSweepResult } from "./quorum-sweep-service";

const validArgs = [
  "--academy-id",
  "t110-academy",
  "--window-hours",
  "6",
  "--actor-id",
  "owner-1",
] as const;

function result(
  outcome: SessionQuorumSweepResult["outcome"],
  releasedBookings = 0,
): SessionQuorumSweepResult {
  return {
    sessionId: `session-${outcome}`,
    outcome,
    confirmedCount: 1,
    minParticipants: 4,
    cancels: outcome === "cancelled",
    releasedBookings,
  };
}

describe("quorum sweep runner (T110)", () => {
  it("requires every option, exactly once, with a usable value", () => {
    expect(parseQuorumSweepRunnerArgs(validArgs)).toEqual({
      academyId: "t110-academy",
      windowHours: 6,
      actorId: "owner-1",
    });

    for (const argv of [
      [],
      ["--academy-id", "t110-academy"],
      [...validArgs, "--academy-id", "t110-academy"],
      ["--academy-id", "T110", "--window-hours", "6", "--actor-id", "owner-1"],
      ["--academy-id", "t110-academy", "--window-hours", "0", "--actor-id", "owner-1"],
      ["--academy-id", "t110-academy", "--window-hours", "999", "--actor-id", "owner-1"],
      ["--academy-id", "t110-academy", "--window-hours", "6", "--actor-id", ""],
      ["--unknown", "x"],
      ["--academy-id", "--window-hours"],
    ]) {
      expect(() => parseQuorumSweepRunnerArgs(argv), argv.join(" ")).toThrow();
    }
  });

  it("refuses to run anywhere but the demo Firestore Emulator", () => {
    expect(() =>
      assertQuorumSweepRunnerEnvironment({
        GCLOUD_PROJECT: "demo-bpt-jersey",
        FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080",
      }),
    ).not.toThrow();

    for (const environment of [
      {},
      { GCLOUD_PROJECT: "bptjersey", FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080" },
      { GCLOUD_PROJECT: "demo-bpt-jersey" },
      { GCLOUD_PROJECT: "demo-bpt-jersey", FIRESTORE_EMULATOR_HOST: "firestore.googleapis.com" },
    ]) {
      expect(() => assertQuorumSweepRunnerEnvironment(environment)).toThrow();
    }
  });

  it("summarises what the sweep did, by outcome", () => {
    expect(
      summariseQuorumSweep({ academyId: "t110-academy", windowHours: 6 }, [
        result("cancelled", 2),
        result("cancelled", 1),
        result("quorumMet"),
        result("beforeCutoff"),
        result("alreadyCancelledForQuorum"),
      ]),
    ).toEqual({
      academyId: "t110-academy",
      windowHours: 6,
      evaluatedSessions: 5,
      cancelledSessions: 2,
      releasedBookings: 3,
      outcomes: {
        cancelled: 2,
        quorumMet: 1,
        beforeCutoff: 1,
        alreadyCancelledForQuorum: 1,
      },
    });
  });

  it("reports an empty window without inventing work", () => {
    expect(summariseQuorumSweep({ academyId: "t110-academy", windowHours: 1 }, [])).toMatchObject({
      evaluatedSessions: 0,
      cancelledSessions: 0,
      releasedBookings: 0,
      outcomes: {},
    });
  });
});
