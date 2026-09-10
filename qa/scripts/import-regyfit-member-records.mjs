// Imports normalised Regyfit member records into Firestore behind the admin callables.
//
// usage:
//   REGYFIT_MEMBER_RECORDS_FILE=<normalized.json> \
//   REGYFIT_ACADEMY_ID=<academyId> \
//   REGYFIT_IMPORT_TARGET=emulator|production \
//   node scripts/import-regyfit-member-records.mjs
//
// Production writes additionally require:
//   GCLOUD_PROJECT=bptjersey-f5a25
//   REGYFIT_OPERATOR_CONFIRMATION=real-member-records-production-v1
//
// The records file holds personal data of academy members and must stay outside the repository.

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

// Runs against the compiled domain runtime: build it first with
//   corepack pnpm --filter @bpt-jersey/domain build:runtime
import { parseRegyfitMemberRecord } from "../../packages/domain/lib/members/regyfit-member-record-contracts.js";

const requireFromFunctions = createRequire(
  new URL("../../apps/functions/package.json", import.meta.url),
);
const { getApps, initializeApp } = requireFromFunctions("firebase-admin/app");
const { getFirestore } = requireFromFunctions("firebase-admin/firestore");

const productionProjectId = "bptjersey-f5a25";
const productionConfirmation = "real-member-records-production-v1";

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment: ${name}`);
  return value;
}

function isLoopbackHost(value) {
  if (!value) return false;
  const host = value.split(":")[0]?.toLowerCase();
  return host === "127.0.0.1" || host === "localhost" || host === "::1";
}

function resolveTarget() {
  const target = required("REGYFIT_IMPORT_TARGET");
  if (target === "emulator") {
    if (!isLoopbackHost(process.env.FIRESTORE_EMULATOR_HOST)) {
      throw new Error("Emulator imports require FIRESTORE_EMULATOR_HOST on a loopback host");
    }
    return { target, projectId: process.env.GCLOUD_PROJECT?.trim() || "demo-bpt-jersey" };
  }
  if (target === "production") {
    if (process.env.FIRESTORE_EMULATOR_HOST) {
      throw new Error("Production imports must not run with FIRESTORE_EMULATOR_HOST set");
    }
    if (required("GCLOUD_PROJECT") !== productionProjectId) {
      throw new Error(`Production imports require GCLOUD_PROJECT=${productionProjectId}`);
    }
    if (process.env.REGYFIT_OPERATOR_CONFIRMATION !== productionConfirmation) {
      throw new Error("Production imports require the operator confirmation value");
    }
    return { target, projectId: productionProjectId };
  }
  throw new Error("REGYFIT_IMPORT_TARGET must be emulator or production");
}

function loadRecords(file) {
  const parsed = JSON.parse(readFileSync(file, "utf8"));
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error("The records file must hold a non-empty array");
  }
  const records = [];
  const seen = new Set();
  const failures = [];
  for (const candidate of parsed) {
    const result = parseRegyfitMemberRecord(candidate);
    if (!result.ok) {
      failures.push({
        recordId: candidate?.recordId,
        issues: result.error.map((issue) => `${issue.path.join(".")}:${issue.code}`),
      });
      continue;
    }
    if (seen.has(result.value.recordId)) {
      throw new Error(`Duplicate record id ${result.value.recordId}`);
    }
    seen.add(result.value.recordId);
    records.push(result.value);
  }
  if (failures.length > 0) {
    console.error(JSON.stringify({ invalidRecords: failures }, null, 2));
    throw new Error(`${failures.length} record(s) failed validation`);
  }
  return records;
}

async function main() {
  const file = required("REGYFIT_MEMBER_RECORDS_FILE");
  const academyId = required("REGYFIT_ACADEMY_ID");
  const { target, projectId } = resolveTarget();
  const records = loadRecords(file);

  const app = getApps()[0] ?? initializeApp({ projectId });
  const firestore = getFirestore(app);
  const collection = firestore.collection(`academies/${academyId}/regyfitMemberRecords`);

  const existing = await collection.get();
  const staleIds = new Set(existing.docs.map((document) => document.id));
  for (const record of records) staleIds.delete(record.recordId);

  let written = 0;
  let batch = firestore.batch();
  let pending = 0;
  const flush = async () => {
    if (pending === 0) return;
    await batch.commit();
    batch = firestore.batch();
    pending = 0;
  };
  for (const record of records) {
    batch.set(collection.doc(record.recordId), { ...record, academyId });
    written += 1;
    pending += 1;
    if (pending === 400) await flush();
  }
  for (const staleId of staleIds) {
    batch.delete(collection.doc(staleId));
    pending += 1;
    if (pending === 400) await flush();
  }
  await flush();

  console.log(
    JSON.stringify({
      target,
      projectId,
      academyId,
      written,
      removedStale: staleIds.size,
      capturedAt: records[0]?.capturedAt,
    }),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
