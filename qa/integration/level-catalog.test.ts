import { randomUUID } from "node:crypto";
import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { afterAll, describe, expect, it } from "vitest";

import businessCriteriaJson from "../../docs/data/ibjjf-levels-business-criteria.sanitized.json";
import observedJson from "../../docs/data/ibjjf-levels-observed.sanitized.json";
import { createLevelCatalogStore } from "../../apps/functions/src/levels/level-service";
import { normalizeLevelCatalogSource } from "../../apps/functions/src/levels/level-source";

const runId = `level-catalog-integration-${process.pid}-${randomUUID()}`;
const academyId = `${runId}-academy`;
const firestoreEmulatorHost = process.env.FIRESTORE_EMULATOR_HOST?.trim();

function isLocalEmulatorHost(host: string | undefined): boolean {
  if (host === undefined || host === "") return false;
  try {
    const url = new URL(`http://${host}`);
    return (
      (url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "[::1]") &&
      url.pathname === "/"
    );
  } catch {
    return false;
  }
}

const useLocalEmulator = isLocalEmulatorHost(firestoreEmulatorHost);
if (!useLocalEmulator) {
  console.warn(
    "SKIP level catalog emulator integration: FIRESTORE_EMULATOR_HOST must be a local emulator host",
  );
}

const app = useLocalEmulator ? initializeApp({ projectId: "demo-bpt-jersey" }, runId) : undefined;
const firestore = app ? getFirestore(app) : undefined;
const store = firestore
  ? createLevelCatalogStore({
      firestore: firestore as unknown as Parameters<typeof createLevelCatalogStore>[0]["firestore"],
    })
  : undefined;
const normalized = normalizeLevelCatalogSource(observedJson, businessCriteriaJson);

afterAll(async () => {
  if (app) {
    if (store) {
      try {
        await store.rollback({ academyId, systemId: "ibjjf-v1", normalized });
      } catch {
        // cleanup ignore
      }
    }
    await deleteApp(app);
  }
});

describe("Level Catalog Emulator Integration", () => {
  it.skipIf(!useLocalEmulator)(
    "seeds, lists and rolls back catalog in real Firestore emulator",
    async () => {
      if (!store) throw new Error("Store required for integration test");

      // 1. Seed
      const seedResult = await store.seed({
        academyId,
        normalized,
      });

      expect(seedResult.systemId).toBe("ibjjf-v1");
      expect(seedResult.definitionCount).toBe(171);
      expect(seedResult.beltCount).toBe(27);
      expect(seedResult.stripeCount).toBe(144);
      expect(seedResult.skillCount).toBe(11);
      expect(seedResult.requirementCount).toBe(165);
      expect(seedResult.idempotent).toBe(false);

      // 2. List published
      const catalog = await store.listPublished(academyId);
      expect(catalog.system.systemId).toBe("ibjjf-v1");
      expect(catalog.definitions).toHaveLength(171);
      expect(catalog.skills).toHaveLength(11);
      expect(catalog.requirements).toHaveLength(165);
      expect(catalog.sourceHash).toBe(normalized.sourceHash);

      // 3. Re-seed (idempotent)
      const reseed = await store.seed({
        academyId,
        normalized,
      });
      expect(reseed.idempotent).toBe(true);

      // 4. Rollback
      const rollback = await store.rollback({
        academyId,
        systemId: "ibjjf-v1",
        normalized,
      });
      expect(rollback.deletedDefinitions).toBe(171);
      expect(rollback.deletedRequirements).toBe(165);
      expect(rollback.deletedSystems).toBe(1);

      await expect(store.listPublished(academyId)).rejects.toThrow();
    },
  );
});
