import { createRequire } from "node:module";

const requireFromFunctions = createRequire(
  new URL("../../apps/functions/package.json", import.meta.url),
);
const { getApps, initializeApp } = requireFromFunctions("firebase-admin/app");
const { getFirestore } = requireFromFunctions("firebase-admin/firestore");

import {
  assertCanonicalUtcDateTime,
  assertImportTargetIsSafe,
  getImportProjectId,
  importRegyfitAccessRecords,
} from "../../apps/functions/lib/src/regyfit/access-import.js";

const requiredEnvironment = [
  "REGYFIT_PRIVATE_STAGING_ROOT",
  "REGYFIT_RUN_ID",
  "REGYFIT_MODULE_KEY",
  "REGYFIT_SOURCE_ROUTE",
  "REGYFIT_ACADEMY_ID",
  "REGYFIT_IMPORT_TARGET",
  "REGYFIT_CAPTURED_AT",
];

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment: ${name}`);
  return value;
}

async function main() {
  for (const name of requiredEnvironment) required(name);
  const target = required("REGYFIT_IMPORT_TARGET");
  if (target === "emulator" && !process.env.FIRESTORE_EMULATOR_HOST?.trim()) {
    throw new Error("Missing required emulator environment");
  }
  if (target !== "emulator" && target !== "staging") {
    throw new Error("Import target is not safe");
  }

  const config = {
    privateStagingRoot: required("REGYFIT_PRIVATE_STAGING_ROOT"),
    runId: required("REGYFIT_RUN_ID"),
    moduleKey: required("REGYFIT_MODULE_KEY"),
    sourceRoute: required("REGYFIT_SOURCE_ROUTE"),
    academyId: required("REGYFIT_ACADEMY_ID"),
    target,
  };
  const capturedAt = assertCanonicalUtcDateTime(required("REGYFIT_CAPTURED_AT"));
  const projectId = getImportProjectId();
  assertImportTargetIsSafe(config, projectId);
  const app = getApps()[0] ?? initializeApp({ projectId });
  const receipt = await importRegyfitAccessRecords(config, getFirestore(app), capturedAt);

  console.log(
    JSON.stringify({
      runId: receipt.runId,
      moduleKey: receipt.moduleKey,
      importedCount: receipt.importedCount,
      skippedCount: receipt.skippedCount,
      contentSha256: receipt.contentSha256,
      auditEventPath: receipt.auditEventPath,
    }),
  );
}

main().catch(() => {
  console.error("Regyfit access import failed");
  process.exitCode = 1;
});
