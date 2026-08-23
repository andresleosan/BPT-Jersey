import { getFirestore } from "firebase-admin/firestore";
import { HttpsError, onCall, type CallableRequest } from "firebase-functions/v2/https";

import {
  parseApprovePromotionInput,
  parseRecordEvaluationInput,
  parseRecordMedicalLeaveInput,
  parseRejectPromotionInput,
  type EvaluationRecord,
  type GraduationRecord,
  type LevelCatalogProjection,
  type MedicalLeaveRecord,
  type RecognitionCandidate,
  type StudentProgressSummary,
} from "@bpt-jersey/domain/levels";
import { requireUserActor } from "../auth/user-authorization.js";
import {
  createLevelCatalogStore,
  LevelStoreError,
  type LevelCatalogStore,
  type StudentSkillSummary,
} from "./level-service.js";

const staffRoles = ["owner", "administrator", "headCoach", "coach"] as const;
const headCoachRoles = ["owner", "headCoach"] as const;

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

export function createGetStudentProgressSummaryHandler({ store }: { store: LevelCatalogStore }) {
  return async (
    request: CallableRequest<unknown>,
  ): Promise<{ progress: StudentProgressSummary }> => {
    const actor = requireUserActor(request);
    const data =
      (request.data as {
        studentId?: unknown;
        currentDefinitionKey?: unknown;
        currentLevelStartedAt?: unknown;
        attendedClassesCount?: unknown;
        totalHours?: unknown;
      }) ?? {};

    let targetStudentId: string = String(actor.userId);

    if (staffRoles.includes(actor.role as (typeof staffRoles)[number])) {
      if (typeof data.studentId === "string" && data.studentId.trim()) {
        targetStudentId = data.studentId.trim();
      } else {
        throw new HttpsError("invalid-argument", "studentId is required for staff progress query");
      }
    } else if (actor.role === "adultStudent") {
      if (
        typeof data.studentId === "string" &&
        data.studentId.trim() &&
        data.studentId.trim() !== String(actor.userId)
      ) {
        throw new HttpsError(
          "permission-denied",
          "Access denied: student progress visibility restricted to self or authorized guardians",
        );
      }
      targetStudentId = String(actor.userId);
    } else if (actor.role === "guardian") {
      if (typeof data.studentId === "string" && data.studentId.trim()) {
        targetStudentId = data.studentId.trim();
      } else {
        throw new HttpsError(
          "invalid-argument",
          "studentId is required for guardian progress query",
        );
      }
    } else {
      throw new HttpsError(
        "permission-denied",
        "Access denied: student progress visibility restricted",
      );
    }

    const currentDefinitionKey =
      typeof data.currentDefinitionKey === "string" && data.currentDefinitionKey.trim()
        ? data.currentDefinitionKey.trim()
        : undefined;

    const currentLevelStartedAt =
      typeof data.currentLevelStartedAt === "string" && data.currentLevelStartedAt.trim()
        ? data.currentLevelStartedAt.trim()
        : null;

    const attendedClassesCount =
      typeof data.attendedClassesCount === "number" && data.attendedClassesCount >= 0
        ? data.attendedClassesCount
        : undefined;

    const totalHours =
      typeof data.totalHours === "number" && data.totalHours >= 0 ? data.totalHours : undefined;

    const progress = await store.getStudentProgressSummary(
      actor.academyId,
      targetStudentId,
      currentDefinitionKey,
      currentLevelStartedAt,
      attendedClassesCount,
      totalHours,
    );

    return {
      progress,
    };
  };
}

