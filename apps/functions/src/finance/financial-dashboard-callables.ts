import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { HttpsError, onCall, type CallableRequest } from "firebase-functions/v2/https";
import type { FinancialDashboard } from "@bpt-jersey/domain/finance/dashboard";
import type { UserActorContext } from "@bpt-jersey/domain";

import { requireUserActor } from "../auth/user-authorization.js";
import {
  createFirestoreFinancialDashboardStore,
  FinancialDashboardStoreError,
  type FinancialDashboardStore,
} from "./financial-dashboard-service.js";

export type FinancialDashboardCallableServices = Readonly<{
  store: FinancialDashboardStore;
  isActorActive: (actor: UserActorContext) => Promise<boolean>;
}>;

const allowedRoles = Object.freeze(["owner", "administrator"] as const);

function permissionDenied(): never {
  throw new HttpsError("permission-denied", "Financial dashboard access is not permitted");
}

function requireNoPayload(value: unknown): void {
  if (value !== null) {
    throw new HttpsError("invalid-argument", "Financial dashboard payload must be null");
  }
}

export function createGetFinancialDashboardHandler(services: FinancialDashboardCallableServices) {
  return async (request: CallableRequest<unknown>): Promise<{ dashboard: FinancialDashboard }> => {
    const actor = requireUserActor(request);
    if (!allowedRoles.includes(actor.role as (typeof allowedRoles)[number])) permissionDenied();
    requireNoPayload(request.data);

    try {
      if (!(await services.isActorActive(actor))) permissionDenied();
      return { dashboard: await services.store.getFinancialDashboard(actor.academyId) };
    } catch (error) {
      if (error instanceof HttpsError) throw error;
      if (error instanceof FinancialDashboardStoreError && error.code === "tenant") {
        permissionDenied();
      }
      throw new HttpsError("internal", "Unable to retrieve financial dashboard");
    }
  };
}

let defaultStore: FinancialDashboardStore | undefined;

function callableServices(): FinancialDashboardCallableServices {
  if (!defaultStore) {
    const firestore = getFirestore();
    defaultStore = createFirestoreFinancialDashboardStore({
      firestore: firestore as unknown as Parameters<
        typeof createFirestoreFinancialDashboardStore
      >[0]["firestore"],
    });
  }
  return {
    store: defaultStore,
    isActorActive: async (actor) => !(await getAuth().getUser(actor.userId)).disabled,
  };
}

export const getFinancialDashboard = onCall(
  {
    enforceAppCheck: false,
    consumeAppCheckToken: false,
  },
  async (request) => createGetFinancialDashboardHandler(callableServices())(request),
);
