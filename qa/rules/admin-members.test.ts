import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  assertFails,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { afterAll, beforeAll, describe, it } from "vitest";

const projectId = `demo-bpt-jersey-members-rules-${process.pid}`;
const memberPath = "academies/academy-1/members/member-1";

let testEnvironment: RulesTestEnvironment;

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

afterAll(async () => {
  await testEnvironment.cleanup();
});

describe("member direct-access Rules", () => {
  it("denies anonymous, authenticated client, and administrator reads and writes", async () => {
    const contexts = [
      testEnvironment.unauthenticatedContext(),
      testEnvironment.authenticatedContext("client-1", {
        academyId: "academy-1",
        role: "guardian",
      }),
      testEnvironment.authenticatedContext("admin-1", {
        academyId: "academy-1",
        role: "administrator",
      }),
    ];

    for (const context of contexts) {
      const firestore = context.firestore();
      await assertFails(getDoc(doc(firestore, memberPath)));
      await assertFails(setDoc(doc(firestore, memberPath), { fullName: "Client write" }));
    }
  });
});
