import { getFirestore } from "firebase-admin/firestore";
import { HttpsError, onCall, type CallableRequest } from "firebase-functions/v2/https";

import {
  parsePlanDraft,
  planIds,
  type PlanDraft,
  type PlanId,
  type PlanRecord,
} from "@bpt-jersey/domain/memberships";

import { requireUserActor } from "../auth/user-authorization.js";
import { createPlanStore, PlanStoreError, type PlanStore } from "./plan-service.js";

export type PlanCallableServices = Readonly<{
  store: PlanStore;
  now?: () => string;
}>;

export type PlanPublicProjection = PlanDraft;
export type PlanManagedProjection = PlanPublicProjection &
  Readonly<{
    active: boolean;
  }>;

const safeIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const planDraftFields = [
  "planId",
  "displayName",
  "priceMinor",
  "currency",
  "billingPeriod",
  "eligibleParticipantTypes",
  "classSites",
  "weeklyClassLimit",
  "openMatSites",
  "openMatFeeMinor",
] as const;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  try {
    return (
      typeof value === "object" &&
      value !== null &&
      !Array.isArray(value) &&
      Object.getPrototypeOf(value) === Object.prototype
    );
  } catch {
    return false;
  }
}

function invalidPayload(): never {
  throw new HttpsError("invalid-argument", "Plan payload is invalid");
}

function exactFields(value: Record<string, unknown>, fields: readonly string[]): boolean {
  try {
    const keys = Reflect.ownKeys(value);
    return (
      keys.length === fields.length &&
      keys.every((key) => typeof key === "string" && fields.includes(key))
    );
  } catch {
    return false;
  }
}

function parsePlanId(value: unknown): PlanId {
  if (
    typeof value !== "string" ||
    !safeIdPattern.test(value) ||
    !planIds.includes(value as PlanId)
  ) {
    return invalidPayload();
  }
  return value as PlanId;
}

function parseNoPayload(value: unknown): void {
  if (value !== null && value !== undefined) invalidPayload();
}

function parsePlanIdPayload(value: unknown): PlanId {
  if (!isPlainRecord(value) || !exactFields(value, ["planId"])) return invalidPayload();
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, "planId");
    if (
      descriptor === undefined ||
      descriptor.enumerable !== true ||
      descriptor.get !== undefined ||
      descriptor.set !== undefined ||
      !Object.hasOwn(descriptor, "value")
    ) {
      return invalidPayload();
    }
    return parsePlanId(descriptor.value);
  } catch {
    return invalidPayload();
  }
}

function parseSavePayload(value: unknown): PlanDraft {
  if (!isPlainRecord(value) || !exactFields(value, planDraftFields)) return invalidPayload();
  try {
    const parsed = parsePlanDraft(value);
    if (!parsed.ok) return invalidPayload();
    return parsed.value;
  } catch {
    return invalidPayload();
  }
}

function requireCatalogReader(request: CallableRequest<unknown>) {
  const actor = requireUserActor(request);
  if (
    actor.role !== "owner" &&
    actor.role !== "administrator" &&
    actor.role !== "guardian" &&
    actor.role !== "adultStudent" &&
    actor.role !== "headCoach" &&
    actor.role !== "coach"
  ) {
    throw new HttpsError("permission-denied", "Plan access is not permitted");
  }
  return actor;
}

function requireCatalogAdministrator(request: CallableRequest<unknown>) {
  const actor = requireUserActor(request);
  if (actor.role !== "owner" && actor.role !== "administrator") {
    throw new HttpsError("permission-denied", "Plan access is not permitted");
  }
  return actor;
}

function assertTenant(plan: PlanRecord, academyId: string): PlanRecord {
  if (plan.academyId !== academyId) {
    throw new PlanStoreError("tenant", "Plan tenant mismatch");
  }
  return plan;
}

function publicPlan(plan: PlanRecord): PlanPublicProjection {
  return Object.freeze({
    planId: plan.planId,
    displayName: plan.displayName,
    priceMinor: plan.priceMinor,
    currency: plan.currency,
    billingPeriod: plan.billingPeriod,
    eligibleParticipantTypes: Object.freeze([...plan.eligibleParticipantTypes]),
    classSites: Object.freeze([...plan.classSites]),
    weeklyClassLimit: plan.weeklyClassLimit,
    openMatSites: Object.freeze([...plan.openMatSites]),
    openMatFeeMinor: plan.openMatFeeMinor,
  });
}

function managedPlan(plan: PlanRecord): PlanManagedProjection {
  return Object.freeze({ ...publicPlan(plan), active: plan.active });
}

