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
import {
  createFirebaseLevelAuthorization,
  type AuthorizedLevelActor,
  type LevelAuthorizationService,
} from "./level-authorization.js";
import {
  createLevelCatalogStore,
  LevelStoreError,
  type LevelCatalogStore,
  type StudentSkillSummary,
} from "./level-service.js";

type HandlerDependencies = Readonly<{
  store: LevelCatalogStore;
  authorization: LevelAuthorizationService;
}>;

const staffRoles = new Set(["owner", "administrator", "headCoach", "coach"]);
const assessmentRoles = new Set(["headCoach", "coach"]);

function invalidPayload(): never {
  throw new HttpsError("invalid-argument", "Levels payload is invalid");
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function exactFields(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  const keys = Reflect.ownKeys(value);
  return (
    keys.every(
      (key) => typeof key === "string" && (required.includes(key) || optional.includes(key)),
    ) && required.every((field) => Object.hasOwn(value, field))
  );
}

function emptyPayload(value: unknown): void {
  if (!isPlainRecord(value) || !exactFields(value, [])) invalidPayload();
}

function targetPayload(
  value: unknown,
  actor: AuthorizedLevelActor,
  options: Readonly<{ staffMayOmit?: boolean }> = {},
): string | undefined {
  if (actor.role === "adultStudent") {
    emptyPayload(value);
    return undefined;
  }
  if (
    staffRoles.has(actor.role) &&
    options.staffMayOmit &&
    isPlainRecord(value) &&
    exactFields(value, [])
  ) {
    return undefined;
  }
  if (!isPlainRecord(value) || !exactFields(value, ["studentId"])) invalidPayload();
  const studentId = value.studentId;
  if (typeof studentId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(studentId)) {
    invalidPayload();
  }
  return studentId;
}

function mapStoreError(error: unknown, action: string): never {
  if (error instanceof HttpsError) throw error;
  if (error instanceof LevelStoreError) {
    if (error.code === "invalid") {
      throw new HttpsError("invalid-argument", "Levels request is invalid");
    }
    if (error.code === "tenant") {
      throw new HttpsError("permission-denied", "Levels access is not permitted");
    }
    if (error.code === "not-found") {
      throw new HttpsError("not-found", "Levels record is not available");
    }
    throw new HttpsError("failed-precondition", "Levels state conflicts");
  }
  throw new HttpsError("internal", `Unable to ${action}`);
}

async function targetStudent(
  authorization: LevelAuthorizationService,
  actor: AuthorizedLevelActor,
  requestedStudentId: string | undefined,
): Promise<string> {
  return (await authorization.resolveStudent(actor, requestedStudentId)).studentId;
}

export function createListLevelCatalogHandler(dependencies: HandlerDependencies) {
  return async (request: CallableRequest<unknown>): Promise<LevelCatalogProjection> => {
    const actor = await dependencies.authorization.requireActor(request);
    if (request.data !== null && request.data !== undefined) invalidPayload();
    try {
      return await dependencies.store.listPublished(actor.academyId);
    } catch (error) {
      return mapStoreError(error, "retrieve level catalog");
    }
  };
}

export function createRecordEvaluationHandler(dependencies: HandlerDependencies) {
  return async (request: CallableRequest<unknown>): Promise<{ evaluation: EvaluationRecord }> => {
    const actor = await dependencies.authorization.requireActor(request);
    if (!assessmentRoles.has(actor.role) || actor.staffId === null) {
      throw new HttpsError("permission-denied", "A current coach role is required");
    }
    if (
      !isPlainRecord(request.data) ||
      !exactFields(request.data, [
        "studentId",
        "sessionId",
        "definitionKey",
        "skillKey",
        "score",
        "evidenceNotes",
      ])
    ) {
      invalidPayload();
    }
    const parsed = parseRecordEvaluationInput(request.data);
    if (!parsed.ok) invalidPayload();
    const studentId = await targetStudent(
      dependencies.authorization,
      actor,
      parsed.value.studentId,
    );
    try {
      return {
        evaluation: await dependencies.store.recordEvaluation({
          academyId: actor.academyId,
          input: { ...parsed.value, studentId },
          evaluatorId: actor.userId,
          evaluatorStaffId: actor.staffId,
          evaluatorRole: actor.role as "headCoach" | "coach",
        }),
      };
    } catch (error) {
      return mapStoreError(error, "record assessment");
    }
  };
}

export function createListStudentEvaluationsHandler(dependencies: HandlerDependencies) {
  return async (
    request: CallableRequest<unknown>,
  ): Promise<{ evaluations: readonly EvaluationRecord[]; summary: StudentSkillSummary }> => {
    const actor = await dependencies.authorization.requireActor(request);
    const requested = targetPayload(request.data, actor);
    const studentId = await targetStudent(dependencies.authorization, actor, requested);
    try {
      const [evaluations, summary] = await Promise.all([
        dependencies.store.listStudentEvaluations(actor.academyId, studentId),
        dependencies.store.getStudentSkillSummary(actor.academyId, studentId),
      ]);
      return { evaluations, summary };
    } catch (error) {
      return mapStoreError(error, "retrieve assessments");
    }
  };
}

export function createGetStudentProgressSummaryHandler(dependencies: HandlerDependencies) {
  return async (
    request: CallableRequest<unknown>,
  ): Promise<{ progress: StudentProgressSummary }> => {
    const actor = await dependencies.authorization.requireActor(request);
    const requested = targetPayload(request.data, actor);
    const studentId = await targetStudent(dependencies.authorization, actor, requested);
    try {
      return {
        progress: await dependencies.store.getStudentProgressSummary(actor.academyId, studentId),
      };
    } catch (error) {
      return mapStoreError(error, "retrieve student progress");
    }
  };
}

export function createRecordMedicalLeaveHandler(dependencies: HandlerDependencies) {
  return async (
    request: CallableRequest<unknown>,
  ): Promise<{ medicalLeave: MedicalLeaveRecord }> => {
    const actor = await dependencies.authorization.requireActor(request);
    if (!staffRoles.has(actor.role)) {
      throw new HttpsError("permission-denied", "A current staff role is required");
    }
    if (
      !isPlainRecord(request.data) ||
      !exactFields(request.data, ["studentId", "startDate", "endDate", "reasonCode"])
    ) {
      invalidPayload();
    }
    const parsed = parseRecordMedicalLeaveInput(request.data);
    if (!parsed.ok) invalidPayload();
    const studentId = await targetStudent(
      dependencies.authorization,
      actor,
      parsed.value.studentId,
    );
    try {
      return {
        medicalLeave: await dependencies.store.recordMedicalLeave({
          academyId: actor.academyId,
          input: { ...parsed.value, studentId },
          recordedBy: actor.userId,
          actorRole: actor.role as "owner" | "administrator" | "headCoach" | "coach",
          actorStaffId: actor.staffId,
        }),
      };
    } catch (error) {
      return mapStoreError(error, "record medical leave");
    }
  };
}

export function createListMedicalLeavesHandler(dependencies: HandlerDependencies) {
  return async (
    request: CallableRequest<unknown>,
  ): Promise<{ medicalLeaves: readonly MedicalLeaveRecord[] }> => {
    const actor = await dependencies.authorization.requireActor(request);
    const requested = targetPayload(request.data, actor);
    const studentId = await targetStudent(dependencies.authorization, actor, requested);
    try {
      return {
        medicalLeaves: await dependencies.store.listMedicalLeaves(actor.academyId, studentId),
      };
    } catch (error) {
      return mapStoreError(error, "retrieve medical leaves");
    }
  };
}

export function createListRecognitionCandidatesHandler(dependencies: HandlerDependencies) {
  return async (
    request: CallableRequest<unknown>,
  ): Promise<{ candidates: readonly RecognitionCandidate[] }> => {
    const actor = await dependencies.authorization.requireActor(request);
    if (!staffRoles.has(actor.role)) {
      throw new HttpsError("permission-denied", "A current staff role is required");
    }
    emptyPayload(request.data);
    try {
      return { candidates: await dependencies.store.listRecognitionCandidates(actor.academyId) };
    } catch (error) {
      return mapStoreError(error, "retrieve recognition candidates");
    }
  };
}

export function createApprovePromotionHandler(dependencies: HandlerDependencies) {
  return async (request: CallableRequest<unknown>): Promise<{ graduation: GraduationRecord }> => {
    const actor = await dependencies.authorization.requireActor(request);
    if (actor.role !== "headCoach" || actor.staffId === null) {
      throw new HttpsError("permission-denied", "The current head coach is required");
    }
    if (
      !isPlainRecord(request.data) ||
      !exactFields(
        request.data,
        ["studentId", "fromDefinitionKey", "toDefinitionKey", "decisionNotes"],
        ["ceremonyDate"],
      )
    ) {
      invalidPayload();
    }
    const parsed = parseApprovePromotionInput(request.data);
    if (!parsed.ok) invalidPayload();
    const studentId = await targetStudent(
      dependencies.authorization,
      actor,
      parsed.value.studentId,
    );
    try {
      return {
        graduation: await dependencies.store.approvePromotion({
          academyId: actor.academyId,
          input: { ...parsed.value, studentId },
          decidedBy: actor.userId,
          decidedByStaffId: actor.staffId,
          decidedByRole: "headCoach",
        }),
      };
    } catch (error) {
      return mapStoreError(error, "approve promotion");
    }
  };
}

export function createRejectPromotionHandler(dependencies: HandlerDependencies) {
  return async (request: CallableRequest<unknown>): Promise<{ graduation: GraduationRecord }> => {
    const actor = await dependencies.authorization.requireActor(request);
    if (actor.role !== "headCoach" || actor.staffId === null) {
      throw new HttpsError("permission-denied", "The current head coach is required");
    }
    if (
      !isPlainRecord(request.data) ||
      !exactFields(request.data, ["studentId", "targetDefinitionKey", "decisionNotes"])
    ) {
      invalidPayload();
    }
    const parsed = parseRejectPromotionInput(request.data);
    if (!parsed.ok) invalidPayload();
    const studentId = await targetStudent(
      dependencies.authorization,
      actor,
      parsed.value.studentId,
    );
    try {
      return {
        graduation: await dependencies.store.rejectPromotion({
          academyId: actor.academyId,
          input: { ...parsed.value, studentId },
          decidedBy: actor.userId,
          decidedByStaffId: actor.staffId,
          decidedByRole: "headCoach",
        }),
      };
    } catch (error) {
      return mapStoreError(error, "reject promotion");
    }
  };
}

export function createListGraduationsHandler(dependencies: HandlerDependencies) {
  return async (
    request: CallableRequest<unknown>,
  ): Promise<{ graduations: readonly GraduationRecord[] }> => {
    const actor = await dependencies.authorization.requireActor(request);
    const requested = targetPayload(request.data, actor, { staffMayOmit: true });
    const studentId =
      requested === undefined && staffRoles.has(actor.role)
        ? undefined
        : await targetStudent(dependencies.authorization, actor, requested);
    try {
      return { graduations: await dependencies.store.listGraduations(actor.academyId, studentId) };
    } catch (error) {
      return mapStoreError(error, "retrieve promotion history");
    }
  };
}

let defaultStore: LevelCatalogStore | undefined;
let defaultAuthorization: LevelAuthorizationService | undefined;

function getStore(): LevelCatalogStore {
  if (!defaultStore) {
    defaultStore = createLevelCatalogStore({ firestore: getFirestore() as never });
  }
  return defaultStore;
}

function getAuthorization(): LevelAuthorizationService {
  if (!defaultAuthorization) {
    defaultAuthorization = createFirebaseLevelAuthorization();
  }
  return defaultAuthorization;
}

function dependencies(): HandlerDependencies {
  return { store: getStore(), authorization: getAuthorization() };
}

export const levelCallableOptions = { enforceAppCheck: true } as const;

export const listLevelCatalog = onCall(levelCallableOptions, (request) =>
  createListLevelCatalogHandler(dependencies())(request),
);
export const recordEvaluation = onCall(levelCallableOptions, (request) =>
  createRecordEvaluationHandler(dependencies())(request),
);
export const listStudentEvaluations = onCall(levelCallableOptions, (request) =>
  createListStudentEvaluationsHandler(dependencies())(request),
);
export const getStudentProgressSummary = onCall(levelCallableOptions, (request) =>
  createGetStudentProgressSummaryHandler(dependencies())(request),
);
export const recordMedicalLeave = onCall(levelCallableOptions, (request) =>
  createRecordMedicalLeaveHandler(dependencies())(request),
);
export const listMedicalLeaves = onCall(levelCallableOptions, (request) =>
  createListMedicalLeavesHandler(dependencies())(request),
);
export const listRecognitionCandidates = onCall(levelCallableOptions, (request) =>
  createListRecognitionCandidatesHandler(dependencies())(request),
);
export const approvePromotion = onCall(levelCallableOptions, (request) =>
  createApprovePromotionHandler(dependencies())(request),
);
export const rejectPromotion = onCall(levelCallableOptions, (request) =>
  createRejectPromotionHandler(dependencies())(request),
);
export const listGraduations = onCall(levelCallableOptions, (request) =>
  createListGraduationsHandler(dependencies())(request),
);
