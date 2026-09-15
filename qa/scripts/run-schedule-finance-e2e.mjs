import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

// T032 authenticated Emulator E2E for the schedule and finance callables added on top of
// schema-v2 classes: two-rule class -> sessions -> booked counts -> session edit -> class
// removal; and a membership-less manual invoice -> cash payment -> recent payments -> family
// account -> member names. Run inside `firebase emulators:exec --only auth,firestore,functions`
// with the flags below. Modelled on the T095/T096 runners.
const repositoryRoot = resolve(import.meta.dirname, "../..");
const projectId = "demo-bpt-jersey";

if (
  process.env.T032_SCHEDULE_FINANCE_EMULATOR_E2E !== "true" ||
  process.env.GCLOUD_PROJECT !== projectId ||
  process.env.NEXT_PUBLIC_ADMIN_E2E
) {
  throw new Error("T032 runner requires explicit local demo-project emulator flags.");
}
// The waiver-adjacent profile callables are closed outside the synthetic pilot; the Functions
// Emulator inherits the shell environment of `emulators:exec`, so the flag has to be present here
// as well.
if (process.env.BPT_SYNTHETIC_PILOT !== "true") {
  throw new Error("T032 runner requires BPT_SYNTHETIC_PILOT=true in the emulator environment.");
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
const functionsPort = process.env.T032_FUNCTIONS_EMULATOR_PORT?.trim() ?? "5001";
if (!/^[1-9]\d{3,4}$/u.test(functionsPort)) {
  throw new Error("T032_FUNCTIONS_EMULATOR_PORT must be a non-privileged local port.");
}

const academyId = required("T032_E2E_ACADEMY_ID");
const ownerEmail = required("T032_OWNER_EMAIL");
const coachEmail = required("T032_COACH_EMAIL");
const adultEmail = required("T032_ADULT_EMAIL");
const password = required("T032_E2E_PASSWORD");
if (password.length < 12) {
  throw new Error("T032 runner requires a synthetic password of 12+ characters.");
}
for (const email of [ownerEmail, coachEmail, adultEmail]) {
  if (!email.endsWith("@example.test")) throw new Error("T032 runner requires synthetic users.");
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
  T032_FUNCTIONS_EMULATOR_PORT: functionsPort,
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

// Coach: Auth user and claims in the real academy (the generic seed accepts the academy id; the
// schedule callables only read claims, so no Firestore staff document is needed here).
run(["qa/scripts/seed-auth-emulator.mjs"], {
  AUTH_EMULATOR_E2E_EMAIL: coachEmail,
  AUTH_EMULATOR_E2E_PASSWORD: password,
  AUTH_EMULATOR_E2E_ROLE: "coach",
  AUTH_EMULATOR_E2E_ACADEMY_ID: academyId,
});

// Adult client: Auth user and claims only, reusing the T094 seed. Its profile and family are
// created by `saveClientProfile` inside the spec.
run(["qa/scripts/seed-onboarding-emulator.mjs"], {
  T094_E2E_ACADEMY_ID: academyId,
  T094_E2E_PASSWORD: password,
  T094_ADULT_EMAIL: adultEmail,
  T094_GUARDIAN_EMAIL: `t032-unused-guardian@example.test`,
});
run([
  "apps/functions/scripts/member-directory-empty-initialize.mjs",
  `--academy-id=${academyId}`,
  "--confirmation=T093-EMPTY-CANONICAL-INITIALIZE",
]);
run(
  [
    "qa/run-e2e.mjs",
    "tests/schedule-finance-emulator.spec.ts",
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
