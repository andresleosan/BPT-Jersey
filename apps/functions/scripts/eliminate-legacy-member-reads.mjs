#!/usr/bin/env node

import { deleteApp, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

import {
  assertLegacyReadEliminationTarget,
  LegacyReadEliminationCliError as CliError,
  parseLegacyReadEliminationArguments,
} from "./legacy-read-elimination-target.mjs";

// T097 (ADR-009, Enmienda 2026-10-21). Dry run by default; --apply needs the dry run's exact
// confirmation and, in production, the separate production constant. Run from the deploy artifact.

function required(options, name) {
  const value = options[name];
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value)) {
    throw new CliError(`Missing or invalid --${name}.`);
  }
  return value;
}

let app;
try {
  const options = parseLegacyReadEliminationArguments(process.argv.slice(2));
  const projectId = required(options, "project");
  const academyId = required(options, "academy-id");
  const apply = options.apply === true;
  assertLegacyReadEliminationTarget({
    target: options.target,
    projectId,
    apply,
    productionConfirmation: options["production-confirmation"],
    environment: {
      gcloudProjectId: process.env.GCLOUD_PROJECT,
      googleCloudProjectId: process.env.GOOGLE_CLOUD_PROJECT,
      firebaseConfig: process.env.FIREBASE_CONFIG,
      firestoreEmulatorHost: process.env.FIRESTORE_EMULATOR_HOST,
    },
  });
  // Passed exactly as the functions pass defineSecret(...).value(), so the MACs match; never printed.
  const integritySecretMaterial = process.env.MEMBER_DIRECTORY_MIGRATION_INTEGRITY_SECRET;
  if (!integritySecretMaterial) {
    throw new CliError("MEMBER_DIRECTORY_MIGRATION_INTEGRITY_SECRET is required.");
  }
  let actorId;
  if (apply) {
    actorId = required(options, "actor-id");
    if (typeof options.confirmation !== "string") {
      throw new CliError("The exact dry-run confirmation is required for --apply.");
    }
  } else if (options.confirmation !== undefined || options["actor-id"] !== undefined) {
    throw new CliError("--confirmation and --actor-id are only for --apply.");
  }

  if (getApps().length !== 0) throw new CliError("Unexpected pre-existing Firebase Admin app.");
  app = initializeApp({ projectId }, "legacy-read-elimination");
  const service = await import("../lib/src/members/member-directory-global-elimination.js");
  const adapter =
    await import("../lib/src/members/member-directory-global-elimination-firestore.js");
  const store = adapter.createGlobalLegacyEliminationFirestoreStore(getFirestore(app));
  const binding = { projectId, academyId, integritySecretMaterial };

  const result = apply
    ? await service.applyGlobalLegacyElimination(store, {
        ...binding,
        confirmation: options.confirmation,
        actorId,
        now: new Date().toISOString(),
      })
    : await service.planGlobalLegacyEliminationDryRun(store, binding);
  process.stdout.write(
    `${JSON.stringify({ mode: apply ? "apply" : "dry-run", ...result }, null, 2)}\n`,
  );
} catch (error) {
  // Typed refusals carry ids, revisions and counts only, so the operator sees them as they are.
  const known = error instanceof CliError || error?.name === "GlobalLegacyEliminationError";
  process.stderr.write(`${known ? error.message : "Legacy-read elimination failed."}\n`);
  if (!known && process.env.BPT_OPERATOR_DEBUG === "1") {
    process.stderr.write(`cause: ${error?.code ?? ""} ${error?.message ?? error}\n`);
  }
  process.exitCode = 1;
} finally {
  if (app !== undefined) await deleteApp(app);
}
