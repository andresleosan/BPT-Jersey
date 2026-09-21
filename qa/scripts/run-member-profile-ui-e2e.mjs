import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

// T051V2: member record (Plan B) + JIU-JITSU IBJJF (Plan C) through the static web build, real
// Auth, Functions and Firestore emulators. Run inside
// `firebase emulators:exec --only auth,firestore,functions`.
const repositoryRoot = resolve(import.meta.dirname, "../..");
const projectId = "demo-bpt-jersey";

if (
  process.env.MEMBER_PROFILE_UI_EMULATOR_E2E !== "true" ||
  process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID !== projectId ||
  process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS !== "true" ||
  process.env.NEXT_PUBLIC_FIREBASE_ENV !== "local" ||
  process.env.NEXT_PUBLIC_ADMIN_E2E ||
  process.env.FIRESTORE_EMULATOR_HOST !== "127.0.0.1:8080" ||
  process.env.FIREBASE_AUTH_EMULATOR_HOST !== "127.0.0.1:9099"
) {
  throw new Error("Member profile runner requires explicit local demo-project emulator flags.");
}

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment: ${name}`);
  return value;
}

// A unique academy per run: Task 13's runner shares nothing with this one, and two suites writing
// the same academy would let one run's catalogue decide another run's assertions.
const academyId = required("MEMBER_PROFILE_E2E_ACADEMY_ID");
if (!/^[a-z][a-z0-9-]{2,60}$/u.test(academyId)) {
  throw new Error("MEMBER_PROFILE_E2E_ACADEMY_ID must be a lowercase slug.");
}
for (const name of [
  "AUTH_EMULATOR_E2E_EMAIL",
  "AUTH_EMULATOR_E2E_PASSWORD",
  "MEMBER_PROFILE_E2E_PASSWORD",
  "MEMBER_PROFILE_HEAD_COACH_EMAIL",
  "MEMBER_PROFILE_COACH_EMAIL",
  "MEMBER_PROFILE_ADMINISTRATOR_EMAIL",
  "MEMBER_DIRECTORY_IDENTITY_KEY_SECRET",
  "MEMBER_DIRECTORY_MIGRATION_INTEGRITY_SECRET",
  "MEMBER_DIRECTORY_BASELINE_ENCRYPTION_SECRET",
]) {
  required(name);
}

const suiteEnvironment = {
  ...process.env,
  AUTH_EMULATOR_E2E: "true",
  AUTH_EMULATOR_E2E_ROLE: "owner",
  AUTH_EMULATOR_E2E_ACADEMY_ID: academyId,
  T093_E2E_ACADEMY_ID: academyId,
  MEMBER_PROFILE_E2E_ACADEMY_ID: academyId,
  GCLOUD_PROJECT: projectId,
};
delete suiteEnvironment.DEBUG;

function run(args) {
  const result = spawnSync(process.execPath, args, {
    cwd: repositoryRoot,
    env: suiteEnvironment,
    stdio: "inherit",
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run(["qa/scripts/seed-auth-emulator.mjs"]);
run(["qa/scripts/seed-member-directory-emulator.mjs"]);
run(["qa/scripts/seed-member-profile-actors-emulator.mjs"]);
run([
  "apps/functions/scripts/member-directory-empty-initialize.mjs",
  `--academy-id=${academyId}`,
  "--confirmation=T093-EMPTY-CANONICAL-INITIALIZE",
]);
run([
  "apps/functions/scripts/seed-levels.mjs",
  "--target=emulator",
  `--academy-id=${academyId}`,
  "--system-id=ibjjf-v3",
]);
run([
  "qa/run-e2e.mjs",
  "tests/member-profile.spec.ts",
  "--project=desktop-chromium",
  "--workers=1",
  "--retries=0",
]);
