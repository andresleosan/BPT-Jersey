import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dirname, "../..");

if (
  process.env.WAITLIST_UI_EMULATOR_E2E !== "true" ||
  process.env.AUTH_EMULATOR_E2E_ROLE !== "adultStudent" ||
  process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID !== "demo-bpt-jersey"
) {
  throw new Error(
    "Waitlist UI E2E runner requires the explicit synthetic adultStudent demo-project flags.",
  );
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
if (
  process.env.FIREBASE_AUTH_EMULATOR_HOST !== `127.0.0.1:${authPort}` ||
  process.env.FIRESTORE_EMULATOR_HOST !== `127.0.0.1:${firestorePort}`
) {
  throw new Error("Waitlist UI E2E ports must match the active loopback emulators.");
}

const repetitions = Number.parseInt(process.env.WAITLIST_UI_REPEAT ?? "1", 10);
if (!Number.isInteger(repetitions) || repetitions < 1 || repetitions > 5) {
  throw new Error("WAITLIST_UI_REPEAT must be an integer from 1 to 5.");
}

function run(args) {
  const result = spawnSync(process.execPath, args, {
    cwd: repositoryRoot,
    env: process.env,
    stdio: "inherit",
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run(["qa/scripts/seed-auth-emulator.mjs"]);
for (let index = 0; index < repetitions; index += 1) {
  run(["qa/scripts/seed-waitlist-ui-emulator.mjs"]);
  run([
    "qa/run-e2e.mjs",
    "tests/waitlist-self-service-auth-emulator.spec.ts",
    "--project=desktop-chromium",
    "--workers=1",
    "--retries=0",
  ]);
}
