import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  assertFails,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { collection, deleteDoc, doc, getDoc, getDocs, setDoc, updateDoc } from "firebase/firestore";
import { afterAll, afterEach, beforeAll, beforeEach, describe, it } from "vitest";

const projectId = "demo-bpt-jersey-retention-boundary-" + process.pid;
let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  const rules = await readFile(resolve(import.meta.dirname, "../../firestore.rules"), "utf8");
  testEnv = await initializeTestEnvironment({
    projectId,
    firestore: { rules, host: "127.0.0.1", port: 8080 },
  });
});

beforeEach(async () => {
  await testEnv.clearFirestore();
});

afterEach(async () => {
  await testEnv.clearFirestore();
});

afterAll(async () => {
  await testEnv.cleanup();
});

describe("retention alert direct Firestore boundary", () => {
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
    it("denies direct retention inbox access for " + name, async () => {
      const context =
        auth === undefined
          ? testEnv.unauthenticatedContext()
          : testEnv.authenticatedContext(auth.uid, {
              academyId: "academy-a",
              role: auth.role,
            });
      const db = context.firestore();
      const item = doc(
        db,
        "academies/academy-a/retentionAlerts/academy-a__attendance_gap__student-a__2026-08-28",
      );
      const inbox = collection(db, "academies/academy-a/retentionAlerts");

      await assertFails(getDoc(item));
      await assertFails(getDocs(inbox));
      await assertFails(setDoc(item, { schemaVersion: "1" }));
      await assertFails(updateDoc(item, { status: "open" }));
      await assertFails(deleteDoc(item));
    });
  }
});
