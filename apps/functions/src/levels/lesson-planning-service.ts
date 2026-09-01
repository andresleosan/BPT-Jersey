import { parseAuditEventDraft, type AuditEventDraft } from "@bpt-jersey/domain/audit";
import { appendAuditEventInTransaction } from "../audit/audit-writer.js";

import {
  approveLessonPlan,
  parseLessonPlanRecord,
  parseTechniqueLibraryVersion,
  type ApproveLessonPlanInput,
  type LessonPlanRecord,
  type TechniqueLibraryVersion,
} from "@bpt-jersey/domain/levels/lesson-planning";

export class LessonPlanningStoreError extends Error {
  public readonly code: "invalid" | "tenant" | "not-found" | "conflict";

  public constructor(code: "invalid" | "tenant" | "not-found" | "conflict", message: string) {
    super(message);
    this.name = "LessonPlanningStoreError";
    this.code = code;
  }
}

export type LessonPlanningWriteResult = Readonly<{ idempotent: boolean }>;

export type LessonPlanningStore = Readonly<{
  getLibrary: (
    academyId: string,
    libraryId: string,
    version: number,
  ) => Promise<TechniqueLibraryVersion>;
  saveLibrary: (input: {
    academyId: string;
    library: TechniqueLibraryVersion;
  }) => Promise<LessonPlanningWriteResult>;
  getPlan: (academyId: string, planId: string) => Promise<LessonPlanRecord>;
  savePlan: (plan: LessonPlanRecord) => Promise<LessonPlanningWriteResult>;
  approvePlan: (input: {
    academyId: string;
    planId: string;
    input: ApproveLessonPlanInput;
  }) => Promise<LessonPlanRecord>;
}>;

type LibraryDocument = Readonly<{
  academyId: string;
  schemaVersion: 1;
  libraryId: string;
  version: number;
  status: TechniqueLibraryVersion["status"];
  publishedAt: string | null;
  techniques: readonly TechniqueLibraryVersion["techniques"][number][];
}>;

type PlanDocument = LessonPlanRecord & Readonly<{ schemaVersion: 1 }>;

const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

function assertIdentifier(value: string, label: string): void {
  if (!identifierPattern.test(value)) {
    throw new LessonPlanningStoreError("invalid", `${label} is invalid`);
  }
}

function assertVersion(version: number): void {
  if (!Number.isSafeInteger(version) || version < 1) {
    throw new LessonPlanningStoreError("invalid", "library version is invalid");
  }
}

function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function normalizeLibrary(library: TechniqueLibraryVersion): TechniqueLibraryVersion {
  const parsed = parseTechniqueLibraryVersion(library);
  if (!parsed.ok) {
    throw new LessonPlanningStoreError("invalid", "Technique library is invalid");
  }
  return parsed.value;
}

function libraryDocument(academyId: string, library: TechniqueLibraryVersion): LibraryDocument {
  return Object.freeze({ academyId, schemaVersion: 1, ...library });
}

function planDocument(plan: LessonPlanRecord): PlanDocument {
  return Object.freeze({ ...plan, schemaVersion: 1 });
}

function approvalAuditEventId(academyId: string, planId: string, approvedAt: string): string {
  return "lesson-plan-approved-v1__" + academyId + "__" + planId + "__" + approvedAt;
}

