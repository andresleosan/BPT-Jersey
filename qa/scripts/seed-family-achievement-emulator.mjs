import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const projectId = "demo-bpt-jersey";
const academyId = "synthetic-academy";
const familyId = "t067-family-review";
const generatedAt = "2026-08-31T10:00:00.000Z";
const snapshotId = `family-achievements-v1__${academyId}__${familyId}__${generatedAt}`;

function assertLoopback(name, value) {
  const match = /^127\.0\.0\.1:([1-9]\d{3,4})$/u.exec(value ?? "");
  if (!match || Number(match[1]) < 1_024 || Number(match[1]) > 65_535) {
    throw new Error(`${name} must be a loopback emulator host.`);
  }
}

if ((process.env.GCLOUD_PROJECT ?? projectId) !== projectId) {
  throw new Error("T067 seed requires the demo Firebase project.");
}
assertLoopback("FIRESTORE_EMULATOR_HOST", process.env.FIRESTORE_EMULATOR_HOST);
assertLoopback("FIREBASE_AUTH_EMULATOR_HOST", process.env.FIREBASE_AUTH_EMULATOR_HOST);
if (!["owner", "administrator"].includes(process.env.AUTH_EMULATOR_E2E_ROLE ?? "")) {
  throw new Error("T067 seed requires an owner or administrator emulator role.");
}

const app = initializeApp({ projectId });
const firestore = getFirestore(app);

const snapshot = {
  academyId,
  familyId,
  generatedAt,
  members: [
    {
      studentId: "t067-member",
      displayName: "Synthetic Family Member",
      participantType: "minor",
      goals: [
        {
          goalId: "t067-goal-classes",
          label: "Attend classes",
          metric: "classes_attended",
          target: 4,
          progress: 4,
          status: "complete",
        },
      ],
      achievementCandidates: [
        {
          achievementId: "t067-achievement-consistency",
          label: "Consistency milestone",
          metric: "classes_attended",
          target: 4,
          achievedValue: 4,
          status: "candidate",
        },
      ],
    },
  ],
  adultComparison: [],
  schemaVersion: 1,
};

const audit = {
  academyId,
  actorId: "system-family-achievements",
  action: "family.achievements.generated",
  targetRef: `academies/${academyId}/familyAchievementSnapshots/${familyId}`,
  purpose: "family achievement snapshot generation",
  correlationId: `family-achievements:${academyId}:${familyId}:${generatedAt}`,
  familyId,
  snapshotId,
  memberCount: 1,
  candidateCount: 1,
  generatedAt,
  auditEventId: snapshotId,
  occurredAt: generatedAt,
  result: "completed",
  schemaVersion: 1,
};

try {
  await firestore
    .doc(`academies/${academyId}/familyAchievementSnapshots/${snapshotId}`)
    .set(snapshot);
  await firestore.doc(`academies/${academyId}/auditEvents/${snapshotId}`).set(audit);
  console.log(
    JSON.stringify({ academyId, familyId, emulator: process.env.FIRESTORE_EMULATOR_HOST }),
  );
} finally {
  await deleteApp(app);
}
