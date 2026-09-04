import { createHash } from "node:crypto";

import { parseLevelCatalogSource, type CanonicalLevelCatalog } from "@bpt-jersey/domain/levels";

export type NormalizedLevelCatalog = CanonicalLevelCatalog &
  Readonly<{
    sourceHash: string;
    sourceHashes: Readonly<{
      observed: string;
      businessCriteria: string;
    }>;
  }>;

export const approvedLevelCatalogSourceHashes = Object.freeze({
  observed: "1118e362ad02db54a8da1117e19a77f1bd05598aa770e53ca502bd18b8da6794",
  businessCriteria: "209a46d2c9e13404601248ec7cfd82868058e567d91bb95946676d4f5fe0d98d",
  combined: "c92af1720951dba01ee79f9d1b1b8084f18dedc2400584b375a7e12717314f73",
});

function computeSourceFileHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function computeCatalogSourceHash(observed: unknown, businessCriteria: unknown): string {
  const combined = JSON.stringify({ observed, businessCriteria });
  return createHash("sha256").update(combined).digest("hex");
}

export function assertApprovedLevelCatalogSource(normalized: NormalizedLevelCatalog): void {
  if (
    normalized.sourceHash !== approvedLevelCatalogSourceHashes.combined ||
    normalized.sourceHashes.observed !== approvedLevelCatalogSourceHashes.observed ||
    normalized.sourceHashes.businessCriteria !== approvedLevelCatalogSourceHashes.businessCriteria
  ) {
    throw new Error("Level catalog sources do not match the approved hashes.");
  }
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
  const sourceHashes = Object.freeze({
    observed: computeSourceFileHash(observed),
    businessCriteria: computeSourceFileHash(businessCriteria),
  });

  return Object.freeze({
    ...result.value,
    sourceHash,
    sourceHashes,
  });
}