function buildApprovalAuditDraft(
  academyId: string,
  plan: LessonPlanRecord,
  input: ApproveLessonPlanInput,
): AuditEventDraft {
  const draft = {
    academyId,
    actorId: input.staffId,
    action: "lesson.plan.approved" as const,
    targetRef: "academies/" + academyId + "/lessonPlans/" + plan.planId,
    purpose: "lesson plan approval",
    correlationId: "lesson-plan:" + academyId + ":" + plan.planId + ":" + input.approvedAt,
    planId: plan.planId,
    libraryId: plan.libraryId,
    libraryVersion: plan.libraryVersion,
    approvedAt: input.approvedAt,
  };
  const parsed = parseAuditEventDraft(draft);
  if (!parsed.ok) {
    throw new LessonPlanningStoreError("invalid", "Lesson plan approval audit is invalid");
  }
  return parsed.value;
}
function parseLibraryDocument(
  academyId: string,
  libraryId: string,
  version: number,
  data: Record<string, unknown> | undefined,
): TechniqueLibraryVersion {
  if (
    data === undefined ||
    Object.keys(data).length !== 7 ||
    data.academyId !== academyId ||
    data.schemaVersion !== 1 ||
    data.libraryId !== libraryId ||
    data.version !== version
  ) {
    throw new LessonPlanningStoreError("invalid", "Persisted technique library is invalid");
  }
  const parsed = parseTechniqueLibraryVersion({
    libraryId: data.libraryId,
    version: data.version,
    status: data.status,
    publishedAt: data.publishedAt,
    techniques: data.techniques,
  });
  if (!parsed.ok) {
    throw new LessonPlanningStoreError("invalid", "Persisted technique library is invalid");
  }
  return parsed.value;
}

function parsePlanDocument(
  academyId: string,
  planId: string,
  data: Record<string, unknown> | undefined,
  library: TechniqueLibraryVersion,
): LessonPlanRecord {
  if (
    data === undefined ||
    Object.keys(data).length !== 10 ||
    data.schemaVersion !== 1 ||
    data.academyId !== academyId ||
    data.planId !== planId
  ) {
    throw new LessonPlanningStoreError("invalid", "Persisted lesson plan is invalid");
  }
  const parsed = parseLessonPlanRecord(
    {
      planId: data.planId,
      academyId: data.academyId,
      title: data.title,
      libraryId: data.libraryId,
      libraryVersion: data.libraryVersion,
      status: data.status,
      activities: data.activities,
      approvedByStaffId: data.approvedByStaffId,
      approvedAt: data.approvedAt,
    },
    library,
  );
  if (!parsed.ok) throw new LessonPlanningStoreError("invalid", "Persisted lesson plan is invalid");
  return parsed.value;
}

function validatePlan(academyId: string, plan: LessonPlanRecord, library: TechniqueLibraryVersion) {
  assertIdentifier(plan.planId, "planId");
  if (plan.academyId !== academyId) {
    throw new LessonPlanningStoreError("tenant", "Lesson plan belongs to another academy");
  }
  const parsed = parseLessonPlanRecord(plan, library);
  if (!parsed.ok) throw new LessonPlanningStoreError("invalid", "Lesson plan is invalid");
  return parsed.value;
}

