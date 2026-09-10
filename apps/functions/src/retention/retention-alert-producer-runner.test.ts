import { describe, expect, it } from "vitest";

import {
  assertRetentionRunnerEnvironment,
  parseRetentionRunnerArgs,
} from "./retention-alert-producer-runner";

describe("retention alert producer runner", () => {
  it("parses the complete explicit synthetic policy", () => {
    expect(
      parseRetentionRunnerArgs([
        "--academy-id",
        "synthetic-academy",
        "--run-date",
        "2026-09-01",
        "--inactivity-days",
        "14",
        "--lookback-days",
        "30",
        "--no-show-threshold",
        "2",
        "--membership-expiry-days",
        "14",
      ]),
    ).toEqual({
      academyId: "synthetic-academy",
      runDate: "2026-09-01",
      policy: {
        inactivityDays: 14,
        lookbackDays: 30,
        noShowThreshold: 2,
        membershipExpiryDays: 14,
      },
    });
  });

  it("rejects missing policy values and unknown flags", () => {
    expect(() => parseRetentionRunnerArgs(["--academy-id", "synthetic-academy"])).toThrow(
      "All runner options are required",
    );
    expect(() =>
      parseRetentionRunnerArgs([
        "--academy-id",
        "synthetic-academy",
        "--run-date",
        "2026-09-01",
        "--inactivity-days",
        "14",
        "--lookback-days",
        "30",
        "--no-show-threshold",
        "2",
        "--membership-expiry-days",
        "14",
        "--secret",
        "nope",
      ]),
    ).toThrow("Unknown runner option");
  });

  it("accepts only the explicit demo Firestore Emulator boundary", () => {
    expect(() =>
      assertRetentionRunnerEnvironment({
        GCLOUD_PROJECT: "demo-bpt-jersey",
        FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080",
      }),
    ).not.toThrow();
    expect(() =>
      assertRetentionRunnerEnvironment({
        GCLOUD_PROJECT: "demo-bpt-jersey",
        FIRESTORE_EMULATOR_HOST: "prod.example:443",
      }),
    ).toThrow("requires the demo Firestore Emulator");
    expect(() =>
      assertRetentionRunnerEnvironment({
        GCLOUD_PROJECT: "bpt-jersey-production",
        FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080",
      }),
    ).toThrow("requires the demo Firestore Emulator");
  });
});
