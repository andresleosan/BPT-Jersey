import {
  editableLevelCatalogSchema,
  saveLevelCatalogInputSchema,
  type EditableLevelCatalog,
  type SaveLevelCatalogInput,
} from "@bpt-jersey/domain/levels/editor";

import { httpsCallable } from "./callable";
import { getFirebaseFunctions } from "./firebase-client";

export const levelEditorSafeErrors = Object.freeze({
  load: "Unable to load the belt catalogue. Please try again.",
  save: "Unable to save. Check the fields and try again.",
});

export async function getEditableLevelCatalog(): Promise<EditableLevelCatalog> {
  try {
    const response = await httpsCallable<null, unknown>(
      getFirebaseFunctions(),
      "getEditableLevelCatalog",
    )(null);
    const parsed = editableLevelCatalogSchema.safeParse(response.data);
    if (parsed.success) return parsed.data;
  } catch {
    // Firebase errors never reach the screen.
  }
  throw new Error(levelEditorSafeErrors.load);
}

export type SaveLevelCatalogOutcome =
  | Readonly<{ kind: "saved"; catalog: EditableLevelCatalog }>
  | Readonly<{ kind: "stale" }>;

/** Someone else saving first is an expected answer, not a failure: it comes back as `stale`. */
export async function saveLevelCatalog(
  input: SaveLevelCatalogInput,
): Promise<SaveLevelCatalogOutcome> {
  const request = saveLevelCatalogInputSchema.safeParse(input);
  if (!request.success) throw new Error(levelEditorSafeErrors.save);
  try {
    const response = await httpsCallable<unknown, unknown>(
      getFirebaseFunctions(),
      "saveLevelCatalog",
    )(request.data);
    const parsed = editableLevelCatalogSchema.safeParse(response.data);
    if (parsed.success) return { kind: "saved", catalog: parsed.data };
  } catch (error) {
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? (error as { code: unknown }).code
        : undefined;
    if (code === "functions/aborted") return { kind: "stale" };
  }
  throw new Error(levelEditorSafeErrors.save);
}
