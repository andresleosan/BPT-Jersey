import { randomUUID } from "node:crypto";

import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createHealthProfileChangeRequestHandler,
  getHealthProfileHandler,
  reviewHealthProfileChangeRequestHandler,
  saveHealthProfileHandler,
  type HealthCallableServices,
} from "../../apps/functions/src/health/health-callables.js";
import {
  createHealthStore,
  type HealthFirestore,
} from "../../apps/functions/src/health/health-service.js";

const runId = "health-" + process.pid + "-" + randomUUID();
const academyId = runId + "-academy";
const ownerId = runId + "-owner";
const guardianId = runId + "-guardian";
const unrelatedGuardianId = runId + "-unrelated";
const studentId = runId + "-student";
const familyId = runId + "-family";
const requestId = runId + "-request";
const app = initializeApp({ projectId: "demo-bpt-jersey" }, runId);
const firestore = getFirestore(app);
const now = "2026-08-24T12:00:00Z";

const student = {
  studentId,
  academyId,
  familyId,
  fullName: "Synthetic Minor",
  dateOfBirth: "2015-01-01",
  phoneNumber: "+15550000001",
  email: "minor@example.test",
  trainingCenter: "Town",
  trainingTimePreferences: ["evening"],
  participantType: "minor",
  active: true,
  status: "active",
  schemaVersion: "1",
  createdAt: now,
  createdBy: ownerId,
  updatedAt: now,
  updatedBy: ownerId,
};

const relationship = {
  relationshipId: familyId + "--" + studentId,
  academyId,
  familyId,
  studentId,
  adultUserId: guardianId,
  relationshipType: "guardian",
  permissions: ["readProfile"],
  validFrom: now,
  active: true,
  status: "active",
  schemaVersion: "1",
  createdAt: now,
  createdBy: ownerId,
  updatedAt: now,
  updatedBy: ownerId,
};

function request(data: unknown, role: string, uid: string) {
  return {
    data,
    auth: { uid, token: { academyId, role } },
  } as never;
}

function services(): HealthCallableServices {
  return {
    pilotEnabled: true,
    store: createHealthStore({
      firestore: firestore as unknown as HealthFirestore,
      generateRequestId: () => requestId,
    }),
  };
}

describe("health support against the Firestore emulator", () => {
  beforeAll(async () => {
    await firestore.doc("academies/" + academyId + "/students/" + studentId).set(student);
    await firestore
      .doc("academies/" + academyId + "/relationships/" + relationship.relationshipId)
      .set(relationship);
  });

  afterAll(async () => {
    await Promise.all([
      firestore.doc("academies/" + academyId + "/healthProfiles/" + studentId).delete(),
      firestore
        .doc("academies/" + academyId + "/healthProfileChangeRequests/" + requestId)
        .delete(),
      firestore.doc("academies/" + academyId + "/students/" + studentId).delete(),
      firestore
        .doc("academies/" + academyId + "/relationships/" + relationship.relationshipId)
        .delete(),
    ]);
    await deleteApp(app);
  });

  it("keeps guardian projection redacted and completes an atomic approval", async () => {
    await saveHealthProfileHandler(
      request(
        {
          studentId,
          minimumOperationalSupport: ["mobility"],
          conditionSummary: "Needs a clear route.",
          staffReferenceLabel: "Meet at reception",
          expiresAt: null,
        },
        "owner",
        ownerId,
      ),
      services(),
    );

    const guardian = await getHealthProfileHandler(
      request({ studentId }, "guardian", guardianId),
      services(),
    );
    expect(guardian).toMatchObject({
      studentId,
      minimumOperationalSupport: ["mobility"],
      conditionSummary: "Needs a clear route.",
    });
    expect(guardian).not.toHaveProperty("staffReferenceLabel");

    const change = await createHealthProfileChangeRequestHandler(
      request(
        {
          studentId,
          proposedMinimumOperationalSupport: ["communication"],
          proposedConditionSummary: "Needs one-step instructions.",
          proposedExpiresAt: null,
        },
        "guardian",
        guardianId,
      ),
      services(),
    );
    expect(change).toMatchObject({ requestId, status: "pending" });

    await expect(
      getHealthProfileHandler(request({ studentId }, "guardian", unrelatedGuardianId), services()),
    ).rejects.toMatchObject({ code: "permission-denied" });

    await reviewHealthProfileChangeRequestHandler(
      request({ requestId, decision: "approve" }, "owner", ownerId),
      services(),
    );

    const admin = await getHealthProfileHandler(
      request({ studentId }, "owner", ownerId),
      services(),
    );
    expect(admin).toMatchObject({
      minimumOperationalSupport: ["communication"],
      pendingChangeRequest: null,
      staffReferenceLabel: "Meet at reception",
    });
  });
});
