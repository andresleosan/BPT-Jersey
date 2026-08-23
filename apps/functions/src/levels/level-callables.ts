import { getFirestore } from "firebase-admin/firestore";
import { HttpsError, onCall, type CallableRequest } from "firebase-functions/v2/https";

import {
  parseRecordEvaluationInput,
  type EvaluationRecord,
  type LevelCatalogProjection,
} from "@bpt-jersey/domain/levels";
import { requireUserActor } from "../auth/user-authorization.js";
import {
  createLevelCatalogStore,
  LevelStoreError,
  type LevelCatalogStore,
  type StudentSkillSummary,
} from "./level-service.js";

const staffRoles = ["owner", "administrator", "headCoach", "coach"] as const;

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

export function createRecordEvaluationHandler({ store }: { store: LevelCatalogStore }) {
  return async (request: CallableRequest<unknown>): Promise<{ evaluation: EvaluationRecord }> => {
    const actor = requireUserActor(request);
    if (!staffRoles.includes(actor.role as (typeof staffRoles)[number])) {
      throw new HttpsError(
        "permission-denied",
        "Staff role required to record evaluation (owner, administrator, headCoach, coach)",
      );
    }

    const parsed = parseRecordEvaluationInput(request.data);
    if (!parsed.ok) {
      throw new HttpsError(
        "invalid-argument",
        `Invalid evaluation payload: ${parsed.error.map((e) => e.code).join(", ")}`,
      );
    }

    const evaluation = await store.recordEvaluation({
      academyId: actor.academyId,
      input: parsed.value,
      evaluatorId: actor.userId,
      evaluatorRole: actor.role as (typeof staffRoles)[number],
    });

    return {
      evaluation,
    };
  };
}

export function createListStudentEvaluationsHandler({ store }: { store: LevelCatalogStore }) {
  return async (
    request: CallableRequest<unknown>,
  ): Promise<{ evaluations: readonly EvaluationRecord[]; summary: StudentSkillSummary }> => {
    const actor = requireUserActor(request);
    const data = (request.data as { studentId?: unknown }) ?? {};

    let targetStudentId: string = String(actor.userId);

    if (staffRoles.includes(actor.role as (typeof staffRoles)[number])) {
      if (typeof data.studentId === "string" && data.studentId.trim()) {
        targetStudentId = data.studentId.trim();
      } else {
        throw new HttpsError(
          "invalid-argument",
          "studentId is required for staff evaluation query",
        );
      }
    } else if (actor.role === "adultStudent") {
      if (
        typeof data.studentId === "string" &&
        data.studentId.trim() &&
        data.studentId.trim() !== String(actor.userId)
      ) {
        throw new HttpsError(
          "permission-denied",
          "Access denied: student evaluation visibility restricted to self or authorized guardians",
        );
      }
      targetStudentId = String(actor.userId);
    } else if (actor.role === "guardian") {
      if (typeof data.studentId === "string" && data.studentId.trim()) {
        targetStudentId = data.studentId.trim();
      } else {
        throw new HttpsError(
          "invalid-argument",
          "studentId is required for guardian evaluation query",
        );
      }
    } else {
      throw new HttpsError(
        "permission-denied",
        "Access denied: student evaluation visibility restricted",
      );
    }

    const evaluations = await store.listStudentEvaluations(actor.academyId, targetStudentId);
    const summary = await store.getStudentSkillSummary(actor.academyId, targetStudentId);

    return {
      evaluations,
      summary,
    };
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

export const recordEvaluation = onCall(
  {
    enforceAppCheck: false,
    consumeAppCheckToken: false,
  },
  async (request) => {
    const handler = createRecordEvaluationHandler({ store: getStore() });
    return handler(request);
  },
);

export const listStudentEvaluations = onCall(
  {
    enforceAppCheck: false,
    consumeAppCheckToken: false,
  },
  async (request) => {
    const handler = createListStudentEvaluationsHandler({ store: getStore() });
    return handler(request);
  },
);