export function createRecordMedicalLeaveHandler({ store }: { store: LevelCatalogStore }) {
  return async (
    request: CallableRequest<unknown>,
  ): Promise<{ medicalLeave: MedicalLeaveRecord }> => {
    const actor = requireUserActor(request);
    if (!staffRoles.includes(actor.role as (typeof staffRoles)[number])) {
      throw new HttpsError(
        "permission-denied",
        "Staff role required to record medical leave (owner, administrator, headCoach, coach)",
      );
    }

    const parsed = parseRecordMedicalLeaveInput(request.data);
    if (!parsed.ok) {
      throw new HttpsError(
        "invalid-argument",
        `Invalid medical leave payload: ${parsed.error.map((e) => e.code).join(", ")}`,
      );
    }

    const medicalLeave = await store.recordMedicalLeave({
      academyId: actor.academyId,
      input: parsed.value,
      recordedBy: actor.userId,
    });

    return {
      medicalLeave,
    };
  };
}

export function createListMedicalLeavesHandler({ store }: { store: LevelCatalogStore }) {
  return async (
    request: CallableRequest<unknown>,
  ): Promise<{ medicalLeaves: readonly MedicalLeaveRecord[] }> => {
    const actor = requireUserActor(request);
    const data = (request.data as { studentId?: unknown }) ?? {};

    let targetStudentId: string = String(actor.userId);

    if (staffRoles.includes(actor.role as (typeof staffRoles)[number])) {
      if (typeof data.studentId === "string" && data.studentId.trim()) {
        targetStudentId = data.studentId.trim();
      } else {
        throw new HttpsError(
          "invalid-argument",
          "studentId is required for staff medical leave query",
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
          "Access denied: medical leave visibility restricted to self or authorized guardians",
        );
      }
      targetStudentId = String(actor.userId);
    } else if (actor.role === "guardian") {
      if (typeof data.studentId === "string" && data.studentId.trim()) {
        targetStudentId = data.studentId.trim();
      } else {
        throw new HttpsError(
          "invalid-argument",
          "studentId is required for guardian medical leave query",
        );
      }
    } else {
      throw new HttpsError(
        "permission-denied",
        "Access denied: medical leave visibility restricted",
      );
    }

    const medicalLeaves = await store.listMedicalLeaves(actor.academyId, targetStudentId);
    return {
      medicalLeaves,
    };
  };
}

export function createListRecognitionCandidatesHandler({ store }: { store: LevelCatalogStore }) {
  return async (
    request: CallableRequest<unknown>,
  ): Promise<{ candidates: readonly RecognitionCandidate[] }> => {
    const actor = requireUserActor(request);
    if (!staffRoles.includes(actor.role as (typeof staffRoles)[number])) {
      throw new HttpsError(
        "permission-denied",
        "Staff role required to view recognition candidates (owner, administrator, headCoach, coach)",
      );
    }

    const candidates = await store.listRecognitionCandidates(actor.academyId);
    return {
      candidates,
    };
  };
}

export function createApprovePromotionHandler({ store }: { store: LevelCatalogStore }) {
  return async (request: CallableRequest<unknown>): Promise<{ graduation: GraduationRecord }> => {
    const actor = requireUserActor(request);
    if (!headCoachRoles.includes(actor.role as (typeof headCoachRoles)[number])) {
      throw new HttpsError(
        "permission-denied",
        "Head Coach or Owner role required to approve promotions and graduations",
      );
    }

    const parsed = parseApprovePromotionInput(request.data);
    if (!parsed.ok) {
      throw new HttpsError(
        "invalid-argument",
        `Invalid promotion approval payload: ${parsed.error.map((e) => e.code).join(", ")}`,
      );
    }

    const graduation = await store.approvePromotion({
      academyId: actor.academyId,
      input: parsed.value,
      decidedBy: actor.userId,
      decidedByRole: actor.role as "owner" | "headCoach",
    });

    return {
      graduation,
    };
  };
}

