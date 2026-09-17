import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const projectId = "demo-bpt-jersey";
const academyId = "regyfit-import-e2e";

if (
  process.env.CS_IMPORT_UI_EMULATOR_E2E !== "true" ||
  process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID !== projectId ||
  process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS !== "true" ||
  process.env.NEXT_PUBLIC_FIREBASE_ENV !== "local" ||
  process.env.NEXT_PUBLIC_ADMIN_E2E ||
  process.env.FIRESTORE_EMULATOR_HOST !== "127.0.0.1:8080" ||
  process.env.FIREBASE_AUTH_EMULATOR_HOST !== "127.0.0.1:9099"
) {
  throw new Error(
    "Classes / Services import runner requires explicit local demo-project emulator flags.",
  );
}

function run(args, env = {}) {
  const result = spawnSync(process.execPath, args, {
    cwd: repositoryRoot,
    env: { ...process.env, ...env },
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run(["qa/scripts/seed-auth-emulator.mjs"], {
  AUTH_EMULATOR_E2E_ROLE: "owner",
  AUTH_EMULATOR_E2E_ACADEMY_ID: academyId,
});
run(["qa/scripts/regyfit-classes-services-import.mjs"], {
  REGYFIT_CAPTURE_DIR: "qa/fixtures/regyfit-classes-services-synthetic",
  REGYFIT_ACADEMY_ID: academyId,
  REGYFIT_IMPORT_TARGET: "emulator",
  REGYFIT_IMPORT_APPLY: "true",
  // 14 and 16 Sep become completed, 19 and 20 Sep stay scheduled, whatever today is.
  REGYFIT_IMPORT_NOW: "2026-09-17T12:00:00.000Z",
});
run([
  "qa/run-e2e.mjs",
  "tests/classes-services-import-emulator.spec.ts",
  "--project=desktop-chromium",
  "--workers=1",
  "--retries=0",
]);
