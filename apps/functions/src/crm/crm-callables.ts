import { getFirestore } from "firebase-admin/firestore";
import { HttpsError, onCall, type CallableRequest } from "firebase-functions/v2/https";

import {
  leadStatuses,
  parseLeadDraft,
  type LeadRecord,
  type LeadStatus,
  type LeadTimelineEvent,
} from "@bpt-jersey/domain/crm";
import { browserAdminCallableOptions } from "../auth/callable-options.js";
import { requireUserActor } from "../auth/user-authorization.js";
import { createFirestoreCrmStore, type CrmStore, type LeadListFilter } from "./crm-service.js";

const readRoles = ["owner", "administrator", "headCoach"] as const;
const writeRoles = ["owner", "administrator"] as const;
const safeIdentifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

function assertObject(value: unknown, message: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new HttpsError("invalid-argument", message);
  }
  return value as Record<string, unknown>;
}

function assertRole(role: string, roles: readonly string[], message: string): void {
  if (!roles.includes(role)) throw new HttpsError("permission-denied", message);
}

function parseLeadId(value: unknown): string {
  if (typeof value !== "string" || !safeIdentifierPattern.test(value.trim())) {
    throw new HttpsError("invalid-argument", "leadId is invalid");
  }
  return value.trim();
}

function parseStatus(value: unknown): LeadStatus {
  if (typeof value !== "string" || !leadStatuses.includes(value as LeadStatus)) {
    throw new HttpsError("invalid-argument", "targetStatus is invalid");
  }
  return value as LeadStatus;
}

function mapStoreError(error: unknown): never {
  if (error instanceof HttpsError) throw error;
  const code = (error as { code?: unknown })?.code;
  if (code === "not-found") throw new HttpsError("not-found", "CRM lead not found");
  if (code === "tenant" || code === "conflict") {
    throw new HttpsError("failed-precondition", "CRM operation is not permitted");
  }
  if (code === "invalid") throw new HttpsError("invalid-argument", "CRM payload is invalid");
  throw new HttpsError("internal", "CRM is not available");
}

function parseFilter(value: unknown): LeadListFilter {
  const data = assertObject(value ?? {}, "CRM filters must be an object");
  const filter: { status?: LeadStatus; ownerId?: string } = {};
  if (data.status !== undefined) filter.status = parseStatus(data.status);
  if (data.ownerId !== undefined) {
    if (typeof data.ownerId !== "string" || !safeIdentifierPattern.test(data.ownerId.trim())) {
      throw new HttpsError("invalid-argument", "ownerId is invalid");
    }
    filter.ownerId = data.ownerId.trim();
  }
  return filter;
}

export function createCreateLeadHandler({ store }: { store: CrmStore }) {
  return async (
    request: CallableRequest<unknown>,
  ): Promise<{ lead: LeadRecord; event: LeadTimelineEvent }> => {
    const actor = requireUserActor(request);
    assertRole(actor.role, writeRoles, "Owner or administrator role required to create CRM leads");
    const parsed = parseLeadDraft(request.data);
    if (!parsed.ok) throw new HttpsError("invalid-argument", "Invalid CRM lead payload");
    if (parsed.value.academyId !== actor.academyId) {
      throw new HttpsError("permission-denied", "CRM lead tenant mismatch");
    }
    try {
      const result = await store.createLead({
        academyId: actor.academyId,
        input: parsed.value,
        createdBy: actor.userId,
      });
      return result;
    } catch (error) {
      return mapStoreError(error);
    }
  };
}

export function createListLeadsHandler({ store }: { store: CrmStore }) {
  return async (request: CallableRequest<unknown>): Promise<{ leads: readonly LeadRecord[] }> => {
    const actor = requireUserActor(request);
    assertRole(actor.role, readRoles, "CRM access is not permitted");
    try {
      const requestedFilter = parseFilter(request.data);
      const filter =
        actor.role === "headCoach"
          ? { ...requestedFilter, ownerId: actor.userId }
          : requestedFilter;
      const leads = await store.listLeads(actor.academyId, filter);
      return { leads };
    } catch (error) {
      return mapStoreError(error);
    }
  };
}

