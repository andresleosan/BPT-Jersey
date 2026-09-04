import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

// T093 authenticated Emulator E2E for the canonical member directory callables.
// Run inside `firebase emulators:exec --only auth,firestore,functions` with the flags below.
const repositoryRoot = resolve(import.meta.dirname, "../..");
const projectId = "demo-bpt-jersey";

if (
  process.env.T093_MEMBER_DIRECTORY_EMULATOR_E2E !== "true" ||
  process.env.GCLOUD_PROJECT !== projectId ||
  process.env.NEXT_PUBLIC_ADMIN_E2E
) {
  throw new Error("T093 runner requires explicit local demo-project emulator flags.");
}

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment: ${name}`);
  return value;
}

function loopbackPort(host, label) {
  const match = /^127\.0\.0\.1:([1-9]\d{3,4})$/u.exec(host ?? "");
  if (!match || Number(match[1]) < 1_024 || Number(match[1]) > 65_535) {
    throw new Error(`${label} must point to a loopback non-privileged emulator port.`);
  }
  return match[1];
}

loopbackPort(process.env.FIREBASE_AUTH_EMULATOR_HOST, "FIREBASE_AUTH_EMULATOR_HOST");
loopbackPort(process.env.FIRESTORE_EMULATOR_HOST, "FIRESTORE_EMULATOR_HOST");
const functionsPort = process.env.T093_FUNCTIONS_EMULATOR_PORT?.trim() ?? "5001";
if (!/^[1-9]\d{3,4}$/u.test(functionsPort)) {
  throw new Error("T093_FUNCTIONS_EMULATOR_PORT must be a non-privileged local port.");
}

const academyId = required("T093_E2E_ACADEMY_ID");
required("AUTH_EMULATOR_E2E_EMAIL");
const password = required("AUTH_EMULATOR_E2E_PASSWORD");
if (password.length < 12) {
  throw new Error("T093 runner requires a synthetic password of 12+ characters.");
}
for (const name of [
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
  GCLOUD_PROJECT: projectId,
  // The spec drives callables directly, so no static web server is needed.
  BASE_URL: `http://127.0.0.1:${functionsPort}`,
  T093_FUNCTIONS_EMULATOR_PORT: functionsPort,
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
run([
  "apps/functions/scripts/member-directory-empty-initialize.mjs",
  `--academy-id=${academyId}`,
  "--confirmation=T093-EMPTY-CANONICAL-INITIALIZE",
]);
run([
  "qa/run-e2e.mjs",
  "tests/member-directory-auth-emulator.spec.ts",
  "--project=desktop-chromium",
  "--workers=1",
  "--retries=0",
]);
