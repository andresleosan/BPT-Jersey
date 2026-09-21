import { createHash } from "node:crypto";

import {
  parseLevelCatalogSource,
  type CanonicalLevelCatalog,
  type LevelCatalogVersion,
} from "@bpt-jersey/domain/levels";

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

// ibjjf-v2 is built in memory from the two committed files, so it has no `contentHash` field of its
// own: these three sha256 values ARE its approved source hash, computed the same way as v1's.
export const approvedLevelCatalogSourceHashesBySystem: Readonly<
  Record<
    LevelCatalogVersion,
    Readonly<{ observed: string; businessCriteria: string; combined: string }>
  >
> = Object.freeze({
  "ibjjf-v1": approvedLevelCatalogSourceHashes,
  "ibjjf-v2": Object.freeze({
    observed: "ea6f2176117f22705dec882e2276e66c7620637f902d5d1a4c81d6705994e0a8",
    businessCriteria: "ad45b5a754ac898858e7a3a734377e1b7201d82812af34605e68c3581f4154cf",
    combined: "7b3d072ce9e61b3b24edd6c76a5e221c1f3c1deb886be74de4b74182d31df98c",
  }),
  "ibjjf-v3": Object.freeze({
    observed: "a0ba65ad2e0af61d3e5e0d1e1a11fa1eb015378bb7b6d56f7a92b1ea57b639ef",
    businessCriteria: "2a004063ebef47c417ca269179bf67689f68703a46577cbf0d12c91d04e9c724",
    combined: "fe160a98352209a56dc13602e326ff80a26f2a0b32051f88170fce6255b1a14c",
  }),
});

export function assertApprovedLevelCatalogSource(normalized: NormalizedLevelCatalog): void {
  const systemId = normalized.system.systemId;
  const approved = Object.hasOwn(approvedLevelCatalogSourceHashesBySystem, systemId)
    ? approvedLevelCatalogSourceHashesBySystem[systemId as LevelCatalogVersion]
    : undefined;
  if (
    approved === undefined ||
    normalized.sourceHash !== approved.combined ||
    normalized.sourceHashes.observed !== approved.observed ||
    normalized.sourceHashes.businessCriteria !== approved.businessCriteria
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
