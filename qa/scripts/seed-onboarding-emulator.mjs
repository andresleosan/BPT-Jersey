import { deleteApp, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

// T094 synthetic provisioning for the authenticated onboarding E2E. It prepares only the two client
// identities (an adult student and a guardian) as Auth Emulator users with the academy claims the
// callables verify. Their `users/{uid}` and `students/{id}` documents are deliberately NOT written
// here: creating them through `saveClientProfile`, `saveGuardianProfile` and `createFamily` is the
// onboarding path under test. The owner is provisioned by the T093 seed the runner invokes first.
const projectId = "demo-bpt-jersey";
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

if (!isLoopback(authHost) || (process.env.GCLOUD_PROJECT ?? projectId) !== projectId) {
  throw new Error("T094 seed requires a loopback demo Auth Emulator.");
}

const academyId = required("T094_E2E_ACADEMY_ID");
if (!/^[a-z][a-z0-9-]{2,60}$/u.test(academyId)) {
  throw new Error("T094 seed requires a simple synthetic academy ID.");
}
const password = required("T094_E2E_PASSWORD");
if (password.length < 12) throw new Error("T094 seed requires a synthetic password of 12+ chars.");

const clients = [
  { email: required("T094_ADULT_EMAIL"), role: "adultStudent" },
  { email: required("T094_GUARDIAN_EMAIL"), role: "guardian" },
];
for (const client of clients) {
  if (!client.email.endsWith("@example.test")) {
    throw new Error("T094 seed requires synthetic @example.test client users.");
  }
}
if (clients[0].email === clients[1].email) {
  throw new Error("T094 seed requires distinct adult and guardian users.");
}

const app = initializeApp({ projectId }, "t094-onboarding-seed");
const auth = getAuth(app);

try {
  for (const client of clients) {
    let user;
    try {
      user = await auth.getUserByEmail(client.email);
      user = await auth.updateUser(user.uid, { password, emailVerified: true, disabled: false });
    } catch (error) {
      if (error?.code !== "auth/user-not-found") throw error;
      user = await auth.createUser({ email: client.email, password, emailVerified: true });
    }
    await auth.setCustomUserClaims(user.uid, { academyId, role: client.role });
    console.log(JSON.stringify({ academyId, uid: user.uid, role: client.role }));
  }
} finally {
  await deleteApp(app);
}
