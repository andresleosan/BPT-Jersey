#!/usr/bin/env node

import { register } from "node:module";

// This is deliberately not a Firebase Function and is never exported by src/index.ts.
let initializerSecrets;
let initializedApp;
let deleteInitializedApp;
let runtimeResolutionComplete = false;

try {
  register("./member-directory-empty-runtime-loader.mjs", {
    parentURL: import.meta.url,
    data: {
      memberDirectoryDomainUrl: new URL(
        "../../../packages/domain/lib/members/member-directory-contracts.js",
        import.meta.url,
      ).href,
    },
  });
  const [initializer, baseline] = await Promise.all([
    import("../lib/src/members/member-directory-empty-initializer.js"),
    import("../lib/src/members/member-directory-empty-baseline-local.js"),
  ]);
  runtimeResolutionComplete = true;
  await initializer.runEmptyCanonicalMemberDirectoryInitializer(
    {
      arguments: process.argv.slice(2),
      environment: {
        GCLOUD_PROJECT: process.env.GCLOUD_PROJECT,
        GOOGLE_CLOUD_PROJECT: process.env.GOOGLE_CLOUD_PROJECT,
        FIREBASE_CONFIG: process.env.FIREBASE_CONFIG,
        FIRESTORE_EMULATOR_HOST: process.env.FIRESTORE_EMULATOR_HOST,
        FIREBASE_AUTH_EMULATOR_HOST: process.env.FIREBASE_AUTH_EMULATOR_HOST,
      },
      now: () => new Date().toISOString(),
    },
    {
      reopenAndVerifyPrivateEmptyBaseline: async (binding) => {
        initializerSecrets = baseline.loadEmptyCanonicalInitializerSecrets(process.env);
        return baseline
          .createLocalEmptyIdentityBaselineAdapter({
            secrets: initializerSecrets,
            artifactRootUrl: new URL("../../../.tmp/member-directory-baselines/", import.meta.url),
          })
          .ensureAndReopen(binding);
      },
      getIntegritySecret: () => {
        if (initializerSecrets === undefined) {
          throw new Error("Private baseline verification did not complete.");
        }
        return initializerSecrets.integrity;
      },
      createStore: async () => {
        const [{ deleteApp, getApps, initializeApp }, { getFirestore }, adapter] =
          await Promise.all([
            import("firebase-admin/app"),
            import("firebase-admin/firestore"),
            import("../lib/src/members/member-directory-empty-initializer-firestore.js"),
          ]);
        if (getApps().length !== 0) {
          throw new Error("Unexpected pre-existing Firebase Admin app.");
        }
        initializedApp = initializeApp(
          { projectId: "demo-bpt-jersey" },
          "t093-empty-canonical-initializer",
        );
        deleteInitializedApp = () => deleteApp(initializedApp);
        return adapter.createEmptyCanonicalMemberDirectoryFirestoreStore(
          getFirestore(initializedApp),
        );
      },
    },
  );
  process.stdout.write("Empty canonical member directory initialized.\n");
} catch {
  process.stderr.write(
    runtimeResolutionComplete
      ? "Empty canonical initialization failed.\n"
      : "Empty canonical runner module resolution failed.\n",
  );
  process.exitCode = 1;
} finally {
  if (deleteInitializedApp !== undefined) {
    await deleteInitializedApp();
  }
}
