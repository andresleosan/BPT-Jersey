import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  assertFails,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { collection, deleteDoc, doc, getDoc, getDocs, setDoc, updateDoc } from "firebase/firestore";
import { afterAll, afterEach, beforeAll, beforeEach, describe, it } from "vitest";

const projectId = `demo-bpt-jersey-level-boundary-${process.pid}`;
const academyIds = Object.freeze(["academy-a", "academy-b"] as const);
const levelCollections = Object.freeze([
  "levelSystems",
  "levelDefinitions",
  "levelRequirements",
] as const);

const actorCases = Object.freeze([
  { name: "anonymous", uid: null, claims: undefined },
  { name: "client", uid: "client-1", claims: { academyId: "academy-a", role: "client" } },
  { name: "coach", uid: "coach-1", claims: { academyId: "academy-a", role: "coach" } },
  { name: "headCoach", uid: "headcoach-1", claims: { academyId: "academy-a", role: "headCoach" } },
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
        levelCollections.map((collectionName) =>
          setDoc(doc(firestore, `academies/${academyId}/${collectionName}/synthetic-1`), {
            academyId,
            synthetic: true,
          }),
        ),
      ),
    );
  });
}

async function assertLevelCollectionDenied(
  firestore: RulesFirestore,
  academyId: string,
  collectionName: (typeof levelCollections)[number],
): Promise<void> {
  const path = `academies/${academyId}/${collectionName}`;
  const existing = doc(firestore, `${path}/synthetic-1`);
  const candidate = doc(firestore, `${path}/candidate-1`);

  await assertFails(getDoc(existing));
  await assertFails(getDocs(collection(firestore, path)));
  await assertFails(setDoc(candidate, { academyId, candidate: true }));
  await assertFails(updateDoc(existing, { updated: true }));
  await assertFails(deleteDoc(existing));
}

beforeAll(async () => {
  const rules = await readFile(resolve(import.meta.dirname, "../../firestore.rules"), "utf8");
  testEnvironment = await initializeTestEnvironment({
    projectId,
    firestore: {
      rules,
      host: "127.0.0.1",
      port: 8080,
    },
  });
});

afterAll(async () => {
  await testEnvironment.cleanup();
});

beforeEach(async () => {
  await seedSyntheticData();
});

afterEach(async () => {
  await testEnvironment.clearFirestore();
});

describe("levels direct Firestore boundary", () => {
  for (const actor of actorCases) {
    it(`denies every level path operation for '${actor.name}'`, async () => {
      const context =
        actor.uid === null
          ? testEnvironment.unauthenticatedContext()
          : testEnvironment.authenticatedContext(actor.uid, actor.claims);
      const firestore = context.firestore();

      for (const collectionName of levelCollections) {
        await assertLevelCollectionDenied(firestore, "academy-a", collectionName);
      }
    });
  }
});
