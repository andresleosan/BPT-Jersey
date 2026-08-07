import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  assertFails,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { ref, set } from "firebase/database";
import { doc, setDoc } from "firebase/firestore";
import { afterAll, afterEach, beforeAll, describe, it } from "vitest";

const projectId = "demo-bpt-jersey";
let testEnvironment: RulesTestEnvironment;

beforeAll(async () => {
  const [firestoreRules, databaseRules] = await Promise.all([
    readFile(resolve("firestore.rules"), "utf8"),
    readFile(resolve("database.rules.json"), "utf8"),
  ]);

  testEnvironment = await initializeTestEnvironment({
    projectId,
    firestore: {
      host: "127.0.0.1",
      port: 8080,
      rules: firestoreRules,
    },
    database: {
      host: "127.0.0.1",
      port: 9000,
      rules: databaseRules,
    },
  });
});

afterEach(async () => {
  await Promise.all([testEnvironment.clearFirestore(), testEnvironment.clearDatabase()]);
});

afterAll(async () => {
  await testEnvironment.cleanup();
});

describe("default-deny Firebase rules", () => {
  it("rejects unauthenticated Firestore writes", async () => {
    const firestore = testEnvironment.unauthenticatedContext().firestore();

    await assertFails(setDoc(doc(firestore, "students/student-1"), { name: "Test Student" }));
  });

  it("rejects authenticated Firestore writes until role rules exist", async () => {
    const firestore = testEnvironment.authenticatedContext("staff-1").firestore();

    await assertFails(setDoc(doc(firestore, "students/student-1"), { name: "Test Student" }));
  });

  it("rejects unauthenticated Realtime Database writes", async () => {
    const database = testEnvironment.unauthenticatedContext().database();

    await assertFails(set(ref(database, "presence/student-1"), { online: true }));
  });
});
