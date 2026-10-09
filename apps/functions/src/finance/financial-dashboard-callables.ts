import { isCurrentActorSession } from "../auth/active-session.js";
import { getFirestore } from "firebase-admin/firestore";
import { HttpsError, onCall, type CallableRequest } from "firebase-functions/v2/https";
import {
  financialDashboardInputSchema,
  type FinancialDashboard,
} from "@bpt-jersey/domain/finance/dashboard";
import type { UserActorContext } from "@bpt-jersey/domain";

import { browserAdminCallableOptions } from "../auth/callable-options.js";
import { requireUserActor } from "../auth/user-authorization.js";
import {
  createFirestoreFinancialDashboardStore,
  FinancialDashboardStoreError,
  type FinancialDashboardStore,
} from "./financial-dashboard-service.js";

export type FinancialDashboardCallableServices = Readonly<{
  store: FinancialDashboardStore;
  isActorActive: (actor: UserActorContext, request: CallableRequest<unknown>) => Promise<boolean>;
}>;

const allowedRoles = Object.freeze(["owner", "administrator"] as const);

function permissionDenied(): never {
  throw new HttpsError("permission-denied", "Financial dashboard access is not permitted");
}

function parsePayload(value: unknown): string | undefined {
  // null stays valid so the web build live during a deploy keeps working.
  if (value === null) return undefined;
  const parsed = financialDashboardInputSchema.safeParse(value);
  if (!parsed.success) {
    throw new HttpsError("invalid-argument", "Financial dashboard payload is invalid");
  }
  return parsed.data.month;
}

export function createGetFinancialDashboardHandler(services: FinancialDashboardCallableServices) {
  return async (request: CallableRequest<unknown>): Promise<{ dashboard: FinancialDashboard }> => {
    const actor = requireUserActor(request);
    if (!allowedRoles.includes(actor.role as (typeof allowedRoles)[number])) permissionDenied();
    const month = parsePayload(request.data);

    try {
      if (!(await services.isActorActive(actor, request))) permissionDenied();
      return { dashboard: await services.store.getFinancialDashboard(actor.academyId, month) };
    } catch (error) {
      if (error instanceof HttpsError) throw error;
      if (error instanceof FinancialDashboardStoreError && error.code === "tenant") {
        permissionDenied();
      }
      if (error instanceof FinancialDashboardStoreError && error.code === "month") {
        throw new HttpsError("invalid-argument", "That month has not started yet");
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
    isActorActive: isCurrentActorSession,
  };
}

export const getFinancialDashboard = onCall(
  {
    ...browserAdminCallableOptions,
    enforceAppCheck: true,
    consumeAppCheckToken: false,
  },
  async (request) => createGetFinancialDashboardHandler(callableServices())(request),
);
