import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  assertFails,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { collection, deleteDoc, doc, getDoc, getDocs, setDoc, updateDoc } from "firebase/firestore";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

const projectId = `demo-bpt-jersey-staff-boundary-${process.pid}`;
const academyIds = Object.freeze(["academy-a", "academy-b"] as const);
const staffCollections = Object.freeze([
  "staff",
  "staffAvailability",
  "staffAssignments",
  "adminRoleLocks",
] as const);
const actorCases = Object.freeze([
  { name: "anonymous", uid: null, claims: undefined },
  { name: "client", uid: "client-1", claims: { academyId: "academy-a", role: "client" } },
  { name: "coach", uid: "coach-1", claims: { academyId: "academy-a", role: "coach" } },
  { name: "owner", uid: "owner-1", claims: { academyId: "academy-a", role: "owner" } },
  {
    name: "administrator",
    uid: "administrator-1",
    claims: { academyId: "academy-a", role: "administrator" },
  },
] as const);

let testEnvironment: RulesTestEnvironment;
type RulesFirestore = ReturnType<
  ReturnType<RulesTestEnvironment["unauthenticatedContext"]>["firestore"]
>;

async function seedSyntheticData(): Promise<void> {
  await testEnvironment.withSecurityRulesDisabled(async (context) => {
    const firestore = context.firestore();
    await Promise.all(
      academyIds.flatMap((academyId) =>
        staffCollections.map((collectionName) =>
          setDoc(doc(firestore, `academies/${academyId}/${collectionName}/synthetic-1`), {
            academyId,
            synthetic: true,
          }),
        ),
      ),
    );
  });
}

async function assertStaffCollectionDenied(
  firestore: RulesFirestore,
  academyId: string,
  collectionName: (typeof staffCollections)[number],
): Promise<void> {
  const path = `academies/${academyId}/${collectionName}`;
  const existing = doc(firestore, `${path}/synthetic-1`);
  const candidate = doc(firestore, `${path}/candidate-1`);

  await Promise.all([
    assertFails(getDoc(existing)),
    assertFails(getDocs(collection(firestore, path))),
    assertFails(setDoc(candidate, { academyId, synthetic: true })),
    assertFails(updateDoc(existing, { synthetic: false })),
    assertFails(deleteDoc(existing)),
  ]);
}

beforeAll(async () => {
  const firestoreRules = await readFile(resolve("firestore.rules"), "utf8");
  testEnvironment = await initializeTestEnvironment({
    projectId,
    firestore: { rules: firestoreRules },
  });
});

beforeEach(seedSyntheticData);

afterEach(async () => {
  await testEnvironment.clearFirestore();
});

afterAll(async () => {
  await testEnvironment.cleanup();
});

describe("staff direct Firestore boundary", () => {
  it.each(actorCases)(
    "denies every staff path operation for $name",
    async ({ uid, claims, name }) => {
      const context =
        uid === null
          ? testEnvironment.unauthenticatedContext()
          : testEnvironment.authenticatedContext(uid, claims);
      const academies = name === "administrator" ? academyIds : [academyIds[0]];

      for (const academyId of academies) {
        for (const collectionName of staffCollections) {
          await assertStaffCollectionDenied(context.firestore(), academyId, collectionName);
        }
      }
    },
    120_000,
  );

  it("denies an administrator from crossing academy boundaries", async () => {
    const firestore = testEnvironment
      .authenticatedContext("administrator-1", {
        academyId: "academy-a",
        role: "administrator",
      })
      .firestore();

    for (const academyId of academyIds) {
      await assertStaffCollectionDenied(firestore, academyId, "staff");
    }

    expect(academyIds).toHaveLength(2);
  });
});
