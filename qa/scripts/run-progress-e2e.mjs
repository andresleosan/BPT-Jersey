import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

// T097 authenticated Emulator E2E for progress on canonical data: level opening by the head
// coach, attendance, evaluation, recognition candidates, promotion approval and report. Run inside
// `firebase emulators:exec --only auth,firestore,functions` with the flags below.
const repositoryRoot = resolve(import.meta.dirname, "../..");
const projectId = "demo-bpt-jersey";

if (
  process.env.T097_PROGRESS_EMULATOR_E2E !== "true" ||
  process.env.GCLOUD_PROJECT !== projectId ||
  process.env.NEXT_PUBLIC_ADMIN_E2E
) {
  throw new Error("T097 runner requires explicit local demo-project emulator flags.");
}
// The waiver callables are closed outside the synthetic pilot; the Functions Emulator inherits
// the shell environment of `emulators:exec`, so the flag has to be present here as well.
if (process.env.BPT_SYNTHETIC_PILOT !== "true") {
  throw new Error("T097 runner requires BPT_SYNTHETIC_PILOT=true in the emulator environment.");
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
const functionsPort = process.env.T097_FUNCTIONS_EMULATOR_PORT?.trim() ?? "5001";
if (!/^[1-9]\d{3,4}$/u.test(functionsPort)) {
  throw new Error("T097_FUNCTIONS_EMULATOR_PORT must be a non-privileged local port.");
}

const academyId = required("T097_E2E_ACADEMY_ID");
const ownerEmail = required("T097_OWNER_EMAIL");
const adultEmail = required("T097_ADULT_EMAIL");
const headCoachEmail = required("T097_HEAD_COACH_EMAIL");
const password = required("T097_E2E_PASSWORD");
if (password.length < 12) {
  throw new Error("T097 runner requires a synthetic password of 12+ characters.");
}
for (const email of [ownerEmail, adultEmail, headCoachEmail]) {
  if (!email.endsWith("@example.test")) throw new Error("T097 runner requires synthetic users.");
}
for (const name of [
  "MEMBER_DIRECTORY_IDENTITY_KEY_SECRET",
  "MEMBER_DIRECTORY_MIGRATION_INTEGRITY_SECRET",
  "MEMBER_DIRECTORY_BASELINE_ENCRYPTION_SECRET",
]) {
  required(name);
}

const baseEnvironment = {
  ...process.env,
  GCLOUD_PROJECT: projectId,
  T097_FUNCTIONS_EMULATOR_PORT: functionsPort,
};
delete baseEnvironment.DEBUG;

function run(args, extraEnvironment = {}) {
  const result = spawnSync(process.execPath, args, {
    cwd: repositoryRoot,
    env: { ...baseEnvironment, ...extraEnvironment },
    stdio: "inherit",
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

// Owner: Auth user, claims and the exact provisioned staff document, reusing the T093 seeds.
const ownerEnvironment = {
  AUTH_EMULATOR_E2E_EMAIL: ownerEmail,
  AUTH_EMULATOR_E2E_PASSWORD: password,
  AUTH_EMULATOR_E2E_ROLE: "owner",
  T093_E2E_ACADEMY_ID: academyId,
};
run(["qa/scripts/seed-auth-emulator.mjs"], ownerEnvironment);
run(["qa/scripts/seed-member-directory-emulator.mjs"], ownerEnvironment);
// Adult client: Auth user and claims only, reusing the T094 seed. Its profile, family, waiver
// consent, membership, bookings and attendance are created by the callables under test.
run(["qa/scripts/seed-onboarding-emulator.mjs"], {
  T094_E2E_ACADEMY_ID: academyId,
  T094_E2E_PASSWORD: password,
  T094_ADULT_EMAIL: adultEmail,
  T094_GUARDIAN_EMAIL: `t097-unused-guardian@example.test`,
});
// Head coach: Auth user, claims, staff user document and canonical staff profile.
run(["qa/scripts/seed-staff-emulator.mjs"]);
run([
  "apps/functions/scripts/member-directory-empty-initialize.mjs",
  `--academy-id=${academyId}`,
  "--confirmation=T093-EMPTY-CANONICAL-INITIALIZE",
]);
// Canonical Levels catalog (171 definitions) through the guarded seed CLI against the Emulator.
run(["apps/functions/scripts/seed-levels.mjs", "--target=emulator", `--academy-id=${academyId}`]);
run(
  [
    "qa/run-e2e.mjs",
    "tests/progress-auth-emulator.spec.ts",
    "--project=desktop-chromium",
    "--workers=1",
    "--retries=0",
  ],
  {
    AUTH_EMULATOR_E2E: "true",
    // The spec drives callables directly, so no static web server is needed.
    BASE_URL: `http://127.0.0.1:${functionsPort}`,
  },
);
