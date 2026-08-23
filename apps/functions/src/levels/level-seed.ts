import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  type LevelCatalogStore,
  type LevelRollbackResult,
  type LevelSeedResult,
} from "./level-service";
import { normalizeLevelCatalogSource } from "./level-source";

export type SeedLevelCatalogInput = Readonly<{
  target: "emulator" | "staging";
  academyId: string;
  confirmation?: string;
  store: LevelCatalogStore;
  customObserved?: unknown;
  customBusiness?: unknown;
}>;

export type RollbackLevelCatalogInput = Readonly<{
  target: "emulator" | "staging";
  academyId: string;
  systemId: string;
  confirmation?: string;
  store: LevelCatalogStore;
}>;

function assertNonProduction(target: string): void {
  if (target === "production" || process.env.NODE_ENV === "production") {
    throw new Error("Production seed is strictly prohibited.");
  }
  if (target !== "emulator" && target !== "staging") {
    throw new Error(`Unsupported seed target: ${target}`);
  }
}

export async function seedLevelCatalog(input: SeedLevelCatalogInput): Promise<LevelSeedResult> {
  assertNonProduction(input.target);

  if (input.target === "staging" && input.confirmation !== "T083-LEVELS-SEED") {
    throw new Error("Confirmation required for staging: T083-LEVELS-SEED");
  }

  let observed = input.customObserved;
  let business = input.customBusiness;

  if (!observed) {
    const observedPath = resolve(process.cwd(), "docs/data/ibjjf-levels-observed.sanitized.json");
    observed = JSON.parse(readFileSync(observedPath, "utf8"));
  }

  if (!business) {
    const businessPath = resolve(
      process.cwd(),
      "docs/data/ibjjf-levels-business-criteria.sanitized.json",
    );
    business = JSON.parse(readFileSync(businessPath, "utf8"));
  }

  const normalized = normalizeLevelCatalogSource(observed, business);
  return input.store.seed({
    academyId: input.academyId,
    normalized,
  });
}

export async function rollbackLevelCatalog(
  input: RollbackLevelCatalogInput,
): Promise<LevelRollbackResult> {
  assertNonProduction(input.target);

  if (input.target === "staging" && input.confirmation !== "T083-LEVELS-SEED") {
    throw new Error("Confirmation required for staging: T083-LEVELS-SEED");
  }

  return input.store.rollback({
    academyId: input.academyId,
    systemId: input.systemId,
  });
}
