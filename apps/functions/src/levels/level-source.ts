import { createHash } from "node:crypto";

import { parseLevelCatalogSource, type CanonicalLevelCatalog } from "@bpt-jersey/domain/levels";

export type NormalizedLevelCatalog = CanonicalLevelCatalog &
  Readonly<{
    sourceHash: string;
  }>;

export function computeCatalogSourceHash(observed: unknown, businessCriteria: unknown): string {
  const combined = JSON.stringify({ observed, businessCriteria });
  return createHash("sha256").update(combined).digest("hex");
}

export function normalizeLevelCatalogSource(
  observed: unknown,
  businessCriteria: unknown,
): NormalizedLevelCatalog {
  const result = parseLevelCatalogSource(observed, businessCriteria);
  if (!result.ok) {
    const errorDetails = result.error.map((e) => `${e.path.join(".")}: ${e.code}`).join(", ");
    throw new Error(`Invalid level catalog source data: ${errorDetails}`);
  }

  const sourceHash = computeCatalogSourceHash(observed, businessCriteria);

  return Object.freeze({
    ...result.value,
    sourceHash,
  });
}
