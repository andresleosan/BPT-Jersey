import { getFirestore } from "firebase-admin/firestore";
import { HttpsError, onCall, type CallableRequest } from "firebase-functions/v2/https";

import { createLevelCatalogStore } from "./level-service.js";
import {
  createFirebaseLevelAuthorization,
  type LevelAuthorizationService,
} from "./level-authorization.js";
import {
  createFirestoreProgressReportStore,
  ProgressReportStoreError,
  type ProgressReportStore,
} from "./progress-report-service.js";
import type { ProgressReport } from "@bpt-jersey/domain/levels";

const staffRoles = ["owner", "administrator", "headCoach", "coach"] as const;

export function createGetProgressReportHandler({
  store,
  authorization,
}: {
  store: ProgressReportStore;
  authorization: LevelAuthorizationService;
}) {
  return async (request: CallableRequest<unknown>): Promise<{ report: ProgressReport }> => {
    const actor = await authorization.requireActor(request);
    if (!staffRoles.includes(actor.role as (typeof staffRoles)[number])) {
      throw new HttpsError("permission-denied", "Staff role required to view progress reports");
    }
    if (request.data !== null && request.data !== undefined) {
      throw new HttpsError("invalid-argument", "getProgressReport does not accept a payload.");
    }

    try {
      return { report: await store.getProgressReport(actor.academyId) };
    } catch (error) {
      if (error instanceof ProgressReportStoreError && error.code === "not-found") {
        throw new HttpsError("not-found", "No published progression catalog is available");
      }
      if (error instanceof ProgressReportStoreError && error.code === "tenant") {
        throw new HttpsError("permission-denied", "Progress report tenant scope is invalid");
      }
      throw new HttpsError("internal", "Unable to retrieve progress report.");
    }
  };
}

let defaultStore: ProgressReportStore | undefined;
let defaultAuthorization: LevelAuthorizationService | undefined;

function getStore(): ProgressReportStore {
  if (!defaultStore) {
    const firestore = getFirestore();
    const levelStore = createLevelCatalogStore({
      firestore: firestore as unknown as Parameters<typeof createLevelCatalogStore>[0]["firestore"],
    });
    defaultStore = createFirestoreProgressReportStore({
      firestore: firestore as unknown as Parameters<
        typeof createFirestoreProgressReportStore
      >[0]["firestore"],
      levelStore,
    });
  }
  return defaultStore;
}

function getAuthorization(): LevelAuthorizationService {
  defaultAuthorization ??= createFirebaseLevelAuthorization();
  return defaultAuthorization;
}

export const getProgressReport = onCall(
  {
    enforceAppCheck: true,
  },
  async (request) =>
    createGetProgressReportHandler({
      store: getStore(),
      authorization: getAuthorization(),
    })(request),
);
