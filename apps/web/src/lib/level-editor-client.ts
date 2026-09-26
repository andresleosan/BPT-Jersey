import {
  activateLevelCatalogResultSchema,
  levelCatalogActivationRefusalSchema,
  levelCatalogVersionContentSchema,
  listLevelCatalogVersionsResultSchema,
  saveLevelCatalogDraftInputSchema,
  type ActivateLevelCatalogResult,
  type LevelCatalogMissingKey,
  type LevelCatalogVersionContent,
  type ListLevelCatalogVersionsResult,
  type SaveLevelCatalogDraftInput,
} from "@bpt-jersey/domain/levels/editor";
import { z } from "zod";

import { httpsCallable } from "./callable";
import { getFirebaseFunctions } from "./firebase-client";

export const levelEditorSafeErrors = Object.freeze({
  list: "Unable to load catalogue versions. Please try again.",
  get: "Unable to open this catalogue version. Please try again.",
  create: "Unable to create a draft. Please try again.",
  save: "Unable to save the draft. Check the highlighted fields and try again.",
  publish: "Unable to publish the draft. Please try again.",
  activate: "Unable to activate this version. Please try again.",
});

const publishResultSchema = z.strictObject({
  systemId: z.string(),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/u),
});

async function call<T>(
  name: string,
  data: unknown,
  schema: z.ZodType<T>,
  safeMessage: string,
): Promise<T> {
  try {
    const response = await httpsCallable<unknown, unknown>(getFirebaseFunctions(), name)(data);
    const parsed = schema.safeParse(response.data);
    if (parsed.success) return parsed.data;
  } catch {
    // Firebase errors never reach the screen; the caller shows the safe message instead.
  }
  throw new Error(safeMessage);
}

export function listLevelCatalogVersions(): Promise<ListLevelCatalogVersionsResult> {
  return call(
    "listLevelCatalogVersions",
    null,
    listLevelCatalogVersionsResultSchema,
    levelEditorSafeErrors.list,
  );
}

export function getLevelCatalogVersion(systemId: string): Promise<LevelCatalogVersionContent> {
  return call(
    "getLevelCatalogVersion",
    { systemId },
    levelCatalogVersionContentSchema,
    levelEditorSafeErrors.get,
  );
}

export function createLevelCatalogDraft(
  fromSystemId: string,
): Promise<LevelCatalogVersionContent> {
  return call(
    "createLevelCatalogDraft",
    { fromSystemId },
    levelCatalogVersionContentSchema,
    levelEditorSafeErrors.create,
  );
}

export async function saveLevelCatalogDraft(
  input: SaveLevelCatalogDraftInput,
): Promise<LevelCatalogVersionContent> {
  const parsed = saveLevelCatalogDraftInputSchema.safeParse(input);
  if (!parsed.success) throw new Error(levelEditorSafeErrors.save);
  return call(
    "saveLevelCatalogDraft",
    parsed.data,
    levelCatalogVersionContentSchema,
    levelEditorSafeErrors.save,
  );
}

export function publishLevelCatalogDraft(
  systemId: string,
): Promise<{ systemId: string; contentHash: string }> {
  return call(
    "publishLevelCatalogDraft",
    { systemId },
    publishResultSchema,
    levelEditorSafeErrors.publish,
  );
}

export type ActivateLevelCatalogOutcome =
  | Readonly<{ kind: "activated"; result: ActivateLevelCatalogResult }>
  | Readonly<{ kind: "missing"; missing: readonly LevelCatalogMissingKey[] }>;

/**
 * A refusal because students hold levels the target drops is an expected answer, not a failure:
 * it comes back as `missing` so the screen can say which levels and how many students.
 */
export async function activateLevelCatalog(
  systemId: string,
): Promise<ActivateLevelCatalogOutcome> {
  try {
    const response = await httpsCallable<unknown, unknown>(
      getFirebaseFunctions(),
      "activateLevelCatalog",
    )({ systemId });
    const parsed = activateLevelCatalogResultSchema.safeParse(response.data);
    if (parsed.success) return { kind: "activated", result: parsed.data };
  } catch (error) {
    const details =
      typeof error === "object" && error !== null && "details" in error
        ? (error as { details: unknown }).details
        : undefined;
    const refusal = levelCatalogActivationRefusalSchema.safeParse(details);
    if (refusal.success) return { kind: "missing", missing: refusal.data.missing };
  }
  throw new Error(levelEditorSafeErrors.activate);
}
