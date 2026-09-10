import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  assertFails,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { collection, deleteDoc, doc, getDoc, getDocs, setDoc, updateDoc } from "firebase/firestore";
import { afterAll, afterEach, beforeAll, beforeEach, describe, it } from "vitest";

const projectId = "demo-bpt-jersey-lesson-planning-boundary";
const academyId = "academy-a";
const collections = Object.freeze(["techniqueLibraries", "lessonPlans"] as const);
const actors = Object.freeze([
  { name: "anonymous", uid: null, claims: undefined },
  { name: "client", uid: "client-1", claims: { academyId, role: "client" } },
  { name: "coach", uid: "coach-1", claims: { academyId, role: "coach" } },
  { name: "headCoach", uid: "headcoach-1", claims: { academyId, role: "headCoach" } },
  { name: "owner", uid: "owner-1", claims: { academyId, role: "owner" } },
  { name: "administrator", uid: "administrator-1", claims: { academyId, role: "administrator" } },
] as const);

let testEnvironment: RulesTestEnvironment;

async function seed(): Promise<void> {
  await testEnvironment.withSecurityRulesDisabled(async (context) => {
    const firestore = context.firestore();
    await Promise.all(
      collections.map((collectionName) =>
        setDoc(doc(firestore, "academies/" + academyId + "/" + collectionName + "/synthetic-1"), {
          academyId,
          schemaVersion: 1,
        }),
      ),
    );
  });
}

beforeAll(async () => {
  const rules = await readFile(resolve(import.meta.dirname, "../../firestore.rules"), "utf8");
  testEnvironment = await initializeTestEnvironment({
    projectId,
    firestore: { rules },
  });
});

beforeEach(seed);
afterEach(async () => testEnvironment.clearFirestore());
afterAll(async () => testEnvironment.cleanup());

describe("lesson planning direct Firestore boundary", () => {
  for (const actor of actors) {
    it("denies every lesson planning path operation for '" + actor.name + "'", async () => {
      const context =
        actor.uid === null
          ? testEnvironment.unauthenticatedContext()
          : testEnvironment.authenticatedContext(actor.uid, actor.claims);
      const firestore = context.firestore();

      for (const collectionName of collections) {
        const path = "academies/" + academyId + "/" + collectionName;
        const existing = doc(firestore, path + "/synthetic-1");
        const candidate = doc(firestore, path + "/candidate-1");
        await assertFails(getDoc(existing));
        await assertFails(getDocs(collection(firestore, path)));
        await assertFails(setDoc(candidate, { academyId, schemaVersion: 1 }));
        await assertFails(updateDoc(existing, { changed: true }));
        await assertFails(deleteDoc(existing));
      }
    });
  }
});
