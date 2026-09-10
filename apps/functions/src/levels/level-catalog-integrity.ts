import { createHash } from "node:crypto";

import { assertApprovedLevelCatalogSource, type NormalizedLevelCatalog } from "./level-source.js";

export const LEVEL_CATALOG_MANIFEST_SCHEMA_VERSION = 1 as const;
export const LEVEL_CATALOG_DOCUMENT_COUNT = 337 as const;
export const LEVEL_CATALOG_DEFINITION_COUNT = 171 as const;
export const LEVEL_CATALOG_REQUIREMENT_COUNT = 165 as const;

export type LevelCatalogManifest = Readonly<{
  manifestId: string;
  academyId: string;
  systemId: string;
  status: "published";
  schemaVersion: typeof LEVEL_CATALOG_MANIFEST_SCHEMA_VERSION;
  sourceHash: string;
  observedSourceHash: string;
  businessCriteriaSourceHash: string;
  catalogDocumentHash: string;
  definitionKeysHash: string;
  requirementKeysHash: string;
  catalogDocumentCount: typeof LEVEL_CATALOG_DOCUMENT_COUNT;
  definitionCount: typeof LEVEL_CATALOG_DEFINITION_COUNT;
  requirementCount: typeof LEVEL_CATALOG_REQUIREMENT_COUNT;
  publishedOperationId: string;
  publishedAuditEventId: string;
}>;

export type LevelCatalogPublication = Readonly<{
  systemId: string;
  systemDocument: Readonly<Record<string, unknown>>;
  definitions: readonly Readonly<{
    id: string;
    data: Readonly<Record<string, unknown>>;
  }>[];
  requirements: readonly Readonly<{
    id: string;
    data: Readonly<Record<string, unknown>>;
  }>[];
  manifest: LevelCatalogManifest;
}>;

export type StoredLevelCatalogDocument = Readonly<{
  id: string;
  data: () => Record<string, unknown>;
}>;

const sha256Pattern = /^[a-f0-9]{64}$/u;
const safeOperationIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Level catalog contains a non-finite number.");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  if (typeof value !== "object") {
    throw new Error("Level catalog contains an unsupported value.");
  }

  const record = value as Record<string, unknown>;
  const ownKeys = Reflect.ownKeys(record);
  if (ownKeys.some((key) => typeof key !== "string")) {
    throw new Error("Level catalog contains an unsupported key.");
  }
  const keys = (ownKeys as string[]).sort((left, right) => left.localeCompare(right));
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
}

