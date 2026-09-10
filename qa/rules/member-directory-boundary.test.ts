import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  assertFails,
  initializeTestEnvironment,
  type RulesTestContext,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import { afterAll, beforeAll, describe, it } from "vitest";

const projectId = `demo-bpt-jersey-member-directory-rules-${process.pid}`;

const protectedDocuments = Object.freeze([
  "academies/academy-1/members/member-1",
  "academies/academy-1/students/student-1",
  "academies/academy-1/studentAdminProfiles/student-1",
  "academies/academy-1/studentIdentityKeys/key-1",
  "academies/academy-1/studentRestrictedReadLimits/actor-1",
  "academies/academy-1/memberDirectoryCursorStates/cursor-1",
  "academies/academy-1/memberDirectoryStates/current",
  "academies/academy-1/memberDirectoryMigrations/operation-1",
  "academies/academy-1/memberDirectoryMigrationChunks/chunk-1",
  "academies/academy-1/memberDirectoryApprovals/approval-1",
  "academies/academy-1/memberDirectoryApprovalConsumptions/approval-1",
  "academies/academy-1/memberDirectoryWriteReceipts/write-1",
  "academies/academy-1/familyWriteReceipts/family-write-1",
  "academies/academy-1/profileWriteReceipts/write-1",
  `academies/academy-1/memberDirectoryImportReceipts/import-${"a".repeat(64)}`,
  `academies/academy-1/memberDirectoryImportSessions/import-session-${"b".repeat(64)}`,
  "academies/academy-1/auditEvents/audit-1",
  "memberDirectoryRestoreGuards/academy-1",
  "memberDirectoryRestoreGuards/academy-1/events/1",
  "memberDirectoryRestoreAttestations/attestation-1",
  "memberDirectoryRestoreAttestationConsumptions/attestation-1",
] as const);

const roles = Object.freeze([
  undefined,
  "adultStudent",
  "guardian",
  "coach",
  "headCoach",
  "administrator",
  "owner",
] as const);

let testEnvironment: RulesTestEnvironment;

function contextFor(role: (typeof roles)[number], index: number): RulesTestContext {
  if (role === undefined) return testEnvironment.unauthenticatedContext();
  return testEnvironment.authenticatedContext(`actor-${index}`, {
    academyId: "academy-1",
    role,
  });
}

beforeAll(async () => {
  testEnvironment = await initializeTestEnvironment({
    projectId,
    firestore: { rules: await readFile(resolve("firestore.rules"), "utf8") },
  });
  await testEnvironment.withSecurityRulesDisabled(async (context) => {
    const firestore = context.firestore();
    for (const path of protectedDocuments) {
      await setDoc(doc(firestore, path), { seeded: true });
    }
  });
});

afterAll(async () => {
  await testEnvironment.cleanup();
});

describe("canonical member-directory direct-access boundary", () => {
  it("denies get, list, create, update and delete for every public role", async () => {
    for (const [roleIndex, role] of roles.entries()) {
      const firestore = contextFor(role, roleIndex).firestore();
      for (const [pathIndex, path] of protectedDocuments.entries()) {
        const existing = doc(firestore, path);
        const collectionPath = path.slice(0, path.lastIndexOf("/"));
        const candidate = doc(firestore, `${collectionPath}/candidate-${roleIndex}-${pathIndex}`);

        await assertFails(getDoc(existing));
        await assertFails(getDocs(query(collection(firestore, collectionPath), limit(1))));
        await assertFails(setDoc(candidate, { candidate: true }));
        await assertFails(updateDoc(existing, { updated: true }));
        await assertFails(deleteDoc(existing));
      }
    }
  }, 60_000);
});
