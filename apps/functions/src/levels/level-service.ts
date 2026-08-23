import {
  buildEvaluationId,
  buildGraduationId,
  buildStudentProgressSummary,
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
import type { NormalizedLevelCatalog } from "./level-source";

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
  }) => Promise<LevelSeedResult>;
  rollback: (input: { academyId: string; systemId: string }) => Promise<LevelRollbackResult>;
  recordEvaluation: (params: {
    academyId: string;
    input: RecordEvaluationInput;
    evaluatorId: string;
    evaluatorRole: "owner" | "administrator" | "headCoach" | "coach";
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
    currentDefinitionKey?: string,
    currentLevelStartedAt?: string | null,
    attendedClassesCount?: number,
    totalHours?: number,
  ) => Promise<StudentProgressSummary>;
  recordMedicalLeave: (params: {
    academyId: string;
    input: RecordMedicalLeaveInput;
    recordedBy: string;
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
    decidedByRole: "owner" | "headCoach";
    decidedAt?: string;
  }) => Promise<GraduationRecord>;
  rejectPromotion: (params: {
    academyId: string;
    input: RejectPromotionInput;
    decidedBy: string;
    decidedByRole: "owner" | "headCoach";
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

export type GenericFirestore = {
  doc: (path: string) => {
    get: () => Promise<{ exists: boolean; data: () => Record<string, unknown> | undefined }>;
    set: (data: Record<string, unknown>) => Promise<unknown>;
    delete: () => Promise<unknown>;
  };
  collection: (path: string) => {
    get: () => Promise<{
      docs: readonly {
        id: string;
        data: () => Record<string, unknown>;
        ref: { delete: () => Promise<unknown> };
      }[];
    }>;
  };
  batch: () => {
    set: (ref: unknown, data: unknown, options?: unknown) => void;
    delete: (ref: unknown) => void;
    commit: () => Promise<unknown>;
  };
};

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
    }): Promise<LevelSeedResult> {
      assertValidAcademyId(input.academyId);
      const { academyId, normalized } = input;
      const systemId = normalized.system.systemId;

      const systemRef = firestore.doc(`academies/${academyId}/levelSystems/${systemId}`);
      const systemSnap = await systemRef.get();

      if (systemSnap.exists) {
        const existingData = systemSnap.data();
        const existingHash = existingData?.["sourceHash"];
        if (existingHash === normalized.sourceHash) {
          return {
            systemId,
            sourceHash: normalized.sourceHash,
            definitionCount: normalized.definitions.length,
            beltCount: normalized.definitions.filter((d) => d.kind === "belt").length,
            stripeCount: normalized.definitions.filter((d) => d.kind === "stripe").length,
            skillCount: normalized.skills.length,
            requirementCount: normalized.requirements.length,
            idempotent: true,
          };
        } else {
          throw new LevelStoreError(
            "conflict",
            `System ${systemId} already exists with a different source hash.`,
          );
        }
      }

      // Write system document
      await systemRef.set({
        ...normalized.system,
        academyId,
        sourceHash: normalized.sourceHash,
        status: "published",
      });

      // Write definitions and requirements in chunks if needed
      for (const def of normalized.definitions) {
        const defRef = firestore.doc(
          `academies/${academyId}/levelDefinitions/${def.definitionKey}`,
        );
        await defRef.set({ ...def, academyId });
      }

      for (const req of normalized.requirements) {
        const reqRef = firestore.doc(
          `academies/${academyId}/levelRequirements/${req.requirementKey}`,
        );
        await reqRef.set({ ...req, academyId });
      }

      return {
        systemId,
        sourceHash: normalized.sourceHash,
        definitionCount: normalized.definitions.length,
        beltCount: normalized.definitions.filter((d) => d.kind === "belt").length,
        stripeCount: normalized.definitions.filter((d) => d.kind === "stripe").length,
        skillCount: normalized.skills.length,
        requirementCount: normalized.requirements.length,
        idempotent: false,
      };
    },

    async rollback(input: { academyId: string; systemId: string }): Promise<LevelRollbackResult> {
      assertValidAcademyId(input.academyId);
      const { academyId, systemId } = input;

      const systemRef = firestore.doc(`academies/${academyId}/levelSystems/${systemId}`);
      const systemSnap = await systemRef.get();
      if (!systemSnap.exists) {
        throw new LevelStoreError(
          "not-found",
          `Level system ${systemId} does not exist in academy ${academyId}`,
        );
      }

      const defsSnap = await firestore.collection(`academies/${academyId}/levelDefinitions`).get();
      let deletedDefs = 0;
      for (const doc of defsSnap.docs) {
        if (doc.data()["systemId"] === systemId) {
          await doc.ref.delete();
          deletedDefs++;
        }
      }

      const reqsSnap = await firestore.collection(`academies/${academyId}/levelRequirements`).get();
      let deletedReqs = 0;
      for (const doc of reqsSnap.docs) {
        if (doc.data()["systemId"] === systemId) {
          await doc.ref.delete();
          deletedReqs++;
        }
      }

      await systemRef.delete();

      return {
        systemId,
        deletedDefinitions: deletedDefs,
        deletedRequirements: deletedReqs,
        deletedSystems: 1,
      };
    },

    async recordEvaluation(params: {
      academyId: string;
      input: RecordEvaluationInput;
      evaluatorId: string;
      evaluatorRole: "owner" | "administrator" | "headCoach" | "coach";
      evaluatedAt?: string;
    }): Promise<EvaluationRecord> {
      assertValidAcademyId(params.academyId);
      const { academyId, input, evaluatorId, evaluatorRole } = params;
      const now = new Date().toISOString();
      const evaluatedAt = params.evaluatedAt ?? now;
      const evaluationId = buildEvaluationId(input.studentId, input.skillKey, evaluatedAt);

      const record: EvaluationRecord = {
        evaluationId,
        academyId,
        studentId: input.studentId,
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

      await firestore
        .doc(`academies/${academyId}/students/${input.studentId}/evaluations/${evaluationId}`)
        .set(record as unknown as Record<string, unknown>);

      // Write audit event
      const auditRef = firestore.doc(
        `academies/${academyId}/auditEvents/audit_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      );
      await auditRef.set({
        action: "skill_evaluated",
        actorId: evaluatorId,
        actorRole: evaluatorRole,
        targetId: evaluationId,
        studentId: input.studentId,
        skillKey: input.skillKey,
        score: input.score,
        timestamp: now,
      });

      return record;
    },

    async listStudentEvaluations(
      academyId: string,
      studentId: string,
    ): Promise<readonly EvaluationRecord[]> {
      assertValidAcademyId(academyId);
      const snapshot = await firestore
        .collection(`academies/${academyId}/students/${studentId}/evaluations`)
        .get();

      return snapshot.docs
        .map((d) => d.data() as unknown as EvaluationRecord)
        .sort((a, b) => b.evaluatedAt.localeCompare(a.evaluatedAt));
    },

    async getStudentSkillSummary(
      academyId: string,
      studentId: string,
    ): Promise<StudentSkillSummary> {
      const evaluations = await this.listStudentEvaluations(academyId, studentId);
      const summary: Record<
        string,
        { count: number; maxScore: number; latestScore: number; lastEvaluatedAt: string }
      > = {};

      for (const ev of evaluations) {
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
      currentDefinitionKey?: string,
      currentLevelStartedAt?: string | null,
      attendedClassesCount?: number,
      totalHours?: number,
    ): Promise<StudentProgressSummary> {
      assertValidAcademyId(academyId);

      const [catalog, evaluations] = await Promise.all([
        this.listPublished(academyId),
        this.listStudentEvaluations(academyId, studentId),
      ]);

      // If attendedClassesCount not provided, count attendance records for this student
      let classesCount = attendedClassesCount;
      if (classesCount === undefined) {
        const attendanceSnap = await firestore
          .collection(`academies/${academyId}/attendance`)
          .get();

        classesCount = attendanceSnap.docs.filter((d) => {
          const data = d.data();
          const status = data["status"];
          return data["studentId"] === studentId && (status === "attended" || status === "late");
        }).length;
      }

      const effectiveHours = totalHours ?? (classesCount ?? 0) * 1.5;
      const effectiveDefKey =
        currentDefinitionKey ?? catalog.definitions[0]?.definitionKey ?? "white-0";

      return buildStudentProgressSummary({
        catalog,
        studentId,
        currentDefinitionKey: effectiveDefKey,
        evaluations,
        attendedClassesCount: classesCount ?? 0,
        totalHours: effectiveHours,
        currentLevelStartedAt: currentLevelStartedAt ?? null,
      });
    },

    async recordMedicalLeave(params: {
      academyId: string;
      input: RecordMedicalLeaveInput;
      recordedBy: string;
    }): Promise<MedicalLeaveRecord> {
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
        reason: input.reason,
        recordedBy,
        recordedAt: now,
      });

      const batch = firestore.batch();
      batch.set(
        firestore.doc(
          `academies/${academyId}/students/${input.studentId}/medicalLeaves/${leaveId}`,
        ),
        record,
      );

      const auditEventId = `evt_medleave_${leaveId}`;
      batch.set(firestore.doc(`academies/${academyId}/auditEvents/${auditEventId}`), {
        eventId: auditEventId,
        academyId,
        action: "medical_leave_recorded",
        actorId: recordedBy,
        timestamp: now,
        details: {
          leaveId,
          studentId: input.studentId,
          startDate: input.startDate,
          endDate: input.endDate,
        },
      });

      await batch.commit();
      return record;
    },

    async listMedicalLeaves(
      academyId: string,
      studentId: string,
    ): Promise<readonly MedicalLeaveRecord[]> {
      assertValidAcademyId(academyId);

      const snapshot = await firestore
        .collection(`academies/${academyId}/students/${studentId}/medicalLeaves`)
        .get();

      return snapshot.docs
        .map((doc) => doc.data() as unknown as MedicalLeaveRecord)
        .sort((a, b) => b.startDate.localeCompare(a.startDate));
    },

    async listRecognitionCandidates(academyId: string): Promise<readonly RecognitionCandidate[]> {
      assertValidAcademyId(academyId);

      const catalog = await this.listPublished(academyId);

      // Fetch students from members collection
      const membersSnap = await firestore.collection(`academies/${academyId}/members`).get();
      const students = membersSnap.docs.map((doc) => {
        const data = doc.data();
        const firstName = typeof data["firstName"] === "string" ? data["firstName"] : "";
        const lastName = typeof data["lastName"] === "string" ? data["lastName"] : "";
        const fullName = `${firstName} ${lastName}`.trim() || doc.id;
        return {
          studentId: doc.id,
          studentName: fullName,
          currentDefinitionKey:
            typeof data["currentLevel"] === "string" ? data["currentLevel"] : undefined,
          currentLevelStartedAt:
            typeof data["currentLevelStartedAt"] === "string"
              ? data["currentLevelStartedAt"]
              : null,
        };
      });

      // Fetch attendance
      const attendanceSnap = await firestore.collection(`academies/${academyId}/attendance`).get();
      const attendances = attendanceSnap.docs
        .filter((d) => {
          const status = d.data()["status"];
          return status === "attended" || status === "late";
        })
        .map((d) => {
          const data = d.data();
          return {
            studentId: String(data["studentId"]),
            attendedAt: String(
              data["attendedAt"] ?? data["sessionDate"] ?? new Date().toISOString(),
            ),
          };
        });

      // Fetch all evaluations across students
      const allEvaluations: EvaluationRecord[] = [];
      const allLeaves: MedicalLeaveRecord[] = [];

      for (const st of students) {
        const [evals, leaves] = await Promise.all([
          this.listStudentEvaluations(academyId, st.studentId),
          this.listMedicalLeaves(academyId, st.studentId),
        ]);
        allEvaluations.push(...evals);
        allLeaves.push(...leaves);
      }

      return generateRecognitionCandidates({
        catalog,
        students,
        evaluations: allEvaluations,
        attendances,
        medicalLeaves: allLeaves,
      });
    },

    async approvePromotion(params: {
      academyId: string;
      input: ApprovePromotionInput;
      decidedBy: string;
      decidedByRole: "owner" | "headCoach";
      decidedAt?: string;
    }): Promise<GraduationRecord> {
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

      const batch = firestore.batch();
      batch.set(
        firestore.doc(
          `academies/${academyId}/students/${input.studentId}/graduations/${graduationId}`,
        ),
        record,
      );

      // Update student's current level
      batch.set(
        firestore.doc(`academies/${academyId}/members/${input.studentId}`),
        {
          currentLevel: input.toDefinitionKey,
          currentLevelStartedAt: now,
          updatedAt: now,
          updatedBy: decidedBy,
        },
        { merge: true },
      );

      const auditEventId = `evt_grad_${graduationId}`;
      batch.set(firestore.doc(`academies/${academyId}/auditEvents/${auditEventId}`), {
        eventId: auditEventId,
        academyId,
        action: "promotion_approved",
        actorId: decidedBy,
        timestamp: now,
        details: {
          studentId: input.studentId,
          fromDefinitionKey: input.fromDefinitionKey,
          toDefinitionKey: input.toDefinitionKey,
          graduationId,
        },
      });

      await batch.commit();
      return record;
    },

    async rejectPromotion(params: {
      academyId: string;
      input: RejectPromotionInput;
      decidedBy: string;
      decidedByRole: "owner" | "headCoach";
      decidedAt?: string;
    }): Promise<GraduationRecord> {
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

      const batch = firestore.batch();
      batch.set(
        firestore.doc(
          `academies/${academyId}/students/${input.studentId}/graduations/${graduationId}`,
        ),
        record,
      );

      const auditEventId = `evt_grad_rej_${graduationId}`;
      batch.set(firestore.doc(`academies/${academyId}/auditEvents/${auditEventId}`), {
        eventId: auditEventId,
        academyId,
        action: "promotion_rejected",
        actorId: decidedBy,
        timestamp: now,
        details: {
          studentId: input.studentId,
          targetDefinitionKey: input.targetDefinitionKey,
          graduationId,
        },
      });

      await batch.commit();
      return record;
    },

    async listGraduations(
      academyId: string,
      studentId?: string,
    ): Promise<readonly GraduationRecord[]> {
      assertValidAcademyId(academyId);

      if (studentId) {
        const snap = await firestore
          .collection(`academies/${academyId}/students/${studentId}/graduations`)
          .get();

        return snap.docs
          .map((d) => d.data() as unknown as GraduationRecord)
          .sort((a, b) => b.decidedAt.localeCompare(a.decidedAt));
      }

      // Fetch from all members
      const membersSnap = await firestore.collection(`academies/${academyId}/members`).get();
      const allGraduations: GraduationRecord[] = [];

      for (const m of membersSnap.docs) {
        const snap = await firestore
          .collection(`academies/${academyId}/students/${m.id}/graduations`)
          .get();
        allGraduations.push(...snap.docs.map((d) => d.data() as unknown as GraduationRecord));
      }

      return allGraduations.sort((a, b) => b.decidedAt.localeCompare(a.decidedAt));
    },
  };
}

export function createInMemoryLevelStore(): LevelCatalogStore {
  const systems = new Map<string, Record<string, unknown>>();
  const definitions = new Map<string, Record<string, unknown>>();
  const requirements = new Map<string, Record<string, unknown>>();
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
    }): Promise<LevelSeedResult> {
      assertValidAcademyId(input.academyId);
      const { academyId, normalized } = input;
      const systemKey = `${academyId}__${normalized.system.systemId}`;

      const existing = systems.get(systemKey);
      if (existing) {
        if (existing["sourceHash"] === normalized.sourceHash) {
          return {
            systemId: normalized.system.systemId,
            sourceHash: normalized.sourceHash,
            definitionCount: normalized.definitions.length,
            beltCount: normalized.definitions.filter((d) => d.kind === "belt").length,
            stripeCount: normalized.definitions.filter((d) => d.kind === "stripe").length,
            skillCount: normalized.skills.length,
            requirementCount: normalized.requirements.length,
            idempotent: true,
          };
        } else {
          throw new LevelStoreError(
            "conflict",
            `System ${normalized.system.systemId} already exists with a different source hash.`,
          );
        }
      }

      systems.set(systemKey, {
        ...normalized.system,
        academyId,
        sourceHash: normalized.sourceHash,
        status: "published",
      });

      for (const def of normalized.definitions) {
        const defKey = `${academyId}__${def.definitionKey}`;
        definitions.set(defKey, { ...def, academyId });
      }

      for (const req of normalized.requirements) {
        const reqKey = `${academyId}__${req.requirementKey}`;
        requirements.set(reqKey, { ...req, academyId });
      }

      return {
        systemId: normalized.system.systemId,
        sourceHash: normalized.sourceHash,
        definitionCount: normalized.definitions.length,
        beltCount: normalized.definitions.filter((d) => d.kind === "belt").length,
        stripeCount: normalized.definitions.filter((d) => d.kind === "stripe").length,
        skillCount: normalized.skills.length,
        requirementCount: normalized.requirements.length,
        idempotent: false,
      };
    },

    async rollback(input: { academyId: string; systemId: string }): Promise<LevelRollbackResult> {
      assertValidAcademyId(input.academyId);
      const { academyId, systemId } = input;
      const systemKey = `${academyId}__${systemId}`;

      if (!systems.has(systemKey)) {
        throw new LevelStoreError(
          "not-found",
          `Level system ${systemId} not found for academy ${academyId}`,
        );
      }

      systems.delete(systemKey);

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

      return {
        systemId,
        deletedDefinitions: deletedDefs,
        deletedRequirements: deletedReqs,
        deletedSystems: 1,
      };
    },

    async recordEvaluation(params: {
      academyId: string;
      input: RecordEvaluationInput;
      evaluatorId: string;
      evaluatorRole: "owner" | "administrator" | "headCoach" | "coach";
      evaluatedAt?: string;
    }): Promise<EvaluationRecord> {
      assertValidAcademyId(params.academyId);
      const { academyId, input, evaluatorId, evaluatorRole } = params;
      const now = new Date().toISOString();
      const evaluatedAt = params.evaluatedAt ?? now;
      const evaluationId = buildEvaluationId(input.studentId, input.skillKey, evaluatedAt);

      const record: EvaluationRecord = {
        evaluationId,
        academyId,
        studentId: input.studentId,
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
      currentDefinitionKey?: string,
      currentLevelStartedAt?: string | null,
      attendedClassesCount?: number,
      totalHours?: number,
    ): Promise<StudentProgressSummary> {
      assertValidAcademyId(academyId);

      const [catalog, evaluations] = await Promise.all([
        this.listPublished(academyId),
        this.listStudentEvaluations(academyId, studentId),
      ]);

      const classesCount = attendedClassesCount ?? 0;
      const effectiveHours = totalHours ?? classesCount * 1.5;
      const effectiveDefKey =
        currentDefinitionKey ?? catalog.definitions[0]?.definitionKey ?? "white-0";

      return buildStudentProgressSummary({
        catalog,
        studentId,
        currentDefinitionKey: effectiveDefKey,
        evaluations,
        attendedClassesCount: classesCount,
        totalHours: effectiveHours,
        currentLevelStartedAt: currentLevelStartedAt ?? null,
      });
    },

    async recordMedicalLeave(params: {
      academyId: string;
      input: RecordMedicalLeaveInput;
      recordedBy: string;
    }): Promise<MedicalLeaveRecord> {
      const { academyId, input, recordedBy } = params;
      assertValidAcademyId(academyId);

      const leaveId = `leave_${input.studentId}_${Date.now()}`;
      const record: MedicalLeaveRecord = Object.freeze({
        leaveId,
        academyId,
        studentId: input.studentId,
        startDate: input.startDate,
        endDate: input.endDate,
        reason: input.reason,
        recordedBy,
        recordedAt: new Date().toISOString(),
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
        currentDefinitionKey: catalog.definitions[0]?.definitionKey,
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

    async approvePromotion(params: {
      academyId: string;
      input: ApprovePromotionInput;
      decidedBy: string;
      decidedByRole: "owner" | "headCoach";
      decidedAt?: string;
    }): Promise<GraduationRecord> {
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

    async rejectPromotion(params: {
      academyId: string;
      input: RejectPromotionInput;
      decidedBy: string;
      decidedByRole: "owner" | "headCoach";
      decidedAt?: string;
    }): Promise<GraduationRecord> {
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
