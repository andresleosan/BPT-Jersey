import { getFirestore } from "firebase-admin/firestore";
import { HttpsError, onCall, type CallableRequest } from "firebase-functions/v2/https";

import type {
  RetentionAlert,
  RetentionAlertEvidence,
  RetentionAlertKind,
} from "@bpt-jersey/domain/retention";
import { requireUserActor } from "../auth/user-authorization.js";
import {
  createFirestoreRetentionAlertStore,
  type RetentionAlertStore,
} from "./retention-alert-service.js";

const retentionInboxRoles = new Set(["owner", "administrator"]);

export type RetentionInboxAlert = Readonly<{
  studentReference: string;
  kind: RetentionAlertKind;
  severity: "warning";
  status: "open";
  evidence: RetentionAlertEvidence;
  createdAt: string;
}>;

function toInboxAlert(alert: RetentionAlert): RetentionInboxAlert {
  return Object.freeze({
    studentReference: alert.studentId,
    kind: alert.kind,
    severity: alert.severity,
    status: alert.status,
    evidence: alert.evidence,
    createdAt: alert.createdAt,
  });
}

function mapStoreError(error: unknown): never {
  if (error instanceof HttpsError) throw error;
  throw new HttpsError("internal", "Retention alerts are not available");
}

export function createListRetentionAlertsHandler({ store }: { store: RetentionAlertStore }) {
  return async (
    request: CallableRequest<unknown>,
  ): Promise<{ alerts: readonly RetentionInboxAlert[] }> => {
    const actor = requireUserActor(request);
    if (!retentionInboxRoles.has(actor.role)) {
      throw new HttpsError("permission-denied", "Retention inbox access is not permitted");
    }
    if (request.data !== null) {
      throw new HttpsError("invalid-argument", "Retention inbox filters are not supported");
    }
    try {
      const alerts = await store.listAlerts(actor.academyId);
      return { alerts: Object.freeze(alerts.map(toInboxAlert)) };
    } catch (error) {
      return mapStoreError(error);
    }
  };
}

let defaultStore: RetentionAlertStore | undefined;

function getStore(): RetentionAlertStore {
  defaultStore ??= createFirestoreRetentionAlertStore({
    firestore: getFirestore() as unknown as Parameters<
      typeof createFirestoreRetentionAlertStore
    >[0]["firestore"],
  });
  return defaultStore;
}

export const listRetentionAlerts = onCall(async (request) =>
  createListRetentionAlertsHandler({ store: getStore() })(request),
);
