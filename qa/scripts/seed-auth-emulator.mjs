import { deleteApp, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

const expectedAuthEmulatorHost = process.env.FIREBASE_AUTH_EMULATOR_HOST?.trim();

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment: ${name}`);
  return value;
}

function assertSafeAuthEmulator() {
  const match = /^127\.0\.0\.1:([1-9]\d{3,4})$/u.exec(expectedAuthEmulatorHost ?? "");
  const port = Number(match?.[1]);
  if (!match || port < 1_024 || port > 65_535) {
    throw new Error(
      "Auth seed requires a loopback FIREBASE_AUTH_EMULATOR_HOST on a non-privileged port.",
    );
  }
}

async function main() {
  assertSafeAuthEmulator();
  const email = required("AUTH_EMULATOR_E2E_EMAIL");
  const password = required("AUTH_EMULATOR_E2E_PASSWORD");
  const role = process.env.AUTH_EMULATOR_E2E_ROLE?.trim() || "owner";
  if (
    !["owner", "administrator", "headCoach", "coach", "guardian", "adultStudent"].includes(role)
  ) {
    throw new Error(
      "Auth seed role must be owner, administrator, headCoach, coach, guardian, or adultStudent.",
    );
  }
  if (!email.endsWith("@example.test") || password.length < 12) {
    throw new Error("Auth seed credentials must be synthetic emulator credentials.");
  }
  // Optional: the academy the claim points at. Runners that operate a real academy id (T032)
  // set it so non-owner roles do not need a claims fix-up after seeding.
  const academyId = process.env.AUTH_EMULATOR_E2E_ACADEMY_ID?.trim() || "synthetic-academy";
  if (!/^[a-z][a-z0-9-]{2,60}$/u.test(academyId)) {
    throw new Error("AUTH_EMULATOR_E2E_ACADEMY_ID must be a lowercase slug.");
  }

  const app = initializeApp({ projectId: process.env.GCLOUD_PROJECT ?? "demo-bpt-jersey" });
  const auth = getAuth(app);
  let user;
  try {
    try {
      user = await auth.getUserByEmail(email);
      user = await auth.updateUser(user.uid, { password });
    } catch (error) {
      if (error?.code !== "auth/user-not-found") throw error;
      user = await auth.createUser({ email, password, emailVerified: true });
    }

    await auth.setCustomUserClaims(user.uid, { academyId, role });
    console.log(JSON.stringify({ email, uid: user.uid, role, emulator: expectedAuthEmulatorHost }));
  } finally {
    await deleteApp(app);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Auth Emulator seed failed");
  process.exitCode = 1;
});
