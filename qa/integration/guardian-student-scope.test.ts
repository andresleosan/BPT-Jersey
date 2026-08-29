import { randomUUID } from "node:crypto";

import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { afterAll, describe, expect, it } from "vitest";

import { createFirestoreGuardianStudentScopeResolver } from "../../apps/functions/src/schedule/schedule-callables.js";

const runId = "guardian-scope-" + process.pid + "-" + randomUUID();
const academyId = runId + "-academy";
const ownerId = runId + "-owner";
const currentTime = "2026-08-28T12:00:00.000Z";
const app = initializeApp({ projectId: "demo-bpt-jersey" }, runId);
const firestore = getFirestore(app);
const createdDocuments: string[] = [];

type ScopeFixture = Readonly<{
  suffix: string;
  guardianId?: string;
  primaryContactId?: string;
  validFrom?: string;
  validTo?: string;
  active?: boolean;
}>;

async function seedScope(
  input: ScopeFixture,
): Promise<Readonly<{ guardianId: string; studentId: string }>> {
  const guardianId = input.guardianId ?? runId + "-guardian-" + input.suffix;
  const primaryContactId = input.primaryContactId ?? guardianId;
  const familyId = runId + "-family-" + input.suffix;
  const studentId = runId + "-student-" + input.suffix;
  const relationshipId = runId + "-relationship-" + input.suffix;
  const active = input.active ?? true;
  const audit = {
    schemaVersion: "1",
    createdAt: currentTime,
    createdBy: ownerId,
    updatedAt: currentTime,
    updatedBy: ownerId,
  } as const;
  const familyPath = "academies/" + academyId + "/families/" + familyId;
  const studentPath = "academies/" + academyId + "/students/" + studentId;
  const relationshipPath = "academies/" + academyId + "/relationships/" + relationshipId;

  await Promise.all([
    firestore.doc(familyPath).set({
      familyId,
      academyId,
      primaryContactUserId: primaryContactId,
      billingContactUserId: primaryContactId,
      active: true,
      status: "active",
      ...audit,
    }),
    firestore.doc(studentPath).set({
      studentId,
      academyId,
      familyId,
      fullName: "Synthetic Minor " + input.suffix,
      dateOfBirth: "2015-01-01",
      trainingCenter: "Town",
      trainingTimePreferences: ["afternoon"],
      participantType: "minor",
      active: true,
      status: "active",
      ...audit,
    }),
    firestore.doc(relationshipPath).set({
      relationshipId,
      academyId,
      familyId,
      studentId,
      adultUserId: guardianId,
      relationshipType: "guardian",
      permissions: ["readProfile"],
      validFrom: input.validFrom ?? "2026-08-01T00:00:00.000Z",
      ...(input.validTo === undefined ? {} : { validTo: input.validTo }),
      active,
      status: active ? "active" : "inactive",
      ...audit,
    }),
  ]);

  createdDocuments.push(familyPath, studentPath, relationshipPath);
  return { guardianId, studentId };
}

afterAll(async () => {
  await Promise.all(createdDocuments.map(async (path) => firestore.doc(path).delete()));
  await deleteApp(app);
});

describe("guardian student scope against the Firestore emulator", () => {
  it("allows only a current active primary guardian relationship and fails closed otherwise", async () => {
    const current = await seedScope({ suffix: "current" });
    const secondary = await seedScope({
      suffix: "secondary",
      primaryContactId: runId + "-different-primary",
    });
    const future = await seedScope({
      suffix: "future",
      validFrom: "2026-08-29T00:00:00.000Z",
    });
    const expired = await seedScope({
      suffix: "expired",
      validTo: currentTime,
    });
    const inactive = await seedScope({ suffix: "inactive", active: false });
    const resolver = createFirestoreGuardianStudentScopeResolver({
      firestore,
      now: () => new Date(currentTime),
    });

    await expect(
      resolver({ academyId, ...current, guardianUserId: current.guardianId }),
    ).resolves.toBe(true);
    await expect(
      resolver({
        academyId,
        guardianUserId: runId + "-unrelated",
        studentId: current.studentId,
      }),
    ).resolves.toBe(false);
    for (const denied of [secondary, future, expired, inactive]) {
      await expect(
        resolver({ academyId, guardianUserId: denied.guardianId, studentId: denied.studentId }),
      ).resolves.toBe(false);
    }
  });

  it("fails closed when the evaluation clock is invalid", async () => {
    const resolver = createFirestoreGuardianStudentScopeResolver({
      firestore,
      now: () => new Date(Number.NaN),
    });
    await expect(
      resolver({
        academyId,
        guardianUserId: runId + "-guardian-invalid-clock",
        studentId: runId + "-student-invalid-clock",
      }),
    ).resolves.toBe(false);
  });
});
