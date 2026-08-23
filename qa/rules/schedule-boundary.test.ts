import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  assertFails,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { collection, deleteDoc, doc, getDoc, getDocs, setDoc, updateDoc } from "firebase/firestore";
import { afterAll, afterEach, beforeAll, beforeEach, describe, it } from "vitest";

const projectId = `demo-bpt-jersey-schedule-boundary-${process.pid}`;
const academyIds = Object.freeze(["academy-a", "academy-b"] as const);
const scheduleCollections = Object.freeze([
  "locations",
  "programs",
  "classes",
  "sessions",
] as const);

let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  const rules = await readFile(resolve(import.meta.dirname, "../../firestore.rules"), "utf8");
  testEnv = await initializeTestEnvironment({
    projectId,
    firestore: {
      rules,
      host: "127.0.0.1",
      port: 8080,
    },
  });
});

beforeEach(async () => {
  await testEnv.clearFirestore();
});

afterEach(async () => {
  await testEnv.clearFirestore();
});

afterAll(async () => {
  if (testEnv) {
    await testEnv.cleanup();
  }
});

describe("schedule direct Firestore boundary", () => {
  const roles = [
    { name: "unauthenticated", auth: undefined },
    { name: "owner", auth: { uid: "owner-1", academyId: "academy-a", role: "owner" } },
    {
      name: "administrator",
      auth: { uid: "admin-1", academyId: "academy-a", role: "administrator" },
    },
    { name: "headCoach", auth: { uid: "head-1", academyId: "academy-a", role: "headCoach" } },
    { name: "coach", auth: { uid: "coach-1", academyId: "academy-a", role: "coach" } },
    {
      name: "adultStudent",
      auth: { uid: "student-1", academyId: "academy-a", role: "adultStudent" },
    },
    { name: "guardian", auth: { uid: "guardian-1", academyId: "academy-a", role: "guardian" } },
  ];

  for (const { name, auth } of roles) {
    it(`denies client reads, queries, and writes for '${name}'`, async () => {
      const context = auth
        ? testEnv.authenticatedContext(auth.uid, {
            academyId: auth.academyId,
            role: auth.role,
          })
        : testEnv.unauthenticatedContext();
      const db = context.firestore();

      for (const col of scheduleCollections) {
        const itemRef = doc(db, `academies/${academyIds[0]}/${col}/item-1`);
        const colRef = collection(db, `academies/${academyIds[0]}/${col}`);

        await assertFails(getDoc(itemRef));
        await assertFails(getDocs(colRef));
        await assertFails(setDoc(itemRef, { name: "test", schemaVersion: "1" }));
        await assertFails(updateDoc(itemRef, { name: "updated" }));
        await assertFails(deleteDoc(itemRef));
      }
    });
  }
});
