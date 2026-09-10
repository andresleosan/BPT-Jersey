import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  type LevelCatalogStore,
  type LevelRollbackResult,
  type LevelSeedResult,
} from "./level-service.js";
import {
  assertApprovedLevelCatalogSource,
  normalizeLevelCatalogSource,
  type NormalizedLevelCatalog,
} from "./level-source.js";

export type LevelSeedTarget = "emulator" | "staging";

export type LevelSeedTargetEnvironment = Readonly<{
  gcloudProjectId?: string;
  firebaseConfig?: string;
  firestoreEmulatorHost?: string;
  existingAppPresent?: boolean;
  existingAppProjectId?: string;
  nodeEnvironment?: string;
}>;

export type LevelSeedTargetBinding = Readonly<{
  target: LevelSeedTarget;
  projectId: string;
}>;

export type SeedLevelCatalogInput = Readonly<{
  target: LevelSeedTarget;
  academyId: string;
  confirmation?: string;
  environment: LevelSeedTargetEnvironment;
  store: LevelCatalogStore;
  customObserved?: unknown;
  customBusiness?: unknown;
}>;

export type RollbackLevelCatalogInput = Readonly<{
  target: LevelSeedTarget;
  academyId: string;
  systemId: string;
  confirmation?: string;
  environment: LevelSeedTargetEnvironment;
  store: LevelCatalogStore;
}>;

// The approved sources are resolved from this module, never from the working directory, so the
// same artifact loads the same files regardless of where the CLI is launched. The repository root
// is four directories above this module in every supported layout (apps/functions/src/levels,
// apps/functions/lib/src/levels and .firebase-functions/lib/src/levels).
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");

export const levelCatalogSourcePaths = Object.freeze({
  observed: resolve(repositoryRoot, "docs/data/ibjjf-levels-observed.sanitized.json"),
  businessCriteria: resolve(
    repositoryRoot,
    "docs/data/ibjjf-levels-business-criteria.sanitized.json",
  ),
});

function readApprovedSourceFile(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8")) as unknown;
}

function loadLevelCatalogSources(
  input: Readonly<{
    customObserved?: unknown;
    customBusiness?: unknown;
  }>,
): Readonly<{ observed: unknown; business: unknown }> {
  const observed = input.customObserved ?? readApprovedSourceFile(levelCatalogSourcePaths.observed);
  const business =
    input.customBusiness ?? readApprovedSourceFile(levelCatalogSourcePaths.businessCriteria);
  return Object.freeze({ observed, business });
}

export function loadApprovedLevelCatalog(
  input: Readonly<{
    customObserved?: unknown;
    customBusiness?: unknown;
  }> = {},
): NormalizedLevelCatalog {
  const { observed, business } = loadLevelCatalogSources(input);
  const normalized = normalizeLevelCatalogSource(observed, business);
  // Fail before any store access when the sources are not the exact approved files.
  assertApprovedLevelCatalogSource(normalized);
  return normalized;
}

const demoProjectId = "demo-bpt-jersey";
const demoFirestoreEmulatorHost = "127.0.0.1:8080";
const knownProductionProjectIds: ReadonlySet<string> = new Set(["bptjersey-f5a25"]);
// T099 must add an operator-approved, isolated project ID before staging can ever pass this guard.
const approvedStagingProjectIds: ReadonlySet<string> = new Set();
const firebaseProjectIdPattern = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/u;

function unsafeTarget(): never {
  throw new Error("Level seed target is not safe.");
}

function normalizeProjectId(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim().toLowerCase();
  if (!firebaseProjectIdPattern.test(normalized)) unsafeTarget();
  return normalized;
}

function getFirebaseConfigProjectId(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  try {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed !== "object" || parsed === null || !("projectId" in parsed)) {
      return unsafeTarget();
    }
    const projectId = (parsed as { projectId?: unknown }).projectId;
    if (typeof projectId !== "string") return unsafeTarget();
    return normalizeProjectId(projectId);
  } catch {
    return unsafeTarget();
  }
}

function isKnownProductionProject(projectId: string): boolean {
  return (
    knownProductionProjectIds.has(projectId) ||
    projectId === "production" ||
    projectId === "prod" ||
    projectId.includes("production") ||
    /(?:^|-)prod(?:-|$)/u.test(projectId)
  );
}

function assertNonProduction(target: string): void {
  if (target === "production") {
    throw new Error("Production seed is strictly prohibited.");
  }
  if (target !== "emulator" && target !== "staging") {
    throw new Error(`Unsupported seed target: ${target}`);
  }
}

export function assertLevelSeedTargetEnvironment(
  target: string,
  environment: LevelSeedTargetEnvironment,
): LevelSeedTargetBinding {
  assertNonProduction(target);
  if (environment.nodeEnvironment?.trim().toLowerCase() === "production") unsafeTarget();
  if (environment.existingAppPresent === true && environment.existingAppProjectId === undefined) {
    unsafeTarget();
  }

  const projectIds = [
    normalizeProjectId(environment.gcloudProjectId),
    getFirebaseConfigProjectId(environment.firebaseConfig),
    normalizeProjectId(environment.existingAppProjectId),
  ].filter((projectId): projectId is string => projectId !== undefined);

  const [projectId] = projectIds;
  if (projectId === undefined || projectIds.some(isKnownProductionProject)) unsafeTarget();
  const distinctProjectIds = new Set(projectIds);
  if (distinctProjectIds.size !== 1) unsafeTarget();

  if (
    target === "emulator" &&
    (projectId !== demoProjectId ||
      environment.firestoreEmulatorHost?.trim() !== demoFirestoreEmulatorHost)
  ) {
    unsafeTarget();
  }
  if (
    target === "staging" &&
    (environment.firestoreEmulatorHost !== undefined || !approvedStagingProjectIds.has(projectId))
  ) {
    unsafeTarget();
  }

  return { target: target as LevelSeedTarget, projectId };
}

export async function seedLevelCatalog(input: SeedLevelCatalogInput): Promise<LevelSeedResult> {
  assertNonProduction(input.target);
  if (input.target === "staging" && input.confirmation !== "T083-LEVELS-SEED") {
    throw new Error("Confirmation required for staging: T083-LEVELS-SEED");
  }
  assertLevelSeedTargetEnvironment(input.target, input.environment);

  const normalized = loadApprovedLevelCatalog(input);
  return input.store.seed({
    academyId: input.academyId,
    normalized,
  });
}

export async function rollbackLevelCatalog(
  input: RollbackLevelCatalogInput,
): Promise<LevelRollbackResult> {
  assertNonProduction(input.target);
  if (input.target === "staging" && input.confirmation !== "T083-LEVELS-ROLLBACK") {
    throw new Error("Confirmation required for staging: T083-LEVELS-ROLLBACK");
  }
  assertLevelSeedTargetEnvironment(input.target, input.environment);
  if (input.systemId !== "ibjjf-v1") {
    throw new Error("Unsupported level system rollback target.");
  }
  const normalized = loadApprovedLevelCatalog();

  return input.store.rollback({
    academyId: input.academyId,
    systemId: input.systemId,
    normalized,
  });
}