export function createUpdateLeadHandler({ store }: { store: CrmStore }) {
  return async (
    request: CallableRequest<unknown>,
  ): Promise<{ lead: LeadRecord; event: LeadTimelineEvent }> => {
    const actor = requireUserActor(request);
    assertRole(actor.role, writeRoles, "Owner or administrator role required to update CRM leads");
    const data = assertObject(request.data, "CRM update must be an object");
    const leadId = parseLeadId(data.leadId);
    const ownerId = data.ownerId === undefined ? undefined : parseLeadId(data.ownerId);
    const nextActionAt =
      data.nextActionAt === undefined || data.nextActionAt === null
        ? (data.nextActionAt as null | undefined)
        : typeof data.nextActionAt === "string"
          ? data.nextActionAt
          : (() => {
              throw new HttpsError("invalid-argument", "nextActionAt is invalid");
            })();
    try {
      return await store.updateLead({
        academyId: actor.academyId,
        leadId,
        ...(ownerId === undefined ? {} : { ownerId }),
        ...(nextActionAt === undefined ? {} : { nextActionAt }),
        updatedBy: actor.userId,
      });
    } catch (error) {
      return mapStoreError(error);
    }
  };
}

export function createTransitionLeadHandler({ store }: { store: CrmStore }) {
  return async (
    request: CallableRequest<unknown>,
  ): Promise<{ lead: LeadRecord; event: LeadTimelineEvent }> => {
    const actor = requireUserActor(request);
    assertRole(
      actor.role,
      writeRoles,
      "Owner or administrator role required to transition CRM leads",
    );
    const data = assertObject(request.data, "CRM transition must be an object");
    try {
      return await store.transitionLead({
        academyId: actor.academyId,
        leadId: parseLeadId(data.leadId),
        targetStatus: parseStatus(data.targetStatus),
        updatedBy: actor.userId,
      });
    } catch (error) {
      return mapStoreError(error);
    }
  };
}

export function createListLeadTimelineHandler({ store }: { store: CrmStore }) {
  return async (
    request: CallableRequest<unknown>,
  ): Promise<{ events: readonly LeadTimelineEvent[] }> => {
    const actor = requireUserActor(request);
    assertRole(actor.role, readRoles, "CRM access is not permitted");
    const data = assertObject(request.data, "CRM timeline request must be an object");
    try {
      const leadId = parseLeadId(data.leadId);
      if (actor.role === "headCoach") {
        const lead = await store.getLead(actor.academyId, leadId);
        if (lead === null || lead.ownerId !== actor.userId) {
          throw new HttpsError("permission-denied", "CRM timeline access is not permitted");
        }
      }
      const events = await store.listTimeline(actor.academyId, leadId);
      return { events };
    } catch (error) {
      return mapStoreError(error);
    }
  };
}

let defaultStore: CrmStore | undefined;

function getStore(): CrmStore {
  if (defaultStore === undefined) {
    defaultStore = createFirestoreCrmStore({
      firestore: getFirestore() as unknown as Parameters<
        typeof createFirestoreCrmStore
      >[0]["firestore"],
    });
  }
  return defaultStore;
}

export const createCrmLead = onCall(async (request) =>
  createCreateLeadHandler({ store: getStore() })(request),
);
export const listCrmLeads = onCall(browserAdminCallableOptions, async (request) =>
  createListLeadsHandler({ store: getStore() })(request),
);
export const updateCrmLead = onCall(async (request) =>
  createUpdateLeadHandler({ store: getStore() })(request),
);
export const transitionCrmLead = onCall(async (request) =>
  createTransitionLeadHandler({ store: getStore() })(request),
);
export const listCrmLeadTimeline = onCall(async (request) =>
  createListLeadTimelineHandler({ store: getStore() })(request),
);
