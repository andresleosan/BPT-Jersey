import { deleteApp, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

// T097 synthetic provisioning of one head coach for the progress E2E: Auth user, claims, the
// exact staff `users/{uid}` document the levels authorization requires and the canonical
// `staff/{staffId}` profile. Everything else (levels, evaluations, promotions) is created by the
// callables under test.
const projectId = "demo-bpt-jersey";
const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST?.trim();
const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST?.trim();

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
  !isLoopback(authHost) ||
  !isLoopback(firestoreHost) ||
  (process.env.GCLOUD_PROJECT ?? projectId) !== projectId
) {
  throw new Error("Staff seed requires loopback demo Auth/Firestore emulators.");
}

const academyId = required("T097_E2E_ACADEMY_ID");
if (!/^[a-z][a-z0-9-]{2,60}$/u.test(academyId)) {
  throw new Error("Staff seed requires a simple synthetic academy ID.");
}
const email = required("T097_HEAD_COACH_EMAIL");
if (!email.endsWith("@example.test")) throw new Error("Staff seed requires a synthetic user.");
const password = required("T097_E2E_PASSWORD");
if (password.length < 12) throw new Error("Staff seed requires a synthetic password of 12+ chars.");

const app = initializeApp({ projectId }, "t097-staff-seed");
const auth = getAuth(app);
const firestore = getFirestore(app);

try {
  let user;
  try {
    user = await auth.getUserByEmail(email);
    user = await auth.updateUser(user.uid, { password, emailVerified: true, disabled: false });
  } catch (error) {
    if (error?.code !== "auth/user-not-found") throw error;
    user = await auth.createUser({ email, password, emailVerified: true });
  }
  await auth.setCustomUserClaims(user.uid, { academyId, role: "headCoach" });

  const now = new Date().toISOString();
  const staffId = `staff-head-${user.uid.slice(0, 8).toLowerCase()}`;
  await firestore.doc(`academies/${academyId}/users/${user.uid}`).set({
    userId: user.uid,
    academyId,
    accountType: "staff",
    displayName: "Synthetic T097 Head Coach",
    email,
    active: true,
    status: "active",
    schemaVersion: "1",
    createdAt: now,
    createdBy: "system:t097-e2e-seed",
    updatedAt: now,
    updatedBy: "system:t097-e2e-seed",
  });
  // The levels authorization resolves exactly one active staff profile by userId.
  const existing = await firestore
    .collection(`academies/${academyId}/staff`)
    .where("userId", "==", user.uid)
    .get();
  for (const document of existing.docs) {
    if (document.id !== staffId) await document.ref.delete();
  }
  await firestore.doc(`academies/${academyId}/staff/${staffId}`).set({
    staffId,
    academyId,
    userId: user.uid,
    role: "headCoach",
    active: true,
    status: "active",
    schemaVersion: "1",
    createdAt: now,
    createdBy: "system:t097-e2e-seed",
    updatedAt: now,
    updatedBy: "system:t097-e2e-seed",
  });
  console.log(JSON.stringify({ academyId, uid: user.uid, staffId, role: "headCoach" }));
} finally {
  await deleteApp(app);
}
