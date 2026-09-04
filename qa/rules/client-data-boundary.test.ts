import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  assertFails,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { get, ref, set } from "firebase/database";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  setDoc,
  setLogLevel,
  updateDoc,
} from "firebase/firestore";
import { afterAll, afterEach, beforeAll, beforeEach, describe, it } from "vitest";

const projectId = `demo-bpt-jersey-client-boundary-${process.pid}`;
const academyId = "demo-academy";
const academyRoot = `academies/${academyId}`;
const presencePath = `${academyRoot}/presence/session-1/student-1`;

const canonicalCollections = Object.freeze([
  "users",
  "families",
  "students",
  "staff",
  "relationships",
  "locations",
  "programs",
  "classes",
  "sessions",
  "plans",
  "bookings",
  "waitlistEntries",
  "attendance",
  "checkouts",
  "memberships",
  "invoices",
  "payments",
  "paymentEvents",
  "assessments",
  "skillProgress",
  "recognitions",
  "leads",
  "messages",
  "deliveryEvents",
  "notificationPreferences",
  "healthProfiles",
  "safeguardingCases",
  "waiverVersions",
  "consents",
  "documents",
  "auditEvents",
  "exports",
  "regyfitAccessRecords",
] as const);
const academyBackendOnlyCollections = Object.freeze([
  "members",
  "memberImportOperations",
  "adminRoleLocks",
  "sessionCapacityStates",
  "bookingQuotaStates",
  "waitlistPositionStates",
] as const);
const rootBackendOnlyCollections = Object.freeze([
  "memberReportExports",
  "memberReportRateLimits",
  "memberImportSessions",
  "memberImportCleanupJournal",
  "memberImportPreviews",
] as const);
const familyRelationshipCollections = Object.freeze(["families", "relationships"] as const);
const planCollections = Object.freeze(["plans"] as const);
const membershipCollections = Object.freeze(["memberships"] as const);
const financeCollections = Object.freeze(["invoices", "payments"] as const);
const academyCollections = Object.freeze([
  ...canonicalCollections,
  ...academyBackendOnlyCollections,
]);
const actorCases = Object.freeze([
  { name: "anonymous", uid: null, claims: undefined },
  { name: "owner", uid: "owner-1", claims: { academyId, role: "owner" } },
  {
    name: "administrator",
    uid: "administrator-1",
    claims: { academyId, role: "administrator" },
  },
  { name: "headCoach", uid: "head-coach-1", claims: { academyId, role: "headCoach" } },
  { name: "coach", uid: "coach-1", claims: { academyId, role: "coach" } },
  { name: "guardian", uid: "guardian-1", claims: { academyId, role: "guardian" } },
  { name: "adultStudent", uid: "adult-1", claims: { academyId, role: "adultStudent" } },
] as const);

let testEnvironment: RulesTestEnvironment;

setLogLevel("silent");

async function clearEmulatorData(): Promise<void> {
  await Promise.all([testEnvironment.clearFirestore(), testEnvironment.clearDatabase()]);
}

async function seedSyntheticData(): Promise<void> {
  await testEnvironment.withSecurityRulesDisabled(async (context) => {
    const firestore = context.firestore();
    await Promise.all([
      setDoc(doc(firestore, academyRoot), { academyId, synthetic: true }),
      ...academyCollections.map((name) =>
        setDoc(doc(firestore, `${academyRoot}/${name}/synthetic-1`), {
          academyId,
          synthetic: true,
        }),
      ),
      ...rootBackendOnlyCollections.map((name) =>
        setDoc(doc(firestore, `${name}/synthetic-1`), { academyId, synthetic: true }),
      ),
    ]);
    await set(ref(context.database(), presencePath), {
      state: "present",
      lastSeenAt: 200,
      sessionVersion: 1,
    });
  });
}

beforeAll(async () => {
  const [firestoreRules, databaseRules] = await Promise.all([
    readFile(resolve("firestore.rules"), "utf8"),
    readFile(resolve("database.rules.json"), "utf8"),
  ]);
  testEnvironment = await initializeTestEnvironment({
    projectId,
    firestore: { rules: firestoreRules },
    database: { rules: databaseRules },
  });
});

beforeEach(async () => {
  await clearEmulatorData();
  await seedSyntheticData();
});

afterEach(clearEmulatorData);

afterAll(async () => {
  await testEnvironment.cleanup();
});

