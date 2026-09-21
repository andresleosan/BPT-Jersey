#!/usr/bin/env node

import { createHash } from "node:crypto";
import { createRequire } from "node:module";

import { assertLevelSeedTargetEnvironment } from "./level-seed-target.mjs";

class CliError extends Error {}

const allowed = new Set([
  "target",
  "academy-id",
  "operation-id",
  "generated-at",
  "apply",
  "confirmation",
  "target-confirmation",
  "actor-id",
]);

function parseArguments(values) {
  const options = Object.create(null);
  for (const argument of values) {
    if (!argument.startsWith("--")) throw new CliError("Invalid migration arguments.");
    const option = argument.slice(2);
    if (option === "apply") {
      if (options.apply === true) throw new CliError("Duplicate --apply.");
      options.apply = true;
      continue;
    }
    const separator = option.indexOf("=");
    if (separator < 1 || separator !== option.lastIndexOf("=")) {
      throw new CliError("Invalid migration arguments.");
    }
    const key = option.slice(0, separator);
    const value = option.slice(separator + 1);
    if (!allowed.has(key) || value.length === 0 || Object.hasOwn(options, key)) {
      throw new CliError("Invalid migration arguments.");
    }
    options[key] = value;
  }
  return options;
}

function required(options, name) {
  const value = options[name];
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value)) {
    throw new CliError(`Missing or invalid --${name}.`);
  }
  return value;
}

function maskStudentId(studentId) {
  if (studentId === null) return null;
  return `student-${createHash("sha256").update(studentId).digest("hex").slice(0, 12)}`;
}

function safeRows(rows) {
  return rows.map((row) => ({
    student: maskStudentId(row.studentId),
    status: row.status,
    ...(row.reason === undefined ? {} : { reason: row.reason }),
  }));
}

function assertApplyConfirmation(target, value) {
  const expected =
    target === "production"
      ? "T091-LEVEL-PROGRESS-V3-PRODUCTION-APPLY"
      : target === "staging"
        ? "T091-LEVEL-PROGRESS-V3-STAGING-APPLY"
        : undefined;
  if (expected !== undefined && value !== expected) {
    throw new CliError(`Confirmation required for ${target}: ${expected}`);
  }
}

let initializedApp;
let deleteInitializedApp;
try {
  const options = parseArguments(process.argv.slice(2));
  const target = required(options, "target");
  const academyId = required(options, "academy-id");
  const operationId = options["operation-id"] ?? "level-progress-v3";
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(operationId)) {
    throw new CliError("Invalid --operation-id.");
  }
  const generatedAt = options["generated-at"] ?? new Date().toISOString();
  if (
    Number.isNaN(Date.parse(generatedAt)) ||
    new Date(generatedAt).toISOString() !== generatedAt
  ) {
    throw new CliError("Invalid --generated-at.");
  }
  const initialEnvironment = {
    gcloudProjectId: process.env.GCLOUD_PROJECT,
    firebaseConfig: process.env.FIREBASE_CONFIG,
    firestoreEmulatorHost: process.env.FIRESTORE_EMULATOR_HOST,
    nodeEnvironment: process.env.NODE_ENV,
  };
  const binding = assertLevelSeedTargetEnvironment(target, initialEnvironment);
  let actorId;
  if (options.apply === true) {
    actorId = required(options, "actor-id");
    assertApplyConfirmation(target, options["target-confirmation"]);
  }

  const artifactRequire = createRequire(
    new URL(
      "../../../.firebase-functions/lib/src/levels/level-progress-migration.js",
      import.meta.url,
    ),
  );
  const firebaseApp = artifactRequire("firebase-admin/app");
  const existingApp = firebaseApp.getApps()[0];
  const environment = {
    ...initialEnvironment,
    existingAppPresent: existingApp !== undefined,
    existingAppProjectId: existingApp?.options.projectId,
  };
  const verified = assertLevelSeedTargetEnvironment(target, environment);
  if (verified.projectId !== binding.projectId) throw new CliError("Migration target changed.");
  initializedApp = existingApp ?? firebaseApp.initializeApp({ projectId: binding.projectId });
  if (existingApp === undefined) deleteInitializedApp = () => firebaseApp.deleteApp(initializedApp);
  const firebaseFirestore = artifactRequire("firebase-admin/firestore");
  const [levelService, levelSeed, migration] = await Promise.all([
    import("../../../.firebase-functions/lib/src/levels/level-service.js"),
    import("../../../.firebase-functions/lib/src/levels/level-seed.js"),
    import("../../../.firebase-functions/lib/src/levels/level-progress-migration.js"),
  ]);
  const v3 = levelSeed.loadApprovedLevelCatalog({ systemId: "ibjjf-v3" });
  const store = levelService.createLevelProgressMigrationStore(
    firebaseFirestore.getFirestore(initializedApp),
    v3.definitions.map(({ definitionKey }) => definitionKey),
  );
  const plan = await migration.planLevelProgressMigration(store, {
    academyId,
    operationId,
    generatedAt,
  });
  const identity = { academyId, operationId, contentHash: plan.contentHash };
  const exactConfirmation = migration.expectedLevelProgressMigrationConfirmation(identity);

  if (options.apply !== true) {
    process.stdout.write(
      `${JSON.stringify(
        {
          mode: "dry-run",
          target,
          academyId,
          operationId,
          generatedAt,
          contentHash: plan.contentHash,
          exactConfirmation,
          rows: safeRows(plan.rows),
        },
        null,
        2,
      )}\n`,
    );
  } else {
    if (options.confirmation !== exactConfirmation) {
      throw new CliError("The exact dry-run confirmation is required for --apply.");
    }
    const result = await migration.applyLevelProgressMigration(store, plan, {
      ...identity,
      confirmation: options.confirmation,
      actorId,
      appliedAt: generatedAt,
    });
    process.stdout.write(
      `${JSON.stringify(
        {
          mode: "apply",
          target,
          academyId,
          operationId,
          contentHash: result.contentHash,
          rows: safeRows(result.rows),
        },
        null,
        2,
      )}\n`,
    );
  }
} catch (error) {
  process.stderr.write(
    `${error instanceof CliError ? error.message : "Level progress migration failed."}\n`,
  );
  process.exitCode = 1;
} finally {
  if (deleteInitializedApp !== undefined) await deleteInitializedApp();
}
