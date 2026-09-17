// Removes the legacy appAccess.password key from stored Regyfit member records.
//
// usage (dry run, counts only — the default):
//   REGYFIT_ACADEMY_ID=<academyId> REGYFIT_PURGE_TARGET=emulator|production \
//   node qa/scripts/purge-regyfit-record-passwords.mjs
//
// apply (deletes the key, nothing else):
//   add REGYFIT_PURGE_APPLY=yes
// Production additionally requires GCLOUD_PROJECT=bptjersey-f5a25 (dry run and apply) and, to apply,
//   REGYFIT_OPERATOR_CONFIRMATION=regyfit-password-purge-production-v1
// Production runs only after the operator's explicit OK in chat (plan 2026-09-17-member-profile-a, Task 8).

import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const productionProjectId = "bptjersey-f5a25";
export const productionConfirmation = "regyfit-password-purge-production-v1";

function isLoopbackHost(value) {
  if (!value) return false;
  const host = value.split(":")[0]?.toLowerCase();
  return host === "127.0.0.1" || host === "localhost" || host === "::1";
}

export function hasStoredPassword(data) {
  const access = data?.appAccess;
  return typeof access === "object" && access !== null && Object.hasOwn(access, "password");
}

export function resolvePurgeTarget(env) {
  const target = env.REGYFIT_PURGE_TARGET?.trim();
  const apply = env.REGYFIT_PURGE_APPLY === "yes";
  if (target === "emulator") {
    if (!isLoopbackHost(env.FIRESTORE_EMULATOR_HOST)) {
      throw new Error("Emulator purges require FIRESTORE_EMULATOR_HOST on a loopback host");
    }
    return { target, projectId: env.GCLOUD_PROJECT?.trim() || "demo-bpt-jersey", apply };
  }
  if (target === "production") {
    if (env.FIRESTORE_EMULATOR_HOST) {
      throw new Error("Production purges must not run with FIRESTORE_EMULATOR_HOST set");
    }
    if (env.GCLOUD_PROJECT?.trim() !== productionProjectId) {
      throw new Error(`Production purges require GCLOUD_PROJECT=${productionProjectId}`);
    }
    if (apply && env.REGYFIT_OPERATOR_CONFIRMATION !== productionConfirmation) {
      throw new Error("Applying in production requires the operator confirmation value");
    }
    return { target, projectId: productionProjectId, apply };
  }
  throw new Error("REGYFIT_PURGE_TARGET must be emulator or production");
}

async function main() {
  const academyId = process.env.REGYFIT_ACADEMY_ID?.trim();
  if (!academyId) throw new Error("Missing required environment: REGYFIT_ACADEMY_ID");
  const { target, projectId, apply } = resolvePurgeTarget(process.env);

  const requireFromFunctions = createRequire(
    new URL("../../apps/functions/package.json", import.meta.url),
  );
  const { getApps, initializeApp } = requireFromFunctions("firebase-admin/app");
  const { FieldValue, getFirestore } = requireFromFunctions("firebase-admin/firestore");
  const app = getApps()[0] ?? initializeApp({ projectId });
  const firestore = getFirestore(app);

  const snapshot = await firestore.collection(`academies/${academyId}/regyfitMemberRecords`).get();
  const targets = snapshot.docs.filter((document) => hasStoredPassword(document.data()));

  let purged = 0;
  if (apply) {
    // ponytail: one pass in 400-write batches; 249 records today, re-run is idempotent.
    for (let index = 0; index < targets.length; index += 400) {
      const batch = firestore.batch();
      for (const document of targets.slice(index, index + 400)) {
        batch.update(document.ref, { "appAccess.password": FieldValue.delete() });
      }
      await batch.commit();
      purged += Math.min(400, targets.length - index);
    }
  }

  console.log(
    JSON.stringify({
      target,
      projectId,
      academyId,
      scanned: snapshot.size,
      withPassword: targets.length,
      purged,
    }),
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
