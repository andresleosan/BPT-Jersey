import { httpsCallable } from "firebase/functions";

import {
  parseLevelCatalogProjection,
  type LevelCatalogProjection,
} from "@bpt-jersey/domain/levels";
import { getFirebaseFunctions } from "./firebase-client";

const safeCatalogError = "Unable to load level catalog. Please try again.";

export async function getLevelCatalog(): Promise<LevelCatalogProjection> {
  const functions = getFirebaseFunctions();
  const callable = httpsCallable<null, unknown>(functions, "listLevelCatalog");

  try {
    const response = await callable(null);
    const result = parseLevelCatalogProjection(response.data);
    if (!result.ok) {
      throw new Error(safeCatalogError);
    }
    return result.value;
  } catch (error) {
    if (error instanceof Error && error.message === safeCatalogError) {
      throw error;
    }
    throw new Error(safeCatalogError);
  }
}
