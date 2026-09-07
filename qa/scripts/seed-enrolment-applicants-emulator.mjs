import { deleteApp, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

// T121 slice 2 synthetic applicants for the enrolment approval E2E. Each one is exactly what a
// visitor is after signing in with Google and registering: an account with a display name, an
// email and the lowest claim the platform has. Nothing else - no client document, no student, no
// family. Building any of that here would hide the very thing the approval has to produce.
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
  (process.env.GCLOUD_PROJECT ?? projectId) !== projectId
) {
  throw new Error("T121 applicant seed requires loopback demo Auth/Firestore emulators.");
}

const academyId = required("T093_E2E_ACADEMY_ID");
if (!/^[a-z][a-z0-9-]{2,60}$/u.test(academyId)) {
  throw new Error("T121 applicant seed requires a simple synthetic academy ID.");
}
const password = required("T121_APPLICANT_PASSWORD");
if (password.length < 12) {
  throw new Error("T121 applicant seed requires a synthetic password of 12+ characters.");
}

/**
 * One applicant per scenario, because a person may hold only one open request at a time. Sharing
 * an account between scenarios would make the second one fail for the right reason at the wrong
 * moment and hide whatever it was actually checking.
 */
const applicants = [
  { key: "adult", displayName: "Synthetic T121 Adult Applicant" },
  { key: "concurrent", displayName: "Synthetic T121 Concurrent Applicant" },
  { key: "guardian", displayName: "Synthetic T121 Guardian Applicant" },
  { key: "nameless", displayName: undefined },
];

const app = initializeApp({ projectId }, "t121-enrolment-applicant-seed");
const auth = getAuth(app);

try {
  const seeded = [];
  for (const applicant of applicants) {
    const email = `t121-${applicant.key}@example.test`;
    let user;
    try {
      user = await auth.getUserByEmail(email);
      user = await auth.updateUser(user.uid, {
        password,
        ...(applicant.displayName === undefined ? {} : { displayName: applicant.displayName }),
      });
    } catch (error) {
      if (error?.code !== "auth/user-not-found") throw error;
      user = await auth.createUser({
        email,
        password,
        emailVerified: true,
        ...(applicant.displayName === undefined ? {} : { displayName: applicant.displayName }),
      });
    }
    // Exactly the two keys the claim vocabulary allows. Anything else poisons extractUserClaims
    // and locks the account out of every callable.
    await auth.setCustomUserClaims(user.uid, { academyId, role: "shopper" });
    seeded.push({ key: applicant.key, uid: user.uid, email });
  }
  console.log(JSON.stringify({ academyId, applicants: seeded }));
} finally {
  await deleteApp(app);
}