describe("client Firebase data boundary", () => {
  it.each(actorCases)(
    "keeps family and relationship collections deny-by-default for $name",
    async ({ uid, claims }) => {
      const context =
        uid === null
          ? testEnvironment.unauthenticatedContext()
          : testEnvironment.authenticatedContext(uid, claims);
      const firestore = context.firestore();

      for (const name of familyRelationshipCollections) {
        const existing = doc(firestore, `${academyRoot}/${name}/synthetic-1`);
        const candidate = doc(firestore, `${academyRoot}/${name}/candidate-family-1`);
        await Promise.all([
          assertFails(getDoc(existing)),
          assertFails(getDocs(collection(firestore, `${academyRoot}/${name}`))),
          assertFails(setDoc(candidate, { academyId, synthetic: true })),
          assertFails(updateDoc(existing, { synthetic: false })),
          assertFails(deleteDoc(existing)),
        ]);
      }
    },
    120_000,
  );

  it.each(actorCases)(
    "keeps plan collections deny-by-default for $name",
    async ({ uid, claims }) => {
      const context =
        uid === null
          ? testEnvironment.unauthenticatedContext()
          : testEnvironment.authenticatedContext(uid, claims);
      const firestore = context.firestore();

      for (const name of planCollections) {
        const existing = doc(firestore, `${academyRoot}/${name}/synthetic-1`);
        const candidate = doc(firestore, `${academyRoot}/${name}/candidate-plan-1`);
        await Promise.all([
          assertFails(getDoc(existing)),
          assertFails(getDocs(collection(firestore, `${academyRoot}/${name}`))),
          assertFails(setDoc(candidate, { academyId, synthetic: true })),
          assertFails(updateDoc(existing, { synthetic: false })),
          assertFails(deleteDoc(existing)),
        ]);
      }
    },
    120_000,
  );

  it.each(actorCases)(
    "keeps membership collections deny-by-default for $name",
    async ({ uid, claims }) => {
      const context =
        uid === null
          ? testEnvironment.unauthenticatedContext()
          : testEnvironment.authenticatedContext(uid, claims);
      const firestore = context.firestore();

      for (const name of membershipCollections) {
        const existing = doc(firestore, `${academyRoot}/${name}/synthetic-1`);
        const candidate = doc(firestore, `${academyRoot}/${name}/candidate-membership-1`);
        await Promise.all([
          assertFails(getDoc(existing)),
          assertFails(getDocs(collection(firestore, `${academyRoot}/${name}`))),
          assertFails(setDoc(candidate, { academyId, synthetic: true })),
          assertFails(updateDoc(existing, { synthetic: false })),
          assertFails(deleteDoc(existing)),
        ]);
      }
    },
    120_000,
  );

  it.each(actorCases)(
    "keeps finance collections deny-by-default for $name",
    async ({ uid, claims }) => {
      const context =
        uid === null
          ? testEnvironment.unauthenticatedContext()
          : testEnvironment.authenticatedContext(uid, claims);
      const firestore = context.firestore();

      for (const name of financeCollections) {
        const existing = doc(firestore, `${academyRoot}/${name}/synthetic-1`);
        const candidate = doc(firestore, `${academyRoot}/${name}/candidate-finance-1`);
        await Promise.all([
          assertFails(getDoc(existing)),
          assertFails(getDocs(collection(firestore, `${academyRoot}/${name}`))),
          assertFails(setDoc(candidate, { academyId, synthetic: true })),
          assertFails(updateDoc(existing, { synthetic: false })),
          assertFails(deleteDoc(existing)),
        ]);
      }
    },
    120_000,
  );

  it.each(actorCases)(
    "denies every direct Firestore and RTDB operation for $name",
    async ({ uid, claims }) => {
      const context =
        uid === null
          ? testEnvironment.unauthenticatedContext()
          : testEnvironment.authenticatedContext(uid, claims);
      const firestore = context.firestore();
      const rootDocument = doc(firestore, academyRoot);

      await Promise.all([
        assertFails(getDoc(rootDocument)),
        assertFails(updateDoc(rootDocument, { synthetic: false })),
        assertFails(deleteDoc(rootDocument)),
      ]);

      for (const name of academyCollections) {
        const existing = doc(firestore, `${academyRoot}/${name}/synthetic-1`);
        const candidate = doc(firestore, `${academyRoot}/${name}/candidate-1`);
        await Promise.all([
          assertFails(getDoc(existing)),
          assertFails(getDocs(collection(firestore, `${academyRoot}/${name}`))),
          assertFails(setDoc(candidate, { academyId, synthetic: true })),
          assertFails(updateDoc(existing, { synthetic: false })),
          assertFails(deleteDoc(existing)),
        ]);
      }

      for (const name of rootBackendOnlyCollections) {
        const existing = doc(firestore, `${name}/synthetic-1`);
        const candidate = doc(firestore, `${name}/candidate-1`);
        await Promise.all([
          assertFails(getDoc(existing)),
          assertFails(getDocs(collection(firestore, name))),
          assertFails(setDoc(candidate, { academyId, synthetic: true })),
          assertFails(updateDoc(existing, { synthetic: false })),
          assertFails(deleteDoc(existing)),
        ]);
      }

      const presence = ref(context.database(), presencePath);
      await Promise.all([
        assertFails(get(presence)),
        assertFails(set(presence, { state: "present", lastSeenAt: 300, sessionVersion: 2 })),
      ]);
    },
    120_000,
  );
});
