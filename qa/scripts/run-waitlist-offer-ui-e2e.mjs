import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const projectId = "demo-bpt-jersey";

if (
  process.env.WAITLIST_OFFER_UI_EMULATOR_E2E !== "true" ||
  process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID !== projectId ||
  process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS !== "true" ||
  process.env.NEXT_PUBLIC_FIREBASE_ENV !== "local" ||
  process.env.NEXT_PUBLIC_ADMIN_E2E
) {
  throw new Error(
    "T060 offer runner requires explicit local demo-project emulator flags without the admin test bypass.",
  );
}

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment: ${name}`);
  return value;
}

function requiredPort(name, defaultPort) {
  const rawPort = process.env[name]?.trim() ?? defaultPort;
  if (!/^[1-9]\d{3,4}$/u.test(rawPort) || Number(rawPort) < 1_024 || Number(rawPort) > 65_535) {
    throw new Error(`${name} must be a non-privileged local port.`);
  }
  return rawPort;
}

const authPort = requiredPort("NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_PORT", "9099");
const firestorePort = requiredPort("NEXT_PUBLIC_FIREBASE_FIRESTORE_EMULATOR_PORT", "8080");
requiredPort("NEXT_PUBLIC_FIREBASE_FUNCTIONS_EMULATOR_PORT", "5001");
if (
  process.env.FIREBASE_AUTH_EMULATOR_HOST !== `127.0.0.1:${authPort}` ||
  process.env.FIRESTORE_EMULATOR_HOST !== `127.0.0.1:${firestorePort}`
) {
  throw new Error("T060 offer runner ports must match the active loopback emulators.");
}

const password = required("AUTH_EMULATOR_E2E_PASSWORD");
if (password.length < 12) {
  throw new Error("T060 offer runner requires a synthetic Emulator password of 12+ characters.");
}
const identities = Object.freeze([
  ["owner", "t060-owner@example.test", "WAITLIST_OFFER_OWNER_EMAIL"],
  ["administrator", "t060-admin@example.test", "WAITLIST_OFFER_ADMIN_EMAIL"],
  ["headCoach", "t060-head-coach@example.test", "WAITLIST_OFFER_HEAD_COACH_EMAIL"],
  ["coach", "t060-coach@example.test", "WAITLIST_OFFER_COACH_EMAIL"],
  ["adultStudent", "t060-adult@example.test", "WAITLIST_OFFER_ADULT_EMAIL"],
  ["guardian", "t060-guardian@example.test", "WAITLIST_OFFER_GUARDIAN_EMAIL"],
]);
const suiteEnvironment = {
  ...process.env,
  AUTH_EMULATOR_E2E: "true",
  GCLOUD_PROJECT: projectId,
  ...Object.fromEntries(identities.map(([, email, variable]) => [variable, email])),
};

const repetitions = Number.parseInt(process.env.WAITLIST_OFFER_UI_REPEAT ?? "1", 10);
if (!Number.isInteger(repetitions) || repetitions < 1 || repetitions > 5) {
  throw new Error("WAITLIST_OFFER_UI_REPEAT must be an integer from 1 to 5.");
}

function run(args, environment = suiteEnvironment) {
  const result = spawnSync(process.execPath, args, {
    cwd: repositoryRoot,
    env: environment,
    stdio: "inherit",
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

for (const [role, email] of identities) {
  run(["qa/scripts/seed-auth-emulator.mjs"], {
    ...suiteEnvironment,
    AUTH_EMULATOR_E2E_EMAIL: email,
    AUTH_EMULATOR_E2E_ROLE: role,
    AUTH_EMULATOR_E2E_PASSWORD: password,
  });
}

for (let index = 0; index < repetitions; index += 1) {
  for (const project of ["desktop-chromium", "mobile-chromium"]) {
    run(["qa/scripts/seed-waitlist-offer-ui-emulator.mjs"]);
    run([
      "qa/run-e2e.mjs",
      "tests/waitlist-offer-auth-emulator.spec.ts",
      `--project=${project}`,
      "--workers=1",
      "--retries=0",
    ]);
  }
}
