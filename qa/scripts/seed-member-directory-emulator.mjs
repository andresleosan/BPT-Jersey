import { deleteApp, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, Timestamp } from "firebase-admin/firestore";

// T093 synthetic provisioning for the canonical member directory E2E. It only prepares the
// administrative actor: Auth claims plus the exact provisioned `users/{uid}` document that the
// directory callables verify inside their transactions. Directory state itself is created by the
// guarded initializer (apps/functions/scripts/member-directory-empty-initialize.mjs).
const projectId = "demo-bpt-jersey";
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
  process.env.AUTH_EMULATOR_E2E_ROLE !== "owner"
) {
  throw new Error("T093 seed requires loopback demo Auth/Firestore emulators and the owner role.");
}

const academyId = required("T093_E2E_ACADEMY_ID");
if (!/^[a-z][a-z0-9-]{2,60}$/u.test(academyId)) {
  throw new Error("T093 seed requires a simple synthetic academy ID.");
}
const email = required("AUTH_EMULATOR_E2E_EMAIL");
if (!email.endsWith("@example.test")) throw new Error("T093 seed requires a synthetic user.");

const app = initializeApp({ projectId }, "t093-member-directory-seed");
const auth = getAuth(app);
const firestore = getFirestore(app);

try {
  const user = await auth.getUserByEmail(email);
  await auth.setCustomUserClaims(user.uid, { academyId, role: "owner" });

  const now = Timestamp.now();
  await firestore.doc(`academies/${academyId}/adminRoleLocks/${user.uid}`).delete();
  await firestore.doc(`academies/${academyId}/users/${user.uid}`).set({
    userId: user.uid,
    academyId,
    accountType: "staff",
    displayName: "Synthetic T093 Owner",
    email,
    authProvider: "google",
    active: true,
    adminRole: "owner",
    lastRoleChangeAuditId: "audit-t093-e2e-provisioning",
    createdAt: now,
    createdBy: "system:t093-e2e-seed",
    updatedAt: now,
    updatedBy: "system:t093-e2e-seed",
    status: "active",
    schemaVersion: 1,
  });
  console.log(JSON.stringify({ academyId, uid: user.uid, role: "owner" }));
} finally {
  await deleteApp(app);
}