export function createInMemoryLessonPlanningStore(): LessonPlanningStore {
  const libraries = new Map<string, TechniqueLibraryVersion>();
  const plans = new Map<string, LessonPlanRecord>();
  const approvalAudits = new Map<string, AuditEventDraft>();
  const libraryKey = (academyId: string, libraryId: string, version: number) =>
    `${academyId}/${libraryId}/${version}`;
  const planKey = (academyId: string, planId: string) => `${academyId}/${planId}`;

  return {
    async getLibrary(academyId, libraryId, version) {
      assertIdentifier(academyId, "academyId");
      assertIdentifier(libraryId, "libraryId");
      assertVersion(version);
      const library = libraries.get(libraryKey(academyId, libraryId, version));
      if (!library) throw new LessonPlanningStoreError("not-found", "Technique library not found");
      return library;
    },
    async saveLibrary({ academyId, library }) {
      assertIdentifier(academyId, "academyId");
      const normalized = normalizeLibrary(library);
      const key = libraryKey(academyId, normalized.libraryId, normalized.version);
      const existing = libraries.get(key);
      if (existing) {
        if (!same(existing, normalized)) {
          throw new LessonPlanningStoreError("conflict", "Technique library write conflicts");
        }
        return Object.freeze({ idempotent: true });
      }
      libraries.set(key, normalized);
      return Object.freeze({ idempotent: false });
    },
    async getPlan(academyId, planId) {
      assertIdentifier(academyId, "academyId");
      assertIdentifier(planId, "planId");
      const plan = plans.get(planKey(academyId, planId));
      if (!plan) throw new LessonPlanningStoreError("not-found", "Lesson plan not found");
      return plan;
    },
    async savePlan(plan) {
      assertIdentifier(plan.academyId, "academyId");
      const library = await this.getLibrary(plan.academyId, plan.libraryId, plan.libraryVersion);
      const normalized = validatePlan(plan.academyId, plan, library);
      const key = planKey(plan.academyId, normalized.planId);
      const existing = plans.get(key);
      if (existing) {
        if (!same(existing, normalized)) {
          throw new LessonPlanningStoreError("conflict", "Lesson plan write conflicts");
        }
        return Object.freeze({ idempotent: true });
      }
      plans.set(key, normalized);
      return Object.freeze({ idempotent: false });
    },
    async approvePlan({ academyId, planId, input }) {
      const current = await this.getPlan(academyId, planId);
      const library = await this.getLibrary(academyId, current.libraryId, current.libraryVersion);
      if (current.status === "approved") {
        throw new LessonPlanningStoreError("conflict", "Lesson plan is already approved");
      }
      const approved = approveLessonPlan(current, input);
      if (!approved.ok) {
        throw new LessonPlanningStoreError("invalid", "Lesson plan approval is invalid");
      }
      const normalized = validatePlan(academyId, approved.value, library);
      const audit = buildApprovalAuditDraft(academyId, normalized, input);
      approvalAudits.set(approvalAuditEventId(academyId, planId, input.approvedAt), audit);
      plans.set(planKey(academyId, planId), normalized);
      return normalized;
    },
  };
}

type GenericDocumentReference = Readonly<{
  id: string;
  get: () => Promise<{
    exists: boolean;
    data: () => Record<string, unknown> | undefined;
  }>;
}>;

type GenericTransaction = Readonly<{
  get: (reference: GenericDocumentReference) => Promise<{
    exists: boolean;
    data: () => Record<string, unknown> | undefined;
  }>;
  create: (reference: GenericDocumentReference, data: Readonly<Record<string, unknown>>) => void;
  update: (reference: GenericDocumentReference, data: Readonly<Record<string, unknown>>) => void;
}>;

export type GenericLessonPlanningFirestore = Readonly<{
  doc: (path: string) => GenericDocumentReference;
  runTransaction: <T>(update: (transaction: GenericTransaction) => Promise<T>) => Promise<T>;
}>;

function libraryPath(academyId: string, libraryId: string, version: number): string {
  return `academies/${academyId}/techniqueLibraries/${libraryId}__${version}`;
}

function planPath(academyId: string, planId: string): string {
  return `academies/${academyId}/lessonPlans/${planId}`;
}

