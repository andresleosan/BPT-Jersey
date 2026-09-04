import {
  assertLevelSeedConfirmation,
  assertLevelSeedTargetEnvironment,
  parseLevelSeedArguments,
} from "./level-seed-target.mjs";

async function main() {
  const options = parseLevelSeedArguments(process.argv.slice(2));
  const target = options["target"];
  const academyId = options["academy-id"];
  const systemId = options["system-id"];
  const confirmation = options["confirmation"];
  const isRollback = Boolean(options["rollback"]);

  if (target !== "emulator" && target !== "staging") {
    throw new Error("Missing or invalid --target (must be 'emulator' or 'staging').");
  }

  const initialEnvironment = {
    gcloudProjectId: process.env.GCLOUD_PROJECT,
    firebaseConfig: process.env.FIREBASE_CONFIG,
    firestoreEmulatorHost: process.env.FIRESTORE_EMULATOR_HOST,
    nodeEnvironment: process.env.NODE_ENV,
  };
  const targetBinding = assertLevelSeedTargetEnvironment(target, initialEnvironment);
  assertLevelSeedConfirmation(target, isRollback, confirmation);
  const firebaseApp = await import("firebase-admin/app");
  const existingApp = firebaseApp.getApps()[0];
  const environment = {
    ...initialEnvironment,
    existingAppPresent: existingApp !== undefined,
    existingAppProjectId: existingApp?.options.projectId,
  };
  const verifiedBinding = assertLevelSeedTargetEnvironment(target, environment);
  if (verifiedBinding.projectId !== targetBinding.projectId) {
    throw new Error("Level seed target is not safe.");
  }
  const app = existingApp ?? firebaseApp.initializeApp({ projectId: targetBinding.projectId });
  const [firebaseFirestore, levelService, levelSeed] = await Promise.all([
    import("firebase-admin/firestore"),
    import("../../../.firebase-functions/lib/src/levels/level-service.js"),
    import("../../../.firebase-functions/lib/src/levels/level-seed.js"),
  ]);
  const firestore = firebaseFirestore.getFirestore(app);
  const store = levelService.createLevelCatalogStore({ firestore });

  if (isRollback) {
    const result = await levelSeed.rollbackLevelCatalog({
      target,
      academyId,
      systemId,
      confirmation,
      environment,
      store,
    });
    console.log(JSON.stringify(result, null, 2));
  } else {
    const result = await levelSeed.seedLevelCatalog({
      target,
      academyId,
      confirmation,
      environment,
      store,
    });
    console.log(JSON.stringify(result, null, 2));
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Seed failed");
  process.exitCode = 1;
});
