import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const projectId = "demo-bpt-jersey";

if (
  process.env.T067_FAMILY_ACHIEVEMENT_UI_EMULATOR_E2E !== "true" ||
  process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID !== projectId ||
  process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS !== "true" ||
  process.env.NEXT_PUBLIC_FIREBASE_ENV !== "local" ||
  process.env.NEXT_PUBLIC_ADMIN_E2E
) {
  throw new Error("T067 runner requires explicit local demo-project emulator flags.");
}

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment: ${name}`);
  return value;
}

function requiredPort(name, fallback) {
  const value = process.env[name]?.trim() ?? fallback;
  if (!/^[1-9]\d{3,4}$/u.test(value) || Number(value) < 1_024 || Number(value) > 65_535) {
    throw new Error(`${name} must be a non-privileged local port.`);
  }
  return value;
}

const authPort = requiredPort("NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_PORT", "9099");
const firestorePort = requiredPort("NEXT_PUBLIC_FIREBASE_FIRESTORE_EMULATOR_PORT", "8080");
requiredPort("NEXT_PUBLIC_FIREBASE_FUNCTIONS_EMULATOR_PORT", "5001");
if (
  process.env.FIREBASE_AUTH_EMULATOR_HOST !== `127.0.0.1:${authPort}` ||
  process.env.FIRESTORE_EMULATOR_HOST !== `127.0.0.1:${firestorePort}`
) {
  throw new Error("T067 runner ports must match the active loopback emulators.");
}

required("AUTH_EMULATOR_E2E_EMAIL");
const password = required("AUTH_EMULATOR_E2E_PASSWORD");
if (password.length < 12) {
  throw new Error("T067 runner requires a synthetic password of 12+ characters.");
}

const suiteEnvironment = {
  ...process.env,
  AUTH_EMULATOR_E2E: "true",
  AUTH_EMULATOR_E2E_ROLE: "owner",
  GCLOUD_PROJECT: projectId,
};

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
run(["qa/scripts/seed-family-achievement-emulator.mjs"]);
run([
  "qa/run-e2e.mjs",
  "tests/family-achievement-auth-emulator.spec.ts",
  "--project=desktop-chromium",
  "--workers=1",
  "--retries=0",
]);
