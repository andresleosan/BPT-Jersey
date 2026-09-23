// Synthetic data for the recovery/enrolment browser E2E. Emulator-only (demo-bpt-jersey).
// Run by qa/scripts/run-recovery-stack.mjs after the Emulators are ready.
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve(import.meta.dirname, "../..");
const projectId = "demo-bpt-jersey";
const academyId = process.env.RECOVERY_E2E_ACADEMY_ID ?? "demo-academy";
const password = process.env.RECOVERY_E2E_PASSWORD ?? "synthetic-pass-2026";
export const ownerEmail = "recovery-owner@example.test";

for (const [name, value] of [
  ["FIRESTORE_EMULATOR_HOST", process.env.FIRESTORE_EMULATOR_HOST],
  ["FIREBASE_AUTH_EMULATOR_HOST", process.env.FIREBASE_AUTH_EMULATOR_HOST],
]) {
  if (!/^127\.0\.0\.1:\d{4,5}$/u.test(value ?? "")) throw new Error(`${name} must be loopback`);
}
if (process.env.GCLOUD_PROJECT !== projectId) throw new Error("Seed requires demo-bpt-jersey");

const requireFunctions = createRequire(resolve(root, ".firebase-functions/package.json"));
const { initializeApp } = requireFunctions("firebase-admin/app");
const { getAuth } = requireFunctions("firebase-admin/auth");
const { getFirestore } = requireFunctions("firebase-admin/firestore");

function node(args, extra = {}) {
  const result = spawnSync(process.execPath, args, {
    cwd: root,
    env: { ...process.env, ...extra },
    stdio: "inherit",
  });
  if (result.status !== 0) throw new Error(`seed step failed: ${args.join(" ")}`);
}

// Owner: Auth user + claims, then the provisioned staff document.
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

const app = initializeApp({ projectId });
const firestore = getFirestore(app);
const owner = await getAuth(app).getUserByEmail(ownerEmail);
const { createPlanStore } = await import(
  pathToFileURL(resolve(root, ".firebase-functions/lib/src/memberships/plan-service.js")).href
);
await createPlanStore({ firestore }).seedPlanCatalog({
  academyId,
  actorId: owner.uid,
  now: new Date().toISOString(),
});
// Bookable classes: one adult evening class and one kids afternoon class at Town, every day
// for the next week, so every flow can end with a real booking.
const createdAt = new Date().toISOString();
const writes = [];
for (const [programId, name, ageBand] of [
  ["recovery-adult-bjj", "Adult BJJ", "adult"],
  ["recovery-kids-bjj", "Kids BJJ", "kids"],
]) {
  writes.push(
    firestore.doc(`academies/${academyId}/programs/${programId}`).set({
      programId, academyId, name, ageBand, discipline: "bjj", level: "all-levels",
      active: true, schemaVersion: "1",
    }),
  );
}
for (let day = 1; day <= 7; day += 1) {
  for (const [programId, title, hourUtc, accessMode] of [
    ["recovery-adult-bjj", "Adult BJJ", 18],
    ["recovery-kids-bjj", "Kids BJJ", 16],
    // Trial members book Introduction Classes only.
    ["recovery-adult-bjj", "Adult Introduction Class", 10, "intro"],
    ["recovery-kids-bjj", "Kids Introduction Class", 9, "intro"],
  ]) {
    const start = new Date();
    start.setUTCDate(start.getUTCDate() + day);
    start.setUTCHours(hourUtc, 0, 0, 0);
    const sessionId = `${programId}-${accessMode ?? "class"}-d${day}`;
    writes.push(
      firestore.doc(`academies/${academyId}/sessions/${sessionId}`).set({
        sessionId, academyId, classId: null, programId, locationId: "town",
        instructorId: "recovery-coach", title, startAt: start.toISOString(),
        endAt: new Date(start.getTime() + 3_600_000).toISOString(), capacity: 20,
        minParticipants: 1, status: "scheduled", isSeminar: false, cancellationReason: null,
        ...(accessMode ? { accessMode } : {}),
        schemaVersion: "1", createdAt, createdBy: owner.uid, updatedAt: createdAt,
        updatedBy: owner.uid,
      }),
    );
  }
}
// An existing member with an app login and a paid plan who never accepted the online waiver,
// like the members migrated before online registration (rule R6).
const legacyEmail = "legacy-member@example.test";
const legacy = await getAuth(app).createUser({ email: legacyEmail, password, emailVerified: true,
  displayName: "Morgan Legacy" });
await getAuth(app).setCustomUserClaims(legacy.uid, { academyId, role: "adultStudent" });
const audit = { active: true, status: "active", schemaVersion: "1", createdAt, createdBy: owner.uid,
  updatedAt: createdAt, updatedBy: owner.uid };
const legacyFamily = `office-${legacy.uid}`;
writes.push(
  firestore.doc(`academies/${academyId}/users/${legacy.uid}`).set({ userId: legacy.uid, academyId,
    accountType: "client", displayName: "Morgan Legacy", email: legacyEmail,
    phoneNumber: "+441534555020", ...audit }),
  firestore.doc(`academies/${academyId}/students/${legacy.uid}`).set({ studentId: legacy.uid,
    academyId, familyId: legacyFamily, userId: legacy.uid, fullName: "Morgan Legacy",
    dateOfBirth: "1988-02-02", phoneNumber: "+441534555020", email: legacyEmail,
    trainingCenter: "Town", trainingTimePreferences: ["evening"], participantType: "adult",
    ...audit }),
  firestore.doc(`academies/${academyId}/families/${legacyFamily}`).set({ familyId: legacyFamily,
    academyId, primaryContactUserId: legacy.uid, billingContactUserId: legacy.uid, ...audit }),
  firestore.doc(`academies/${academyId}/memberships/legacy-membership`).set({
    membershipId: "legacy-membership", academyId, familyId: legacyFamily, studentId: legacy.uid,
    planId: "town-adult", status: "active", startsAt: createdAt, endsAt: null, nextBillingAt: null,
    schemaVersion: "1", createdAt, createdBy: owner.uid, updatedAt: createdAt, updatedBy: owner.uid,
  }),
);
await Promise.all(writes);
console.log(JSON.stringify({ seeded: academyId, owner: owner.uid }));
