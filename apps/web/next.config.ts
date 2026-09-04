import type { NextConfig } from "next";

const firebaseEnvironment =
  process.env.NEXT_PUBLIC_FIREBASE_ENV ??
  (process.env.NODE_ENV === "development" ? "local" : "production");
const useFirebaseEmulators = process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS === "true";
const isLocalFirebaseEmulator = firebaseEnvironment === "local" && useFirebaseEmulators;

if (useFirebaseEmulators && firebaseEnvironment !== "local") {
  throw new Error("Firebase emulators are local-only and cannot be enabled for this build.");
}

const hasPublicDebugToken = Object.keys(process.env).some(
  (name) =>
    name.startsWith("NEXT_PUBLIC_") &&
    name.endsWith("_DEBUG_TOKEN") &&
    Boolean(process.env[name]?.trim()),
);

if (hasPublicDebugToken && !isLocalFirebaseEmulator) {
  throw new Error(
    "Firebase public debug tokens are local Emulator-only and cannot be enabled for this build.",
  );
}

const appCheckSiteKey = process.env.NEXT_PUBLIC_FIREBASE_APP_CHECK_SITE_KEY?.trim();

if (!appCheckSiteKey && (firebaseEnvironment !== "local" || hasPublicDebugToken)) {
  throw new Error("A Firebase App Check site key is required for this build environment.");
}

const nextConfig: NextConfig = {
  agentRules: false,
  output: "export",
  poweredByHeader: false,
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
