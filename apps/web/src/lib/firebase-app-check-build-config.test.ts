import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

async function loadNextConfig() {
  return import("../../next.config");
}

describe("Firebase App Check build configuration", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_FIREBASE_ENV", "staging");
    vi.stubEnv("NEXT_PUBLIC_USE_FIREBASE_EMULATORS", "false");
    vi.stubEnv("NEXT_PUBLIC_FIREBASE_APP_CHECK_SITE_KEY", "");
    vi.stubEnv("NEXT_PUBLIC_FIREBASE_APP_CHECK_DEBUG_TOKEN", "");
    vi.stubEnv("NEXT_PUBLIC_SYNTHETIC_DEBUG_TOKEN", "");
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it.each([
    { firebaseEnvironment: "staging", useEmulators: "false" },
    { firebaseEnvironment: "production", useEmulators: "false" },
    { firebaseEnvironment: "local", useEmulators: "false" },
  ])(
    "rejects every public debug token in $firebaseEnvironment without the local Emulator",
    async ({ firebaseEnvironment, useEmulators }) => {
      vi.stubEnv("NEXT_PUBLIC_FIREBASE_ENV", firebaseEnvironment);
      vi.stubEnv("NEXT_PUBLIC_USE_FIREBASE_EMULATORS", useEmulators);
      vi.stubEnv("NEXT_PUBLIC_FIREBASE_APP_CHECK_SITE_KEY", "enterprise-site-key");
      vi.stubEnv("NEXT_PUBLIC_SYNTHETIC_DEBUG_TOKEN", "synthetic-debug-token");

      await expect(loadNextConfig()).rejects.toThrow(
        /public debug tokens are local Emulator-only/i,
      );
    },
  );

  it.each(["staging", "production"])(
    "requires an App Check site key for a %s build",
    async (firebaseEnvironment) => {
      vi.stubEnv("NEXT_PUBLIC_FIREBASE_ENV", firebaseEnvironment);

      await expect(loadNextConfig()).rejects.toThrow(/App Check site key/i);
    },
  );

  it("rejects a whitespace-only App Check site key", async () => {
    vi.stubEnv("NEXT_PUBLIC_FIREBASE_APP_CHECK_SITE_KEY", "   ");

    await expect(loadNextConfig()).rejects.toThrow(/App Check site key/i);
  });

  it("ignores blank public debug-token variables", async () => {
    vi.stubEnv("NEXT_PUBLIC_FIREBASE_APP_CHECK_SITE_KEY", "enterprise-site-key");
    vi.stubEnv("NEXT_PUBLIC_SYNTHETIC_DEBUG_TOKEN", "   ");

    await expect(loadNextConfig()).resolves.toMatchObject({
      default: { output: "export" },
    });
  });

  it("allows the exact local Emulator configuration without a site key", async () => {
    vi.stubEnv("NEXT_PUBLIC_FIREBASE_ENV", "local");
    vi.stubEnv("NEXT_PUBLIC_USE_FIREBASE_EMULATORS", "true");

    await expect(loadNextConfig()).resolves.toMatchObject({
      default: { output: "export" },
    });
  });

  it("allows an explicit local Emulator debug token only with a site key", async () => {
    vi.stubEnv("NEXT_PUBLIC_FIREBASE_ENV", "local");
    vi.stubEnv("NEXT_PUBLIC_USE_FIREBASE_EMULATORS", "true");
    vi.stubEnv("NEXT_PUBLIC_FIREBASE_APP_CHECK_SITE_KEY", "local-enterprise-site-key");
    vi.stubEnv("NEXT_PUBLIC_FIREBASE_APP_CHECK_DEBUG_TOKEN", "synthetic-debug-token");

    await expect(loadNextConfig()).resolves.toMatchObject({
      default: { output: "export" },
    });
  });

  it("rejects a local Emulator debug token without a site key", async () => {
    vi.stubEnv("NEXT_PUBLIC_FIREBASE_ENV", "local");
    vi.stubEnv("NEXT_PUBLIC_USE_FIREBASE_EMULATORS", "true");
    vi.stubEnv("NEXT_PUBLIC_FIREBASE_APP_CHECK_DEBUG_TOKEN", "synthetic-debug-token");

    await expect(loadNextConfig()).rejects.toThrow(/App Check site key/i);
  });
});
