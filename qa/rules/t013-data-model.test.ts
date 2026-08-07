import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { get, ref, set } from "firebase/database";
import { collection, doc, getDocs, orderBy, query, setDoc, where } from "firebase/firestore";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

type FixtureRecord = {
  path: string;
  data: Record<string, unknown>;
};

type T013Fixtures = {
  firestore: FixtureRecord[];
  rtdb: FixtureRecord[];
};

const projectId = `demo-bpt-jersey-rules-${process.pid}`;
const tenantId = "demo-academy";
const academyRoot = `academies/${tenantId}`;
const presencePath = `${academyRoot}/presence/session-demo-1/student-demo-1`;
const forbiddenPresenceFields = [
  "paymentId",
  "attendanceId",
  "membershipId",
  "healthProfileId",
  "auditEventId",
];

let testEnvironment: RulesTestEnvironment | undefined;
let fixtures: T013Fixtures | undefined;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseFixtureRecord(value: unknown): FixtureRecord {
  if (!isRecord(value) || typeof value.path !== "string" || !isRecord(value.data)) {
    throw new Error("Invalid T013 fixture record");
  }

  return { path: value.path, data: value.data };
}

function parseFixtures(source: string): T013Fixtures {
  const parsed: unknown = JSON.parse(source);

  if (!isRecord(parsed) || !Array.isArray(parsed.firestore) || !Array.isArray(parsed.rtdb)) {
    throw new Error("Invalid T013 fixture envelope");
  }

  return {
    firestore: parsed.firestore.map(parseFixtureRecord),
    rtdb: parsed.rtdb.map(parseFixtureRecord),
  };
}

function requireFixture(): T013Fixtures {
  if (!fixtures) {
    throw new Error("T013 fixtures were not loaded");
  }

  return fixtures;
}

function pathPart(path: string, fromEnd: number): string {
  const part = path.split("/").at(-fromEnd);
  if (!part) {
    throw new Error(`Invalid fixture path: ${path}`);
  }

  return part;
}

function requiredString(data: Record<string, unknown>, field: string): string {
  const value = data[field];
  if (typeof value !== "string") {
    throw new Error(`Fixture field ${field} must be a string`);
  }

  return value;
}

async function clearEmulatorData(): Promise<void> {
  if (!testEnvironment) {
    return;
  }

  await Promise.all([testEnvironment.clearFirestore(), testEnvironment.clearDatabase()]);
}

beforeAll(async () => {
  const [firestoreRules, databaseRules, fixtureSource] = await Promise.all([
    readFile(resolve("firestore.rules"), "utf8"),
    readFile(resolve("database.rules.json"), "utf8"),
    readFile(resolve("qa/fixtures/t013-model-fixtures.json"), "utf8"),
  ]);

  fixtures = parseFixtures(fixtureSource);
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

beforeEach(clearEmulatorData);

afterEach(clearEmulatorData);

afterAll(async () => {
  await testEnvironment?.cleanup();
});

describe("T013 Firestore and RTDB model fixtures", () => {
  it("loads synthetic records and preserves tenant, identity, query, and presence boundaries", async () => {
    const currentFixtures = requireFixture();
    const environment = testEnvironment;
    if (!environment) {
      throw new Error("T013 emulator environment was not initialized");
    }

    for (const fixture of currentFixtures.firestore) {
      expect(fixture.path === academyRoot || fixture.path.startsWith(`${academyRoot}/`)).toBe(true);
      expect(fixture.data.academyId).toBe(tenantId);

      const collectionName = pathPart(fixture.path, 2);
      if (collectionName === "bookings" || collectionName === "attendance") {
        const expectedId = `${requiredString(fixture.data, "sessionId")}__${requiredString(
          fixture.data,
          "studentId",
        )}`;
        expect(pathPart(fixture.path, 1)).toBe(expectedId);
        expect(
          requiredString(
            fixture.data,
            collectionName === "bookings" ? "bookingId" : "attendanceId",
          ),
        ).toBe(expectedId);
      }
    }

    for (const fixture of currentFixtures.rtdb) {
      expect(fixture.path).toBe(presencePath);
    }

    await environment.withSecurityRulesDisabled(async (context) => {
      const firestore = context.firestore();
      const database = context.database();

      await Promise.all(
        currentFixtures.firestore.map(({ path, data }) => setDoc(doc(firestore, path), data)),
      );
      await Promise.all(
        currentFixtures.rtdb.map(({ path, data }) => set(ref(database, path), data)),
      );

      const sessions = await getDocs(
        query(
          collection(firestore, `${academyRoot}/sessions`),
          where("status", "==", "scheduled"),
          orderBy("startAt", "asc"),
        ),
      );
      expect(sessions.docs[0]?.id).toBe("session-demo-1");

      const presenceSnapshot = await get(ref(database, presencePath));
      const presence = presenceSnapshot.val() as unknown;
      if (!isRecord(presence)) {
        throw new Error("T013 presence fixture must be an object");
      }

      expect(Object.keys(presence).sort()).toEqual(["lastSeenAt", "sessionVersion", "state"]);
      for (const field of forbiddenPresenceFields) {
        expect(field in presence).toBe(false);
      }
    });
  });
});
