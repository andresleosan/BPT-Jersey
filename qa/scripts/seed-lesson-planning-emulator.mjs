import { deleteApp, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

const projectId = "demo-bpt-jersey";
const academyId = "synthetic-academy";
const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST?.trim();
const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST?.trim();

function isLoopback(host) {
  const match = /^127\.0\.0\.1:([1-9]\d{3,4})$/u.exec(host ?? "");
  return Boolean(match) && Number(match[1]) >= 1_024 && Number(match[1]) <= 65_535;
}

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment: ${name}`);
  return value;
}

if (
  !isLoopback(firestoreHost) ||
  !isLoopback(authHost) ||
  (process.env.GCLOUD_PROJECT ?? projectId) !== projectId ||
  process.env.AUTH_EMULATOR_E2E_ROLE !== "headCoach"
) {
  throw new Error("T066 seed requires loopback demo Auth/Firestore emulators and headCoach role.");
}

const email = required("AUTH_EMULATOR_E2E_EMAIL");
if (!email.endsWith("@example.test")) throw new Error("T066 seed requires a synthetic user.");

const app = initializeApp({ projectId }, "t066-lesson-planning-seed");
const auth = getAuth(app);
const firestore = getFirestore(app);

try {
  const user = await auth.getUserByEmail(email);
  await auth.setCustomUserClaims(user.uid, { academyId, role: "headCoach" });

  const library = {
    libraryId: "t066-core",
    version: 1,
    status: "published",
    publishedAt: "2026-08-31T10:00:00.000Z",
    techniques: [
      {
        techniqueId: "t066-guard-pass",
        label: "Guard pass",
        skillKey: "guard-pass",
        sequence: 1,
        active: true,
      },
    ],
  };
  await firestore.doc(`academies/${academyId}/techniqueLibraries/t066-core__1`).set({
    academyId,
    schemaVersion: 1,
    ...library,
  });
  await firestore.doc(`academies/${academyId}/lessonPlans/t066-review-plan`).set({
    planId: "t066-review-plan",
    academyId,
    title: "Synthetic guard passing review",
    libraryId: library.libraryId,
    libraryVersion: library.version,
    status: "submitted",
    activities: [
      {
        activityId: "t066-activity-1",
        kind: "technique",
        techniqueId: "t066-guard-pass",
        durationMinutes: 30,
        sequence: 1,
      },
    ],
    approvedByStaffId: null,
    approvedAt: null,
    schemaVersion: 1,
  });
  console.log(JSON.stringify({ academyId, planId: "t066-review-plan", emulator: firestoreHost }));
} finally {
  await deleteApp(app);
}
