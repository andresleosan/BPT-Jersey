import { deleteApp, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

const expectedAuthEmulatorHost = "127.0.0.1:9099";

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment: ${name}`);
  return value;
}

function assertSafeAuthEmulator() {
  if (process.env.FIREBASE_AUTH_EMULATOR_HOST?.trim() !== expectedAuthEmulatorHost) {
    throw new Error("Auth seed requires FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099.");
  }
}

async function main() {
  assertSafeAuthEmulator();
  const email = required("AUTH_EMULATOR_E2E_EMAIL");
  const password = required("AUTH_EMULATOR_E2E_PASSWORD");
  const role = process.env.AUTH_EMULATOR_E2E_ROLE?.trim() || "owner";
  if (!["owner", "guardian", "adultStudent"].includes(role)) {
    throw new Error("Auth seed role must be owner, guardian, or adultStudent.");
  }
  if (!email.endsWith("@example.test") || password.length < 12) {
    throw new Error("Auth seed credentials must be synthetic emulator credentials.");
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

    await auth.setCustomUserClaims(user.uid, {
      academyId: "synthetic-academy",
      role,
    });
    console.log(JSON.stringify({ email, uid: user.uid, role, emulator: expectedAuthEmulatorHost }));
  } finally {
    await deleteApp(app);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Auth Emulator seed failed");
  process.exitCode = 1;
});
