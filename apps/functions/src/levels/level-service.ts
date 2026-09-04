import { createHash, randomUUID } from "node:crypto";

import {
  buildEvaluationId,
  buildGraduationId,
  buildStudentProgressSummary,
  buildUninitializedStudentProgressSummary,
  generateRecognitionCandidates,
  type ApprovePromotionInput,
  type EvaluationRecord,
  type GraduationRecord,
  type LevelCatalogProjection,
  type LevelDefinitionRecord,
  type LevelRequirementRecord,
  type LevelSystemRecord,
  type MedicalLeaveRecord,
  type RecognitionCandidate,
  type RecordEvaluationInput,
  type RecordMedicalLeaveInput,
  type RejectPromotionInput,
  type StudentProgressSummary,
} from "@bpt-jersey/domain/levels";
import { parseAuditEventDraft, type AuditEventDraft } from "@bpt-jersey/domain/audit";
import { parseStudentProfile, type StudentProfile } from "@bpt-jersey/domain/profiles";
import { parseStaffProfile } from "@bpt-jersey/domain/staff";
import { appendAuditEventInTransaction, matchesAuditEventReplay } from "../audit/audit-writer.js";
import { matchesProvisionedMemberDirectoryActor } from "../members/member-directory-actor-authorization.js";
import {
  assertStoredLevelCatalogIntegrity,
  buildLevelCatalogPublication,
  levelCatalogDocumentReferencesSystem,
  type LevelCatalogPublication,
} from "./level-catalog-integrity.js";
import type { NormalizedLevelCatalog } from "./level-source.js";

export class LevelStoreError extends Error {
  public readonly code: "invalid" | "tenant" | "not-found" | "conflict";

  public constructor(code: "invalid" | "tenant" | "not-found" | "conflict", message: string) {
    super(message);
    this.name = "LevelStoreError";
    this.code = code;
  }
}

export type LevelSeedResult = Readonly<{
  systemId: string;
  sourceHash: string;
  definitionCount: number;
  beltCount: number;
  stripeCount: number;
  skillCount: number;
  requirementCount: number;
  idempotent: boolean;
}>;

export type LevelRollbackResult = Readonly<{
  systemId: string;
  deletedDefinitions: number;
  deletedRequirements: number;
  deletedSystems: number;
}>;

export type StudentSkillSummaryItem = Readonly<{
  count: number;
  maxScore: number;
  latestScore: number;
  lastEvaluatedAt: string;
}>;

export type StudentSkillSummary = Record<string, StudentSkillSummaryItem>;

export type LevelCatalogStore = Readonly<{
  listPublished: (academyId: string) => Promise<LevelCatalogProjection>;
  seed: (input: {
    academyId: string;
    normalized: NormalizedLevelCatalog;
    operationId?: string;
  }) => Promise<LevelSeedResult>;
  rollback: (input: {
    academyId: string;
    systemId: string;
    normalized: NormalizedLevelCatalog;
    operationId?: string;
  }) => Promise<LevelRollbackResult>;
  recordEvaluation: (params: {
    academyId: string;
    input: RecordEvaluationInput;
    evaluatorId: string;
    evaluatorStaffId: string;
    evaluatorRole: "headCoach" | "coach";
    evaluatedAt?: string;
  }) => Promise<EvaluationRecord>;
  listStudentEvaluations: (
    academyId: string,
    studentId: string,
  ) => Promise<readonly EvaluationRecord[]>;
  getStudentSkillSummary: (academyId: string, studentId: string) => Promise<StudentSkillSummary>;
  getStudentProgressSummary: (
    academyId: string,
    studentId: string,
  ) => Promise<StudentProgressSummary>;
  recordMedicalLeave: (params: {
    academyId: string;
    input: RecordMedicalLeaveInput;
    recordedBy: string;
    actorRole: "owner" | "administrator" | "headCoach" | "coach";
    actorStaffId: string | null;
  }) => Promise<MedicalLeaveRecord>;
  listMedicalLeaves: (
    academyId: string,
    studentId: string,
  ) => Promise<readonly MedicalLeaveRecord[]>;
  listRecognitionCandidates: (academyId: string) => Promise<readonly RecognitionCandidate[]>;
  approvePromotion: (params: {
    academyId: string;
    input: ApprovePromotionInput;
    decidedBy: string;
    decidedByStaffId: string;
    decidedByRole: "headCoach";
    decidedAt?: string;
  }) => Promise<GraduationRecord>;
  rejectPromotion: (params: {
    academyId: string;
    input: RejectPromotionInput;
    decidedBy: string;
    decidedByStaffId: string;
    decidedByRole: "headCoach";
    decidedAt?: string;
  }) => Promise<GraduationRecord>;
  listGraduations: (academyId: string, studentId?: string) => Promise<readonly GraduationRecord[]>;
}>;

const safeIdentifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

function assertValidAcademyId(academyId: string): void {
  if (!safeIdentifierPattern.test(academyId)) {
    throw new LevelStoreError("invalid", `Invalid academyId: ${academyId}`);
  }
}

type GenericDocumentSnapshot = Readonly<{
  id?: string;
  exists: boolean;
  data: () => Record<string, unknown> | undefined;
}>;

type GenericDocumentReference = Readonly<{
  id: string;
  path?: string;
  get: () => Promise<GenericDocumentSnapshot>;
  set: (data: Record<string, unknown>) => Promise<unknown>;
  delete: () => Promise<unknown>;
}>;

type GenericQuerySnapshot = Readonly<{
  docs: readonly {
    id: string;
    data: () => Record<string, unknown>;
    ref: GenericDocumentReference;
  }[];
}>;

type GenericCollectionReference = Readonly<{
  get: () => Promise<GenericQuerySnapshot>;
}>;

type GenericTransaction = Readonly<{
  get: {
    (reference: GenericDocumentReference): Promise<GenericDocumentSnapshot>;
    (reference: GenericCollectionReference): Promise<GenericQuerySnapshot>;
  };
  create: (reference: GenericDocumentReference, data: unknown) => void;
  set: (reference: GenericDocumentReference, data: unknown, options?: unknown) => void;
  delete: (reference: GenericDocumentReference) => void;
}>;

export type GenericFirestore = {
  doc: (path: string) => GenericDocumentReference;
  collection: (path: string) => GenericCollectionReference;
  batch: () => {
    set: (ref: unknown, data: unknown, options?: unknown) => void;
    delete: (ref: unknown) => void;
    commit: () => Promise<unknown>;
  };
  runTransaction: <T>(callback: (transaction: GenericTransaction) => Promise<T>) => Promise<T>;
};

const MAX_LEVEL_RECORDS = 400;
const levelCatalogReferenceCollections = Object.freeze([
  "assessments",
  "studentLevelProgress",
  "levelPromotions",
  "students",
  "recognitions",
] as const);

function levelCatalogCorrelationId(
  action: "level.catalog.published" | "level.catalog.rolled_back",
  academyId: string,
  systemId: string,
  operationId: string,
): string {
  const digest = createHash("sha256");
  for (const value of [action, academyId, systemId, operationId]) {
    digest.update(`${Buffer.byteLength(value, "utf8")}:`, "utf8");
    digest.update(value, "utf8");
  }
  return `level-catalog-${digest.digest("hex")}`;
}

function levelCatalogAuditDraft(
  input: Readonly<{
    action: "level.catalog.published" | "level.catalog.rolled_back";
    academyId: string;
    systemId: string;
    operationId: string;
  }>,
): AuditEventDraft {
  const parsed = parseAuditEventDraft({
    academyId: input.academyId,
    actorId: "system-level-catalog-maintenance",
    action: input.action,
    targetRef: `academies/${input.academyId}/levelSystems/${input.systemId}`,
    purpose: "level-catalog-maintenance",
    correlationId: levelCatalogCorrelationId(
      input.action,
      input.academyId,
      input.systemId,
      input.operationId,
    ),
  });
  if (!parsed.ok) {
    throw new LevelStoreError("invalid", "Invalid level catalog audit event.");
  }
  return parsed.value;
}

function levelCatalogAuditEventId(draft: AuditEventDraft): string {
  return `audit-${draft.correlationId}`;
}