export function createRejectPromotionHandler({ store }: { store: LevelCatalogStore }) {
  return async (request: CallableRequest<unknown>): Promise<{ graduation: GraduationRecord }> => {
    const actor = requireUserActor(request);
    if (!headCoachRoles.includes(actor.role as (typeof headCoachRoles)[number])) {
      throw new HttpsError(
        "permission-denied",
        "Head Coach or Owner role required to reject promotions",
      );
    }

    const parsed = parseRejectPromotionInput(request.data);
    if (!parsed.ok) {
      throw new HttpsError(
        "invalid-argument",
        `Invalid promotion rejection payload: ${parsed.error.map((e) => e.code).join(", ")}`,
      );
    }

    const graduation = await store.rejectPromotion({
      academyId: actor.academyId,
      input: parsed.value,
      decidedBy: actor.userId,
      decidedByRole: actor.role as "owner" | "headCoach",
    });

    return {
      graduation,
    };
  };
}

export function createListGraduationsHandler({ store }: { store: LevelCatalogStore }) {
  return async (
    request: CallableRequest<unknown>,
  ): Promise<{ graduations: readonly GraduationRecord[] }> => {
    const actor = requireUserActor(request);
    const data = (request.data as { studentId?: unknown }) ?? {};

    let targetStudentId: string | undefined;

    if (staffRoles.includes(actor.role as (typeof staffRoles)[number])) {
      if (typeof data.studentId === "string" && data.studentId.trim()) {
        targetStudentId = data.studentId.trim();
      }
    } else if (actor.role === "adultStudent") {
      if (
        typeof data.studentId === "string" &&
        data.studentId.trim() &&
        data.studentId.trim() !== String(actor.userId)
      ) {
        throw new HttpsError(
          "permission-denied",
          "Access denied: graduation history visibility restricted to self or authorized guardians",
        );
      }
      targetStudentId = String(actor.userId);
    } else if (actor.role === "guardian") {
      if (typeof data.studentId === "string" && data.studentId.trim()) {
        targetStudentId = data.studentId.trim();
      } else {
        throw new HttpsError(
          "invalid-argument",
          "studentId is required for guardian graduation query",
        );
      }
    } else {
      throw new HttpsError(
        "permission-denied",
        "Access denied: graduation history visibility restricted",
      );
    }

    const graduations = await store.listGraduations(actor.academyId, targetStudentId);
    return {
      graduations,
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

export const getStudentProgressSummary = onCall(
  {
    enforceAppCheck: false,
    consumeAppCheckToken: false,
  },
  async (request) => {
    const handler = createGetStudentProgressSummaryHandler({ store: getStore() });
    return handler(request);
  },
);

export const recordMedicalLeave = onCall(
  {
    enforceAppCheck: false,
    consumeAppCheckToken: false,
  },
  async (request) => {
    const handler = createRecordMedicalLeaveHandler({ store: getStore() });
    return handler(request);
  },
);

export const listMedicalLeaves = onCall(
  {
    enforceAppCheck: false,
    consumeAppCheckToken: false,
  },
  async (request) => {
    const handler = createListMedicalLeavesHandler({ store: getStore() });
    return handler(request);
  },
);

export const listRecognitionCandidates = onCall(
  {
    enforceAppCheck: false,
    consumeAppCheckToken: false,
  },
  async (request) => {
    const handler = createListRecognitionCandidatesHandler({ store: getStore() });
    return handler(request);
  },
);

export const approvePromotion = onCall(
  {
    enforceAppCheck: false,
    consumeAppCheckToken: false,
  },
  async (request) => {
    const handler = createApprovePromotionHandler({ store: getStore() });
    return handler(request);
  },
);

export const rejectPromotion = onCall(
  {
    enforceAppCheck: false,
    consumeAppCheckToken: false,
  },
  async (request) => {
    const handler = createRejectPromotionHandler({ store: getStore() });
    return handler(request);
  },
);

export const listGraduations = onCall(
  {
    enforceAppCheck: false,
    consumeAppCheckToken: false,
  },
  async (request) => {
    const handler = createListGraduationsHandler({ store: getStore() });
    return handler(request);
  },
);