export function hashLevelCatalogValue(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

function sortedUniqueIds(values: readonly string[], label: string): readonly string[] {
  const sorted = [...values].sort((left, right) => left.localeCompare(right));
  if (new Set(sorted).size !== sorted.length) {
    throw new Error(`Level catalog contains duplicate ${label} IDs.`);
  }
  return Object.freeze(sorted);
}

function assertApprovedCatalogShape(normalized: NormalizedLevelCatalog): void {
  if (
    normalized.system.systemId !== "ibjjf-v1" ||
    normalized.definitions.length !== LEVEL_CATALOG_DEFINITION_COUNT ||
    normalized.requirements.length !== LEVEL_CATALOG_REQUIREMENT_COUNT ||
    normalized.definitions.filter((definition) => definition.kind === "belt").length !== 27 ||
    normalized.definitions.filter((definition) => definition.kind === "stripe").length !== 144 ||
    normalized.skills.length !== 11
  ) {
    throw new Error("Level catalog does not match the approved publication shape.");
  }
}

export function buildLevelCatalogPublication(
  input: Readonly<{
    academyId: string;
    normalized: NormalizedLevelCatalog;
    operationId: string;
    publishedAuditEventId: string;
  }>,
): LevelCatalogPublication {
  assertApprovedLevelCatalogSource(input.normalized);
  assertApprovedCatalogShape(input.normalized);
  if (!safeOperationIdPattern.test(input.operationId)) {
    throw new Error("Invalid level catalog operation ID.");
  }

  const systemId = input.normalized.system.systemId;
  const definitionIds = sortedUniqueIds(
    input.normalized.definitions.map((definition) => definition.definitionKey),
    "definition",
  );
  const requirementIds = sortedUniqueIds(
    input.normalized.requirements.map((requirement) => requirement.requirementKey),
    "requirement",
  );

  const systemDocument = Object.freeze({
    ...input.normalized.system,
    academyId: input.academyId,
    sourceHash: input.normalized.sourceHash,
    observedSourceHash: input.normalized.sourceHashes.observed,
    businessCriteriaSourceHash: input.normalized.sourceHashes.businessCriteria,
    manifestId: systemId,
    status: "published" as const,
  });
  const definitions = Object.freeze(
    input.normalized.definitions
      .map((definition) =>
        Object.freeze({
          id: definition.definitionKey,
          data: Object.freeze({ ...definition, academyId: input.academyId }),
        }),
      )
      .sort((left, right) => left.id.localeCompare(right.id)),
  );
  const requirements = Object.freeze(
    input.normalized.requirements
      .map((requirement) =>
        Object.freeze({
          id: requirement.requirementKey,
          data: Object.freeze({ ...requirement, academyId: input.academyId }),
        }),
      )
      .sort((left, right) => left.id.localeCompare(right.id)),
  );
  const catalogDocumentHash = hashLevelCatalogValue({
    system: systemDocument,
    definitions,
    requirements,
  });
  const manifest = Object.freeze({
    manifestId: systemId,
    academyId: input.academyId,
    systemId,
    status: "published" as const,
    schemaVersion: LEVEL_CATALOG_MANIFEST_SCHEMA_VERSION,
    sourceHash: input.normalized.sourceHash,
    observedSourceHash: input.normalized.sourceHashes.observed,
    businessCriteriaSourceHash: input.normalized.sourceHashes.businessCriteria,
    catalogDocumentHash,
    definitionKeysHash: hashLevelCatalogValue(definitionIds),
    requirementKeysHash: hashLevelCatalogValue(requirementIds),
    catalogDocumentCount: LEVEL_CATALOG_DOCUMENT_COUNT,
    definitionCount: LEVEL_CATALOG_DEFINITION_COUNT,
    requirementCount: LEVEL_CATALOG_REQUIREMENT_COUNT,
    publishedOperationId: input.operationId,
    publishedAuditEventId: input.publishedAuditEventId,
  });

  return Object.freeze({ systemId, systemDocument, definitions, requirements, manifest });
}

function assertStoredDocumentsMatch(
  stored: readonly StoredLevelCatalogDocument[],
  expected: readonly Readonly<{ id: string; data: Readonly<Record<string, unknown>> }>[],
  label: string,
): void {
  if (stored.length !== expected.length) {
    throw new Error(`Stored level ${label} count does not match the manifest.`);
  }
  const storedById = new Map(stored.map((document) => [document.id, document.data()]));
  if (storedById.size !== expected.length) {
    throw new Error(`Stored level ${label} IDs are not unique.`);
  }
  for (const document of expected) {
    const actual = storedById.get(document.id);
    if (
      actual === undefined ||
      hashLevelCatalogValue(actual) !== hashLevelCatalogValue(document.data)
    ) {
      throw new Error(`Stored level ${label} do not match the approved catalog.`);
    }
  }
}

export function assertStoredLevelCatalogIntegrity(
  input: Readonly<{
    publication: LevelCatalogPublication;
    storedSystem: Record<string, unknown> | undefined;
    storedManifest: Record<string, unknown> | undefined;
    storedDefinitions: readonly StoredLevelCatalogDocument[];
    storedRequirements: readonly StoredLevelCatalogDocument[];
  }>,
): void {
  if (
    input.storedSystem === undefined ||
    hashLevelCatalogValue(input.storedSystem) !==
      hashLevelCatalogValue(input.publication.systemDocument)
  ) {
    throw new Error("Stored level system does not match the approved manifest.");
  }
  if (
    input.storedManifest === undefined ||
    hashLevelCatalogValue(input.storedManifest) !==
      hashLevelCatalogValue(input.publication.manifest)
  ) {
    throw new Error("Stored level catalog manifest is invalid.");
  }
  assertStoredDocumentsMatch(input.storedDefinitions, input.publication.definitions, "definitions");
  assertStoredDocumentsMatch(
    input.storedRequirements,
    input.publication.requirements,
    "requirements",
  );

  const actualCatalogHash = hashLevelCatalogValue({
    system: input.storedSystem,
    definitions: input.storedDefinitions
      .map((document) => ({ id: document.id, data: document.data() }))
      .sort((left, right) => left.id.localeCompare(right.id)),
    requirements: input.storedRequirements
      .map((document) => ({ id: document.id, data: document.data() }))
      .sort((left, right) => left.id.localeCompare(right.id)),
  });
  if (
    !sha256Pattern.test(input.publication.manifest.catalogDocumentHash) ||
    actualCatalogHash !== input.publication.manifest.catalogDocumentHash
  ) {
    throw new Error("Stored level catalog hash does not match the manifest.");
  }
}

export function levelCatalogDocumentReferencesSystem(
  data: Readonly<Record<string, unknown>>,
  systemId: string,
  definitionKeys: ReadonlySet<string>,
): boolean {
  if (data.systemId === systemId || data.levelSystemId === systemId) return true;

  const directKeys = [
    data.definitionKey,
    data.currentDefinitionKey,
    data.fromDefinitionKey,
    data.toDefinitionKey,
    data.targetDefinitionKey,
  ];
  if (directKeys.some((value) => typeof value === "string" && definitionKeys.has(value))) {
    return true;
  }

  if (Array.isArray(data.dimensions)) {
    return data.dimensions.some(
      (dimension) =>
        typeof dimension === "object" &&
        dimension !== null &&
        typeof (dimension as { definitionKey?: unknown }).definitionKey === "string" &&
        definitionKeys.has((dimension as { definitionKey: string }).definitionKey),
    );
  }
  return false;
}
