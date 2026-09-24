import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { resolve } from "node:path";

// Member gamification and social E2E (plan 2026-09-24, task 9.3) against the Emulators and the
// static web export built for them (NEXT_PUBLIC_USE_FIREBASE_EMULATORS=true,
// NEXT_PUBLIC_CALENDAR_SOURCE=firebase, project demo-bpt-jersey). Run inside
// `firebase emulators:exec --project demo-bpt-jersey --only auth,firestore,functions`.
// Each Playwright project gets its own synthetic academy, so desktop and mobile never share state.
const repositoryRoot = resolve(import.meta.dirname, "../..");
const projectId = "demo-bpt-jersey";
const projects = ["desktop-chromium", "mobile-chromium"];

if (
  process.env.MEMBER_ENGAGEMENT_UI_EMULATOR_E2E !== "true" ||
  process.env.GCLOUD_PROJECT !== projectId ||
  process.env.NEXT_PUBLIC_ADMIN_E2E
) {
  throw new Error("Member engagement runner requires explicit local demo-project emulator flags.");
}
for (const name of ["FIRESTORE_EMULATOR_HOST", "FIREBASE_AUTH_EMULATOR_HOST"]) {
  if (!/^127\.0\.0\.1:([1-9]\d{3,4})$/u.test(process.env[name] ?? "")) {
    throw new Error(`${name} must point to a loopback emulator port.`);
  }
}
const password = process.env.MGE_PASSWORD?.trim() ?? "";
if (password.length < 12)
  throw new Error("MGE_PASSWORD must be a synthetic 12+ character password.");
for (const name of [
  "MEMBER_DIRECTORY_IDENTITY_KEY_SECRET",
  "MEMBER_DIRECTORY_MIGRATION_INTEGRITY_SECRET",
  "MEMBER_DIRECTORY_BASELINE_ENCRYPTION_SECRET",
]) {
  if (!process.env[name]?.trim()) throw new Error(`Missing required environment: ${name}`);
}

const worldDirectory = resolve(repositoryRoot, ".tmp/member-engagement-e2e");
rmSync(worldDirectory, { recursive: true, force: true });
const runId = Date.now().toString(36);
const environment = { ...process.env, GCLOUD_PROJECT: projectId, MGE_WORLD_DIR: worldDirectory };
delete environment.DEBUG;

function run(args, extra = {}) {
  const result = spawnSync(process.execPath, args, {
    cwd: repositoryRoot,
    env: { ...environment, ...extra },
    stdio: "inherit",
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

for (const project of projects) {
  const short = project.startsWith("desktop") ? "d" : "m";
  run(["qa/scripts/seed-member-engagement-emulator.mjs"], {
    MGE_ACADEMY_ID: `mge-${short}-${runId}`,
    MGE_EMAIL_PREFIX: `mge-${short}`,
    MGE_WORLD_FILE: resolve(worldDirectory, `world-${project}.json`),
  });
}

run(
  [
    "qa/run-e2e.mjs",
    "tests/member-engagement-auth-emulator.spec.ts",
    ...projects.map((project) => `--project=${project}`),
    "--workers=1",
    "--retries=0",
  ],
  { MEMBER_ENGAGEMENT_UI_EMULATOR_E2E: "true" },
);