function materializeInMemoryAuditEvent(
  eventId: string,
  draft: AuditEventDraft,
): Record<string, unknown> {
  return {
    ...draft,
    auditEventId: eventId,
    occurredAt: new Date().toISOString(),
    result: "completed",
    schemaVersion: 1,
  };
}

function levelSeedResult(normalized: NormalizedLevelCatalog, idempotent: boolean): LevelSeedResult {
  return {
    systemId: normalized.system.systemId,
    sourceHash: normalized.sourceHash,
    definitionCount: normalized.definitions.length,
    beltCount: normalized.definitions.filter((definition) => definition.kind === "belt").length,
    stripeCount: normalized.definitions.filter((definition) => definition.kind === "stripe").length,
    skillCount: normalized.skills.length,
    requirementCount: normalized.requirements.length,
    idempotent,
  };
}

function publicationFromStoredManifest(
  input: Readonly<{
    academyId: string;
    normalized: NormalizedLevelCatalog;
    storedManifest: Record<string, unknown> | undefined;
  }>,
): Readonly<{
  publication: LevelCatalogPublication;
  publishedAudit: AuditEventDraft;
}> {
  const operationId = input.storedManifest?.publishedOperationId;
  if (typeof operationId !== "string") {
    throw new LevelStoreError("conflict", "Stored level catalog manifest is invalid.");
  }
  const publishedAudit = levelCatalogAuditDraft({
    action: "level.catalog.published",
    academyId: input.academyId,
    systemId: input.normalized.system.systemId,
    operationId,
  });
  const publishedAuditEventId = levelCatalogAuditEventId(publishedAudit);
  if (input.storedManifest?.publishedAuditEventId !== publishedAuditEventId) {
    throw new LevelStoreError("conflict", "Stored level catalog manifest is invalid.");
  }
  return {
    publication: buildLevelCatalogPublication({
      academyId: input.academyId,
      normalized: input.normalized,
      operationId,
      publishedAuditEventId,
    }),
    publishedAudit,
  };
}

function catalogDocumentsForSystem(
  snapshot: GenericQuerySnapshot,
  systemId: string,
): GenericQuerySnapshot["docs"] {
  return snapshot.docs.filter((document) => document.data().systemId === systemId);
}

function assertNoActiveLevelCatalogReferences(
  snapshots: readonly GenericQuerySnapshot[],
  publication: LevelCatalogPublication,
): void {
  const definitionKeys = new Set(publication.definitions.map((definition) => definition.id));
  if (
    snapshots.some((snapshot) =>
      snapshot.docs.some((document) =>
        levelCatalogDocumentReferencesSystem(document.data(), publication.systemId, definitionKeys),
      ),
    )
  ) {
    throw new LevelStoreError(
      "conflict",
      "Level catalog rollback is blocked by active references.",
    );
  }
}

function levelWriteCorrelationId(
  action: AuditEventDraft["action"],
  academyId: string,
  targetId: string,
): string {
  const digest = createHash("sha256");
  for (const value of [action, academyId, targetId]) {
    digest.update(`${Buffer.byteLength(value, "utf8")}:`, "utf8");
    digest.update(value, "utf8");
  }
  return `level-write-${digest.digest("hex")}`;
}

function levelAuditDraft(
  input: Readonly<{
    academyId: string;
    actorId: string;
    action:
      | "level.assessment.recorded"
      | "level.medical-leave.recorded"
      | "level.promotion.approved"
      | "level.promotion.rejected";
    targetCollection: "assessments" | "medicalLeaves" | "levelPromotions";
    targetId: string;
    purpose: "student-development-assessment" | "student-medical-leave" | "student-level-promotion";
  }>,
): AuditEventDraft {
  const parsed = parseAuditEventDraft({
    academyId: input.academyId,
    actorId: input.actorId,
    action: input.action,
    targetRef: `academies/${input.academyId}/${input.targetCollection}/${input.targetId}`,
    purpose: input.purpose,
    correlationId: levelWriteCorrelationId(input.action, input.academyId, input.targetId),
  });
  if (!parsed.ok) {
    throw new LevelStoreError("invalid", "Level audit scope is invalid");
  }
  return parsed.value;
}

function auditEventId(draft: AuditEventDraft): string {
  return `audit-${draft.correlationId}`;
}

function storedStudent(
  snapshot: GenericDocumentSnapshot,
  academyId: string,
  studentId: string,
): StudentProfile {
  if (!snapshot.exists) throw new LevelStoreError("not-found", "Student is not available");
  const parsed = parseStudentProfile(snapshot.data());
  if (!parsed.ok || parsed.value.academyId !== academyId || parsed.value.studentId !== studentId) {
    throw new LevelStoreError("tenant", "Student scope is invalid");
  }
  return parsed.value;
}

function assertActiveStudent(profile: StudentProfile): void {
  if (!profile.active || profile.status !== "active") {
    throw new LevelStoreError("conflict", "Student is not active");
  }
}

async function assertTransactionalActor(
  transaction: GenericTransaction,
  firestore: GenericFirestore,
  input: Readonly<{
    academyId: string;
    actorId: string;
    actorRole: "owner" | "administrator" | "headCoach" | "coach";
    actorStaffId: string | null;
  }>,
): Promise<void> {
  const user = await transaction.get(
    firestore.doc(`academies/${input.academyId}/users/${input.actorId}`),
  );
  const userData = user.data();
  if (!user.exists || userData === undefined) {
    throw new LevelStoreError("tenant", "Actor scope is invalid");
  }
  if (input.actorRole === "owner" || input.actorRole === "administrator") {
    const roleLock = await transaction.get(
      firestore.doc(`academies/${input.academyId}/adminRoleLocks/${input.actorId}`),
    );
    if (
      roleLock.exists ||
      roleLock.data() !== undefined ||
      !matchesProvisionedMemberDirectoryActor(userData, {
        actorId: input.actorId,
        academyId: input.academyId,
        role: input.actorRole,
      })
    ) {
      throw new LevelStoreError("tenant", "Actor scope is invalid");
    }
    return;
  }
  if (input.actorStaffId === null) {
    throw new LevelStoreError("tenant", "Staff scope is invalid");
  }
  const staff = await transaction.get(
    firestore.doc(`academies/${input.academyId}/staff/${input.actorStaffId}`),
  );
  const parsed = parseStaffProfile(staff.data());
  if (
    !staff.exists ||
    userData.userId !== input.actorId ||
    userData.academyId !== input.academyId ||
    userData.accountType !== "staff" ||
    userData.active !== true ||
    userData.status !== "active" ||
    !parsed.ok ||
    parsed.value.staffId !== input.actorStaffId ||
    parsed.value.academyId !== input.academyId ||
    parsed.value.userId !== input.actorId ||
    parsed.value.role !== input.actorRole ||
    !parsed.value.active ||
    parsed.value.status !== "active"
  ) {
    throw new LevelStoreError("tenant", "Staff scope is invalid");
  }
}

function withinLimit<T extends { docs: readonly unknown[] }>(snapshot: T, label: string): T {
  if (snapshot.docs.length > MAX_LEVEL_RECORDS) {
    throw new LevelStoreError("conflict", `${label} exceeds the safe read limit`);
  }
  return snapshot;
}

