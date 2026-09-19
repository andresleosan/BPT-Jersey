import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  assertFails,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";

const projectId = `demo-bpt-migration-rules-${process.pid}`;
const academyId = "academy-1";

let testEnvironment: RulesTestEnvironment;

async function seedDecision(): Promise<void> {
  await testEnvironment.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), `academies/${academyId}/memberMigrationDecisions/m1`), {
      academyId,
      legacyMemberId: "m1",
      kind: "skip",
      reason: "Synthetic fixture",
    });
  });
}

function contextFor(role: string) {
  return testEnvironment.authenticatedContext(`user-${role}`, { academyId, role });
}

beforeAll(async () => {
  testEnvironment = await initializeTestEnvironment({
    projectId,
    firestore: {
      rules: await readFile(resolve("firestore.rules"), "utf8"),
    },
  });
});

beforeEach(seedDecision);

afterAll(async () => {
  await testEnvironment.cleanup();
});

describe("member migration decisions Firestore boundary", () => {
  it("denies every role, including owner and administrator", async () => {
    for (const role of [
      "owner",
      "administrator",
      "headCoach",
      "coach",
      "guardian",
      "adultStudent",
    ]) {
      const firestore = contextFor(role).firestore();
      await assertFails(
        getDoc(doc(firestore, `academies/${academyId}/memberMigrationDecisions/m1`)),
      );
      await assertFails(
        setDoc(doc(firestore, `academies/${academyId}/memberMigrationDecisions/m2`), {
          kind: "skip",
        }),
      );
    }
  });
});
