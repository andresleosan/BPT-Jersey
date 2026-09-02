import { getFirestore } from "firebase-admin/firestore";
import { HttpsError, onCall, type CallableRequest } from "firebase-functions/v2/https";
import { parseOperationalReportQuery, type OperationalReport } from "@bpt-jersey/domain/reports";

import { browserAdminCallableOptions } from "../auth/callable-options.js";
import { requireUserActor } from "../auth/user-authorization.js";
import {
  createFirestoreOperationalReportStore,
  OperationalReportStoreError,
  type OperationalReportStore,
} from "./operational-report-service.js";

const reportRoles = Object.freeze(["owner", "administrator"] as const);

export function createGetOperationalReportHandler(options: { store: OperationalReportStore }) {
  return async (request: CallableRequest<unknown>): Promise<{ report: OperationalReport }> => {
    const actor = requireUserActor(request);
    if (!reportRoles.includes(actor.role as (typeof reportRoles)[number])) {
      throw new HttpsError(
        "permission-denied",
        "Owner or administrator access required to view operational reports",
      );
    }

    const parsedQuery = parseOperationalReportQuery(request.data);
    if (!parsedQuery.ok) {
      throw new HttpsError("invalid-argument", parsedQuery.error);
    }

    try {
      return {
        report: await options.store.getOperationalReport(actor.academyId, parsedQuery.value),
      };
    } catch (error) {
      if (error instanceof OperationalReportStoreError && error.code === "tenant") {
        throw new HttpsError("permission-denied", "Operational report tenant scope is invalid");
      }
      throw new HttpsError("internal", "Unable to retrieve operational report.");
    }
  };
}

let defaultStore: OperationalReportStore | undefined;

function getStore(): OperationalReportStore {
  if (!defaultStore) {
    const firestore = getFirestore();
    defaultStore = createFirestoreOperationalReportStore({
      firestore: firestore as unknown as Parameters<
        typeof createFirestoreOperationalReportStore
      >[0]["firestore"],
    });
  }
  return defaultStore;
}

export const getOperationalReport = onCall(
  {
    ...browserAdminCallableOptions,
    enforceAppCheck: false,
    consumeAppCheckToken: false,
  },
  async (request) => createGetOperationalReportHandler({ store: getStore() })(request),
);