function auditEventPath(academyId: string, eventId: string): string {
  return "academies/" + academyId + "/auditEvents/" + eventId;
}
export function createFirestoreLessonPlanningStore({
  firestore,
}: {
  firestore: GenericLessonPlanningFirestore;
}): LessonPlanningStore {
  return {
    async getLibrary(academyId, libraryId, version) {
      assertIdentifier(academyId, "academyId");
      assertIdentifier(libraryId, "libraryId");
      assertVersion(version);
      const snapshot = await firestore.doc(libraryPath(academyId, libraryId, version)).get();
      if (!snapshot.exists)
        throw new LessonPlanningStoreError("not-found", "Technique library not found");
      return parseLibraryDocument(academyId, libraryId, version, snapshot.data());
    },
    async saveLibrary({ academyId, library }) {
      assertIdentifier(academyId, "academyId");
      const normalized = normalizeLibrary(library);
      const reference = firestore.doc(
        libraryPath(academyId, normalized.libraryId, normalized.version),
      );
      const document = libraryDocument(academyId, normalized);
      return firestore.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(reference);
        if (snapshot.exists) {
          const existing = parseLibraryDocument(
            academyId,
            normalized.libraryId,
            normalized.version,
            snapshot.data(),
          );
          if (!same(existing, normalized)) {
            throw new LessonPlanningStoreError("conflict", "Technique library write conflicts");
          }
          return Object.freeze({ idempotent: true });
        }
        transaction.create(reference, document);
        return Object.freeze({ idempotent: false });
      });
    },
    async getPlan(academyId, planId) {
      assertIdentifier(academyId, "academyId");
      assertIdentifier(planId, "planId");
      const snapshot = await firestore.doc(planPath(academyId, planId)).get();
      if (!snapshot.exists)
        throw new LessonPlanningStoreError("not-found", "Lesson plan not found");
      const data = snapshot.data();
      if (
        data === undefined ||
        typeof data.libraryId !== "string" ||
        typeof data.libraryVersion !== "number"
      ) {
        throw new LessonPlanningStoreError("invalid", "Persisted lesson plan is invalid");
      }
      const library = await this.getLibrary(academyId, data.libraryId, data.libraryVersion);
      return parsePlanDocument(academyId, planId, data, library);
    },
    async savePlan(plan) {
      assertIdentifier(plan.academyId, "academyId");
      const library = await this.getLibrary(plan.academyId, plan.libraryId, plan.libraryVersion);
      const normalized = validatePlan(plan.academyId, plan, library);
      const reference = firestore.doc(planPath(plan.academyId, normalized.planId));
      const document = planDocument(normalized);
      return firestore.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(reference);
        if (snapshot.exists) {
          const existing = parsePlanDocument(
            plan.academyId,
            normalized.planId,
            snapshot.data(),
            library,
          );
          if (!same(existing, normalized)) {
            throw new LessonPlanningStoreError("conflict", "Lesson plan write conflicts");
          }
          return Object.freeze({ idempotent: true });
        }
        transaction.create(reference, document);
        return Object.freeze({ idempotent: false });
      });
    },
    async approvePlan({ academyId, planId, input }) {
      assertIdentifier(academyId, "academyId");
      assertIdentifier(planId, "planId");
      const reference = firestore.doc(planPath(academyId, planId));
      const auditEventId = approvalAuditEventId(academyId, planId, input.approvedAt);
      const auditReference = firestore.doc(auditEventPath(academyId, auditEventId));
      return firestore.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(reference);
        const auditState = await transaction.get(auditReference);
        if (!snapshot.exists)
          throw new LessonPlanningStoreError("not-found", "Lesson plan not found");
        const data = snapshot.data();
        if (
          data === undefined ||
          typeof data.libraryId !== "string" ||
          typeof data.libraryVersion !== "number"
        ) {
          throw new LessonPlanningStoreError("invalid", "Persisted lesson plan is invalid");
        }
        const libraryReference = firestore.doc(
          libraryPath(academyId, data.libraryId, data.libraryVersion),
        );
        const librarySnapshot = await transaction.get(libraryReference);
        if (!librarySnapshot.exists) {
          throw new LessonPlanningStoreError("not-found", "Technique library not found");
        }
        const library = parseLibraryDocument(
          academyId,
          data.libraryId,
          data.libraryVersion,
          librarySnapshot.data(),
        );
        const current = parsePlanDocument(academyId, planId, data, library);
        if (auditState.exists) {
          throw new LessonPlanningStoreError(
            "conflict",
            "Lesson plan approval audit already exists",
          );
        }
        if (current.status === "approved") {
          throw new LessonPlanningStoreError("conflict", "Lesson plan is already approved");
        }
        const approved = approveLessonPlan(current, input);
        if (!approved.ok) {
          throw new LessonPlanningStoreError("invalid", "Lesson plan approval is invalid");
        }
        const normalized = validatePlan(academyId, approved.value, library);
        const audit = buildApprovalAuditDraft(academyId, normalized, input);
        transaction.update(reference, planDocument(normalized));
        appendAuditEventInTransaction(transaction, auditReference, audit);
        return normalized;
      });
    },
  };
}