export function createLevelCatalogStore({
  firestore,
}: {
  firestore: GenericFirestore;
}): LevelCatalogStore {
  return {
    async listPublished(academyId: string): Promise<LevelCatalogProjection> {
      assertValidAcademyId(academyId);

      const systemsSnapshot = await firestore
        .collection(`academies/${academyId}/levelSystems`)
        .get();

      const publishedDoc = systemsSnapshot.docs.find(
        (d) => d.data()["status"] === "published" || d.id === "ibjjf-v1",
      );

      if (!publishedDoc) {
        throw new LevelStoreError(
          "not-found",
          `No published level system found for academy: ${academyId}`,
        );
      }

      const systemData = publishedDoc.data();
      const systemId = publishedDoc.id;
      const sourceHash = String(systemData["sourceHash"] ?? "");

      const definitionsSnapshot = await firestore
        .collection(`academies/${academyId}/levelDefinitions`)
        .get();

      const definitions: LevelDefinitionRecord[] = definitionsSnapshot.docs
        .map((d) => d.data() as unknown as LevelDefinitionRecord)
        .filter((d) => d.systemId === systemId)
        .sort((a, b) => a.sequence - b.sequence);

      const requirementsSnapshot = await firestore
        .collection(`academies/${academyId}/levelRequirements`)
        .get();

      const requirements: LevelRequirementRecord[] = requirementsSnapshot.docs
        .map((d) => d.data() as unknown as LevelRequirementRecord)
        .filter((d) => d.systemId === systemId);

      const systemRecord: LevelSystemRecord = {
        systemId,
        displayName: String(systemData["displayName"] ?? "JIU-JITSU - IBJJF"),
        schemaVersion: 1,
        precedence: systemData["precedence"] as LevelSystemRecord["precedence"],
        counts: systemData["counts"] as LevelSystemRecord["counts"],
        skillCatalog: (systemData["skillCatalog"] ?? []) as LevelSystemRecord["skillCatalog"],
      };

      return Object.freeze({
        system: systemRecord,
        definitions: Object.freeze(definitions),
        skills: systemRecord.skillCatalog,
        requirements: Object.freeze(requirements),
        sourceHash,
      });
    },

    async seed(input: {
      academyId: string;
      normalized: NormalizedLevelCatalog;
      operationId?: string;
    }): Promise<LevelSeedResult> {
      assertValidAcademyId(input.academyId);
      const { academyId, normalized } = input;
      const systemId = normalized.system.systemId;
      const operationId = input.operationId ?? randomUUID();
      const publishedAudit = levelCatalogAuditDraft({
        action: "level.catalog.published",
        academyId,
        systemId,
        operationId,
      });
      const publishedAuditEventId = levelCatalogAuditEventId(publishedAudit);
      const publication = buildLevelCatalogPublication({
        academyId,
        normalized,
        operationId,
        publishedAuditEventId,
      });
      const systemRef = firestore.doc(`academies/${academyId}/levelSystems/${systemId}`);
      const manifestRef = firestore.doc(`academies/${academyId}/levelCatalogManifests/${systemId}`);
      const definitionsCollection = firestore.collection(`academies/${academyId}/levelDefinitions`);
      const requirementsCollection = firestore.collection(
        `academies/${academyId}/levelRequirements`,
      );

      return firestore.runTransaction(async (transaction) => {
        const [systemSnapshot, manifestSnapshot, definitionsSnapshot, requirementsSnapshot] =
          await Promise.all([
            transaction.get(systemRef),
            transaction.get(manifestRef),
            transaction.get(definitionsCollection),
            transaction.get(requirementsCollection),
          ]);
        const storedDefinitions = catalogDocumentsForSystem(
          withinLimit(definitionsSnapshot, "Level definitions"),
          systemId,
        );
        const storedRequirements = catalogDocumentsForSystem(
          withinLimit(requirementsSnapshot, "Level requirements"),
          systemId,
        );

        if (systemSnapshot.exists || manifestSnapshot.exists) {
          if (!systemSnapshot.exists || !manifestSnapshot.exists) {
            throw new LevelStoreError(
              "conflict",
              "Stored level catalog publication is incomplete.",
            );
          }
          const storedPublication = publicationFromStoredManifest({
            academyId,
            normalized,
            storedManifest: manifestSnapshot.data(),
          });
          const seedAuditRef = firestore.doc(
            `academies/${academyId}/auditEvents/${storedPublication.publication.manifest.publishedAuditEventId}`,
          );
          const seedAuditSnapshot = await transaction.get(seedAuditRef);
          assertStoredLevelCatalogIntegrity({
            publication: storedPublication.publication,
            storedSystem: systemSnapshot.data(),
            storedManifest: manifestSnapshot.data(),
            storedDefinitions,
            storedRequirements,
          });
          if (
            !seedAuditSnapshot.exists ||
            !matchesAuditEventReplay(
              seedAuditSnapshot.data(),
              storedPublication.publication.manifest.publishedAuditEventId,
              storedPublication.publishedAudit,
            )
          ) {
            throw new LevelStoreError(
              "conflict",
              "Stored level catalog publication audit is invalid.",
            );
          }
          return levelSeedResult(normalized, true);
        }

        if (storedDefinitions.length > 0 || storedRequirements.length > 0) {
          throw new LevelStoreError("conflict", "Partial level catalog documents already exist.");
        }

        transaction.create(systemRef, publication.systemDocument);
        for (const definition of publication.definitions) {
          transaction.create(
            firestore.doc(`academies/${academyId}/levelDefinitions/${definition.id}`),
            definition.data,
          );
        }
        for (const requirement of publication.requirements) {
          transaction.create(
            firestore.doc(`academies/${academyId}/levelRequirements/${requirement.id}`),
            requirement.data,
          );
        }
        transaction.create(manifestRef, publication.manifest);
        appendAuditEventInTransaction(
          transaction,
          firestore.doc(`academies/${academyId}/auditEvents/${publishedAuditEventId}`),
          publishedAudit,
        );
        return levelSeedResult(normalized, false);
      });
    },

    async rollback(input: {
      academyId: string;
      systemId: string;
      normalized: NormalizedLevelCatalog;
      operationId?: string;
    }): Promise<LevelRollbackResult> {
      assertValidAcademyId(input.academyId);
      const { academyId, systemId, normalized } = input;
      if (systemId !== normalized.system.systemId) {
        throw new LevelStoreError(
          "invalid",
          "Rollback source does not match the requested system.",
        );
      }
      const operationId = input.operationId ?? randomUUID();
      const rollbackAudit = levelCatalogAuditDraft({
        action: "level.catalog.rolled_back",
        academyId,
        systemId,
        operationId,
      });
      const rollbackAuditEventId = levelCatalogAuditEventId(rollbackAudit);
      const systemRef = firestore.doc(`academies/${academyId}/levelSystems/${systemId}`);
      const manifestRef = firestore.doc(`academies/${academyId}/levelCatalogManifests/${systemId}`);
      const definitionsCollection = firestore.collection(`academies/${academyId}/levelDefinitions`);
      const requirementsCollection = firestore.collection(
        `academies/${academyId}/levelRequirements`,
      );
      const referenceCollections = levelCatalogReferenceCollections.map((collection) =>
        firestore.collection(`academies/${academyId}/${collection}`),
      );

      return firestore.runTransaction(async (transaction) => {
        const [systemSnapshot, manifestSnapshot, definitionsSnapshot, requirementsSnapshot] =
          await Promise.all([
            transaction.get(systemRef),
            transaction.get(manifestRef),
            transaction.get(definitionsCollection),
            transaction.get(requirementsCollection),
          ]);
        const referenceSnapshots = await Promise.all(
          referenceCollections.map((collection) => transaction.get(collection)),
        );
        if (!systemSnapshot.exists) {
          throw new LevelStoreError(
            "not-found",
            `Level system ${systemId} does not exist in academy ${academyId}`,
          );
        }
        if (!manifestSnapshot.exists) {
          throw new LevelStoreError("conflict", "Stored level catalog manifest is missing.");
        }

        const storedDefinitions = catalogDocumentsForSystem(
          withinLimit(definitionsSnapshot, "Level definitions"),
          systemId,
        );
        const storedRequirements = catalogDocumentsForSystem(
          withinLimit(requirementsSnapshot, "Level requirements"),
          systemId,
        );
        const storedPublication = publicationFromStoredManifest({
          academyId,
          normalized,
          storedManifest: manifestSnapshot.data(),
        });
        const seedAuditRef = firestore.doc(
          `academies/${academyId}/auditEvents/${storedPublication.publication.manifest.publishedAuditEventId}`,
        );
        const seedAuditSnapshot = await transaction.get(seedAuditRef);
        assertStoredLevelCatalogIntegrity({
          publication: storedPublication.publication,
          storedSystem: systemSnapshot.data(),
          storedManifest: manifestSnapshot.data(),
          storedDefinitions,
          storedRequirements,
        });
        if (
          !seedAuditSnapshot.exists ||
          !matchesAuditEventReplay(
            seedAuditSnapshot.data(),
            storedPublication.publication.manifest.publishedAuditEventId,
            storedPublication.publishedAudit,
          )
        ) {
          throw new LevelStoreError(
            "conflict",
            "Stored level catalog publication audit is invalid.",
          );
        }
        for (const snapshot of referenceSnapshots) {
          withinLimit(snapshot, "Level catalog references");
        }
        assertNoActiveLevelCatalogReferences(referenceSnapshots, storedPublication.publication);

        for (const definition of storedDefinitions) transaction.delete(definition.ref);
        for (const requirement of storedRequirements) transaction.delete(requirement.ref);
        transaction.delete(systemRef);
        transaction.delete(manifestRef);
        appendAuditEventInTransaction(
          transaction,
          firestore.doc(`academies/${academyId}/auditEvents/${rollbackAuditEventId}`),
          rollbackAudit,
        );

        return {
          systemId,
          deletedDefinitions: storedDefinitions.length,
          deletedRequirements: storedRequirements.length,
          deletedSystems: 1,
        };
      });
    },

    async recordEvaluation(params): Promise<EvaluationRecord> {
      assertValidAcademyId(params.academyId);
      const { academyId, input, evaluatorId, evaluatorStaffId, evaluatorRole } = params;
      if (evaluatorRole !== "headCoach" && evaluatorRole !== "coach") {
        throw new LevelStoreError("tenant", "Assessment actor role is invalid");
      }
      const now = params.evaluatedAt ?? new Date().toISOString();
      const evaluationId = buildEvaluationId(input.studentId, input.skillKey, now);

      const record: EvaluationRecord = {
        evaluationId,
        academyId,
        studentId: input.studentId,
        sessionId: input.sessionId,
        definitionKey: input.definitionKey,
        skillKey: input.skillKey,
        score: input.score,
        evidenceNotes: input.evidenceNotes,
        evaluatorId,
        evaluatorRole,
        evaluatedAt: now,
        schemaVersion: "1",
        createdAt: now,
        createdBy: evaluatorId,
        updatedAt: now,
        updatedBy: evaluatorId,
      };
      const assessmentRef = firestore.doc(`academies/${academyId}/assessments/${evaluationId}`);
      const audit = levelAuditDraft({
        academyId,
        actorId: evaluatorId,
        action: "level.assessment.recorded",
        targetCollection: "assessments",
        targetId: evaluationId,
        purpose: "student-development-assessment",
      });
      const auditRef = firestore.doc(`academies/${academyId}/auditEvents/${auditEventId(audit)}`);
      return firestore.runTransaction(async (transaction) => {
        await assertTransactionalActor(transaction, firestore, {
          academyId,
          actorId: evaluatorId,
          actorRole: evaluatorRole,
          actorStaffId: evaluatorStaffId,
        });
        const student = storedStudent(
          await transaction.get(
            firestore.doc(`academies/${academyId}/students/${input.studentId}`),
          ),
          academyId,
          input.studentId,
        );
        assertActiveStudent(student);
        const [session, definition, existing] = await Promise.all([
          transaction.get(firestore.doc(`academies/${academyId}/sessions/${input.sessionId}`)),
          transaction.get(
            firestore.doc(`academies/${academyId}/levelDefinitions/${input.definitionKey}`),
          ),
          transaction.get(assessmentRef),
        ]);
        const sessionData = session.data();
        const definitionData = definition.data();
        if (
          !session.exists ||
          sessionData?.academyId !== academyId ||
          sessionData.sessionId !== input.sessionId ||
          sessionData.status === "cancelled" ||
          (evaluatorRole === "coach" && sessionData.instructorId !== evaluatorStaffId) ||
          !definition.exists ||
          definitionData?.academyId !== academyId ||
          definitionData.definitionKey !== input.definitionKey ||
          typeof definitionData.systemId !== "string" ||
          existing.exists
        ) {
          throw new LevelStoreError("conflict", "Assessment references are not current");
        }
        const system = await transaction.get(
          firestore.doc(`academies/${academyId}/levelSystems/${definitionData.systemId}`),
        );
        const systemData = system.data();
        if (
          !system.exists ||
          systemData?.academyId !== academyId ||
          systemData.systemId !== definitionData.systemId ||
          systemData.status !== "published" ||
          !Array.isArray(systemData.skillCatalog) ||
          !systemData.skillCatalog.some(
            (skill) =>
              typeof skill === "object" &&
              skill !== null &&
              !Array.isArray(skill) &&
              (skill as Record<string, unknown>).key === input.skillKey,
          )
        ) {
          throw new LevelStoreError("conflict", "Assessment catalog is not current");
        }
        transaction.create(assessmentRef, {
          ...record,
          assessmentId: evaluationId,
          coachStaffId: evaluatorStaffId,
          observedAt: now,
          dimensions: [
            {
              definitionKey: input.definitionKey,
              skillKey: input.skillKey,
              score: input.score,
            },
          ],
          status: "recorded",
        });
        appendAuditEventInTransaction(transaction, auditRef, audit);
        return record;
      });
    },

    async listStudentEvaluations(
      academyId: string,
      studentId: string,
    ): Promise<readonly EvaluationRecord[]> {
      assertValidAcademyId(academyId);
      storedStudent(
        await firestore.doc(`academies/${academyId}/students/${studentId}`).get(),
        academyId,
        studentId,
      );
      const snapshot = withinLimit(
        await firestore.collection(`academies/${academyId}/assessments`).get(),
        "Assessments",
      );
      return snapshot.docs
        .map((document) => {
          const data = document.data();
          if (data.academyId !== academyId || data.assessmentId !== document.id) {
            throw new LevelStoreError("tenant", "Assessment scope is invalid");
          }
          return data as unknown as EvaluationRecord;
        })
        .filter((evaluation) => evaluation.studentId === studentId)
        .sort((left, right) => right.evaluatedAt.localeCompare(left.evaluatedAt));
    },

    async getStudentSkillSummary(
      academyId: string,
      studentId: string,
    ): Promise<StudentSkillSummary> {
      const evaluations = await this.listStudentEvaluations(academyId, studentId);
      const summary: StudentSkillSummary = {};
      for (const evaluation of evaluations) {
        const existing = summary[evaluation.skillKey];
        if (!existing) {
          summary[evaluation.skillKey] = {
            count: 1,
            maxScore: evaluation.score,
            latestScore: evaluation.score,
            lastEvaluatedAt: evaluation.evaluatedAt,
          };
          continue;
        }
        summary[evaluation.skillKey] = {
          count: existing.count + 1,
          maxScore: Math.max(existing.maxScore, evaluation.score),
          latestScore:
            evaluation.evaluatedAt > existing.lastEvaluatedAt
              ? evaluation.score
              : existing.latestScore,
          lastEvaluatedAt:
            evaluation.evaluatedAt > existing.lastEvaluatedAt
              ? evaluation.evaluatedAt
              : existing.lastEvaluatedAt,
        };
      }

      return summary;
    },

    async getStudentProgressSummary(
      academyId: string,
      studentId: string,
    ): Promise<StudentProgressSummary> {
      assertValidAcademyId(academyId);
      storedStudent(
        await firestore.doc(`academies/${academyId}/students/${studentId}`).get(),
        academyId,
        studentId,
      );
      const head = await firestore
        .doc(`academies/${academyId}/studentLevelProgress/${studentId}`)
        .get();
      if (!head.exists) return buildUninitializedStudentProgressSummary(studentId);
      const headData = head.data();
      if (
        headData === undefined ||
        headData.academyId !== academyId ||
        headData.studentId !== studentId ||
        headData.state !== "initialized" ||
        typeof headData.systemId !== "string" ||
        typeof headData.currentDefinitionKey !== "string" ||
        (headData.currentLevelStartedAt !== null &&
          typeof headData.currentLevelStartedAt !== "string")
      ) {
        throw new LevelStoreError("tenant", "Progress head is invalid");
      }
      const [catalog, evaluations, attendanceSnapshot, sessionsSnapshot] = await Promise.all([
        this.listPublished(academyId),
        this.listStudentEvaluations(academyId, studentId),
        firestore.collection(`academies/${academyId}/attendance`).get(),
        firestore.collection(`academies/${academyId}/sessions`).get(),
      ]);
      if (
        catalog.system.systemId !== headData.systemId ||
        !catalog.definitions.some(
          (definition) => definition.definitionKey === headData.currentDefinitionKey,
        )
      ) {
        throw new LevelStoreError("conflict", "Progress definition is not current");
      }
      const attendance = withinLimit(attendanceSnapshot, "Attendance").docs.flatMap((document) => {
        const value = document.data();
        if (
          value.academyId !== academyId ||
          value.attendanceId !== document.id ||
          typeof value.studentId !== "string" ||
          typeof value.sessionId !== "string"
        ) {
          throw new LevelStoreError("tenant", "Attendance scope is invalid");
        }
        if (
          value.studentId !== studentId ||
          value.correctionOf !== null ||
          (value.state !== "attended" && value.state !== "late")
        ) {
          return [];
        }
        return [value];
      });
      const sessions = new Map(
        withinLimit(sessionsSnapshot, "Sessions").docs.map((document) => {
          const value = document.data();
          if (value.academyId !== academyId || value.sessionId !== document.id) {
            throw new LevelStoreError("tenant", "Session scope is invalid");
          }
          return [document.id, value] as const;
        }),
      );
      let totalMinutes = 0;
      for (const attendanceRecord of attendance) {
        const session = sessions.get(String(attendanceRecord.sessionId));
        if (
          session === undefined ||
          session.academyId !== academyId ||
          session.sessionId !== attendanceRecord.sessionId ||
          typeof session.startAt !== "string" ||
          typeof session.endAt !== "string"
        ) {
          throw new LevelStoreError("conflict", "Attendance session is invalid");
        }
        const duration = Date.parse(session.endAt) - Date.parse(session.startAt);
        if (!Number.isFinite(duration) || duration <= 0) {
          throw new LevelStoreError("conflict", "Session duration is invalid");
        }
        totalMinutes += duration / 60_000;
      }
      return buildStudentProgressSummary({
        catalog,
        studentId,
        currentDefinitionKey: headData.currentDefinitionKey,
        evaluations,
        attendedClassesCount: attendance.length,
        totalHours: totalMinutes / 60,
        currentLevelStartedAt: headData.currentLevelStartedAt ?? null,
      });
    },

    async recordMedicalLeave(params): Promise<MedicalLeaveRecord> {
      const { academyId, input, recordedBy, actorRole, actorStaffId } = params;
      assertValidAcademyId(academyId);

      const leaveId = `leave_${input.studentId}_${Date.now()}`;
      const now = new Date().toISOString();

      const record: MedicalLeaveRecord = Object.freeze({
        leaveId,
        academyId,
        studentId: input.studentId,
        startDate: input.startDate,
        endDate: input.endDate,
        reasonCode: input.reasonCode,
        status: "active",
        schemaVersion: "1",
        recordedBy,
        recordedAt: now,
        createdAt: now,
        createdBy: recordedBy,
        updatedAt: now,
        updatedBy: recordedBy,
      });
      const leaveRef = firestore.doc(`academies/${academyId}/medicalLeaves/${leaveId}`);
      const audit = levelAuditDraft({
        academyId,
        actorId: recordedBy,
        action: "level.medical-leave.recorded",
        targetCollection: "medicalLeaves",
        targetId: leaveId,
        purpose: "student-medical-leave",
      });
      const auditRef = firestore.doc(`academies/${academyId}/auditEvents/${auditEventId(audit)}`);
      return firestore.runTransaction(async (transaction) => {
        await assertTransactionalActor(transaction, firestore, {
          academyId,
          actorId: recordedBy,
          actorRole,
          actorStaffId,
        });
        const student = storedStudent(
          await transaction.get(
            firestore.doc(`academies/${academyId}/students/${input.studentId}`),
          ),
          academyId,
          input.studentId,
        );
        assertActiveStudent(student);
        transaction.create(leaveRef, record);
        appendAuditEventInTransaction(transaction, auditRef, audit);
        return record;
      });
    },

    async listMedicalLeaves(
      academyId: string,
      studentId: string,
    ): Promise<readonly MedicalLeaveRecord[]> {
      assertValidAcademyId(academyId);

      storedStudent(
        await firestore.doc(`academies/${academyId}/students/${studentId}`).get(),
        academyId,
        studentId,
      );
      const snapshot = withinLimit(
        await firestore.collection(`academies/${academyId}/medicalLeaves`).get(),
        "Medical leaves",
      );
      return snapshot.docs
        .map((document) => {
          const data = document.data();
          if (data.academyId !== academyId || data.leaveId !== document.id) {
            throw new LevelStoreError("tenant", "Medical leave scope is invalid");
          }
          return data as unknown as MedicalLeaveRecord;
        })
        .filter((record) => record.studentId === studentId)
        .sort((a, b) => b.startDate.localeCompare(a.startDate));
    },

    async listRecognitionCandidates(academyId: string): Promise<readonly RecognitionCandidate[]> {
      assertValidAcademyId(academyId);
      const [
        catalog,
        studentSnapshot,
        headSnapshot,
        assessmentSnapshot,
        attendanceSnapshot,
        leaveSnapshot,
      ] = await Promise.all([
        this.listPublished(academyId),
        firestore.collection(`academies/${academyId}/students`).get(),
        firestore.collection(`academies/${academyId}/studentLevelProgress`).get(),
        firestore.collection(`academies/${academyId}/assessments`).get(),
        firestore.collection(`academies/${academyId}/attendance`).get(),
        firestore.collection(`academies/${academyId}/medicalLeaves`).get(),
      ]);
      const heads = new Map(
        withinLimit(headSnapshot, "Progress heads").docs.map((document) => {
          const value = document.data();
          if (
            value.academyId !== academyId ||
            value.studentId !== document.id ||
            value.state !== "initialized" ||
            typeof value.currentDefinitionKey !== "string"
          ) {
            throw new LevelStoreError("tenant", "Progress head scope is invalid");
          }
          return [document.id, value] as const;
        }),
      );
      const studentProfiles = withinLimit(studentSnapshot, "Students").docs.map((document) =>
        storedStudent({ exists: true, data: () => document.data() }, academyId, document.id),
      );
      const allStudentIds = new Set(studentProfiles.map((profile) => profile.studentId));
      if ([...heads.keys()].some((studentId) => !allStudentIds.has(studentId))) {
        throw new LevelStoreError("tenant", "Progress head student scope is invalid");
      }
      const students = studentProfiles.flatMap((profile) => {
        const head = heads.get(profile.studentId);
        if (!profile.active || profile.status !== "active" || head === undefined) return [];
        return [
          {
            studentId: profile.studentId,
            studentName: profile.fullName,
            currentDefinitionKey: head.currentDefinitionKey as string,
            currentLevelStartedAt:
              typeof head.currentLevelStartedAt === "string" ? head.currentLevelStartedAt : null,
          },
        ];
      });
      const studentIds = new Set(students.map((student) => student.studentId));
      const evaluations = withinLimit(assessmentSnapshot, "Assessments")
        .docs.map((document) => {
          const record = document.data();
          if (
            record.academyId !== academyId ||
            record.assessmentId !== document.id ||
            typeof record.studentId !== "string" ||
            !allStudentIds.has(record.studentId)
          ) {
            throw new LevelStoreError("tenant", "Assessment scope is invalid");
          }
          return record as unknown as EvaluationRecord;
        })
        .filter((record) => studentIds.has(record.studentId));
      const attendances = withinLimit(attendanceSnapshot, "Attendance").docs.flatMap((document) => {
        const record = document.data();
        if (
          record.academyId !== academyId ||
          record.attendanceId !== document.id ||
          typeof record.studentId !== "string" ||
          !allStudentIds.has(record.studentId) ||
          typeof record.occurredAt !== "string"
        ) {
          throw new LevelStoreError("tenant", "Attendance scope is invalid");
        }
        if (
          !studentIds.has(record.studentId) ||
          record.correctionOf !== null ||
          (record.state !== "attended" && record.state !== "late")
        ) {
          return [];
        }
        return [{ studentId: record.studentId, attendedAt: record.occurredAt }];
      });
      const medicalLeaves = withinLimit(leaveSnapshot, "Medical leaves")
        .docs.map((document) => {
          const record = document.data();
          if (
            record.academyId !== academyId ||
            record.leaveId !== document.id ||
            typeof record.studentId !== "string" ||
            !allStudentIds.has(record.studentId)
          ) {
            throw new LevelStoreError("tenant", "Medical leave scope is invalid");
          }
          return record as unknown as MedicalLeaveRecord;
        })
        .filter((record) => studentIds.has(record.studentId));
      return generateRecognitionCandidates({
        catalog,
        students,
        evaluations,
        attendances,
        medicalLeaves,
      });
    },

    async approvePromotion(params): Promise<GraduationRecord> {
      const { academyId, input, decidedBy, decidedByStaffId, decidedByRole } = params;
      assertValidAcademyId(academyId);
      if (decidedByRole !== "headCoach") {
        throw new LevelStoreError("tenant", "Promotion decision role is invalid");
      }
      const now = params.decidedAt ?? new Date().toISOString();
      const graduationId = buildGraduationId(input.studentId, input.toDefinitionKey, now);

      const record: GraduationRecord = Object.freeze({
        graduationId,
        academyId,
        studentId: input.studentId,
        fromDefinitionKey: input.fromDefinitionKey,
        toDefinitionKey: input.toDefinitionKey,
        status: "approved",
        decisionNotes: input.decisionNotes,
        decidedBy,
        decidedByRole,
        decidedAt: now,
        ceremonyDate: input.ceremonyDate ?? null,
        schemaVersion: "1",
        createdAt: now,
        createdBy: decidedBy,
        updatedAt: now,
        updatedBy: decidedBy,
      });

      const promotionRef = firestore.doc(`academies/${academyId}/levelPromotions/${graduationId}`);
      const headRef = firestore.doc(
        `academies/${academyId}/studentLevelProgress/${input.studentId}`,
      );
      const audit = levelAuditDraft({
        academyId,
        actorId: decidedBy,
        action: "level.promotion.approved",
        targetCollection: "levelPromotions",
        targetId: graduationId,
        purpose: "student-level-promotion",
      });
      const auditRef = firestore.doc(`academies/${academyId}/auditEvents/${auditEventId(audit)}`);
      return firestore.runTransaction(async (transaction) => {
        await assertTransactionalActor(transaction, firestore, {
          academyId,
          actorId: decidedBy,
          actorRole: "headCoach",
          actorStaffId: decidedByStaffId,
        });
        const student = storedStudent(
          await transaction.get(
            firestore.doc(`academies/${academyId}/students/${input.studentId}`),
          ),
          academyId,
          input.studentId,
        );
        assertActiveStudent(student);
        const [head, fromDefinition, toDefinition, existingPromotion] = await Promise.all([
          transaction.get(headRef),
          transaction.get(
            firestore.doc(`academies/${academyId}/levelDefinitions/${input.fromDefinitionKey}`),
          ),
          transaction.get(
            firestore.doc(`academies/${academyId}/levelDefinitions/${input.toDefinitionKey}`),
          ),
          transaction.get(promotionRef),
        ]);
        const headData = head.data();
        const fromData = fromDefinition.data();
        const toData = toDefinition.data();
        if (
          !head.exists ||
          headData?.academyId !== academyId ||
          headData.studentId !== input.studentId ||
          headData.state !== "initialized" ||
          headData.currentDefinitionKey !== input.fromDefinitionKey ||
          !fromDefinition.exists ||
          !toDefinition.exists ||
          fromData?.academyId !== academyId ||
          toData?.academyId !== academyId ||
          fromData.definitionKey !== input.fromDefinitionKey ||
          toData.definitionKey !== input.toDefinitionKey ||
          fromData.systemId !== headData.systemId ||
          toData.systemId !== headData.systemId ||
          typeof fromData.sequence !== "number" ||
          toData.sequence !== fromData.sequence + 1 ||
          existingPromotion.exists
        ) {
          throw new LevelStoreError("conflict", "Promotion references are not current");
        }
        transaction.create(promotionRef, {
          ...record,
          promotionId: graduationId,
          systemId: headData.systemId,
          decisionStatus: "approved",
          proposedBy: decidedByStaffId,
          decidedByStaffId,
        });
        transaction.set(headRef, {
          ...headData,
          studentId: input.studentId,
          academyId,
          currentDefinitionKey: input.toDefinitionKey,
          currentLevelStartedAt: now,
          lastApprovedPromotionId: graduationId,
          state: "initialized",
          schemaVersion: "1",
          updatedAt: now,
          updatedBy: decidedBy,
        });
        appendAuditEventInTransaction(transaction, auditRef, audit);
        return record;
      });
    },

    async rejectPromotion(params): Promise<GraduationRecord> {
      const { academyId, input, decidedBy, decidedByStaffId, decidedByRole } = params;
      assertValidAcademyId(academyId);
      if (decidedByRole !== "headCoach") {
        throw new LevelStoreError("tenant", "Promotion decision role is invalid");
      }
      const now = params.decidedAt ?? new Date().toISOString();
      const graduationId = buildGraduationId(input.studentId, input.targetDefinitionKey, now);
      const promotionRef = firestore.doc(`academies/${academyId}/levelPromotions/${graduationId}`);
      const audit = levelAuditDraft({
        academyId,
        actorId: decidedBy,
        action: "level.promotion.rejected",
        targetCollection: "levelPromotions",
        targetId: graduationId,
        purpose: "student-level-promotion",
      });
      const auditRef = firestore.doc(`academies/${academyId}/auditEvents/${auditEventId(audit)}`);
      return firestore.runTransaction(async (transaction) => {
        await assertTransactionalActor(transaction, firestore, {
          academyId,
          actorId: decidedBy,
          actorRole: "headCoach",
          actorStaffId: decidedByStaffId,
        });
        const student = storedStudent(
          await transaction.get(
            firestore.doc(`academies/${academyId}/students/${input.studentId}`),
          ),
          academyId,
          input.studentId,
        );
        assertActiveStudent(student);
        const [head, definition, existingPromotion] = await Promise.all([
          transaction.get(
            firestore.doc(`academies/${academyId}/studentLevelProgress/${input.studentId}`),
          ),
          transaction.get(
            firestore.doc(`academies/${academyId}/levelDefinitions/${input.targetDefinitionKey}`),
          ),
          transaction.get(promotionRef),
        ]);
        const headData = head.data();
        const definitionData = definition.data();
        if (
          !definition.exists ||
          definitionData?.academyId !== academyId ||
          definitionData.definitionKey !== input.targetDefinitionKey ||
          typeof definitionData.systemId !== "string" ||
          existingPromotion.exists ||
          (head.exists &&
            (headData?.academyId !== academyId || headData.studentId !== input.studentId))
        ) {
          throw new LevelStoreError("conflict", "Promotion references are not current");
        }
        const record: GraduationRecord = Object.freeze({
          graduationId,
          academyId,
          studentId: input.studentId,
          fromDefinitionKey:
            head.exists && typeof headData?.currentDefinitionKey === "string"
              ? headData.currentDefinitionKey
              : "uninitialized",
          toDefinitionKey: input.targetDefinitionKey,
          status: "rejected",
          decisionNotes: input.decisionNotes,
          decidedBy,
          decidedByRole,
          decidedAt: now,
          ceremonyDate: null,
          schemaVersion: "1",
          createdAt: now,
          createdBy: decidedBy,
          updatedAt: now,
          updatedBy: decidedBy,
        });
        transaction.create(promotionRef, {
          ...record,
          promotionId: graduationId,
          systemId: definitionData.systemId,
          decisionStatus: "rejected",
          proposedBy: decidedByStaffId,
          decidedByStaffId,
        });
        appendAuditEventInTransaction(transaction, auditRef, audit);
        return record;
      });
    },

    async listGraduations(
      academyId: string,
      studentId?: string,
    ): Promise<readonly GraduationRecord[]> {
      assertValidAcademyId(academyId);

      if (studentId !== undefined) {
        storedStudent(
          await firestore.doc(`academies/${academyId}/students/${studentId}`).get(),
          academyId,
          studentId,
        );
      }
      const snapshot = withinLimit(
        await firestore.collection(`academies/${academyId}/levelPromotions`).get(),
        "Level promotions",
      );
      return snapshot.docs
        .map((document) => {
          const data = document.data();
          if (data.academyId !== academyId || data.promotionId !== document.id) {
            throw new LevelStoreError("tenant", "Promotion scope is invalid");
          }
          return data as unknown as GraduationRecord;
        })
        .filter((record) => studentId === undefined || record.studentId === studentId)
        .sort((left, right) => right.decidedAt.localeCompare(left.decidedAt));
    },
  };
}

