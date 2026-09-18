import { deleteApp, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, Timestamp } from "firebase-admin/firestore";

// T051V2 synthetic provisioning for the member record / JIU-JITSU IBJJF E2E. It creates the three
// NON-owner actors the spec needs - a head coach, a coach and an administrator - with Auth claims,
// the staff `users/{uid}` document the levels authorization reads inside its transactions and, for
// the two coaching roles, the canonical `staff/{staffId}` profile. The owner is provisioned by the
// T093 seeds, which this script deliberately does not duplicate.
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
  throw new Error("T051V2 actor seed requires loopback demo Auth/Firestore emulators.");
}

const academyId = required("MEMBER_PROFILE_E2E_ACADEMY_ID");
if (!/^[a-z][a-z0-9-]{2,60}$/u.test(academyId)) {
  throw new Error("T051V2 actor seed requires a simple synthetic academy ID.");
}
const password = required("MEMBER_PROFILE_E2E_PASSWORD");
if (password.length < 12) {
  throw new Error("T051V2 actor seed requires a synthetic password of 12+ characters.");
}

const actors = [
  { role: "headCoach", email: required("MEMBER_PROFILE_HEAD_COACH_EMAIL"), staff: true },
  { role: "coach", email: required("MEMBER_PROFILE_COACH_EMAIL"), staff: true },
  { role: "administrator", email: required("MEMBER_PROFILE_ADMINISTRATOR_EMAIL"), staff: false },
];
for (const actor of actors) {
  if (!actor.email.endsWith("@example.test")) {
    throw new Error("T051V2 actor seed requires synthetic users.");
  }
}

const app = initializeApp({ projectId }, "t051-member-profile-actors");
const auth = getAuth(app);
const firestore = getFirestore(app);

try {
  for (const actor of actors) {
    let user;
    try {
      user = await auth.getUserByEmail(actor.email);
      user = await auth.updateUser(user.uid, { password, emailVerified: true, disabled: false });
    } catch (error) {
      if (error?.code !== "auth/user-not-found") throw error;
      user = await auth.createUser({ email: actor.email, password, emailVerified: true });
    }
    await auth.setCustomUserClaims(user.uid, { academyId, role: actor.role });

    const now = new Date().toISOString();
    // The administrator is provisioned in exactly the shape the canonical directory read service
    // verifies for an admin actor (the same one the T093 owner seed writes); a staff coach is
    // provisioned as staff and carries no `adminRole` at all.
    const stamp = Timestamp.now();
    await firestore.doc(`academies/${academyId}/adminRoleLocks/${user.uid}`).delete();
    await firestore.doc(`academies/${academyId}/users/${user.uid}`).set(
      actor.role === "administrator"
        ? {
            userId: user.uid,
            academyId,
            accountType: "staff",
            displayName: "Synthetic T051V2 Administrator",
            email: actor.email,
            authProvider: "google",
            active: true,
            adminRole: "administrator",
            lastRoleChangeAuditId: "audit-t051-e2e-provisioning",
            createdAt: stamp,
            createdBy: "system:t051-e2e-seed",
            updatedAt: stamp,
            updatedBy: "system:t051-e2e-seed",
            status: "active",
            schemaVersion: 1,
          }
        : {
            userId: user.uid,
            academyId,
            accountType: "staff",
            displayName: `Synthetic T051V2 ${actor.role}`,
            email: actor.email,
            active: true,
            status: "active",
            schemaVersion: "1",
            createdAt: now,
            createdBy: "system:t051-e2e-seed",
            updatedAt: now,
            updatedBy: "system:t051-e2e-seed",
          },
    );

    if (!actor.staff) {
      console.log(JSON.stringify({ academyId, uid: user.uid, role: actor.role, staffId: null }));
      continue;
    }
    // The levels authorization resolves exactly one active staff profile by userId, so any older
    // profile for this user is removed rather than left to make the lookup ambiguous.
    const staffId = `staff-${actor.role.toLowerCase()}-${user.uid.slice(0, 8).toLowerCase()}`;
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
      role: actor.role,
      active: true,
      status: "active",
      schemaVersion: "1",
      createdAt: now,
      createdBy: "system:t051-e2e-seed",
      updatedAt: now,
      updatedBy: "system:t051-e2e-seed",
    });
    console.log(JSON.stringify({ academyId, uid: user.uid, role: actor.role, staffId }));
  }
} finally {
  await deleteApp(app);
}
