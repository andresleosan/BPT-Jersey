import { describe, expect, it } from "vitest";

import businessCriteriaJson from "../../../../docs/data/ibjjf-levels-business-criteria.sanitized.json";
import observedJson from "../../../../docs/data/ibjjf-levels-observed.sanitized.json";
import {
  assertStoredLevelCatalogIntegrity,
  buildLevelCatalogPublication,
  LEVEL_CATALOG_DOCUMENT_COUNT,
  levelCatalogDocumentReferencesSystem,
} from "./level-catalog-integrity";
import { normalizeLevelCatalogSource } from "./level-source";

const normalized = normalizeLevelCatalogSource(observedJson, businessCriteriaJson);
const publication = buildLevelCatalogPublication({
  academyId: "demo-academy",
  normalized,
  operationId: "seed-operation-1",
  publishedAuditEventId: "audit-level-catalog-published",
});

describe("Level catalog integrity manifest", () => {
  it("binds all 337 catalog documents and both approved source hashes", () => {
    expect(publication.manifest.catalogDocumentCount).toBe(LEVEL_CATALOG_DOCUMENT_COUNT);
    expect(publication.manifest.definitionCount).toBe(171);
    expect(publication.manifest.requirementCount).toBe(165);
    expect(publication.manifest.observedSourceHash).toBe(normalized.sourceHashes.observed);
    expect(publication.manifest.businessCriteriaSourceHash).toBe(
      normalized.sourceHashes.businessCriteria,
    );
  });

  it("rejects a partial catalog instead of treating replay as idempotent", () => {
    expect(() =>
      assertStoredLevelCatalogIntegrity({
        publication,
        storedSystem: { ...publication.systemDocument },
        storedManifest: { ...publication.manifest },
        storedDefinitions: publication.definitions.slice(1).map((document) => ({
          id: document.id,
          data: () => ({ ...document.data }),
        })),
        storedRequirements: publication.requirements.map((document) => ({
          id: document.id,
          data: () => ({ ...document.data }),
        })),
      }),
    ).toThrow(/count does not match the manifest/);
  });

  it("detects canonical progress, promotion and assessment references", () => {
    const definitionKeys = new Set(publication.definitions.map((definition) => definition.id));
    const definitionKey = publication.definitions[0]?.id;
    if (definitionKey === undefined) throw new Error("Fixture definition required.");

    expect(
      levelCatalogDocumentReferencesSystem(
        { systemId: publication.systemId },
        publication.systemId,
        definitionKeys,
      ),
    ).toBe(true);
    expect(
      levelCatalogDocumentReferencesSystem(
        { dimensions: [{ definitionKey }] },
        publication.systemId,
        definitionKeys,
      ),
    ).toBe(true);
    expect(
      levelCatalogDocumentReferencesSystem(
        { unrelated: "value" },
        publication.systemId,
        definitionKeys,
      ),
    ).toBe(false);
  });
});