export function createInMemoryLevelStore(): LevelCatalogStore {
  const systems = new Map<string, Record<string, unknown>>();
  const definitions = new Map<string, Record<string, unknown>>();
  const requirements = new Map<string, Record<string, unknown>>();
  const manifests = new Map<string, Record<string, unknown>>();
  const auditEvents = new Map<string, Record<string, unknown>>();
  const evaluations = new Map<string, EvaluationRecord>();
  const medicalLeaves = new Map<string, MedicalLeaveRecord>();
  const graduations = new Map<string, GraduationRecord>();

  return {
    async listPublished(academyId: string): Promise<LevelCatalogProjection> {
      assertValidAcademyId(academyId);

      const publishedSystem = Array.from(systems.values()).find(
        (s) =>
          s["academyId"] === academyId &&
          (s["status"] === "published" || s["systemId"] === "ibjjf-v1"),
      );

      if (!publishedSystem) {
        throw new LevelStoreError(
          "not-found",
          `No published level system found for academy: ${academyId}`,
        );
      }

      const systemId = publishedSystem["systemId"] as string;
      const systemDefs = Array.from(definitions.values())
        .filter((d) => d["academyId"] === academyId && d["systemId"] === systemId)
        .map((d) => d as unknown as LevelDefinitionRecord)
        .sort((a, b) => a.sequence - b.sequence);

      const systemReqs = Array.from(requirements.values())
        .filter((r) => r["academyId"] === academyId && r["systemId"] === systemId)
        .map((r) => r as unknown as LevelRequirementRecord);

      return Object.freeze({
        system: publishedSystem as unknown as LevelSystemRecord,
        definitions: Object.freeze(systemDefs),
        skills: (publishedSystem["skillCatalog"] ?? []) as LevelSystemRecord["skillCatalog"],
        requirements: Object.freeze(systemReqs),
        sourceHash: publishedSystem["sourceHash"] as string,
      });
    },

    async seed(input: {
      academyId: string;
      normalized: NormalizedLevelCatalog;
      operationId?: string;
    }): Promise<LevelSeedResult> {
      assertValidAcademyId(input.academyId);
      const { academyId, normalized } = input;
      const systemId = normalized.system.systemId;
      const systemKey = `${academyId}__${systemId}`;
      const manifestKey = systemKey;

      const existing = systems.get(systemKey);
      const existingManifest = manifests.get(manifestKey);
      if (existing !== undefined || existingManifest !== undefined) {
        if (existing === undefined || existingManifest === undefined) {
          throw new LevelStoreError("conflict", "Stored level catalog publication is incomplete.");
        }
        const storedPublication = publicationFromStoredManifest({
          academyId,
          normalized,
          storedManifest: existingManifest,
        });
        const storedDefinitions = Array.from(definitions.values())
          .filter(
            (definition) => definition.academyId === academyId && definition.systemId === systemId,
          )
          .map((definition) => ({
            id: String(definition.definitionKey),
            data: () => definition,
          }));
        const storedRequirements = Array.from(requirements.values())
          .filter(
            (requirement) =>
              requirement.academyId === academyId && requirement.systemId === systemId,
          )
          .map((requirement) => ({
            id: String(requirement.requirementKey),
            data: () => requirement,
          }));
        assertStoredLevelCatalogIntegrity({
          publication: storedPublication.publication,
          storedSystem: existing,
          storedManifest: existingManifest,
          storedDefinitions,
          storedRequirements,
        });
        const storedAudit = auditEvents.get(
          storedPublication.publication.manifest.publishedAuditEventId,
        );
        if (
          storedAudit === undefined ||
          !matchesAuditEventReplay(
            storedAudit,
            storedPublication.publication.manifest.publishedAuditEventId,
            storedPublication.publishedAudit,
          )
        ) {
          throw new LevelStoreError(
            "conflict",
            "Stored level catalog publication audit is invalid.",
          );
        }
        return levelSeedResult(normalized, true);
      }

      const operationId = input.operationId ?? randomUUID();
      const publishedAudit = levelCatalogAuditDraft({
        action: "level.catalog.published",
        academyId,
        systemId,
        operationId,
      });
      const publishedAuditEventId = levelCatalogAuditEventId(publishedAudit);
      const publication = buildLevelCatalogPublication({
        academyId,
        normalized,
        operationId,
        publishedAuditEventId,
      });
      if (
        Array.from(definitions.values()).some(
          (definition) => definition.academyId === academyId && definition.systemId === systemId,
        ) ||
        Array.from(requirements.values()).some(
          (requirement) => requirement.academyId === academyId && requirement.systemId === systemId,
        )
      ) {
        throw new LevelStoreError("conflict", "Partial level catalog documents already exist.");
      }

      systems.set(systemKey, { ...publication.systemDocument });
      for (const definition of publication.definitions) {
        definitions.set(`${academyId}__${definition.id}`, { ...definition.data });
      }
      for (const requirement of publication.requirements) {
        requirements.set(`${academyId}__${requirement.id}`, { ...requirement.data });
      }
      manifests.set(manifestKey, { ...publication.manifest });
      auditEvents.set(
        publishedAuditEventId,
        materializeInMemoryAuditEvent(publishedAuditEventId, publishedAudit),
      );
      return levelSeedResult(normalized, false);
    },

    async rollback(input: {
      academyId: string;
      systemId: string;
      normalized: NormalizedLevelCatalog;
      operationId?: string;
    }): Promise<LevelRollbackResult> {
      assertValidAcademyId(input.academyId);
      const { academyId, systemId, normalized } = input;
      if (systemId !== normalized.system.systemId) {
        throw new LevelStoreError(
          "invalid",
          "Rollback source does not match the requested system.",
        );
      }
      const systemKey = `${academyId}__${systemId}`;
      const system = systems.get(systemKey);
      const manifest = manifests.get(systemKey);
      if (system === undefined) {
        throw new LevelStoreError(
          "not-found",
          `Level system ${systemId} not found for academy ${academyId}`,
        );
      }
      if (manifest === undefined) {
        throw new LevelStoreError("conflict", "Stored level catalog manifest is missing.");
      }
      const storedPublication = publicationFromStoredManifest({
        academyId,
        normalized,
        storedManifest: manifest,
      });
      const storedDefinitions = Array.from(definitions.values())
        .filter(
          (definition) => definition.academyId === academyId && definition.systemId === systemId,
        )
        .map((definition) => ({
          id: String(definition.definitionKey),
          data: () => definition,
        }));
      const storedRequirements = Array.from(requirements.values())
        .filter(
          (requirement) => requirement.academyId === academyId && requirement.systemId === systemId,
        )
        .map((requirement) => ({
          id: String(requirement.requirementKey),
          data: () => requirement,
        }));
      assertStoredLevelCatalogIntegrity({
        publication: storedPublication.publication,
        storedSystem: system,
        storedManifest: manifest,
        storedDefinitions,
        storedRequirements,
      });
      const storedAudit = auditEvents.get(
        storedPublication.publication.manifest.publishedAuditEventId,
      );
      if (
        storedAudit === undefined ||
        !matchesAuditEventReplay(
          storedAudit,
          storedPublication.publication.manifest.publishedAuditEventId,
          storedPublication.publishedAudit,
        )
      ) {
        throw new LevelStoreError("conflict", "Stored level catalog publication audit is invalid.");
      }
      const definitionKeys = new Set(
        storedPublication.publication.definitions.map((definition) => definition.id),
      );
      if (
        Array.from(evaluations.values()).some(
          (evaluation) =>
            evaluation.academyId === academyId && definitionKeys.has(evaluation.definitionKey),
        ) ||
        Array.from(graduations.values()).some(
          (graduation) =>
            graduation.academyId === academyId &&
            (definitionKeys.has(graduation.fromDefinitionKey) ||
              definitionKeys.has(graduation.toDefinitionKey)),
        )
      ) {
        throw new LevelStoreError(
          "conflict",
          "Level catalog rollback is blocked by active references.",
        );
      }

      systems.delete(systemKey);
      manifests.delete(systemKey);

      let deletedDefs = 0;
      for (const [key, def] of definitions.entries()) {
        if (def["academyId"] === academyId && def["systemId"] === systemId) {
          definitions.delete(key);
          deletedDefs++;
        }
      }

      let deletedReqs = 0;
      for (const [key, req] of requirements.entries()) {
        if (req["academyId"] === academyId && req["systemId"] === systemId) {
          requirements.delete(key);
          deletedReqs++;
        }
      }
      const operationId = input.operationId ?? randomUUID();
      const rollbackAudit = levelCatalogAuditDraft({
        action: "level.catalog.rolled_back",
        academyId,
        systemId,
        operationId,
      });
      const rollbackAuditEventId = levelCatalogAuditEventId(rollbackAudit);
      auditEvents.set(
        rollbackAuditEventId,
        materializeInMemoryAuditEvent(rollbackAuditEventId, rollbackAudit),
      );

      return {
        systemId,
        deletedDefinitions: deletedDefs,
        deletedRequirements: deletedReqs,
        deletedSystems: 1,
      };
    },

    async recordEvaluation(params): Promise<EvaluationRecord> {
      assertValidAcademyId(params.academyId);
      const { academyId, input, evaluatorId, evaluatorRole } = params;
      const now = new Date().toISOString();
      const evaluatedAt = params.evaluatedAt ?? now;
      const evaluationId = buildEvaluationId(input.studentId, input.skillKey, evaluatedAt);

      const record: EvaluationRecord = {
        evaluationId,
        academyId,
        studentId: input.studentId,
        sessionId: input.sessionId,
        definitionKey: input.definitionKey,
        skillKey: input.skillKey,
        score: input.score,
        evidenceNotes: input.evidenceNotes,
        evaluatorId,
        evaluatorRole,
        evaluatedAt,
        schemaVersion: "1",
        createdAt: now,
        createdBy: evaluatorId,
        updatedAt: now,
        updatedBy: evaluatorId,
      };

      const key = `${academyId}__${input.studentId}__${evaluationId}`;
      evaluations.set(key, record);
      return record;
    },

    async listStudentEvaluations(
      academyId: string,
      studentId: string,
    ): Promise<readonly EvaluationRecord[]> {
      assertValidAcademyId(academyId);
      return Array.from(evaluations.values())
        .filter((e) => e.academyId === academyId && e.studentId === studentId)
        .sort((a, b) => b.evaluatedAt.localeCompare(a.evaluatedAt));
    },

    async getStudentSkillSummary(
      academyId: string,
      studentId: string,
    ): Promise<StudentSkillSummary> {
      const studentEvals = await this.listStudentEvaluations(academyId, studentId);
      const summary: Record<
        string,
        { count: number; maxScore: number; latestScore: number; lastEvaluatedAt: string }
      > = {};

      for (const ev of studentEvals) {
        const existing = summary[ev.skillKey];
        if (!existing) {
          summary[ev.skillKey] = {
            count: 1,
            maxScore: ev.score,
            latestScore: ev.score,
            lastEvaluatedAt: ev.evaluatedAt,
          };
        } else {
          existing.count += 1;
          if (ev.score > existing.maxScore) {
            existing.maxScore = ev.score;
          }
          if (ev.evaluatedAt > existing.lastEvaluatedAt) {
            existing.lastEvaluatedAt = ev.evaluatedAt;
            existing.latestScore = ev.score;
          }
        }
      }

      return summary;
    },

    async getStudentProgressSummary(
      academyId: string,
      studentId: string,
    ): Promise<StudentProgressSummary> {
      assertValidAcademyId(academyId);
      return buildUninitializedStudentProgressSummary(studentId);
    },

    async recordMedicalLeave(params): Promise<MedicalLeaveRecord> {
      const { academyId, input, recordedBy } = params;
      assertValidAcademyId(academyId);

      const leaveId = `leave_${input.studentId}_${Date.now()}`;
      const now = new Date().toISOString();
      const record: MedicalLeaveRecord = Object.freeze({
        leaveId,
        academyId,
        studentId: input.studentId,
        startDate: input.startDate,
        endDate: input.endDate,
        reasonCode: input.reasonCode,
        status: "active",
        schemaVersion: "1",
        recordedBy,
        recordedAt: now,
        createdAt: now,
        createdBy: recordedBy,
        updatedAt: now,
        updatedBy: recordedBy,
      });

      medicalLeaves.set(`${academyId}_${input.studentId}_${leaveId}`, record);
      return record;
    },

    async listMedicalLeaves(
      academyId: string,
      studentId: string,
    ): Promise<readonly MedicalLeaveRecord[]> {
      assertValidAcademyId(academyId);

      return Array.from(medicalLeaves.values())
        .filter((l) => l.academyId === academyId && l.studentId === studentId)
        .sort((a, b) => b.startDate.localeCompare(a.startDate));
    },

    async listRecognitionCandidates(academyId: string): Promise<readonly RecognitionCandidate[]> {
      assertValidAcademyId(academyId);

      const catalog = await this.listPublished(academyId);

      // In-memory: unique students from evaluations and leaves
      const studentIds = new Set<string>();
      for (const ev of evaluations.values()) {
        if (ev.academyId === academyId) studentIds.add(ev.studentId);
      }
      for (const ml of medicalLeaves.values()) {
        if (ml.academyId === academyId) studentIds.add(ml.studentId);
      }

      const students = Array.from(studentIds).map((id) => ({
        studentId: id,
        studentName: id,
        currentLevelStartedAt: null,
      }));

      const allEvaluations = Array.from(evaluations.values()).filter(
        (e) => e.academyId === academyId,
      );
      const allLeaves = Array.from(medicalLeaves.values()).filter((l) => l.academyId === academyId);

      return generateRecognitionCandidates({
        catalog,
        students,
        evaluations: allEvaluations,
        attendances: [],
        medicalLeaves: allLeaves,
      });
    },

    async approvePromotion(params): Promise<GraduationRecord> {
      const { academyId, input, decidedBy, decidedByRole, decidedAt } = params;
      assertValidAcademyId(academyId);

      const now = decidedAt ?? new Date().toISOString();
      const graduationId = buildGraduationId(input.studentId, input.toDefinitionKey, now);

      const record: GraduationRecord = Object.freeze({
        graduationId,
        academyId,
        studentId: input.studentId,
        fromDefinitionKey: input.fromDefinitionKey,
        toDefinitionKey: input.toDefinitionKey,
        status: "approved",
        decisionNotes: input.decisionNotes,
        decidedBy,
        decidedByRole,
        decidedAt: now,
        ceremonyDate: input.ceremonyDate ?? null,
        schemaVersion: "1",
        createdAt: now,
        createdBy: decidedBy,
        updatedAt: now,
        updatedBy: decidedBy,
      });

      graduations.set(`${academyId}_${input.studentId}_${graduationId}`, record);
      return record;
    },

    async rejectPromotion(params): Promise<GraduationRecord> {
      const { academyId, input, decidedBy, decidedByRole, decidedAt } = params;
      assertValidAcademyId(academyId);

      const now = decidedAt ?? new Date().toISOString();
      const graduationId = buildGraduationId(input.studentId, input.targetDefinitionKey, now);

      const record: GraduationRecord = Object.freeze({
        graduationId,
        academyId,
        studentId: input.studentId,
        fromDefinitionKey: "current",
        toDefinitionKey: input.targetDefinitionKey,
        status: "rejected",
        decisionNotes: input.decisionNotes,
        decidedBy,
        decidedByRole,
        decidedAt: now,
        ceremonyDate: null,
        schemaVersion: "1",
        createdAt: now,
        createdBy: decidedBy,
        updatedAt: now,
        updatedBy: decidedBy,
      });

      graduations.set(`${academyId}_${input.studentId}_${graduationId}`, record);
      return record;
    },

    async listGraduations(
      academyId: string,
      studentId?: string,
    ): Promise<readonly GraduationRecord[]> {
      assertValidAcademyId(academyId);

      return Array.from(graduations.values())
        .filter((g) => g.academyId === academyId && (!studentId || g.studentId === studentId))
        .sort((a, b) => b.decidedAt.localeCompare(a.decidedAt));
    },
  };
}
