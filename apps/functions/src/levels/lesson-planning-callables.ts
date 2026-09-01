import { getFirestore } from "firebase-admin/firestore";
import { HttpsError, onCall, type CallableRequest } from "firebase-functions/v2/https";

import type { LessonPlanRecord, TechniqueLibraryVersion } from "@bpt-jersey/domain";
import { requireUserActor } from "../auth/user-authorization.js";
import {
  createFirestoreLessonPlanningStore,
  LessonPlanningStoreError,
  type LessonPlanningStore,
} from "./lesson-planning-service.js";

const readRoles = ["owner", "administrator", "headCoach", "coach"] as const;
const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

function parsePlanIdPayload(data: unknown): string {
  if (
    typeof data !== "object" ||
    data === null ||
    Array.isArray(data) ||
    Reflect.ownKeys(data).length !== 1 ||
    !Object.hasOwn(data, "planId")
  ) {
    throw new HttpsError("invalid-argument", "The lesson plan payload is invalid.");
  }
  const planId = (data as { planId?: unknown }).planId;
  if (typeof planId !== "string" || !identifierPattern.test(planId)) {
    throw new HttpsError("invalid-argument", "planId is invalid.");
  }
  return planId;
}

function mapStoreError(error: unknown, action: string): never {
  if (error instanceof LessonPlanningStoreError) {
    if (error.code === "not-found") throw new HttpsError("not-found", "Lesson plan not found.");
    if (error.code === "conflict") throw new HttpsError("aborted", "Lesson plan state conflicts.");
    if (error.code === "tenant" || error.code === "invalid") {
      throw new HttpsError("permission-denied", "Lesson plan scope is invalid.");
    }
  }
  throw new HttpsError("internal", `Unable to ${action} lesson plan.`);
}

export function createGetLessonPlanHandler({ store }: { store: LessonPlanningStore }) {
  return async (
    request: CallableRequest<unknown>,
  ): Promise<{ plan: LessonPlanRecord; library: TechniqueLibraryVersion }> => {
    const actor = requireUserActor(request);
    if (!readRoles.includes(actor.role as (typeof readRoles)[number])) {
      throw new HttpsError("permission-denied", "Staff role required to read lesson plans.");
    }
    const planId = parsePlanIdPayload(request.data);
    try {
      const plan = await store.getPlan(actor.academyId, planId);
      const library = await store.getLibrary(actor.academyId, plan.libraryId, plan.libraryVersion);
      return { plan, library };
    } catch (error) {
      return mapStoreError(error, "retrieve");
    }
  };
}

export function createApproveLessonPlanHandler({ store }: { store: LessonPlanningStore }) {
  return async (request: CallableRequest<unknown>): Promise<{ plan: LessonPlanRecord }> => {
    const actor = requireUserActor(request);
    if (actor.role !== "headCoach") {
      throw new HttpsError("permission-denied", "Only a head coach may approve lesson plans.");
    }
    const planId = parsePlanIdPayload(request.data);
    try {
      return {
        plan: await store.approvePlan({
          academyId: actor.academyId,
          planId,
          input: {
            staffId: actor.userId,
            staffRole: "head_coach",
            approvedAt: new Date().toISOString(),
          },
        }),
      };
    } catch (error) {
      return mapStoreError(error, "approve");
    }
  };
}

let defaultStore: LessonPlanningStore | undefined;

function getStore(): LessonPlanningStore {
  if (!defaultStore) {
    defaultStore = createFirestoreLessonPlanningStore({
      firestore: getFirestore() as never,
    });
  }
  return defaultStore;
}

export const getLessonPlan = onCall(async (request) =>
  createGetLessonPlanHandler({ store: getStore() })(request),
);

export const approveLessonPlan = onCall(async (request) =>
  createApproveLessonPlanHandler({ store: getStore() })(request),
);
