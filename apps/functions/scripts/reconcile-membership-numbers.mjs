#!/usr/bin/env node

import { deleteApp, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

import { assertMembershipNumberReconciliationTarget } from "./membership-number-reconciliation-target.mjs";

class CliError extends Error {}

function parseArguments(values) {
  const options = Object.create(null);
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === "--apply") {
      if (options.apply === true) throw new CliError("Duplicate --apply.");
      options.apply = true;
      continue;
    }
    if (!value.startsWith("--")) throw new CliError("Unexpected positional argument.");
    const separator = value.indexOf("=");
    if (separator > 2) {
      const name = value.slice(2, separator);
      const inline = value.slice(separator + 1);
      if (inline.length === 0) throw new CliError(`Missing value for --${name}.`);
      if (Object.hasOwn(options, name)) throw new CliError(`Duplicate --${name}.`);
      options[name] = inline;
      continue;
    }
    const name = value.slice(2);
    const next = values[index + 1];
    if (next === undefined || next.startsWith("--")) {
      throw new CliError(`Missing value for --${name}.`);
    }
    if (Object.hasOwn(options, name)) throw new CliError(`Duplicate --${name}.`);
    options[name] = next;
    index += 1;
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

function projectFromFirebaseConfig(value) {
  if (value === undefined) return undefined;
  try {
    const parsed = JSON.parse(value);
    return typeof parsed.projectId === "string" ? parsed.projectId : undefined;
  } catch {
    throw new CliError("FIREBASE_CONFIG is invalid.");
  }
}

function assertProjectBinding(projectId) {
  for (const bound of [
    process.env.GCLOUD_PROJECT,
    process.env.GOOGLE_CLOUD_PROJECT,
    projectFromFirebaseConfig(process.env.FIREBASE_CONFIG),
  ]) {
    if (bound !== undefined && bound !== projectId) {
      throw new CliError("The requested project does not match the process environment.");
    }
  }
  const emulatorConfigured = process.env.FIRESTORE_EMULATOR_HOST !== undefined;
  const emulatorProject = projectId.startsWith("demo-");
  if (emulatorConfigured !== emulatorProject) {
    throw new CliError("The project ID and Firestore emulator binding do not match.");
  }
}

function safePlanView(plan, operationId, expectedConfirmation) {
  const counts = Object.create(null);
  for (const row of plan.rows) counts[row.action] = (counts[row.action] ?? 0) + 1;
  return {
    mode: "dry-run",
    academyId: plan.academyId,
    operationId,
    generatedAt: plan.generatedAt,
    contentHash: plan.contentHash,
    expectedConfirmation,
    counts,
    rows: plan.rows.map(({ recordRef, action, currentMasked }) => ({
      recordRef,
      action,
      currentMasked,
    })),
  };
}

let app;
try {
  const options = parseArguments(process.argv.slice(2));
  const allowedOptions = new Set([
    "project",
    "target",
    "academy-id",
    "operation-id",
    "generated-at",
    "apply",
    "confirmation",
    "actor-id",
    "production-confirmation",
  ]);
  for (const name of Object.keys(options)) {
    if (!allowedOptions.has(name)) throw new CliError(`Unknown --${name}.`);
  }
  const projectId = required(options, "project");
  const target = options.target;
  if (target !== "emulator" && target !== "production") {
    throw new CliError("Missing or invalid --target.");
  }
  const academyId = required(options, "academy-id");
  const operationId = options["operation-id"] ?? "membership-number-reconciliation";
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(operationId)) {
    throw new CliError("Invalid --operation-id.");
  }
  const generatedAt = options["generated-at"] ?? new Date().toISOString();
  if (
    Number.isNaN(Date.parse(generatedAt)) ||
    new Date(generatedAt).toISOString() !== generatedAt
  ) {
    throw new CliError("Missing or invalid --generated-at.");
  }
  assertProjectBinding(projectId);
  assertMembershipNumberReconciliationTarget({
    target,
    projectId,
    apply: options.apply === true,
    productionConfirmation: options["production-confirmation"],
    environment: {
      gcloudProjectId: process.env.GCLOUD_PROJECT,
      googleCloudProjectId: process.env.GOOGLE_CLOUD_PROJECT,
      firebaseConfig: process.env.FIREBASE_CONFIG,
      firestoreEmulatorHost: process.env.FIRESTORE_EMULATOR_HOST,
    },
  });
  let applyActorId;
  if (options.apply === true) {
    applyActorId = required(options, "actor-id");
    if (!process.env.MEMBER_DIRECTORY_IDENTITY_KEY_SECRET) {
      throw new CliError("The identity-key secret is required for --apply.");
    }
  }
  if (getApps().length !== 0) throw new CliError("Unexpected pre-existing Firebase Admin app.");
  app = initializeApp({ projectId }, "membership-number-reconciliation");
  const adapter = await import("../lib/src/members/membership-number-reconciliation-firestore.js");
  const store = adapter.createMembershipNumberReconciliationFirestoreStore({
    firestore: getFirestore(app),
    identitySecretMaterial: process.env.MEMBER_DIRECTORY_IDENTITY_KEY_SECRET ?? "",
    identitySecretVersion: "identity-v1",
  });
  const plan = await adapter.planMembershipNumberReconciliation(store, {
    academyId,
    generatedAt,
  });
  const identity = { academyId, operationId, contentHash: plan.contentHash };
  const expectedConfirmation = adapter.expectedMembershipNumberReconciliationConfirmation(identity);

  if (options.apply !== true) {
    process.stdout.write(
      `${JSON.stringify(safePlanView(plan, operationId, expectedConfirmation), null, 2)}\n`,
    );
  } else {
    if (typeof options.confirmation !== "string" || options.confirmation !== expectedConfirmation) {
      throw new CliError("The exact dry-run confirmation is required for --apply.");
    }
    const result = await adapter.applyMembershipNumberReconciliation(store, plan, {
      ...identity,
      confirmation: options.confirmation,
      actorId: applyActorId,
      appliedAt: generatedAt,
    });
    process.stdout.write(
      `${JSON.stringify(
        {
          mode: "apply",
          academyId: result.academyId,
          operationId: result.operationId,
          contentHash: result.contentHash,
          rows: result.rows,
        },
        null,
        2,
      )}\n`,
    );
  }
} catch (error) {
  process.stderr.write(
    `${error instanceof CliError ? error.message : "Membership number reconciliation failed."}\n`,
  );
  // The cause stays hidden by default (it may name record paths); the operator can opt in.
  if (!(error instanceof CliError) && process.env.BPT_OPERATOR_DEBUG === "1") {
    process.stderr.write(`cause: ${error?.code ?? ""} ${error?.message ?? error}\n`);
  }
  process.exitCode = 1;
} finally {
  if (app !== undefined) await deleteApp(app);
}
