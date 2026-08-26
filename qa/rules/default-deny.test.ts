import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  assertFails,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { ref, set } from "firebase/database";
import { doc, getDoc, setDoc } from "firebase/firestore";
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

  it("rejects direct reads and writes to restricted health collections for authenticated users", async () => {
    const firestore = testEnvironment.authenticatedContext("owner-1").firestore();

    await assertFails(getDoc(doc(firestore, "academies/academy-1/healthProfiles/student-1")));
    await assertFails(
      getDoc(doc(firestore, "academies/academy-1/healthProfileChangeRequests/request-1")),
    );
    await assertFails(
      setDoc(doc(firestore, "academies/academy-1/healthProfiles/student-1"), {
        status: "active",
      }),
    );
    await assertFails(getDoc(doc(firestore, "academies/academy-1/documents/document-1")));
    await assertFails(getDoc(doc(firestore, "academies/academy-1/waiverVersions/waiver-1")));
    await assertFails(getDoc(doc(firestore, "academies/academy-1/consents/consent-1")));
    await assertFails(
      setDoc(doc(firestore, "academies/academy-1/consents/consent-1"), {
        status: "accepted",
      }),
    );
    await assertFails(getDoc(doc(firestore, "academies/academy-1/exports/export-1")));
    await assertFails(getDoc(doc(firestore, "academies/academy-1/auditEvents/audit-1")));
    await assertFails(getDoc(doc(firestore, "academies/academy-1/exportRateLimits/actor-hash")));
    await assertFails(
      setDoc(doc(firestore, "academies/academy-1/exports/export-1"), {
        status: "delivered_inline",
      }),
    );
  });

  it("rejects unauthenticated Realtime Database writes", async () => {
    const database = testEnvironment.unauthenticatedContext().database();

    await assertFails(set(ref(database, "presence/student-1"), { online: true }));
  });
});
