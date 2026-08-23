import { initializeApp, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { createLevelCatalogStore } from "../src/levels/level-service.ts";
import { seedLevelCatalog, rollbackLevelCatalog } from "../src/levels/level-seed.ts";

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {};
  for (const arg of args) {
    if (arg.startsWith("--")) {
      const [key, value] = arg.slice(2).split("=");
      options[key] = value ?? true;
    }
  }
  return options;
}

async function main() {
  const options = parseArgs();
  const target = options["target"] ?? (process.env.FIREBASE_EMULATOR_HOST ? "emulator" : undefined);
  const academyId = options["academy-id"] ?? "demo-academy";
  const systemId = options["system-id"] ?? "ibjjf-v1";
  const confirmation = options["confirmation"];
  const isRollback = Boolean(options["rollback"]);

  if (!target || (target !== "emulator" && target !== "staging")) {
    throw new Error("Missing or invalid --target (must be 'emulator' or 'staging').");
  }

  const app =
    getApps()[0] ?? initializeApp({ projectId: process.env.GCLOUD_PROJECT ?? "demo-bpt-jersey" });
  const firestore = getFirestore(app);
  const store = createLevelCatalogStore({ firestore });

  if (isRollback) {
    const result = await rollbackLevelCatalog({
      target,
      academyId,
      systemId,
      confirmation,
      store,
    });
    console.log(JSON.stringify(result, null, 2));
  } else {
    const result = await seedLevelCatalog({
      target,
      academyId,
      confirmation,
      store,
    });
    console.log(JSON.stringify(result, null, 2));
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Seed failed");
  process.exitCode = 1;
});
