// Synthetic world for the member gamification and social emulator E2E (plan 2026-09-24, task 9.3).
// Emulator-only (demo-bpt-jersey). Run by qa/scripts/run-member-engagement-ui-e2e.mjs, once per
// Playwright project, each into its own academy so the two projects never share state.
//
// People are written through the same writers the approvals use (canonical directory, family
// store, guardian profile store), so their records are what production would hold. Sessions,
// memberships, attendance, bookings and waiver acceptances are plain documents in the shapes the
// services write. The leaderboard snapshot is built by the nightly job's own logic.
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve(import.meta.dirname, "../..");
const projectId = "demo-bpt-jersey";

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment: ${name}`);
  return value;
}
for (const name of ["FIRESTORE_EMULATOR_HOST", "FIREBASE_AUTH_EMULATOR_HOST"]) {
  if (!/^127\.0\.0\.1:\d{4,5}$/u.test(process.env[name] ?? ""))
    throw new Error(`${name} must be loopback`);
}
if (process.env.GCLOUD_PROJECT !== projectId) throw new Error("Seed requires demo-bpt-jersey");

const academyId = required("MGE_ACADEMY_ID");
if (!/^[a-z][a-z0-9-]{2,60}$/u.test(academyId)) throw new Error("MGE_ACADEMY_ID must be a slug");
const prefix = required("MGE_EMAIL_PREFIX");
const password = required("MGE_PASSWORD");
if (password.length < 12)
  throw new Error("MGE_PASSWORD must be a synthetic 12+ character password");
const worldFile = required("MGE_WORLD_FILE");
const email = (name) => `${prefix}.${name}@example.test`;

function node(args, extra = {}) {
  const result = spawnSync(process.execPath, args, {
    cwd: root,
    env: { ...process.env, ...extra },
    stdio: "inherit",
  });
  if (result.status !== 0) throw new Error(`seed step failed: ${args.join(" ")}`);
}

// Owner (Auth + staff document), empty canonical directory, Levels catalog, one head coach.
const ownerEmail = email("owner");
const coachEmail = email("coach");
const ownerEnvironment = {
  T093_E2E_ACADEMY_ID: academyId,
  AUTH_EMULATOR_E2E_ACADEMY_ID: academyId,
  AUTH_EMULATOR_E2E_EMAIL: ownerEmail,
  AUTH_EMULATOR_E2E_PASSWORD: password,
  AUTH_EMULATOR_E2E_ROLE: "owner",
};
node(["qa/scripts/seed-auth-emulator.mjs"], ownerEnvironment);
node(["qa/scripts/seed-member-directory-emulator.mjs"], ownerEnvironment);
node([
  "apps/functions/scripts/member-directory-empty-initialize.mjs",
  `--academy-id=${academyId}`,
  "--confirmation=T093-EMPTY-CANONICAL-INITIALIZE",
]);
node(["apps/functions/scripts/seed-levels.mjs", "--target=emulator", `--academy-id=${academyId}`]);
node(["qa/scripts/seed-staff-emulator.mjs"], {
  T097_E2E_ACADEMY_ID: academyId,
  T097_E2E_PASSWORD: password,
  T097_HEAD_COACH_EMAIL: coachEmail,
});

const artifact = resolve(root, ".firebase-functions");
const requireFunctions = createRequire(resolve(artifact, "package.json"));
const load = (path) => import(pathToFileURL(resolve(artifact, "lib/src", path)).href);
const { initializeApp } = requireFunctions("firebase-admin/app");
const { getAuth } = requireFunctions("firebase-admin/auth");
const { getFirestore } = requireFunctions("firebase-admin/firestore");
const [
  { createCanonicalMemberDirectoryService },
  { createMemberDirectoryFirestoreAdapters },
  { createFamilyStore },
  { createGuardianProfileStore },
  { createPlanStore },
  { buildLeaderboardRows },
  engagement,
] = await Promise.all([
  load("members/canonical-member-directory-service.js"),
  load("members/member-directory-firestore.js"),
  load("families/family-service.js"),
  load("profiles/guardian-profile-service.js"),
  load("memberships/plan-service.js"),
  load("competitors/public-card.js"),
  import(pathToFileURL(requireFunctions.resolve("@bpt-jersey/domain/members/engagement")).href),
]);

const app = initializeApp({ projectId }, `mge-seed-${academyId}`);
const firestore = getFirestore(app);
const auth = getAuth(app);
const base = `academies/${academyId}`;
const now = new Date();
const nowIso = now.toISOString();
const owner = await auth.getUserByEmail(ownerEmail);
const actor = {
  actorId: owner.uid,
  academyId,
  role: "owner",
  active: true,
  appCheckVerified: true,
};
const control = {
  projectId,
  identitySecretMaterial: required("MEMBER_DIRECTORY_IDENTITY_KEY_SECRET"),
  identitySecretVersion: "identity-v1",
  integritySecretMaterial: required("MEMBER_DIRECTORY_MIGRATION_INTEGRITY_SECRET"),
  integritySecretVersion: "integrity-v1",
};
const directory = createCanonicalMemberDirectoryService({
  ...control,
  firestore: createMemberDirectoryFirestoreAdapters(firestore).writer,
});
const families = createFamilyStore({
  firestore,
  canonicalControl: control,
  auth: {
    getUser: async (uid) => {
      const user = await auth.getUser(uid);
      return {
        uid: user.uid,
        emailVerified: user.emailVerified,
        disabled: user.disabled,
        ...(user.customClaims ? { customClaims: user.customClaims } : {}),
      };
    },
  },
});
const guardianProfiles = createGuardianProfileStore({
  firestore,
  integritySecretMaterial: control.integritySecretMaterial,
  integritySecretVersion: control.integritySecretVersion,
});

await createPlanStore({ firestore }).seedPlanCatalog({
  academyId,
  actorId: owner.uid,
  now: nowIso,
});

// ---------------------------------------------------------------------------------------------
// People. Ages are measured today on the Jersey calendar, so the dates of birth move with the run.
const yearsAgo = (years, monthDay = "01-15") => `${now.getUTCFullYear() - years}-${monthDay}`;
const minor = (fullName, age, extra = {}) => ({
  fullName,
  // Born in January: already had this year's birthday whenever the suite runs after 15 January.
  dateOfBirth: yearsAgo(age),
  trainingCenter: "Town",
  trainingTimePreferences: ["afternoon"],
  ...extra,
});

async function account(key, displayName, role) {
  const user = await auth.createUser({
    email: email(key),
    password,
    emailVerified: true,
    displayName,
  });
  await auth.setCustomUserClaims(user.uid, { academyId, role });
  return user;
}

let phoneSequence = 100;
async function adultWithAccount(key, fullName, age) {
  const user = await account(key, fullName, "adultStudent");
  const phoneNumber = `+44153455${String(phoneSequence++).padStart(4, "0")}`;
  const { studentId } = await directory.createAdminAdultForAccount({
    actor,
    enrolmentRequestId: `mge-${key}`,
    value: {
      requestId: randomUUID(),
      fullName,
      dateOfBirth: yearsAgo(age, "03-10"),
      phoneNumber,
      email: email(key),
      trainingCenter: "Town",
      trainingTimePreferences: ["evening"],
    },
    account: { userId: user.uid, displayName: fullName, email: email(key) },
    now: new Date().toISOString(),
  });
  return { key, uid: user.uid, studentId, fullName, email: email(key), phoneNumber };
}

async function guardianFamily(guardian, children) {
  await guardianProfiles.saveGuardianProfile({
    academyId,
    userId: guardian.uid,
    email: guardian.email,
    requestId: randomUUID(),
    displayName: guardian.fullName,
    phoneNumber: guardian.phoneNumber,
    now: new Date().toISOString(),
  });
  await auth.setCustomUserClaims(guardian.uid, { academyId, role: "guardian" });
  const family = await families.createFamily({
    academyId,
    actorId: owner.uid,
    actorRole: "owner",
    enrolmentRequestId: `mge-family-${guardian.key}`,
    requestId: randomUUID(),
    tutorUserId: guardian.uid,
    students: children,
    now: new Date().toISOString(),
  });
  return children.map((child) => {
    const written = family.students.find((student) => student.fullName === child.fullName);
    if (!written) throw new Error(`Family writer did not return ${child.fullName}`);
    return {
      studentId: written.studentId,
      fullName: child.fullName,
      dateOfBirth: child.dateOfBirth,
    };
  });
}

// Adults with their own accounts. Taylor trains AND is the guardian of Charlie (13) and Poppy (9).
const avery = await adultWithAccount("avery", "Avery Stone", 31);
const blake = await adultWithAccount("blake", "Blake Rivers", 27);
const casey = await adultWithAccount("casey", "Casey Morgan", 35);
const dana = await adultWithAccount("dana", "Dana Frost", 29); // hidden from other members
const eli = await adultWithAccount("eli", "Eli Brooks", 41); // never accepted the academy terms
const finley = await adultWithAccount("finley", "Finley Hart", 24);
const gray = await adultWithAccount("gray", "Gray Wolfe", 38);
const taylor = await adultWithAccount("taylor", "Taylor Parker", 40);
const [charlie, poppy] = await guardianFamily(taylor, [
  minor("Charlie Parker", 13),
  minor("Poppy Parker", 9),
]);
// A second family for the other teens and kids; the guardian does not train.
const leeUser = await account("lee", "Morgan Lee", "guardian");
const [jordan, kai, rory, sky] = await guardianFamily(
  {
    key: "lee",
    uid: leeUser.uid,
    email: email("lee"),
    fullName: "Morgan Lee",
    phoneNumber: "+441534559900",
  },
  [minor("Jordan Lee", 14), minor("Kai Lee", 15), minor("Rory Lee", 8), minor("Sky Lee", 10)],
);

// ---------------------------------------------------------------------------------------------
// Memberships, programs and sessions.
const students = [
  ...[avery, blake, casey, dana, eli, finley, gray, taylor].map((person) => ({
    ...person,
    planId: "town-adult",
  })),
  ...[charlie, jordan, kai].map((person) => ({ ...person, planId: "town-teens" })),
  ...[poppy, rory, sky].map((person) => ({ ...person, planId: "town-kids-2x" })),
];
const audit = {
  schemaVersion: "1",
  createdAt: nowIso,
  createdBy: owner.uid,
  updatedAt: nowIso,
  updatedBy: owner.uid,
};
const writes = [];
for (const person of students) {
  const snapshot = await firestore.doc(`${base}/students/${person.studentId}`).get();
  const familyId = snapshot.get("familyId");
  if (typeof familyId !== "string") throw new Error(`No family on ${person.fullName}`);
  const membershipId = `mge-membership-${person.studentId}`;
  writes.push(
    firestore.doc(`${base}/memberships/${membershipId}`).set({
      membershipId,
      academyId,
      familyId,
      studentId: person.studentId,
      planId: person.planId,
      status: "active",
      startsAt: `${now.getUTCFullYear() - 1}-08-01T00:00:00.000Z`,
      endsAt: null,
      nextBillingAt: null,
      ...audit,
    }),
  );
}
for (const [programId, name, ageBand] of [
  ["mge-adult-bjj", "Adult BJJ", "adult"],
  ["mge-teens-bjj", "Teens BJJ", "teens"],
  ["mge-kids-bjj", "Kids BJJ", "kids"],
]) {
  writes.push(
    firestore.doc(`${base}/programs/${programId}`).set({
      programId,
      academyId,
      name,
      ageBand,
      discipline: "bjj",
      level: "all-levels",
      active: true,
      schemaVersion: "1",
    }),
  );
}
function sessionDocument(sessionId, programId, title, start, extra = {}) {
  return {
    sessionId,
    academyId,
    classId: null,
    programId,
    locationId: "town",
    instructorId: "mge-coach",
    title,
    startAt: start.toISOString(),
    endAt: new Date(start.getTime() + 3_600_000).toISOString(),
    capacity: 30,
    minParticipants: 1,
    status: "scheduled",
    isSeminar: false,
    cancellationReason: null,
    ...extra,
    ...audit,
  };
}
const dayStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
const pastStart = (daysAgo, hour) => new Date(dayStart - daysAgo * 86_400_000 + hour * 3_600_000);
const seasonStartIso = new Date(
  Date.parse(`${engagement.seasonStartFor(nowIso)}T00:00:00.000Z`) - 3_600_000,
).toISOString();
if (pastStart(18, 10).toISOString() <= seasonStartIso) {
  throw new Error(
    "The streak fixtures need 18 days of this season behind today; run after 19 September.",
  );
}
const pastSessions = new Map();
function pastSession(daysAgo, hour) {
  const sessionId = `mge-past-${daysAgo}-${hour}`;
  if (!pastSessions.has(sessionId)) {
    pastSessions.set(
      sessionId,
      sessionDocument(sessionId, "mge-adult-bjj", "Adult BJJ", pastStart(daysAgo, hour)),
    );
  }
  return pastSessions.get(sessionId);
}
const range = (from, to) => Array.from({ length: to - from + 1 }, (_, index) => from + index);
// Attendance this season. Blake: 9 in total, the last three within a week of each other and of
// today (streak x3), the other six more than a week before them. Dana would sit directly above
// Blake if she were visible.
const attended = new Map([
  [casey, [...range(1, 12).map((day) => [day, 10]), ...range(1, 12).map((day) => [day, 18])]],
  [finley, range(1, 15).map((day) => [day, 10])],
  [gray, range(1, 12).map((day) => [day, 18])],
  [dana, range(2, 11).map((day) => [day, 10])],
  [blake, [[1, 18], [3, 18], [5, 18], ...range(13, 18).map((day) => [day, 10])]],
  [avery, [2, 4, 6, 8, 10, 12].map((day) => [day, 10])],
  [taylor, [3, 6, 9, 14].map((day) => [day, 18])],
  [eli, [4, 7].map((day) => [day, 18])],
  [charlie, [2, 5, 8, 11, 14].map((day) => [day, 16])],
  [jordan, range(1, 7).map((day) => [day, 16])],
  [kai, [3, 9, 15].map((day) => [day, 16])],
  [poppy, [2, 4, 6, 8].map((day) => [day, 15])],
  [rory, range(2, 7).map((day) => [day, 15])],
  [sky, [5, 10].map((day) => [day, 15])],
]);
for (const [person, visits] of attended) {
  for (const [daysAgo, hour] of visits) {
    const session = pastSession(daysAgo, hour);
    const occurredAt = new Date(Date.parse(session.startAt) + 5 * 60_000).toISOString();
    const attendanceId = `${session.sessionId}__${person.studentId}`;
    writes.push(
      firestore.doc(`${base}/attendance/${attendanceId}`).set({
        attendanceId,
        academyId,
        sessionId: session.sessionId,
        studentId: person.studentId,
        method: "manual",
        state: "attended",
        occurredAt,
        notes: null,
        correctionOf: null,
        schemaVersion: "1",
        createdAt: occurredAt,
        createdBy: owner.uid,
        updatedAt: occurredAt,
        updatedBy: owner.uid,
      }),
    );
  }
}
for (const session of pastSessions.values()) {
  writes.push(firestore.doc(`${base}/sessions/${session.sessionId}`).set(session));
}

// Tomorrow's booked class with the coach's plan. Avery books it; three visible adults, one hidden
// adult and two members of other age groups are booked too.
const bookedSessionId = "mge-fundamentals";
const bookedStart = new Date(dayStart + 86_400_000 + 18 * 3_600_000);
const curriculum = {
  title: "Guard retention",
  techniques: ["Hip escape", "Knee shield frame", "Technical stand-up"],
  details: "Drill in pairs, then positional rounds.",
};
writes.push(
  firestore
    .doc(`${base}/sessions/${bookedSessionId}`)
    .set(
      sessionDocument(bookedSessionId, "mge-adult-bjj", "Fundamentals", bookedStart, {
        curriculum,
      }),
    ),
);
for (const person of [avery, casey, finley, gray, dana, jordan, poppy]) {
  const bookingId = `v2:${bookedSessionId.length}:${bookedSessionId}:${person.studentId.length}:${person.studentId}`;
  writes.push(
    firestore.doc(`${base}/bookings/${bookingId}`).set({
      bookingId,
      academyId,
      sessionId: bookedSessionId,
      studentId: person.studentId,
      membershipId: `mge-membership-${person.studentId}`,
      status: "confirmed",
      requestedAt: nowIso,
      cancelledAt: null,
      cancellationReason: null,
      ...audit,
    }),
  );
}

// Academy terms: everyone but Eli accepted the current version.
const termsVersion = "2026-09-07";
for (const person of students.filter((candidate) => candidate.studentId !== eli.studentId)) {
  writes.push(
    firestore.doc(`${base}/enrolmentWaiverAcceptances/${person.studentId}__${termsVersion}`).set({
      academyId,
      studentId: person.studentId,
      version: termsVersion,
      acceptedAt: nowIso,
      acceptedBy: owner.uid,
    }),
  );
}
// Dana does not show to other members (Q9).
writes.push(
  firestore.doc(`${base}/memberPublicSettings/${dana.studentId}`).set({
    academyId,
    studentId: dana.studentId,
    photoObjectKey: null,
    photoConsentAt: null,
    photoConsentBy: null,
    pendingPhotoObjectKey: null,
    showToMembers: false,
    updatedAt: nowIso,
  }),
);
await Promise.all(writes);

// The nightly snapshot, built by the job's own logic.
const cohorts = await buildLeaderboardRows(firestore, academyId, nowIso);
for (const cohort of ["kids", "teens", "adults"]) {
  await firestore.doc(`${base}/leaderboards/${cohort}`).set(
    engagement.leaderboardSnapshotSchema.parse({
      cohort,
      builtAt: nowIso,
      seasonStart: engagement.seasonStartFor(nowIso),
      rows: cohorts.get(cohort) ?? [],
    }),
  );
}

const world = {
  academyId,
  emails: {
    owner: ownerEmail,
    coach: coachEmail,
    avery: avery.email,
    blake: blake.email,
    casey: casey.email,
    dana: dana.email,
    eli: eli.email,
    finley: finley.email,
    gray: gray.email,
    taylor: taylor.email,
    teen: email("charlie-own"),
  },
  bookedSessionId,
  curriculum,
  names: Object.fromEntries(
    [...cohorts.entries()].map(([cohort, rows]) => [
      cohort,
      Object.fromEntries(rows.map((row) => [row.studentId, row.displayName])),
    ]),
  ),
  studentIds: Object.fromEntries(
    [
      avery,
      blake,
      casey,
      dana,
      eli,
      finley,
      gray,
      taylor,
      charlie,
      poppy,
      jordan,
      kai,
      rory,
      sky,
    ].map((person) => [person.fullName, person.studentId]),
  ),
};
mkdirSync(dirname(worldFile), { recursive: true });
writeFileSync(worldFile, `${JSON.stringify(world, null, 2)}\n`);
console.log(JSON.stringify({ seeded: academyId, adults: cohorts.get("adults")?.length ?? 0 }));
process.exit(0);
