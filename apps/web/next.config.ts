import type { NextConfig } from "next";

const firebaseEnvironment =
  process.env.NEXT_PUBLIC_FIREBASE_ENV ??
  (process.env.NODE_ENV === "development" ? "local" : "production");

if (process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS === "true" && firebaseEnvironment !== "local") {
  throw new Error("Firebase emulators are local-only and cannot be enabled for this build.");
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
