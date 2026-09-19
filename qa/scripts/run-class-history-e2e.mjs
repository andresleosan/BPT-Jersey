import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

// T048V2-H authenticated Emulator E2E for the class registrations log: a synthetic owner, three
// planted class audit events, and the admin screen read in a real browser. Run inside
// `firebase emulators:exec --only auth,firestore,functions` with the flags below.
const repositoryRoot = resolve(import.meta.dirname, "../..");
const projectId = "demo-bpt-jersey";
const academyId = "class-history-e2e";

if (
  process.env.T048_CLASS_HISTORY_EMULATOR_E2E !== "true" ||
  process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID !== projectId ||
  process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS !== "true" ||
  process.env.NEXT_PUBLIC_FIREBASE_ENV !== "local" ||
  process.env.NEXT_PUBLIC_ADMIN_E2E ||
  process.env.FIRESTORE_EMULATOR_HOST !== "127.0.0.1:8080" ||
  process.env.FIREBASE_AUTH_EMULATOR_HOST !== "127.0.0.1:9099"
) {
  throw new Error("T048V2-H runner requires explicit local demo-project emulator flags.");
}

function run(args, env = {}, capture = false) {
  const result = spawnSync(process.execPath, args, {
    cwd: repositoryRoot,
    env: { ...process.env, GCLOUD_PROJECT: projectId, ...env },
    stdio: capture ? ["ignore", "pipe", "inherit"] : "inherit",
    encoding: "utf8",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
  if (capture) process.stdout.write(result.stdout);
  return result.stdout ?? "";
}

const ownerSeed = run(
  ["qa/scripts/seed-auth-emulator.mjs"],
  { AUTH_EMULATOR_E2E_ROLE: "owner", AUTH_EMULATOR_E2E_ACADEMY_ID: academyId },
  true,
);
const ownerUid = JSON.parse(ownerSeed.trim().split("\n").pop()).uid;
if (typeof ownerUid !== "string" || ownerUid.length === 0) {
  throw new Error("The auth seed did not report the owner uid.");
}

run(["qa/scripts/seed-class-history-emulator.mjs"], {
  T048_CLASS_HISTORY_ACADEMY_ID: academyId,
  T048_CLASS_HISTORY_STAFF_UID: ownerUid,
});

run(
  [
    "qa/run-e2e.mjs",
    "tests/admin-classes-services-history.spec.ts",
    "--project=desktop-chromium",
    "--workers=1",
    "--retries=0",
  ],
  { AUTH_EMULATOR_E2E: "true" },
);
