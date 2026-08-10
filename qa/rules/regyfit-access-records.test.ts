import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  assertFails,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { deleteDoc, doc, getDoc, getDocs, collection, setDoc, updateDoc } from "firebase/firestore";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";

const projectId = `demo-bpt-jerfyfit-rules-${process.pid}`;
const academyId = "academy-1";
const otherAcademyId = "academy-2";
const recordPath = `academies/${academyId}/regyfitAccessRecords/access-1`;

let testEnvironment: RulesTestEnvironment;

async function seedRecord(): Promise<void> {
  await testEnvironment.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), recordPath), {
      academyId,
      sourceSystem: "regyfit",
      sourceId: "access-1",
      memberDisplayName: "Synthetic Member",
      memberNumber: "SYN-001",
      loginCount: 3,
      lastLoginAt: "2026-08-08T10:00:00.000Z",
      ip: "198.51.100.10",
      importRunId: "synthetic-run-1",
      capturedAt: "2026-08-08T10:00:00.000Z",
      schemaVersion: 1,
    });
  });
}

function contextFor(role: string, scopedAcademyId = academyId) {
  return testEnvironment.authenticatedContext(`user-${role}`, {
    academyId: scopedAcademyId,
    role,
  });
}

beforeAll(async () => {
  testEnvironment = await initializeTestEnvironment({
    projectId,
    firestore: {
      host: "127.0.0.1",
      port: 8080,
      rules: await readFile(resolve("firestore.rules"), "utf8"),
    },
  });
});

beforeEach(seedRecord);

afterAll(async () => {
  await testEnvironment.cleanup();
});

describe("Regyfit access record Firestore boundary", () => {
  it("rejects direct reads for owner and administrator", async () => {
    for (const role of ["owner", "administrator"]) {
      const firestore = contextFor(role).firestore();

      await assertFails(getDoc(doc(firestore, recordPath)));
      await assertFails(
        getDocs(collection(firestore, `academies/${academyId}/regyfitAccessRecords`)),
      );
    }
  });

  it("rejects unauthenticated and every non-admin direct read", async () => {
    await assertFails(
      getDoc(doc(testEnvironment.unauthenticatedContext().firestore(), recordPath)),
    );
    for (const role of ["headCoach", "coach", "guardian", "adultStudent"]) {
      await assertFails(getDoc(doc(contextFor(role).firestore(), recordPath)));
    }
  });

  it("rejects owner reads across academies and documents with a mismatched tenant field", async () => {
    const otherRecordPath = `academies/${otherAcademyId}/regyfitAccessRecords/access-2`;
    await testEnvironment.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), otherRecordPath), {
        academyId,
        sourceId: "access-2",
        ip: "198.51.100.11",
      });
    });

    await assertFails(getDoc(doc(contextFor("owner", otherAcademyId).firestore(), recordPath)));
    await assertFails(getDoc(doc(contextFor("owner").firestore(), otherRecordPath)));
  });

  it("rejects every client write, update, and delete path", async () => {
    const owner = contextFor("owner").firestore();
    const newRecord = doc(owner, `academies/${academyId}/regyfitAccessRecords/access-2`);

    await assertFails(setDoc(newRecord, { academyId, ip: "198.51.100.12" }));
    await assertFails(updateDoc(doc(owner, recordPath), { loginCount: 4 }));
    await assertFails(deleteDoc(doc(owner, recordPath)));
  });
});
