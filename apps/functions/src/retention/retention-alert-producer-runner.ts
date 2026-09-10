import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import type { RetentionPolicy } from "@bpt-jersey/domain/retention";
import {
  createFirestoreRetentionSnapshotSource,
  createRetentionAlertProducer,
  type RetentionSourceFirestore,
} from "./retention-alert-producer.js";
import { createFirestoreRetentionAlertStore } from "./retention-alert-service.js";

const demoProjectId = "demo-bpt-jersey";
const demoFirestoreEmulatorHost = "127.0.0.1:8080";
const academyIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const calendarDatePattern = /^\d{4}-\d{2}-\d{2}$/u;
const optionNames = Object.freeze([
  "--academy-id",
  "--run-date",
  "--inactivity-days",
  "--lookback-days",
  "--no-show-threshold",
  "--membership-expiry-days",
] as const);

type RunnerOption = (typeof optionNames)[number];

export type RetentionRunnerInput = Readonly<{
  academyId: string;
  runDate: string;
  policy: RetentionPolicy;
}>;

export type RetentionRunnerEnvironment = Readonly<
  Partial<Pick<NodeJS.ProcessEnv, "GCLOUD_PROJECT" | "FIRESTORE_EMULATOR_HOST">>
>;

function isCalendarDate(value: string): boolean {
  if (!calendarDatePattern.test(value)) return false;
  const timestamp = Date.parse(value + "T00:00:00.000Z");
  return !Number.isNaN(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value;
}

function parseBoundedInteger(option: RunnerOption, value: string, maximum: number): number {
  if (value.length === 0 || value !== value.trim() || !/^\d+$/u.test(value)) {
    throw new Error("Invalid value for " + option);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw new Error("Invalid value for " + option);
  }
  return parsed;
}

export function parseRetentionRunnerArgs(argv: readonly string[]): RetentionRunnerInput {
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
  const runDate = values.get("--run-date")!;
  if (!academyIdPattern.test(academyId)) {
    throw new Error("Invalid value for --academy-id");
  }
  if (!isCalendarDate(runDate)) {
    throw new Error("Invalid value for --run-date");
  }

  return Object.freeze({
    academyId,
    runDate,
    policy: Object.freeze({
      inactivityDays: parseBoundedInteger(
        "--inactivity-days",
        values.get("--inactivity-days")!,
        365,
      ),
      lookbackDays: parseBoundedInteger("--lookback-days", values.get("--lookback-days")!, 365),
      noShowThreshold: parseBoundedInteger(
        "--no-show-threshold",
        values.get("--no-show-threshold")!,
        200,
      ),
      membershipExpiryDays: parseBoundedInteger(
        "--membership-expiry-days",
        values.get("--membership-expiry-days")!,
        365,
      ),
    }),
  });
}

export function assertRetentionRunnerEnvironment(environment: RetentionRunnerEnvironment): void {
  if (
    environment.GCLOUD_PROJECT?.trim() !== demoProjectId ||
    environment.FIRESTORE_EMULATOR_HOST?.trim() !== demoFirestoreEmulatorHost
  ) {
    throw new Error(
      "Retention producer runner requires the demo Firestore Emulator at " +
        demoFirestoreEmulatorHost,
    );
  }
}

export async function runRetentionAlertProducer(
  argv: readonly string[],
  environment: RetentionRunnerEnvironment,
) {
  const input = parseRetentionRunnerArgs(argv);
  assertRetentionRunnerEnvironment(environment);
  const app = initializeApp({ projectId: demoProjectId }, "t062-retention-producer-runner");
  try {
    const firestore = getFirestore(app);
    const source = createFirestoreRetentionSnapshotSource({
      firestore: firestore as unknown as RetentionSourceFirestore,
    });
    const store = createFirestoreRetentionAlertStore({
      firestore: firestore as unknown as Parameters<
        typeof createFirestoreRetentionAlertStore
      >[0]["firestore"],
    });
    return await createRetentionAlertProducer({ source, store }).produce(input);
  } finally {
    await deleteApp(app);
  }
}

const isMainModule =
  process.argv[1] !== undefined && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;

if (isMainModule) {
  runRetentionAlertProducer(process.argv.slice(2), process.env)
    .then((result) => {
      console.log(JSON.stringify({ emulator: demoFirestoreEmulatorHost, ...result }));
    })
    .catch((error: unknown) => {
      console.error(
        error instanceof Error && error.name === "Error"
          ? error.message
          : "Retention producer runner failed",
      );
      process.exitCode = 1;
    });
}
