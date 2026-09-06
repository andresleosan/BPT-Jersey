import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

// T098 golden path: the authenticated callable-level suites (T094 onboarding, T095 manual
// billing, T096 class operations with T109/T110, T111 no-show penalty, T116 delegated staff
// permissions, T112 coach birthdays,
// T113 level age bands and T097 progress) chained in ONE emulator run over ONE synthetic academy:
// family/adult -> waiver ->
// membership -> class -> booking -> attendance -> no-show penalty -> invoice and payment ->
// birthdays -> progress -> report.
// Run inside `firebase emulators:exec --only auth,firestore,functions`.
const repositoryRoot = resolve(import.meta.dirname, "../..");
const projectId = "demo-bpt-jersey";

if (
  process.env.GOLDEN_PATH_EMULATOR_E2E !== "true" ||
  process.env.GCLOUD_PROJECT !== projectId ||
  process.env.NEXT_PUBLIC_ADMIN_E2E
) {
  throw new Error("Golden path runner requires explicit local demo-project emulator flags.");
}
if (process.env.BPT_SYNTHETIC_PILOT !== "true") {
  throw new Error(
    "Golden path runner requires BPT_SYNTHETIC_PILOT=true in the emulator environment.",
  );
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
const functionsPort = process.env.GOLDEN_PATH_FUNCTIONS_EMULATOR_PORT?.trim() ?? "5001";
if (!/^[1-9]\d{3,4}$/u.test(functionsPort)) {
  throw new Error("GOLDEN_PATH_FUNCTIONS_EMULATOR_PORT must be a non-privileged local port.");
}

const academyId = required("GOLDEN_PATH_ACADEMY_ID");
const password = required("GOLDEN_PATH_PASSWORD");
if (password.length < 12)
  throw new Error("Golden path requires a synthetic password of 12+ chars.");
const ownerEmail = required("GOLDEN_PATH_OWNER_EMAIL");
const headCoachEmail = required("GOLDEN_PATH_HEAD_COACH_EMAIL");
const guardianEmail = required("GOLDEN_PATH_GUARDIAN_EMAIL");
// A second guardian, because each suite enrols its own family and a tutor holds one family.
const progressGuardianEmail = required("GOLDEN_PATH_GUARDIAN_PROGRESS_EMAIL");
// A third guardian, for the age-band suite: it opens two children of one family at the same belt.
const levelsGuardianEmail = required("GOLDEN_PATH_GUARDIAN_LEVELS_EMAIL");
// One adult per suite, and two for the birthday suite because it needs one member at each site.
// Each suite creates its own adult's membership and a second current membership for the same
// student is (correctly) refused.
const adults = {
  onboarding: required("GOLDEN_PATH_ADULT_ONBOARDING_EMAIL"),
  billing: required("GOLDEN_PATH_ADULT_BILLING_EMAIL"),
  schedule: required("GOLDEN_PATH_ADULT_SCHEDULE_EMAIL"),
  penalty: required("GOLDEN_PATH_ADULT_PENALTY_EMAIL"),
  birthdayTown: required("GOLDEN_PATH_ADULT_BIRTHDAY_TOWN_EMAIL"),
  birthdayWest: required("GOLDEN_PATH_ADULT_BIRTHDAY_WEST_EMAIL"),
  progress: required("GOLDEN_PATH_ADULT_PROGRESS_EMAIL"),
};
for (const email of [
  ownerEmail,
  headCoachEmail,
  guardianEmail,
  progressGuardianEmail,
  levelsGuardianEmail,
  ...Object.values(adults),
]) {
  if (!email.endsWith("@example.test")) throw new Error("Golden path requires synthetic users.");
}
if (new Set([guardianEmail, progressGuardianEmail, levelsGuardianEmail]).size !== 3) {
  throw new Error("Golden path requires three distinct guardian users.");
}
if (new Set(Object.values(adults)).size !== 7) {
  throw new Error("Golden path requires seven distinct adult users.");
}
for (const name of [
  "MEMBER_DIRECTORY_IDENTITY_KEY_SECRET",
  "MEMBER_DIRECTORY_MIGRATION_INTEGRITY_SECRET",
  "MEMBER_DIRECTORY_BASELINE_ENCRYPTION_SECRET",
]) {
  required(name);
}

const baseEnvironment = { ...process.env, GCLOUD_PROJECT: projectId };
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

// Owner, staff document and canonical directory.
const ownerEnvironment = {
  AUTH_EMULATOR_E2E_EMAIL: ownerEmail,
  AUTH_EMULATOR_E2E_PASSWORD: password,
  AUTH_EMULATOR_E2E_ROLE: "owner",
  T093_E2E_ACADEMY_ID: academyId,
};
run(["qa/scripts/seed-auth-emulator.mjs"], ownerEnvironment);
run(["qa/scripts/seed-member-directory-emulator.mjs"], ownerEnvironment);
// Clients: three guardians and seven adults (Auth users and claims only). The seed provisions two
// identities per call and the pairing is arbitrary, so the guardians simply ride the first calls.
const guardians = [guardianEmail, progressGuardianEmail, levelsGuardianEmail];
for (const [index, adultEmail] of Object.values(adults).entries()) {
  run(["qa/scripts/seed-onboarding-emulator.mjs"], {
    T094_E2E_ACADEMY_ID: academyId,
    T094_E2E_PASSWORD: password,
    T094_ADULT_EMAIL: adultEmail,
    T094_GUARDIAN_EMAIL: guardians[index] ?? progressGuardianEmail,
  });
}
// Head coach with staff profile, empty canonical directory and the Levels catalog.
run(["qa/scripts/seed-staff-emulator.mjs"], {
  T097_E2E_ACADEMY_ID: academyId,
  T097_E2E_PASSWORD: password,
  T097_HEAD_COACH_EMAIL: headCoachEmail,
});
run([
  "apps/functions/scripts/member-directory-empty-initialize.mjs",
  `--academy-id=${academyId}`,
  "--confirmation=T093-EMPTY-CANONICAL-INITIALIZE",
]);
run(["apps/functions/scripts/seed-levels.mjs", "--target=emulator", `--academy-id=${academyId}`]);

// The eight suites in order, one worker, no retries, no static web server.
run(
  [
    "qa/run-e2e.mjs",
    "tests/onboarding-auth-emulator.spec.ts",
    "tests/manual-billing-auth-emulator.spec.ts",
    "tests/schedule-auth-emulator.spec.ts",
    "tests/no-show-penalty-auth-emulator.spec.ts",
    "tests/staff-permission-grant-auth-emulator.spec.ts",
    "tests/coach-birthday-auth-emulator.spec.ts",
    "tests/level-age-band-auth-emulator.spec.ts",
    "tests/progress-auth-emulator.spec.ts",
    "--project=desktop-chromium",
    "--workers=1",
    "--retries=0",
  ],
  {
    AUTH_EMULATOR_E2E: "true",
    BASE_URL: `http://127.0.0.1:${functionsPort}`,
    T094_ONBOARDING_EMULATOR_E2E: "true",
    T094_E2E_ACADEMY_ID: academyId,
    T094_FUNCTIONS_EMULATOR_PORT: functionsPort,
    T094_OWNER_EMAIL: ownerEmail,
    T094_ADULT_EMAIL: adults.onboarding,
    T094_GUARDIAN_EMAIL: guardianEmail,
    T094_E2E_PASSWORD: password,
    T095_MANUAL_BILLING_EMULATOR_E2E: "true",
    T095_E2E_ACADEMY_ID: academyId,
    T095_FUNCTIONS_EMULATOR_PORT: functionsPort,
    T095_OWNER_EMAIL: ownerEmail,
    T095_ADULT_EMAIL: adults.billing,
    T095_E2E_PASSWORD: password,
    T096_SCHEDULE_EMULATOR_E2E: "true",
    T096_E2E_ACADEMY_ID: academyId,
    T096_FUNCTIONS_EMULATOR_PORT: functionsPort,
    T096_OWNER_EMAIL: ownerEmail,
    T096_ADULT_EMAIL: adults.schedule,
    T096_E2E_PASSWORD: password,
    T111_NO_SHOW_PENALTY_EMULATOR_E2E: "true",
    T111_E2E_ACADEMY_ID: academyId,
    T111_FUNCTIONS_EMULATOR_PORT: functionsPort,
    T111_OWNER_EMAIL: ownerEmail,
    T111_HEAD_COACH_EMAIL: headCoachEmail,
    T111_ADULT_EMAIL: adults.penalty,
    T111_E2E_PASSWORD: password,
    T116_PERMISSION_GRANT_EMULATOR_E2E: "true",
    T116_E2E_ACADEMY_ID: academyId,
    T116_FUNCTIONS_EMULATOR_PORT: functionsPort,
    T116_OWNER_EMAIL: ownerEmail,
    T116_HEAD_COACH_EMAIL: headCoachEmail,
    T116_E2E_PASSWORD: password,
    T112_BIRTHDAY_EMULATOR_E2E: "true",
    T112_E2E_ACADEMY_ID: academyId,
    T112_FUNCTIONS_EMULATOR_PORT: functionsPort,
    T112_OWNER_EMAIL: ownerEmail,
    T112_HEAD_COACH_EMAIL: headCoachEmail,
    T112_ADULT_TOWN_EMAIL: adults.birthdayTown,
    T112_ADULT_WEST_EMAIL: adults.birthdayWest,
    T112_E2E_PASSWORD: password,
    T113_AGE_BAND_EMULATOR_E2E: "true",
    T113_E2E_ACADEMY_ID: academyId,
    T113_FUNCTIONS_EMULATOR_PORT: functionsPort,
    T113_OWNER_EMAIL: ownerEmail,
    T113_HEAD_COACH_EMAIL: headCoachEmail,
    T113_GUARDIAN_EMAIL: levelsGuardianEmail,
    T113_E2E_PASSWORD: password,
    T097_PROGRESS_EMULATOR_E2E: "true",
    T097_E2E_ACADEMY_ID: academyId,
    T097_FUNCTIONS_EMULATOR_PORT: functionsPort,
    T097_OWNER_EMAIL: ownerEmail,
    T097_HEAD_COACH_EMAIL: headCoachEmail,
    T097_ADULT_EMAIL: adults.progress,
    T097_GUARDIAN_EMAIL: progressGuardianEmail,
    T097_E2E_PASSWORD: password,
  },
);
