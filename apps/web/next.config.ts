import type { NextConfig } from "next";

const firebaseEnvironment =
  process.env.NEXT_PUBLIC_FIREBASE_ENV ??
  (process.env.NODE_ENV === "development" ? "local" : "production");
if (process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS === "true" && firebaseEnvironment !== "local") {
  throw new Error("Firebase emulators are local-only and cannot be enabled for this build.");
}

// ponytail: en dev el navegador llega por el hostname de la tailnet, no por localhost;
// sin esto Next 16 devuelve 403 en /_next/*. Vacío (y por tanto inerte) fuera de dev.
const devOrigins = (process.env.NEXT_DEV_ALLOWED_ORIGINS ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const nextConfig: NextConfig = {
  agentRules: false,
  ...(devOrigins.length > 0 ? { allowedDevOrigins: devOrigins } : {}),
  output: "export",
  poweredByHeader: false,
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
