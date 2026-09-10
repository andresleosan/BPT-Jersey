import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  assertFails,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
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

const projectId = "demo-bpt-jersey-waitlist-boundary-" + process.pid;
const academyId = "academy-a";
const canonicalWaitlistId = "v2:9:session-1:9:student-1";
const legacyWaitlistId = "session-1__student-1";
const privateDocuments = Object.freeze([
  { collection: "waitlistEntries", documentId: canonicalWaitlistId },
  { collection: "waitlistEntries", documentId: legacyWaitlistId },
  { collection: "sessionCapacityStates", documentId: "session-1" },
  { collection: "bookingQuotaStates", documentId: "v2:9:student-1:10:2026-08-24" },
  { collection: "waitlistPositionStates", documentId: "session-1" },
] as const);
const privateCollections = Object.freeze([
  "waitlistEntries",
  "sessionCapacityStates",
  "bookingQuotaStates",
  "waitlistPositionStates",
] as const);
let testEnv: RulesTestEnvironment;

setLogLevel("silent");

beforeAll(async () => {
  const rules = await readFile(resolve(import.meta.dirname, "../../firestore.rules"), "utf8");
  testEnv = await initializeTestEnvironment({
    projectId,
    firestore: { rules },
  });
});

beforeEach(async () => testEnv.clearFirestore());
afterEach(async () => testEnv.clearFirestore());
afterAll(async () => testEnv.cleanup());

describe("waitlist direct Firestore boundary", () => {
  const roles = [
    { name: "unauthenticated", auth: undefined },
    { name: "owner", auth: { uid: "owner-1", role: "owner" } },
    { name: "administrator", auth: { uid: "admin-1", role: "administrator" } },
    { name: "headCoach", auth: { uid: "head-1", role: "headCoach" } },
    { name: "coach", auth: { uid: "coach-1", role: "coach" } },
    { name: "adultStudent", auth: { uid: "adult-1", role: "adultStudent" } },
    { name: "guardian", auth: { uid: "guardian-1", role: "guardian" } },
  ] as const;

  for (const { name, auth } of roles) {
    it("denies direct waitlist and coordination access for " + name, async () => {
      const context =
        auth === undefined
          ? testEnv.unauthenticatedContext()
          : testEnv.authenticatedContext(auth.uid, {
              academyId,
              role: auth.role,
            });
      const db = context.firestore();

      for (const target of privateDocuments) {
        const item = doc(db, `academies/${academyId}/${target.collection}/${target.documentId}`);
        await assertFails(getDoc(item));
        await assertFails(setDoc(item, { academyId, schemaVersion: "1" }));
        await assertFails(updateDoc(item, { revision: 2 }));
        await assertFails(deleteDoc(item));
      }

      for (const collectionName of privateCollections) {
        await assertFails(getDocs(collection(db, `academies/${academyId}/${collectionName}`)));
      }
    });
  }
});
