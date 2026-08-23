import { getFirestore } from "firebase-admin/firestore";
import { HttpsError, onCall, type CallableRequest } from "firebase-functions/v2/https";

import type { LevelCatalogProjection } from "@bpt-jersey/domain/levels";
import { requireUserActor } from "../auth/user-authorization.js";
import {
  createLevelCatalogStore,
  LevelStoreError,
  type LevelCatalogStore,
} from "./level-service.js";

export function createListLevelCatalogHandler({ store }: { store: LevelCatalogStore }) {
  return async (request: CallableRequest): Promise<LevelCatalogProjection> => {
    if (request.data !== null && request.data !== undefined) {
      throw new HttpsError("invalid-argument", "listLevelCatalog does not accept a payload.");
    }

    const actor = requireUserActor(request);

    try {
      return await store.listPublished(actor.academyId);
    } catch (error) {
      if (error instanceof LevelStoreError) {
        if (error.code === "not-found") {
          throw new HttpsError("not-found", error.message);
        }
        if (error.code === "tenant" || error.code === "invalid") {
          throw new HttpsError("permission-denied", error.message);
        }
      }
      throw new HttpsError("internal", "Unable to retrieve level catalog.");
    }
  };
}

let defaultStore: LevelCatalogStore | undefined;

function getStore(): LevelCatalogStore {
  if (!defaultStore) {
    const firestore = getFirestore();
    defaultStore = createLevelCatalogStore({
      firestore: firestore as unknown as Parameters<typeof createLevelCatalogStore>[0]["firestore"],
    });
  }
  return defaultStore;
}

export const listLevelCatalog = onCall(
  {
    enforceAppCheck: false,
    consumeAppCheckToken: false,
  },
  async (request) => {
    const handler = createListLevelCatalogHandler({ store: getStore() });
    return handler(request);
  },
);
