import { getFirestore } from "firebase-admin/firestore";
import { HttpsError, onCall, type CallableRequest } from "firebase-functions/v2/https";

import {
  assignLevelInputSchema,
  parseApprovePromotionInput,
  parseOpenStudentLevelInput,
  parseRecordEvaluationInput,
  parseRecordMedicalLeaveInput,
  parseRejectPromotionInput,
  recordSkillRatingsInputSchema,
  studentLevelHistoryRequestSchema,
  voidPromotionInputSchema,
  type AssignLevelResult,
  type EvaluationRecord,
  type GraduationRecord,
  type LevelCatalogProjection,
  type MedicalLeaveRecord,
  type RecognitionCandidate,
  type RecordSkillRatingsResult,
  type StudentLevelHistory,
  type StudentProgressSummary,
  type VoidPromotionResult,
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
/**
 * T051V2 (grill G6, narrowed by G12): coach, head coach and owner may RATE a skill; the
 * administrator may not, because a rating is a judgement about a member's jiu-jitsu.
 */
const ratingRoles = new Set(["headCoach", "coach", "owner"]);

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

/**
 * T051V2: who may OPEN, ASSIGN or VOID a level. The head coach needs a live staff record; the
 * owner has none by design (`assertTransactionalActor` validates the owner through the member
 * directory instead), so the store takes `staffId: null` from them. The administrator is refused
 * here — G12 narrows G6 to "the administrator sees the record and the history, and writes neither".
 * One helper, one message, so the three write callables cannot drift apart.
 */
function decisionActor(
  actor: AuthorizedLevelActor,
): Readonly<{ role: "headCoach" | "owner"; staffId: string | null }> {
  if (actor.role === "owner") return { role: "owner", staffId: null };
  if (actor.role === "headCoach" && actor.staffId !== null) {
    return { role: "headCoach", staffId: actor.staffId };
  }
  throw new HttpsError("permission-denied", "The head coach or the owner is required");
}

/**
 * `recordEvaluation` carries two payload shapes (plan decision 3): the legacy single rating and
 * the Manage view's batch. Only an OWN key on a plain object switches the dispatch, so an
 * inherited `ratings` cannot route a legacy payload into the batch handler.
 */
export function hasSkillRatings(data: unknown): boolean {
  return isPlainRecord(data) && Object.hasOwn(data, "ratings");
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
  ): Promise<{
    studentId: string;
    evaluations: readonly EvaluationRecord[];
    summary: StudentSkillSummary;
  }> => {
    const actor = await dependencies.authorization.requireActor(request);
    const requested = targetPayload(request.data, actor);
    const studentId = await targetStudent(dependencies.authorization, actor, requested);
    try {
      const [evaluations, summary] = await Promise.all([
        dependencies.store.listStudentEvaluations(actor.academyId, studentId),
        dependencies.store.getStudentSkillSummary(actor.academyId, studentId),
      ]);
      // T051V2 review fix (Major-2): the RESOLVED student is echoed, so a caller that asked about
      // one member can refuse a summary that belongs to another (or to the caller themselves).
      return { studentId, evaluations, summary };
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

export function createOpenStudentLevelHandler(dependencies: HandlerDependencies) {
  return async (request: CallableRequest<unknown>) => {
    const actor = await dependencies.authorization.requireActor(request);
    const decider = decisionActor(actor);
    const parsed = parseOpenStudentLevelInput(request.data);
    if (!parsed.ok) invalidPayload();
    try {
      const { head, ageBand } = await dependencies.store.openStudentLevel({
        academyId: actor.academyId,
        input: parsed.value,
        openedBy: actor.userId,
        openedByStaffId: decider.staffId,
        openedByRole: decider.role,
      });
      return {
        head: {
          studentId: head.studentId,
          currentDefinitionKey: head.currentDefinitionKey,
          currentLevelStartedAt: head.currentLevelStartedAt,
          state: head.state,
        },
        // T113: the band is a warning for the head coach, not a gate. Numbers only, no dates.
        ageBand,
      };
    } catch (error) {
      return mapStoreError(error, "open student level");
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

export function createAssignLevelHandler(dependencies: HandlerDependencies) {
  return async (request: CallableRequest<unknown>): Promise<AssignLevelResult> => {
    const actor = await dependencies.authorization.requireActor(request);
    const decider = decisionActor(actor);
    // The boundary parses with the store's own schema (note bounds included), so the two sides
    // cannot drift; the store re-checks it at the write because the write is irreversible.
    const parsed = assignLevelInputSchema.safeParse(request.data);
    if (!parsed.success) invalidPayload();
    const studentId = await targetStudent(dependencies.authorization, actor, parsed.data.studentId);
    try {
      return await dependencies.store.assignLevel({
        academyId: actor.academyId,
        input: { ...parsed.data, studentId },
        decidedBy: actor.userId,
        decidedByStaffId: decider.staffId,
        decidedByRole: decider.role,
      });
    } catch (error) {
      return mapStoreError(error, "assign level");
    }
  };
}

export function createVoidPromotionHandler(dependencies: HandlerDependencies) {
  return async (request: CallableRequest<unknown>): Promise<VoidPromotionResult> => {
    const actor = await dependencies.authorization.requireActor(request);
    const decider = decisionActor(actor);
    const parsed = voidPromotionInputSchema.safeParse(request.data);
    if (!parsed.success) invalidPayload();
    const studentId = await targetStudent(dependencies.authorization, actor, parsed.data.studentId);
    try {
      return await dependencies.store.voidPromotion({
        academyId: actor.academyId,
        input: { ...parsed.data, studentId },
        decidedBy: actor.userId,
        decidedByStaffId: decider.staffId,
        decidedByRole: decider.role,
      });
    } catch (error) {
      return mapStoreError(error, "void promotion");
    }
  };
}

export function createGetStudentLevelHistoryHandler(dependencies: HandlerDependencies) {
  return async (request: CallableRequest<unknown>): Promise<StudentLevelHistory> => {
    const actor = await dependencies.authorization.requireActor(request);
    // Read side: the administrator IS admitted here (G12), unlike the three write callables.
    if (!staffRoles.has(actor.role)) {
      throw new HttpsError("permission-denied", "A current staff role is required");
    }
    const parsed = studentLevelHistoryRequestSchema.safeParse(request.data);
    if (!parsed.success) invalidPayload();
    const studentId = await targetStudent(dependencies.authorization, actor, parsed.data.studentId);
    try {
      return await dependencies.store.getStudentLevelHistory(actor.academyId, studentId);
    } catch (error) {
      return mapStoreError(error, "retrieve level history");
    }
  };
}

export function createRecordSkillRatingsHandler(dependencies: HandlerDependencies) {
  return async (request: CallableRequest<unknown>): Promise<RecordSkillRatingsResult> => {
    const actor = await dependencies.authorization.requireActor(request);
    if (!ratingRoles.has(actor.role) || (actor.role !== "owner" && actor.staffId === null)) {
      throw new HttpsError("permission-denied", "A current coach role is required");
    }
    const parsed = recordSkillRatingsInputSchema.safeParse(request.data);
    if (!parsed.success) invalidPayload();
    const studentId = await targetStudent(dependencies.authorization, actor, parsed.data.studentId);
    try {
      return await dependencies.store.recordSkillRatings({
        academyId: actor.academyId,
        input: { ...parsed.data, studentId },
        evaluatorId: actor.userId,
        evaluatorStaffId: actor.staffId,
        evaluatorRole: actor.role as "headCoach" | "coach" | "owner",
      });
    } catch (error) {
      return mapStoreError(error, "record assessment");
    }
  };
}

/**
 * The `recordEvaluation` deploy surface: one callable, two payload shapes. Kept as a named factory
 * rather than a ternary inside `onCall` so the dispatch itself is testable.
 */
export function createRecordEvaluationDispatchHandler(dependencies: HandlerDependencies) {
  const batch = createRecordSkillRatingsHandler(dependencies);
  const single = createRecordEvaluationHandler(dependencies);
  return async (
    request: CallableRequest<unknown>,
  ): Promise<RecordSkillRatingsResult | { evaluation: EvaluationRecord }> =>
    hasSkillRatings(request.data) ? batch(request) : single(request);
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
  createRecordEvaluationDispatchHandler(dependencies())(request),
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
export const openStudentLevel = onCall(levelCallableOptions, (request) =>
  createOpenStudentLevelHandler(dependencies())(request),
);
export const rejectPromotion = onCall(levelCallableOptions, (request) =>
  createRejectPromotionHandler(dependencies())(request),
);
export const listGraduations = onCall(levelCallableOptions, (request) =>
  createListGraduationsHandler(dependencies())(request),
);
export const assignLevel = onCall(levelCallableOptions, (request) =>
  createAssignLevelHandler(dependencies())(request),
);
export const voidPromotion = onCall(levelCallableOptions, (request) =>
  createVoidPromotionHandler(dependencies())(request),
);
export const getStudentLevelHistory = onCall(levelCallableOptions, (request) =>
  createGetStudentLevelHistoryHandler(dependencies())(request),
);
