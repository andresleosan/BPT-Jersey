#!/usr/bin/env node

import { createRequire } from "node:module";

import { assertLevelSeedTargetEnvironment } from "./level-seed-target.mjs";

class CliError extends Error {}

const allowed = new Set([
  "target",
  "academy-id",
  "generated-at",
  "apply",
  "confirmation",
  "target-confirmation",
  "actor-id",
]);
const identifier = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

function parseArguments(values) {
  const options = Object.create(null);
  for (const argument of values) {
    if (!argument.startsWith("--")) throw new CliError("Invalid alignment arguments.");
    const option = argument.slice(2);
    if (option === "apply") {
      if (options.apply === true) throw new CliError("Duplicate --apply.");
      options.apply = true;
      continue;
    }
    const separator = option.indexOf("=");
    if (separator < 1) throw new CliError("Invalid alignment arguments.");
    const key = option.slice(0, separator);
    const value = option.slice(separator + 1);
    if (!allowed.has(key) || value.length === 0 || Object.hasOwn(options, key)) {
      throw new CliError("Invalid alignment arguments.");
    }
    options[key] = value;
  }
  return options;
}

function required(options, name) {
  const value = options[name];
  if (typeof value !== "string" || !identifier.test(value)) {
    throw new CliError(`Missing or invalid --${name}.`);
  }
  return value;
}

let deleteInitializedApp;
try {
  const options = parseArguments(process.argv.slice(2));
  const target = required(options, "target");
  const academyId = required(options, "academy-id");
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
    if (
      target === "production" &&
      options["target-confirmation"] !== "LEVELS-PDF-ALIGN-PRODUCTION-APPLY"
    ) {
      throw new CliError("Confirmation required for production: LEVELS-PDF-ALIGN-PRODUCTION-APPLY");
    }
  }

  const modulePath = "../../../.firebase-functions/lib/src/levels/level-catalog-pdf-alignment.js";
  const artifactRequire = createRequire(new URL(modulePath, import.meta.url));
  const firebaseApp = artifactRequire("firebase-admin/app");
  const existingApp = firebaseApp.getApps()[0];
  const verified = assertLevelSeedTargetEnvironment(target, {
    ...initialEnvironment,
    existingAppPresent: existingApp !== undefined,
    existingAppProjectId: existingApp?.options.projectId,
  });
  if (verified.projectId !== binding.projectId) throw new CliError("Alignment target changed.");
  const app = existingApp ?? firebaseApp.initializeApp({ projectId: binding.projectId });
  if (existingApp === undefined) deleteInitializedApp = () => firebaseApp.deleteApp(app);
  const firestore = artifactRequire("firebase-admin/firestore").getFirestore(app);
  const alignment = await import(modulePath);

  const plan = await alignment.planPdfAlignment(firestore, { academyId, generatedAt });
  const exactConfirmation = alignment.expectedAlignmentConfirmation(plan);
  if (options.apply !== true) {
    process.stdout.write(
      `${JSON.stringify(
        {
          mode: "dry-run",
          target,
          academyId,
          generatedAt,
          status: plan.status,
          systemId: plan.systemId,
          updates: plan.updates.length,
          deletes: plan.deletes.length,
          headMoves: plan.headMoves.length,
          blockers: plan.blockers,
          summary: plan.summary,
          exactConfirmation,
        },
        null,
        2,
      )}\n`,
    );
  } else {
    const result = await alignment.applyPdfAlignment(firestore, plan, {
      actorId,
      confirmation: options.confirmation,
    });
    process.stdout.write(
      `${JSON.stringify({ mode: "apply", target, academyId, ...result }, null, 2)}\n`,
    );
  }
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.message : "Level catalogue PDF alignment failed."}\n`,
  );
  if (process.env.BPT_OPERATOR_DEBUG === "1") console.error(error);
  process.exitCode = 1;
} finally {
  if (deleteInitializedApp !== undefined) await deleteInitializedApp();
}