function mapPlanError(
  error: unknown,
  operation: "load" | "save" | "activate" | "deactivate",
): never {
  if (error instanceof HttpsError) throw error;
  if (error instanceof PlanStoreError) {
    if (error.code === "invalid") {
      throw new HttpsError(
        operation === "save" ? "invalid-argument" : "failed-precondition",
        operation === "save" ? "Plan payload is invalid" : "Plan data is not available",
      );
    }
    if (error.code === "tenant") {
      throw new HttpsError("permission-denied", "Plan access is not permitted");
    }
    if (error.code === "not-found") {
      throw new HttpsError("failed-precondition", "Plan is not available");
    }
    throw new HttpsError("failed-precondition", "Plan operation is not available");
  }
  throw new HttpsError(
    "internal",
    operation === "load"
      ? "Unable to load plans"
      : operation === "save"
        ? "Unable to save plan"
        : operation === "activate"
          ? "Unable to activate plan"
          : "Unable to deactivate plan",
  );
}

export async function listPlansHandler(
  request: CallableRequest<unknown>,
  services: PlanCallableServices,
): Promise<readonly PlanPublicProjection[]> {
  const actor = requireCatalogReader(request);
  parseNoPayload(request.data);
  try {
    const plans = await services.store.listPlans(actor.academyId);
    return Object.freeze(
      plans
        .map((plan) => assertTenant(plan, actor.academyId))
        .filter((plan) => plan.active)
        .map(publicPlan),
    );
  } catch (error) {
    return mapPlanError(error, "load");
  }
}

export async function listManagedPlansHandler(
  request: CallableRequest<unknown>,
  services: PlanCallableServices,
): Promise<readonly PlanManagedProjection[]> {
  const actor = requireCatalogAdministrator(request);
  parseNoPayload(request.data);
  try {
    const plans = await services.store.listPlans(actor.academyId);
    return Object.freeze(plans.map((plan) => managedPlan(assertTenant(plan, actor.academyId))));
  } catch (error) {
    return mapPlanError(error, "load");
  }
}

export async function getPlanHandler(
  request: CallableRequest<unknown>,
  services: PlanCallableServices,
): Promise<PlanPublicProjection> {
  const actor = requireCatalogReader(request);
  const planId = parsePlanIdPayload(request.data);
  try {
    const plan = await services.store.getPlan(actor.academyId, planId);
    if (plan === undefined || !plan.active) {
      throw new PlanStoreError("not-found", "Plan is not available");
    }
    return publicPlan(assertTenant(plan, actor.academyId));
  } catch (error) {
    return mapPlanError(error, "load");
  }
}

export async function savePlanHandler(
  request: CallableRequest<unknown>,
  services: PlanCallableServices,
): Promise<PlanManagedProjection> {
  const actor = requireCatalogAdministrator(request);
  const draft = parseSavePayload(request.data);
  try {
    const plan = await services.store.savePlan({
      academyId: actor.academyId,
      actorId: actor.userId,
      now: services.now?.() ?? new Date().toISOString(),
      draft,
    });
    return managedPlan(assertTenant(plan, actor.academyId));
  } catch (error) {
    return mapPlanError(error, "save");
  }
}

export async function activatePlanHandler(
  request: CallableRequest<unknown>,
  services: PlanCallableServices,
): Promise<PlanManagedProjection> {
  const actor = requireCatalogAdministrator(request);
  const planId = parsePlanIdPayload(request.data);
  try {
    const plan = await services.store.activatePlan({
      academyId: actor.academyId,
      actorId: actor.userId,
      planId,
      now: services.now?.() ?? new Date().toISOString(),
    });
    return managedPlan(assertTenant(plan, actor.academyId));
  } catch (error) {
    return mapPlanError(error, "activate");
  }
}

export async function deactivatePlanHandler(
  request: CallableRequest<unknown>,
  services: PlanCallableServices,
): Promise<PlanManagedProjection> {
  const actor = requireCatalogAdministrator(request);
  const planId = parsePlanIdPayload(request.data);
  try {
    const plan = await services.store.deactivatePlan({
      academyId: actor.academyId,
      actorId: actor.userId,
      planId,
      now: services.now?.() ?? new Date().toISOString(),
    });
    return managedPlan(assertTenant(plan, actor.academyId));
  } catch (error) {
    return mapPlanError(error, "deactivate");
  }
}

function planCallableServices(): PlanCallableServices {
  return {
    store: createPlanStore({
      firestore: getFirestore() as unknown as Parameters<typeof createPlanStore>[0]["firestore"],
    }),
  };
}

export const planCallableOptions = { enforceAppCheck: true };

export const listPlans = onCall(planCallableOptions, async (request) =>
  listPlansHandler(request, planCallableServices()),
);

export const listManagedPlans = onCall(planCallableOptions, async (request) =>
  listManagedPlansHandler(request, planCallableServices()),
);

export const getPlan = onCall(planCallableOptions, async (request) =>
  getPlanHandler(request, planCallableServices()),
);

export const savePlan = onCall(planCallableOptions, async (request) =>
  savePlanHandler(request, planCallableServices()),
);

export const activatePlan = onCall(planCallableOptions, async (request) =>
  activatePlanHandler(request, planCallableServices()),
);

export const deactivatePlan = onCall(planCallableOptions, async (request) =>
  deactivatePlanHandler(request, planCallableServices()),
);
