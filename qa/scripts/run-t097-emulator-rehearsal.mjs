import { spawnSync } from "node:child_process";
import { existsSync, renameSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

// T097 rehearsal with Firebase Emulators (ADR-009, Enmienda 2026-10-21), synthetic secrets only.
// Run inside `firebase emulators:exec --project demo-bpt-jersey --only auth,firestore,functions`
// after building the deploy artifact. It initializes an empty directory, shows a real createMember
// admitted, brings the directory to the 400 bound, shows createMember refused, runs the operator
// CLI from the artifact (refusals, dry run, apply, replay) and shows createMember admitted again.
const repositoryRoot = resolve(import.meta.dirname, "../..");
const artifactRoot = resolve(repositoryRoot, ".firebase-functions");
const projectId = "demo-bpt-jersey";
const functionsBaseUrl = `http://127.0.0.1:5001/${projectId}/europe-west9`;
const authUrl = `http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo`;

if (
  process.env.T097_EMULATOR_REHEARSAL !== "true" ||
  process.env.GCLOUD_PROJECT !== projectId ||
  process.env.FIRESTORE_EMULATOR_HOST !== "127.0.0.1:8080" ||
  process.env.FIREBASE_AUTH_EMULATOR_HOST !== "127.0.0.1:9099"
) {
  throw new Error("T097 rehearsal requires the local demo-project emulators and its flag.");
}

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment: ${name}`);
  return value;
}

const academyId = required("T093_E2E_ACADEMY_ID");
const email = required("AUTH_EMULATOR_E2E_EMAIL");
const password = required("AUTH_EMULATOR_E2E_PASSWORD");
const integritySecret = required("MEMBER_DIRECTORY_MIGRATION_INTEGRITY_SECRET");
required("MEMBER_DIRECTORY_IDENTITY_KEY_SECRET");
required("MEMBER_DIRECTORY_BASELINE_ENCRYPTION_SECRET");

const results = [];
function check(name, ok, detail = "") {
  results.push({ check: name, status: ok ? "PASS" : "FAIL", ...(detail ? { detail } : {}) });
  if (!ok) {
    process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
    throw new Error(`Rehearsal check failed: ${name}`);
  }
}

const seedEnvironment = {
  ...process.env,
  AUTH_EMULATOR_E2E: "true",
  AUTH_EMULATOR_E2E_ROLE: "owner",
  AUTH_EMULATOR_E2E_ACADEMY_ID: academyId,
};
function runNode(args, options = {}) {
  return spawnSync(process.execPath, args, {
    cwd: options.cwd ?? repositoryRoot,
    env: options.env ?? seedEnvironment,
    encoding: "utf8",
    windowsHide: true,
  });
}
function mustRun(args) {
  const result = runNode(args);
  if (result.error) throw result.error;
  if (result.status !== 0) {
    process.stderr.write(result.stderr ?? "");
    throw new Error(`Setup step failed: ${args[0]}`);
  }
}

// The initializer binds a private baseline to the secrets of the run that made it.
const baselines = resolve(repositoryRoot, ".tmp/member-directory-baselines");
if (existsSync(baselines)) renameSync(baselines, `${baselines}.before-t097-${Date.now()}`);
mustRun(["qa/scripts/seed-auth-emulator.mjs"]);
mustRun(["qa/scripts/seed-member-directory-emulator.mjs"]);
mustRun([
  "apps/functions/scripts/member-directory-empty-initialize.mjs",
  `--academy-id=${academyId}`,
  "--confirmation=T093-EMPTY-CANONICAL-INITIALIZE",
]);

const { advanceMemberDirectoryControlPlane, assertMemberDirectoryControlPlane } = await import(
  pathToFileURL(resolve(artifactRoot, "lib/src/members/member-directory-state.js")).href
);

const app = initializeApp({ projectId }, "t097-rehearsal");
const db = getFirestore(app);
const statePath = `academies/${academyId}/memberDirectoryStates/current`;
const guardPath = `memberDirectoryRestoreGuards/${academyId}`;

async function readControl() {
  const state = (await db.doc(statePath).get()).data();
  const guard = (await db.doc(guardPath).get()).data();
  const event = (await db.doc(`${guardPath}/events/${guard.lastEventId}`).get()).data();
  return { state, guard, event };
}

function base64Url(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}
// Unsigned, emulator-only App Check token, as in member-directory-auth-emulator.spec.ts.
function syntheticAppCheckToken() {
  const now = Math.floor(Date.now() / 1000);
  return `${base64Url({ alg: "none", typ: "JWT" })}.${base64Url({
    sub: `1:${projectId}:web:t097-rehearsal`,
    aud: [`projects/${projectId}`],
    iss: `https://firebaseappcheck.googleapis.com/${projectId}`,
    iat: now,
    exp: now + 3_600,
  })}.emulator-only`;
}

const session = await (
  await fetch(authUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  })
).json();
check("owner signs in to the Auth emulator", typeof session.idToken === "string");
const ownerUid = session.localId;

async function call(name, data) {
  const response = await fetch(`${functionsBaseUrl}/${name}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.idToken}`,
      "X-Firebase-AppCheck": syntheticAppCheckToken(),
    },
    body: JSON.stringify({ data }),
  });
  return { status: response.status, body: await response.json() };
}

let sequence = 0;
function adult() {
  sequence += 1;
  const suffix = `${Date.now().toString(36)}${sequence}`;
  return {
    requestId: `t097-rehearsal-${suffix}`,
    fullName: `Synthetic T097 Adult ${sequence}`,
    dateOfBirth: "1990-01-02",
    phoneNumber: `+44153400${String(1000 + sequence)}`,
    email: `t097-${suffix}@example.test`,
    trainingCenter: "Town",
    trainingTimePreferences: ["evening"],
    membershipNumber: String(900_000_000 + sequence),
    gender: "unknown",
    emergencyContact: {
      fullName: "Synthetic T097 Contact",
      relationship: "Spouse",
      phoneNumber: "+441534009797",
    },
  };
}

function cli(args, secret = integritySecret) {
  const result = runNode(
    [resolve(artifactRoot, "scripts/eliminate-legacy-member-reads.mjs"), ...args],
    {
      cwd: artifactRoot,
      env: { ...process.env, MEMBER_DIRECTORY_MIGRATION_INTEGRITY_SECRET: secret },
    },
  );
  let json;
  try {
    json = JSON.parse(result.stdout);
  } catch {
    json = undefined;
  }
  return { status: result.status, json, stderr: (result.stderr ?? "").trim() };
}
const target = ["--project", projectId, "--target", "emulator", "--academy-id", academyId];

try {
  // 1. A fresh directory admits through the real callable.
  const admitted = await call("createMember", adult());
  check(
    "createMember admits on a fresh directory",
    admitted.status === 200,
    String(admitted.status),
  );

  // 2. Fixture: ONE guarded transition takes the counter to the bound (production got there
  // through 400 admissions; the T097 transaction does not care how).
  await db.runTransaction(async (transaction) => {
    const read = async (path) => (await transaction.get(db.doc(path))).data();
    const state = await read(statePath);
    const guard = await read(guardPath);
    const event = await read(`${guardPath}/events/${guard.lastEventId}`);
    const control = assertMemberDirectoryControlPlane({
      projectId,
      state,
      guard,
      event,
      integritySecretMaterial: integritySecret,
      integritySecretVersion: "integrity-v1",
    });
    const now = new Date().toISOString();
    const nextState = {
      ...control.state,
      rollbackEligibleStudentCount: 400,
      stateRevision: control.state.stateRevision + 1,
      updatedAt: now,
      updatedBy: "system:t097-rehearsal",
    };
    const next = advanceMemberDirectoryControlPlane({
      projectId,
      state: control.state,
      guard: control.guard,
      event: control.event,
      nextState,
      operationId: "t097-rehearsal-bound",
      transitionKind: "canonical-identity-create",
      integritySecretMaterial: integritySecret,
      integritySecretVersion: "integrity-v1",
      now,
      actorId: "system:t097-rehearsal",
    });
    transaction.set(db.doc(statePath), nextState);
    transaction.set(db.doc(guardPath), { ...next.guard });
    transaction.create(db.doc(`${guardPath}/events/${next.event.eventId}`), { ...next.event });
  });
  const atBound = await readControl();
  check(
    "directory sits at 400/400 with the marker false",
    atBound.state.rollbackEligibleStudentCount === 400 &&
      atBound.state.rollbackCapacityLimit === 400 &&
      atBound.state.globalLegacyReadEliminated === false,
  );

  // 3. At the bound the real callable refuses and nothing moves.
  const refused = await call("createMember", adult());
  const afterRefusal = await readControl();
  check(
    "createMember is refused at 400/400",
    refused.status !== 200 && afterRefusal.state.stateRevision === atBound.state.stateRevision,
    `${refused.status} ${refused.body?.error?.message ?? ""}`,
  );

  // 4. CLI refusals that must write nothing.
  const wrongSecret = cli(target, `${integritySecret.slice(0, -4)}AAAA`);
  check(
    "dry run refuses a wrong integrity secret",
    wrongSecret.status === 1 && /control plane could not be verified/u.test(wrongSecret.stderr),
    wrongSecret.stderr,
  );
  const dryRun = cli(target);
  check(
    "dry run is ready with no unmet precondition",
    dryRun.status === 0 &&
      dryRun.json?.status === "ready" &&
      dryRun.json.unmetPreconditions.length === 0 &&
      dryRun.json.legacyMemberDocuments === 0 &&
      dryRun.json.nextState.globalLegacyReadEliminated === true &&
      dryRun.json.nextState.rollbackEligibleStudentCount === 400,
    dryRun.stderr,
  );
  const confirmation = dryRun.json.expectedConfirmation;
  const wrongConfirmation = cli([
    ...target,
    "--apply",
    "--actor-id",
    ownerUid,
    "--confirmation",
    `${confirmation.slice(0, -1)}0`,
  ]);
  const afterWrong = await readControl();
  check(
    "apply refuses a confirmation that is not the dry run's",
    wrongConfirmation.status === 1 &&
      /does not match/u.test(wrongConfirmation.stderr) &&
      afterWrong.state.stateRevision === atBound.state.stateRevision,
    wrongConfirmation.stderr,
  );

  const legacyMember = db.doc(`academies/${academyId}/members/t097-rehearsal-legacy`);
  await legacyMember.set({ rehearsal: true });
  const blockedMembers = cli(target);
  const blockedApply = cli([
    ...target,
    "--apply",
    "--actor-id",
    ownerUid,
    "--confirmation",
    blockedMembers.json?.expectedConfirmation ?? "missing",
  ]);
  await legacyMember.delete();
  check(
    "a legacy members document blocks the dry run and the apply",
    blockedMembers.json?.status === "blocked" &&
      blockedMembers.json.unmetPreconditions.join(",") === "legacy-members-empty" &&
      blockedApply.status === 1 &&
      (await readControl()).state.stateRevision === atBound.state.stateRevision,
    blockedApply.stderr,
  );

  const nested = db.doc(`academies/${academyId}/students/t097-rehearsal-student/graduations/old`);
  await nested.set({ rehearsal: true });
  const blockedNested = cli(target);
  await nested.delete();
  check(
    "nested legacy history blocks the dry run",
    blockedNested.json?.status === "blocked" &&
      blockedNested.json.unmetPreconditions.join(",") === "nested-legacy-history-adapted" &&
      blockedNested.json.nestedLegacyHistory.graduations === 1,
  );

  // 5. The real thing: dry run, apply, replay.
  const fresh = cli(target);
  check("fresh dry run is ready", fresh.json?.status === "ready", fresh.stderr);
  const applied = cli([
    ...target,
    "--apply",
    "--actor-id",
    ownerUid,
    "--confirmation",
    fresh.json.expectedConfirmation,
  ]);
  check(
    "apply eliminates legacy reads at the next revision",
    applied.status === 0 &&
      applied.json?.status === "eliminated" &&
      applied.json.stateRevision === atBound.state.stateRevision + 1,
    applied.stderr,
  );
  const replay = cli([
    ...target,
    "--apply",
    "--actor-id",
    ownerUid,
    "--confirmation",
    fresh.json.expectedConfirmation,
  ]);
  check(
    "a repeated apply answers already-eliminated and writes nothing",
    replay.status === 0 &&
      replay.json?.status === "already-eliminated" &&
      (await readControl()).state.stateRevision === atBound.state.stateRevision + 1,
    replay.stderr,
  );

  // 6. The new triple verifies with the functions' own primitive; the audit event exists.
  const eliminated = await readControl();
  let verified = false;
  try {
    assertMemberDirectoryControlPlane({
      projectId,
      ...eliminated,
      integritySecretMaterial: integritySecret,
      integritySecretVersion: "integrity-v1",
    });
    verified = true;
  } catch {
    verified = false;
  }
  const audit = (
    await db
      .doc(
        `academies/${academyId}/auditEvents/t097-global-legacy-elimination-${eliminated.state.stateRevision}`,
      )
      .get()
  ).data();
  check(
    "state, guard and event verify, marker set, protocol disabled, counter kept as history",
    verified &&
      eliminated.state.globalLegacyReadEliminated === true &&
      eliminated.state.rollbackProtocolVersion === "disabled" &&
      eliminated.state.rollbackEligibleStudentCount === 400 &&
      eliminated.state.rollbackCapacityLimit === 400 &&
      eliminated.event.transitionKind === "global-legacy-eliminate" &&
      eliminated.guard.globalLegacyReadEverEliminated === true &&
      audit?.action === "member.directory.legacy-reads-eliminated" &&
      audit?.actorId === ownerUid,
  );

  // 7. The real callable admits again; the counter stays at 400 as history.
  const after = await call("createMember", adult());
  const admittedAfter = await readControl();
  const student = after.body?.result?.studentId
    ? (await db.doc(`academies/${academyId}/students/${after.body.result.studentId}`).get()).exists
    : false;
  check(
    "createMember admits after T097 and the counter stays at 400",
    after.status === 200 &&
      student &&
      admittedAfter.state.rollbackEligibleStudentCount === 400 &&
      admittedAfter.state.stateRevision === eliminated.state.stateRevision + 1,
    String(after.status),
  );
  process.stdout.write(`${JSON.stringify(results, null, 2)}\nT097 REHEARSAL PASSED\n`);
} finally {
  await deleteApp(app);
}
