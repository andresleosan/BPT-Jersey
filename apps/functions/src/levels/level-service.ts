import { createHash, randomUUID } from "node:crypto";

import {
  ageInCompletedYears,
  buildEvaluationId,
  buildGraduationId,
  buildStudentProgressSummary,
  buildUninitializedStudentProgressSummary,
  countClassesAtLevel,
  daysAtLevel,
  generateRecognitionCandidates,
  historyFreeTextSchema,
  importedBaselineSchema,
  isLevelCalendarDate,
  jerseyDateOf,
  latestSkillRatings,
  levelHistoryEntrySchema,
  listPromotionGaps,
  minimumDaysOf,
  promotionNoteSchema,
  assessmentEvidenceNotesSchema,
  recordSkillRatingsInputSchema,
  skillRatingsSchema,
  studentLevelHistorySchema,
  type ImportedBaseline,
  type ApprovePromotionInput,
  type LevelHistoryEntry,
  type StudentLevelHistory,
  type VoidPromotionInput,
  type VoidPromotionResult,
  type AssignLevelInput,
  type AssignLevelResult,
  type OpenStudentLevelInput,
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
  type RecordSkillRatingsInput,
  type RecordSkillRatingsResult,
  type RejectPromotionInput,
  type StudentProgressSummary,
  evaluateAgeBand,
  type AgeBandEvaluation,
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
    evaluatorStaffId: string | null;
    evaluatorRole: "headCoach" | "coach" | "owner" | "administrator";
    evaluatedAt?: string;
  }) => Promise<EvaluationRecord>;
  /**
   * T051V2 (plan decision 3): the Manage view rates many skills at once and has no session, so a
   * batch writes one `assessments` document per rating with `sessionId: null`, all in ONE
   * transaction. Coach, head coach and owner may rate (G6); an owner has no staff record, hence
   * the nullable `evaluatorStaffId`.
   */
  recordSkillRatings: (params: {
    academyId: string;
    input: RecordSkillRatingsInput;
    evaluatorId: string;
    evaluatorStaffId: string | null;
    evaluatorRole: "headCoach" | "coach" | "owner" | "administrator";
    evaluatedAt?: string;
  }) => Promise<RecordSkillRatingsResult>;
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
    decidedByStaffId: string | null;
    decidedByRole: "headCoach" | "owner" | "administrator";
    decidedAt?: string;
  }) => Promise<GraduationRecord>;
  rejectPromotion: (params: {
    academyId: string;
    input: RejectPromotionInput;
    decidedBy: string;
    decidedByStaffId: string | null;
    decidedByRole: "headCoach" | "owner" | "administrator";
    decidedAt?: string;
  }) => Promise<GraduationRecord>;
  listGraduations: (academyId: string, studentId?: string) => Promise<readonly GraduationRecord[]>;
  openStudentLevel: (params: {
    academyId: string;
    input: OpenStudentLevelInput;
    openedBy: string;
    /**
     * T051V2: nullable because the owner opens a level without a staff record; `assertTransactionalActor`
     * validates the owner through the member directory instead. A head coach with `null` here still
     * fails closed on "Staff scope is invalid".
     */
    openedByStaffId: string | null;
    openedByRole: "headCoach" | "owner" | "administrator";
    openedAt?: string;
  }) => Promise<OpenedStudentLevel>;
  /**
   * T051V2 (plan decision 1): assignment is its own operation, not a change to `approvePromotion`.
   * It may skip levels, it is dated by the operator, the owner may use it, and the gaps it records
   * are computed by the server — never sent by the caller.
   */
  assignLevel: (params: {
    academyId: string;
    input: AssignLevelInput;
    decidedBy: string;
    decidedByStaffId: string | null;
    decidedByRole: "headCoach" | "owner" | "administrator";
    decidedAt?: string;
  }) => Promise<AssignLevelResult>;
  /**
   * T051V2 (plan decision 2): a void is APPEND-ONLY. It writes a `void_<promotionId>` record and
   * puts the head back from the voided promotion's own `restore` snapshot, so it never has to
   * reconstruct history; the promotion it voids is never mutated or deleted. Only the promotion
   * the head names (`lastApprovedPromotionId`) can be voided, so a chain is walked back one step
   * at a time.
   */
  voidPromotion: (params: {
    academyId: string;
    input: VoidPromotionInput;
    decidedBy: string;
    decidedByStaffId: string | null;
    decidedByRole: "headCoach" | "owner" | "administrator";
    decidedAt?: string;
  }) => Promise<VoidPromotionResult>;
  getStudentLevelHistory: (academyId: string, studentId: string) => Promise<StudentLevelHistory>;
}>;

/**
 * T113 (operator decision 2026-09-06): opening a level out of the catalog age band is still the
 * head coach's call, but it is no longer silent. The band is evaluated at opening and handed back
 * so the panel can say so; nothing is stored and nothing is blocked. Without the warning, a student
 * opened out of band would simply never appear as a recognition candidate, with no clue why.
 */
export type OpenedStudentLevel = Readonly<{ head: StudentLevelHead; ageBand: AgeBandEvaluation }>;

function openingAgeBand(
  definition: Readonly<Record<string, unknown>> | undefined,
  dateOfBirth: unknown,
  now: string,
): AgeBandEvaluation {
  const criteria = definition?.criteria;
  const band =
    typeof criteria === "object" && criteria !== null
      ? (criteria as Readonly<Record<string, unknown>>)
      : undefined;
  const whole = (value: unknown) =>
    typeof value === "number" && Number.isSafeInteger(value) ? value : null;
  return evaluateAgeBand({
    criteria:
      band === undefined ? null : { minAge: whole(band.minAge), maxAge: whole(band.maxAge) },
    dateOfBirth: typeof dateOfBirth === "string" ? dateOfBirth : null,
    now,
  });
}

/** The canonical progress head a head coach opens; promotions move `currentDefinitionKey`. */
export type StudentLevelHead = Readonly<{
  academyId: string;
  studentId: string;
  systemId: string;
  currentDefinitionKey: string;
  currentLevelStartedAt: string;
  lastApprovedPromotionId: string | null;
  openedByStaffId: string | null;
  openingNotes: string;
  openedDefinitionKey?: string;
  openedOn?: string;
  openedByRole?: "headCoach" | "owner" | "administrator" | null;
  source?: "regyfit-import";
  importedBaseline?: ImportedBaseline;
  state: "initialized";
  schemaVersion: "1";
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
}>;

/**
 * Administrators and owners may open levels. Historical headCoach accounts retain their
 * sporting powers until explicitly migrated; ordinary coaches may not open a level.
 */
function assertLevelOpeningRole(openedByRole: string): void {
  if (
    openedByRole !== "headCoach" &&
    openedByRole !== "owner" &&
    openedByRole !== "administrator"
  ) {
    throw new LevelStoreError("tenant", "Level opening role is invalid");
  }
}

/**
 * T051V2: an operator-supplied day — the day a level was reached or a promotion was given — can
 * never be later than today. "Today" is the ACADEMY's day (Europe/Jersey), not UTC: between
 * midnight and 01:00 Jersey time in BST the two disagree, and a head coach acting just after
 * midnight must still be able to say "today". One rule serves both fields so they cannot drift.
 */
function assertOperatorDayNotInTheFuture(
  label: "Level start date" | "Promotion date",
  day: string | undefined,
  now: string,
): void {
  if (day === undefined) return;
  // Defence in depth: the comparison below is lexical, so a malformed value sorting below today
  // would otherwise be accepted and concatenated into an instant. The callable boundary already
  // parses the shape; the store refuses it again, and for its real reason.
  if (!isLevelCalendarDate(day)) {
    throw new LevelStoreError("invalid", `${label} is not a calendar date`);
  }
  if (day > jerseyDateOf(now)) {
    throw new LevelStoreError("invalid", `${label} is in the future`);
  }
}

function assertLevelStartNotInTheFuture(startedOn: string | undefined, now: string): void {
  assertOperatorDayNotInTheFuture("Level start date", startedOn, now);
}

/**
 * Administrators and owners may decide promotions. Historical headCoach records remain valid;
 * an ordinary coach cannot perform these decisions.
 */
function assertPromotionDecisionRole(decidedByRole: string): void {
  if (
    decidedByRole !== "headCoach" &&
    decidedByRole !== "owner" &&
    decidedByRole !== "administrator"
  ) {
    throw new LevelStoreError("tenant", "Promotion decision role is invalid");
  }
}

/**
 * Spec §6.3: a promotion cannot predate the level it promotes from — the class and day counts at
 * assignment are measured from the level start, so an earlier date would record negative time.
 */
function assertPromotionNotBeforeLevelStart(
  promotedOn: string,
  currentLevelStartedAt: string,
): void {
  if (promotedOn < currentLevelStartedAt.slice(0, 10)) {
    throw new LevelStoreError("invalid", "Promotion date is before the current level start");
  }
}

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
      | "level.promotion.rejected"
      | "level.promotion.voided"
      | "level.opened";
    targetCollection: "assessments" | "medicalLeaves" | "levelPromotions" | "studentLevelProgress";
    targetId: string;
    purpose:
      | "student-development-assessment"
      | "student-medical-leave"
      | "student-level-promotion"
      | "student-level-opening";
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

/** Grill G10: a stored baseline that does not parse is a refusal, never a silent zero. */
function storedImportedBaseline(value: unknown): ImportedBaseline | null {
  if (value === undefined) return null;
  const parsed = importedBaselineSchema.safeParse(value);
  if (!parsed.success) throw new LevelStoreError("tenant", "Imported baseline is invalid");
  return parsed.data;
}

/**
 * Task 7: what a promotion records so Task 10's `voidPromotion` can put the head back, including the
 * imported baseline the promotion drops. Shared by the Firestore and in-memory stores so the two can
 * never disagree on the shape. `importedBaseline` is `null`, never absent, when there was none.
 */
export type PromotionRestore = Readonly<{
  currentDefinitionKey: string;
  currentLevelStartedAt: string | null;
  lastApprovedPromotionId: string | null;
  importedBaseline: ImportedBaseline | null;
}>;

function promotionRestoreOf(headData: Readonly<Record<string, unknown>>): PromotionRestore {
  return Object.freeze({
    currentDefinitionKey: headData.currentDefinitionKey as string,
    currentLevelStartedAt: (headData.currentLevelStartedAt as string | null) ?? null,
    lastApprovedPromotionId: (headData.lastApprovedPromotionId as string | null) ?? null,
    importedBaseline: storedImportedBaseline(headData.importedBaseline),
  });
}

/**
 * Task 9: what an assignment records on top of a promotion — the gaps the operator was shown and
 * the criteria as they stood that day, so the history can be read back without recomputing it.
 */
export type PromotionAssignment = Readonly<{
  promotedOn: string;
  note: string | null;
  gaps: readonly string[];
  atAssignment: Readonly<{
    classes: Readonly<{ done: number; min: number | null }>;
    days: Readonly<{ done: number; min: number | null }>;
  }>;
}>;

/**
 * Review of Task 9 (Major-1): the note is the ONLY record of why somebody was promoted below
 * criteria, on an irreversible audited write, so the store re-checks it for the same reason it
 * re-checks the promotion date — `""`, `" "`, `null`, `"ok"` and a note carrying a NUL byte all
 * used to pass the `=== undefined` guard and be stored verbatim. `promotionNoteSchema` is the very
 * schema the callable boundary (Task 12) parses with, so the two can never drift: 10–500
 * characters after trimming, no control character other than a line break. A supplied note is
 * validated whether or not there are gaps; `null` is absent, exactly like `undefined`.
 */
function assignmentNoteOf(note: unknown): string | null {
  if (note === undefined || note === null) return null;
  const parsed = promotionNoteSchema.safeParse(note);
  if (!parsed.success) throw new LevelStoreError("invalid", "Promotion note is invalid");
  return parsed.data;
}

/**
 * Review of Task 10 (Major-1): the void reason is the ONLY record of why a real, audited promotion
 * was cancelled, and an unreadable one used to be stored verbatim and then erase the promotion
 * from the history at read time. It is re-checked at the store with `promotionNoteSchema` — the
 * very schema the callable boundary (Task 12) parses with — for exactly the reason
 * `assignmentNoteOf` above is: 10-500 characters after trimming, no control character other than a
 * line break. The trimmed value is what gets stored. Unlike a note, a reason is never optional.
 */
function voidReasonOf(reason: unknown): string {
  const parsed = promotionNoteSchema.safeParse(reason);
  if (!parsed.success) throw new LevelStoreError("invalid", "Void reason is invalid");
  return parsed.data;
}

/**
 * Task 11 (plan decision 7 / grill G6 "owner everything"): a coach, a head coach AND the owner may
 * rate skills; administrators also rate under the unified administrative/coaching role. The message is
 * distinct from `assertTransactionalActor`'s, because a code-only refusal ("tenant") passes for the
 * wrong reason — Tasks 8, 9 and 10 each caught that.
 */
function assertRatingRole(
  role: unknown,
): asserts role is "headCoach" | "coach" | "owner" | "administrator" {
  if (role !== "headCoach" && role !== "coach" && role !== "owner" && role !== "administrator") {
    throw new LevelStoreError("tenant", "Assessment actor role is invalid");
  }
}

/**
 * The batch itself is re-checked at the store with the very schema the callable boundary (Task 12)
 * will parse with, for the reason `assignmentNoteOf` is: these are irreversible audited writes
 * about a real member, and today no boundary exists at all. Bounds are checked BEFORE any read, so
 * a 101-rating batch is refused without touching the catalogue.
 */
function skillRatingsOf(ratings: unknown): RecordSkillRatingsInput["ratings"] {
  const parsed = skillRatingsSchema.safeParse(ratings);
  if (!parsed.success) throw new LevelStoreError("invalid", "Skill ratings are invalid");
  return parsed.data;
}

/**
 * Evidence notes are operator free text on an audited record, so they are validated here as well
 * as at the boundary. Absent (`undefined`) stores the empty string that `EvaluationRecord` has
 * always carried; anything else — including `null` and `""` — is a refusal, because "omitted" and
 * "present but empty" must not become the same thing.
 */
function evidenceNotesOf(notes: unknown): string {
  if (notes === undefined) return "";
  const parsed = assessmentEvidenceNotesSchema.safeParse(notes);
  if (!parsed.success) {
    throw new LevelStoreError("invalid", "Assessment evidence notes are invalid");
  }
  return parsed.data;
}

/**
 * Review of Task 11 (Minor-1): `input.studentId` and `input.definitionKey` go straight into a
 * Firestore document path and into the evaluation id, and until now nothing in this method parsed
 * them — they were refused only by accident, downstream, and with a message about something else.
 * The whole input is parsed here with the very schema the callable boundary (Task 12) will use,
 * for the same reason the two helpers above exist: the write is irreversible and no boundary
 * exists yet. `ratings` and `evidenceNotes` are checked first so their two distinct messages
 * survive; everything else that the schema refuses lands on this one.
 */
function skillRatingsInputOf(input: unknown): RecordSkillRatingsInput {
  const parsed = recordSkillRatingsInputSchema.safeParse(input);
  if (!parsed.success) throw new LevelStoreError("invalid", "Skill ratings input is invalid");
  return parsed.data;
}

/** The four ways a void is refused. One user-facing message; this is the server-side half. */
type VoidRefusalCause = "no-such-promotion" | "already-voided" | "not-latest" | "no-restore";

/** The head a void puts back, taken from the voided promotion's own restore snapshot. */
type VoidRestoreSnapshot = Readonly<{
  currentDefinitionKey: string;
  currentLevelStartedAt: string;
  lastApprovedPromotionId: string | null;
  importedBaseline: unknown;
}>;

/**
 * Review of Task 10 (Major-5): the four refusals are deliberately indistinguishable to the caller
 * — a head coach who may not void must not learn which promotions exist — but support was left
 * with nothing when an operator reports "it will not let me undo this". The discriminated cause is
 * decided once, here, shared by both stores (which is also why the in-memory store can no longer
 * drift from the Firestore one on any of these clauses), and logged at the throw site.
 *
 * A promotion written before `5b67c1b` carries no `restore` at all and is deliberately NOT
 * voidable (`no-restore`): putting the head back would mean guessing the level the student came
 * from, the instant it started and the imported baseline the promotion dropped.
 */
function voidRestoreOf(
  params: Readonly<{
    headData: Readonly<Record<string, unknown>> | undefined;
    promotionData: Readonly<Record<string, unknown>> | undefined;
    voidExists: boolean;
    academyId: string;
    studentId: string;
    promotionId: string;
  }>,
): VoidRefusalCause | VoidRestoreSnapshot {
  const { headData, promotionData, academyId, studentId, promotionId } = params;
  if (
    promotionData === undefined ||
    promotionData.academyId !== academyId ||
    promotionData.studentId !== studentId ||
    promotionData.status !== "approved" ||
    // A void is a record in the same collection; voiding one is not a thing.
    promotionData.kind === "void"
  ) {
    return "no-such-promotion";
  }
  // Kept for defence in depth and UNREACHABLE by the normal path in both stores: once a void lands
  // the head no longer names that promotion, so a second attempt dies on `not-latest` first. Only
  // a corrupted head that still names an already-voided promotion reaches it.
  if (params.voidExists) return "already-voided";
  if (
    headData === undefined ||
    headData.academyId !== academyId ||
    headData.studentId !== studentId ||
    headData.lastApprovedPromotionId !== promotionId
  ) {
    return "not-latest";
  }
  const restore = promotionData.restore as Record<string, unknown> | undefined;
  if (restore === undefined) return "no-restore";
  const currentDefinitionKey = restore.currentDefinitionKey;
  const currentLevelStartedAt = restore.currentLevelStartedAt;
  const lastApprovedPromotionId = restore.lastApprovedPromotionId;
  if (typeof currentDefinitionKey !== "string") return "no-restore";
  if (typeof currentLevelStartedAt !== "string") return "no-restore";
  if (lastApprovedPromotionId !== null && typeof lastApprovedPromotionId !== "string") {
    return "no-restore";
  }
  return Object.freeze({
    currentDefinitionKey,
    currentLevelStartedAt,
    lastApprovedPromotionId,
    importedBaseline: restore.importedBaseline,
  });
}

/**
 * `console.error` is the logging facility this repo already uses inside Cloud Functions
 * (`apps/functions/src/schedule/schedule-callables.ts`), where it lands in Cloud Logging; no new
 * dependency and no new pattern. Nothing restricted (ADR-009 rule 14) is named: the academy, the
 * student and the promotion are ordinary scope ids, and the reason the operator typed is NOT
 * logged.
 */
function refuseVoid(
  cause: VoidRefusalCause,
  scope: Readonly<{ academyId: string; studentId: string; promotionId: string }>,
): never {
  console.error("level.promotion.void refused", { cause, ...scope });
  throw new LevelStoreError("conflict", "Promotion cannot be voided");
}

/**
 * The per-skill summary both stores return. `latestScore` — the authoritative one after operator
 * DECISION 6 — and its tie rule come from the domain, so the Manage view and the readiness formula
 * can never name a different rating as the latest. `maxScore` stays as history: informative, and
 * read by nothing that decides readiness.
 */
function summariseStudentSkills(evaluations: readonly EvaluationRecord[]): StudentSkillSummary {
  const latest = latestSkillRatings(evaluations);
  const summary: Record<
    string,
    { count: number; maxScore: number; latestScore: number; lastEvaluatedAt: string }
  > = {};
  for (const evaluation of evaluations) {
    const existing = summary[evaluation.skillKey];
    if (!existing) {
      const rating = latest.get(evaluation.skillKey)!;
      summary[evaluation.skillKey] = {
        count: rating.count,
        maxScore: evaluation.score,
        latestScore: rating.score,
        lastEvaluatedAt: rating.evaluatedAt,
      };
      continue;
    }
    existing.maxScore = Math.max(existing.maxScore, evaluation.score);
  }
  return summary;
}

/**
 * Operator DECISION 6: the LATEST rating the student holds for each skill, never the best ever
 * given, so a correction downward re-opens the skills gap on an assignment.
 */
function currentScores(evaluations: readonly EvaluationRecord[]): Record<string, number> {
  const scores: Record<string, number> = {};
  for (const [skillKey, rating] of latestSkillRatings(evaluations)) scores[skillKey] = rating.score;
  return scores;
}

/** Task 10: a stored decision role the history schema recognises; anything else is unknown. */
function historyDecisionRole(value: unknown): "headCoach" | "owner" | "administrator" | null {
  return value === "headCoach" || value === "owner" || value === "administrator" ? value : null;
}

/** The criteria as they stood at an assignment; anything else reads as "not recorded". */
function historyCriterion(value: unknown): { done: number; min: number | null } | null {
  if (typeof value !== "object" || value === null) return null;
  const { done, min } = value as Record<string, unknown>;
  return typeof done === "number" && (typeof min === "number" || min === null)
    ? { done, min }
    : null;
}

/**
 * Carried from Tasks 6 and 9: an assignment made with no note stores `note: null` and
 * `decisionNotes: ""`, so an empty or whitespace-only stored note means there is NO note — not a
 * note that happens to be blank. Without this the Manage view would render an empty note row as
 * if a coach had written one.
 *
 * Review of Task 10 (Major-2): the candidates are parsed with `historyFreeTextSchema`, the very
 * schema the row is then parsed with, so a stored value the read schema cannot take (too long, a
 * control character, not a string at all) reads as "not recorded" instead of failing — and
 * deleting — the whole row. Shared by the promotion note, the opening note and the void reason.
 */
function historyFreeText(...values: readonly unknown[]): string | null {
  for (const value of values) {
    const parsed = historyFreeTextSchema.safeParse(value);
    if (parsed.success && parsed.data !== "") return parsed.data;
  }
  return null;
}

/**
 * The day a void was decided: `decidedAt` is what every void this code writes carries, `createdAt`
 * is the same instant and is the fallback for a row whose `decidedAt` cannot be read. When neither
 * reads, the date is NOT RECORDED. It is never replaced by the promotion's own date, which would
 * read as a fact about the void that nobody recorded.
 */
function historyVoidedOn(...values: readonly unknown[]): string | null {
  for (const value of values) {
    if (typeof value !== "string") continue;
    const day = value.slice(0, 10);
    if (isLevelCalendarDate(day)) return day;
  }
  return null;
}

/**
 * Task 10: the level history the Manage view reads — every approved promotion for this student,
 * each carrying the void that cancelled it, plus the opening the head records, newest first.
 *
 * `levelHistoryEntrySchema` is a READ schema over stored data, so each row is parsed on its own
 * and a row that cannot be parsed is left out: one unreadable record must not blank the whole
 * history.
 *
 * Review of Task 10 (Major-2), RULING: a void record that exists ALWAYS marks its promotion
 * voided. Unreadable sub-fields of the void degrade to `null` — "not recorded" — they never remove
 * a row, and nothing is ever fabricated to fill them. Showing a cancelled promotion as still
 * standing is a lie the operator can see and challenge; omitting the promotion is a lie the
 * operator cannot see at all, and it destroys the evidence the append-only design exists for.
 */
function buildLevelHistory(
  studentId: string,
  headData: Readonly<Record<string, unknown>> | undefined,
  promotions: readonly Readonly<Record<string, unknown>>[],
): StudentLevelHistory {
  const voids = new Map(
    promotions
      .filter((record) => record.kind === "void")
      .map((record) => [String(record.voidsPromotionId), record] as const),
  );
  const rows: unknown[] = promotions
    .filter((record) => record.kind !== "void" && record.status === "approved")
    .map((record) => {
      const voided = voids.get(String(record.promotionId));
      const imported = record.source === "regyfit-import";
      const atAssignment = record.atAssignment as Record<string, unknown> | undefined;
      return {
        // Review of Task 10 (Major-3): these three go to the per-row parse RAW. They used to go
        // through `String(...)`, so a promotion missing `toDefinitionKey` became the string
        // `"undefined"` — which `identifierSchema` accepts — and the member was shown promoted to
        // a belt called `undefined`, row present and standing. Anything that is not a string now
        // fails this row's own parse, exactly the way a malformed `promotedOn` already does.
        entryId: record.promotionId,
        kind: "promotion",
        definitionKey: record.toDefinitionKey,
        fromDefinitionKey: record.fromDefinitionKey,
        // `promotedOn` only exists on an assignment; a recognition-panel approval is dated by the
        // day it was decided.
        assignedOn:
          typeof record.promotedOn === "string"
            ? record.promotedOn
            : String(record.decidedAt).slice(0, 10),
        classes: historyCriterion(atAssignment?.classes),
        days: historyCriterion(atAssignment?.days),
        decidedByRole: imported ? null : historyDecisionRole(record.decidedByRole),
        source: imported ? "regyfit-import" : "bpt",
        note: historyFreeText(record.note, record.decisionNotes),
        gaps: Array.isArray(record.gaps)
          ? record.gaps.filter((gap): gap is string => typeof gap === "string")
          : [],
        voided:
          voided === undefined
            ? null
            : {
                reason: historyFreeText(voided.reason),
                voidedByRole: historyDecisionRole(voided.decidedByRole),
                voidedOn: historyVoidedOn(voided.decidedAt, voided.createdAt),
              },
      };
    });
  if (
    headData !== undefined &&
    typeof headData.openedDefinitionKey === "string" &&
    typeof headData.openedOn === "string"
  ) {
    const imported = headData.source === "regyfit-import";
    rows.push({
      entryId: `opening_${studentId}`,
      kind: "opening",
      definitionKey: headData.openedDefinitionKey,
      fromDefinitionKey: null,
      assignedOn: headData.openedOn,
      classes: null,
      days: null,
      decidedByRole: imported ? null : historyDecisionRole(headData.openedByRole),
      source: imported ? "regyfit-import" : "bpt",
      note: historyFreeText(headData.openingNotes),
      gaps: [],
      voided: null,
    });
  }
  const entries: LevelHistoryEntry[] = rows.flatMap((row) => {
    const parsed = levelHistoryEntrySchema.safeParse(row);
    return parsed.success ? [parsed.data] : [];
  });
  // Newest first; the opening is the oldest thing that can share a day with a promotion.
  entries.sort(
    (left, right) =>
      right.assignedOn.localeCompare(left.assignedOn) || (left.kind === "opening" ? 1 : -1),
  );
  /**
   * T051V2 review of Task 16 (Critical-1): the head's `lastApprovedPromotionId` is the ONLY
   * promotion `voidPromotion` accepts (`return "not-latest"` above), and it is NOT the newest row
   * by `assignedOn`. Two shapes reach that: two promotions on the SAME DAY, where the sort above
   * is inconsistent for a tie and orders them arbitrarily; and Plan D's Regyfit import, which
   * writes promotions straight into the collection with whatever dates the source carries.
   * `assignLevel` alone cannot diverge further — `assertPromotionNotBeforeLevelStart` refuses a
   * date before the current level start and the promotion then starts the new level on its own
   * day, so `assignedOn` never decreases along the standing chain. The id is carried to the
   * reader so the Void affordance is placed by the server's own rule. It is passed through only when it names a
   * row that survived its own parse: a head naming a record that is not on screen can offer the
   * operator nothing, and an id that no longer parses must not take the whole history down.
   */
  const lastApproved =
    typeof headData?.lastApprovedPromotionId === "string" ? headData.lastApprovedPromotionId : null;
  const parsed = studentLevelHistorySchema.safeParse({
    studentId,
    currentDefinitionKey:
      typeof headData?.currentDefinitionKey === "string" ? headData.currentDefinitionKey : null,
    lastApprovedPromotionId:
      lastApproved !== null && entries.some((entry) => entry.entryId === lastApproved)
        ? lastApproved
        : null,
    entries,
  });
  if (!parsed.success) throw new LevelStoreError("conflict", "Level history is invalid");
  return parsed.data;
}

/**
 * Grill G7: the server, never the caller, decides what is missing, and a below-criteria assignment
 * without a note is refused. Shared by both stores so the gap list and the stored snapshot can
 * never diverge between them.
 */
function promotionAssignmentOf(
  params: Readonly<{
    catalog: LevelCatalogProjection;
    from: LevelDefinitionRecord;
    to: LevelDefinitionRecord;
    input: AssignLevelInput;
    currentLevelStartedAt: string;
    importedBaseline: ImportedBaseline | null;
    attendedAt: readonly string[];
    evaluations: readonly EvaluationRecord[];
    dateOfBirth: string | null;
  }>,
): PromotionAssignment {
  const promotedAt = `${params.input.promotedOn}T00:00:00.000Z`;
  const classes = countClassesAtLevel({
    attendedAt: params.attendedAt,
    currentLevelStartedAt: params.currentLevelStartedAt,
    importedBaseline: params.importedBaseline,
    until: params.input.promotedOn,
  });
  const daysDone = daysAtLevel(params.currentLevelStartedAt, promotedAt);
  // `listPromotionGaps` THROWS a plain Error on a key it cannot find. Both keys here are the
  // definition records the caller already resolved against the published catalogue, so the throw
  // is unreachable; an unknown key is refused as a conflict before this helper is called.
  const gaps = listPromotionGaps({
    definitions: params.catalog.definitions,
    requirements: params.catalog.requirements,
    fromDefinitionKey: params.from.definitionKey,
    toDefinitionKey: params.to.definitionKey,
    classesDone: classes.total,
    daysDone,
    skillScores: currentScores(params.evaluations),
    ageYears:
      params.dateOfBirth === null ? null : ageInCompletedYears(params.dateOfBirth, promotedAt),
  });
  const note = assignmentNoteOf(params.input.note);
  if (gaps.length > 0 && note === null) {
    throw new LevelStoreError("invalid", "A note is required when criteria are not met");
  }
  return Object.freeze({
    promotedOn: params.input.promotedOn,
    note,
    gaps,
    atAssignment: Object.freeze({
      classes: Object.freeze({ done: classes.total, min: params.to.criteria.minClasses }),
      days: Object.freeze({ done: daysDone, min: minimumDaysOf(params.to.criteria.minimumTime) }),
    }),
  });
}

/** The student's attended/late, uncorrected attendance; every record must carry a real time. */
function countedAttendance(
  snapshot: GenericQuerySnapshot,
  academyId: string,
  studentId: string,
): readonly Record<string, unknown>[] {
  return withinLimit(snapshot, "Attendance").docs.flatMap((document) => {
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
    if (typeof value.occurredAt !== "string" || Number.isNaN(Date.parse(value.occurredAt))) {
      // The record id stays server-side: the web client maps every callable failure to a fixed
      // user-facing string, so this only ever reaches the operator through the function log.
      throw new LevelStoreError("conflict", `Attendance time is invalid: ${document.id}`);
    }
    return [value];
  });
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
        const [
          systemSnapshot,
          manifestSnapshot,
          definitionsSnapshot,
          requirementsSnapshot,
          systemsSnapshot,
        ] = await Promise.all([
          transaction.get(systemRef),
          transaction.get(manifestRef),
          transaction.get(definitionsCollection),
          transaction.get(requirementsCollection),
          transaction.get(firestore.collection(`academies/${academyId}/levelSystems`)),
        ]);
        if (systemsSnapshot.docs.some((document) => document.id !== systemId)) {
          // ponytail: one published catalogue per academy; switching versions is rollback + seed.
          throw new LevelStoreError("conflict", "Another level catalogue is already published.");
        }
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
      if (
        evaluatorRole !== "headCoach" &&
        evaluatorRole !== "coach" &&
        evaluatorRole !== "owner" &&
        evaluatorRole !== "administrator"
      ) {
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

    async recordSkillRatings(params): Promise<RecordSkillRatingsResult> {
      assertValidAcademyId(params.academyId);
      const { academyId, input, evaluatorId, evaluatorStaffId, evaluatorRole } = params;
      assertRatingRole(evaluatorRole);
      const ratings = skillRatingsOf(input.ratings);
      const evidenceNotes = evidenceNotesOf(input.evidenceNotes);
      const { studentId, definitionKey } = skillRatingsInputOf(input);
      const now = params.evaluatedAt ?? new Date().toISOString();
      const planned = ratings.map((rating) => {
        const evaluationId = buildEvaluationId(studentId, rating.skillKey, now);
        const audit = levelAuditDraft({
          academyId,
          actorId: evaluatorId,
          action: "level.assessment.recorded",
          targetCollection: "assessments",
          targetId: evaluationId,
          purpose: "student-development-assessment",
        });
        return {
          rating,
          evaluationId,
          ref: firestore.doc(`academies/${academyId}/assessments/${evaluationId}`),
          audit,
          auditRef: firestore.doc(`academies/${academyId}/auditEvents/${auditEventId(audit)}`),
        };
      });
      return firestore.runTransaction(async (transaction) => {
        await assertTransactionalActor(transaction, firestore, {
          academyId,
          actorId: evaluatorId,
          actorRole: evaluatorRole,
          actorStaffId: evaluatorStaffId,
        });
        const student = storedStudent(
          await transaction.get(firestore.doc(`academies/${academyId}/students/${studentId}`)),
          academyId,
          studentId,
        );
        assertActiveStudent(student);
        const definition = await transaction.get(
          firestore.doc(`academies/${academyId}/levelDefinitions/${definitionKey}`),
        );
        const definitionData = definition.data();
        if (
          !definition.exists ||
          definitionData?.academyId !== academyId ||
          definitionData.definitionKey !== definitionKey ||
          typeof definitionData.systemId !== "string"
        ) {
          throw new LevelStoreError("conflict", "Assessment references are not current");
        }
        const system = await transaction.get(
          firestore.doc(`academies/${academyId}/levelSystems/${definitionData.systemId}`),
        );
        const systemData = system.data();
        const catalogKeys = new Set(
          Array.isArray(systemData?.skillCatalog)
            ? systemData.skillCatalog.flatMap((skill) =>
                typeof skill === "object" &&
                skill !== null &&
                !Array.isArray(skill) &&
                typeof (skill as Record<string, unknown>).key === "string"
                  ? [(skill as Record<string, unknown>).key as string]
                  : [],
              )
            : [],
        );
        // Every existing document is read before anything is written: the whole batch is one
        // transaction, so a single replayed rating leaves the member neither half assessed nor
        // half audited.
        // ponytail: this is N round trips, one per rating. `transaction.getAll(...refs)` would be
        // one, but neither `GenericTransaction` nor the test fake has `getAll` today, and the
        // ceiling is low: the published catalogue has 11 skills and the contract caps a batch at
        // 100. Worth doing when something else needs `getAll` anyway.
        const existing = await Promise.all(planned.map((entry) => transaction.get(entry.ref)));
        if (
          !system.exists ||
          systemData?.academyId !== academyId ||
          systemData.systemId !== definitionData.systemId ||
          systemData.status !== "published" ||
          planned.some((entry) => !catalogKeys.has(entry.rating.skillKey)) ||
          existing.some((snapshot) => snapshot.exists)
        ) {
          throw new LevelStoreError("conflict", "Assessment catalog is not current");
        }
        for (const entry of planned) {
          const record: EvaluationRecord = {
            evaluationId: entry.evaluationId,
            academyId,
            studentId,
            // Decision 3: the Manage view has no session, and `EvaluationRecord.sessionId` was
            // widened to `string | null` (Task 6) precisely for this path.
            sessionId: null,
            definitionKey,
            skillKey: entry.rating.skillKey,
            score: entry.rating.score,
            evidenceNotes,
            evaluatorId,
            evaluatorRole,
            evaluatedAt: now,
            schemaVersion: "1",
            createdAt: now,
            createdBy: evaluatorId,
            updatedAt: now,
            updatedBy: evaluatorId,
          };
          transaction.create(entry.ref, {
            ...record,
            assessmentId: entry.evaluationId,
            coachStaffId: evaluatorStaffId,
            observedAt: now,
            dimensions: [
              {
                definitionKey,
                skillKey: entry.rating.skillKey,
                score: entry.rating.score,
              },
            ],
            status: "recorded",
          });
          appendAuditEventInTransaction(transaction, entry.auditRef, entry.audit);
        }
        return { studentId, recorded: planned.length };
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
      return summariseStudentSkills(evaluations);
    },

    async getStudentProgressSummary(
      academyId: string,
      studentId: string,
    ): Promise<StudentProgressSummary> {
      assertValidAcademyId(academyId);
      // T113: the canonical student carries the date of birth the age band of the target rank is
      // read against. It stays here; the summary only reports the band and whether it is met.
      const student = storedStudent(
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
      // ponytail: reads the whole attendance and sessions collections under the existing
      // 400-record ceiling (withinLimit); a per-student query on the existing
      // (studentId, occurredAt) index replaces it when an academy passes 400 records.
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
      const attendance = countedAttendance(attendanceSnapshot, academyId, studentId);
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
        classesAtLevel: countClassesAtLevel({
          attendedAt: attendance.map((record) => record.occurredAt as string),
          currentLevelStartedAt: (headData.currentLevelStartedAt as string | null) ?? null,
          importedBaseline: storedImportedBaseline(headData.importedBaseline),
        }),
        dateOfBirth: student.dateOfBirth ?? null,
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
            dateOfBirth: profile.dateOfBirth,
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
      if (!["headCoach", "owner", "administrator"].includes(decidedByRole)) {
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
          actorRole: decidedByRole,
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
          restore: promotionRestoreOf(headData),
        });
        const nextHead: Record<string, unknown> = {
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
        };
        // Grill G10: the imported baseline belongs to the level it was imported at.
        delete nextHead.importedBaseline;
        transaction.set(headRef, nextHead);
        appendAuditEventInTransaction(transaction, auditRef, audit);
        return record;
      });
    },

    async openStudentLevel(params): Promise<OpenedStudentLevel> {
      const { academyId, input, openedBy, openedByStaffId, openedByRole } = params;
      assertValidAcademyId(academyId);
      assertLevelOpeningRole(openedByRole);
      const now = params.openedAt ?? new Date().toISOString();
      assertLevelStartNotInTheFuture(input.startedOn, now);
      const headRef = firestore.doc(
        `academies/${academyId}/studentLevelProgress/${input.studentId}`,
      );
      const audit = levelAuditDraft({
        academyId,
        actorId: openedBy,
        action: "level.opened",
        targetCollection: "studentLevelProgress",
        targetId: input.studentId,
        purpose: "student-level-opening",
      });
      const auditRef = firestore.doc(`academies/${academyId}/auditEvents/${auditEventId(audit)}`);
      return firestore.runTransaction(async (transaction) => {
        await assertTransactionalActor(transaction, firestore, {
          academyId,
          actorId: openedBy,
          actorRole: openedByRole,
          actorStaffId: openedByStaffId,
        });
        const student = storedStudent(
          await transaction.get(
            firestore.doc(`academies/${academyId}/students/${input.studentId}`),
          ),
          academyId,
          input.studentId,
        );
        assertActiveStudent(student);
        const [head, definition, existingAudit] = await Promise.all([
          transaction.get(headRef),
          transaction.get(
            firestore.doc(`academies/${academyId}/levelDefinitions/${input.definitionKey}`),
          ),
          transaction.get(auditRef),
        ]);
        if (head.exists) {
          throw new LevelStoreError("conflict", "Student level is already open");
        }
        const definitionData = definition.data();
        if (
          !definition.exists ||
          definitionData?.academyId !== academyId ||
          definitionData.definitionKey !== input.definitionKey ||
          typeof definitionData.systemId !== "string"
        ) {
          throw new LevelStoreError("conflict", "Level definition is not current");
        }
        if (existingAudit.exists) {
          throw new LevelStoreError("conflict", "Level opening evidence already exists");
        }
        const record: StudentLevelHead = Object.freeze({
          academyId,
          studentId: input.studentId,
          systemId: definitionData.systemId,
          currentDefinitionKey: input.definitionKey,
          // T051V2: the head's two opening fields are derived from ONE day so they can never
          // disagree. Without a startedOn the day is the Jersey day of `now`, and the level
          // starts at its midnight — not at the opening instant, which at the BST boundary
          // belongs to the previous Jersey day and would over-count that day's classes.
          currentLevelStartedAt: `${input.startedOn ?? jerseyDateOf(now)}T00:00:00.000Z`,
          lastApprovedPromotionId: null,
          openedByStaffId,
          openingNotes: input.decisionNotes,
          openedDefinitionKey: input.definitionKey,
          openedOn: input.startedOn ?? jerseyDateOf(now),
          openedByRole,
          state: "initialized",
          schemaVersion: "1",
          createdAt: now,
          createdBy: openedBy,
          updatedAt: now,
          updatedBy: openedBy,
        });
        transaction.create(headRef, { ...record });
        appendAuditEventInTransaction(transaction, auditRef, audit);
        return {
          head: record,
          ageBand: openingAgeBand(
            definitionData,
            (student as { dateOfBirth?: unknown }).dateOfBirth,
            now,
          ),
        };
      });
    },

    async assignLevel(params): Promise<AssignLevelResult> {
      const { academyId, input, decidedBy, decidedByStaffId, decidedByRole } = params;
      assertValidAcademyId(academyId);
      assertPromotionDecisionRole(decidedByRole);
      const now = params.decidedAt ?? new Date().toISOString();
      assertOperatorDayNotInTheFuture("Promotion date", input.promotedOn, now);
      const promotionId = buildGraduationId(input.studentId, input.toDefinitionKey, now);
      const promotionRef = firestore.doc(`academies/${academyId}/levelPromotions/${promotionId}`);
      const headRef = firestore.doc(
        `academies/${academyId}/studentLevelProgress/${input.studentId}`,
      );
      const audit = levelAuditDraft({
        academyId,
        actorId: decidedBy,
        action: "level.promotion.approved",
        targetCollection: "levelPromotions",
        targetId: promotionId,
        purpose: "student-level-promotion",
      });
      const auditRef = firestore.doc(`academies/${academyId}/auditEvents/${auditEventId(audit)}`);
      // The catalogue, the assessments and the attendance are read before the transaction, exactly
      // as getStudentProgressSummary reads them; the head, the student and the promotion id are
      // re-read inside it, where the write decisions are made.
      const [catalog, evaluations, attendanceSnapshot] = await Promise.all([
        this.listPublished(academyId),
        this.listStudentEvaluations(academyId, input.studentId),
        firestore.collection(`academies/${academyId}/attendance`).get(),
      ]);
      const attendedAt = countedAttendance(attendanceSnapshot, academyId, input.studentId).map(
        (record) => record.occurredAt as string,
      );
      return firestore.runTransaction(async (transaction) => {
        await assertTransactionalActor(transaction, firestore, {
          academyId,
          actorId: decidedBy,
          actorRole: decidedByRole,
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
        const [head, existing] = await Promise.all([
          transaction.get(headRef),
          transaction.get(promotionRef),
        ]);
        const headData = head.data();
        const definitionOf = (definitionKey: string) =>
          catalog.definitions.find((definition) => definition.definitionKey === definitionKey);
        const from = definitionOf(input.fromDefinitionKey);
        const to = definitionOf(input.toDefinitionKey);
        if (
          !head.exists ||
          headData?.academyId !== academyId ||
          headData.studentId !== input.studentId ||
          headData.state !== "initialized" ||
          headData.systemId !== catalog.system.systemId ||
          headData.currentDefinitionKey !== input.fromDefinitionKey ||
          typeof headData.currentLevelStartedAt !== "string" ||
          from === undefined ||
          to === undefined ||
          // `assignLevelInputSchema` does not compare the two keys, so a self-promotion parses;
          // `<=` refuses it together with every backwards move.
          to.sequence <= from.sequence ||
          existing.exists
        ) {
          throw new LevelStoreError("conflict", "Promotion references are not current");
        }
        const startedAt = headData.currentLevelStartedAt;
        assertPromotionNotBeforeLevelStart(input.promotedOn, startedAt);
        const assignment = promotionAssignmentOf({
          catalog,
          from,
          to,
          input,
          currentLevelStartedAt: startedAt,
          importedBaseline: storedImportedBaseline(headData.importedBaseline),
          attendedAt,
          evaluations,
          dateOfBirth: student.dateOfBirth ?? null,
        });
        const record: GraduationRecord = Object.freeze({
          graduationId: promotionId,
          academyId,
          studentId: input.studentId,
          fromDefinitionKey: from.definitionKey,
          toDefinitionKey: to.definitionKey,
          status: "approved",
          decisionNotes: assignment.note ?? "",
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
          ...assignment,
          gaps: [...assignment.gaps],
          promotionId,
          systemId: headData.systemId,
          decisionStatus: "approved",
          proposedBy: decidedByStaffId ?? decidedBy,
          decidedByStaffId,
          restore: promotionRestoreOf(headData),
        });
        const nextHead: Record<string, unknown> = {
          ...headData,
          currentDefinitionKey: to.definitionKey,
          // The head starts at midnight on the promotion day, so the day the promotion names and
          // the day the new level counts from are one and the same.
          currentLevelStartedAt: `${input.promotedOn}T00:00:00.000Z`,
          lastApprovedPromotionId: promotionId,
          updatedAt: now,
          updatedBy: decidedBy,
        };
        // Grill G10: the imported baseline belongs to the level it was imported at.
        delete nextHead.importedBaseline;
        transaction.set(headRef, nextHead);
        appendAuditEventInTransaction(transaction, auditRef, audit);
        return Object.freeze({
          promotionId,
          toDefinitionKey: to.definitionKey,
          promotedOn: input.promotedOn,
          gaps: [...assignment.gaps],
        });
      });
    },

    /**
     * Plan decision 2. Everything the void needs was written by the promotion itself, so the only
     * question asked here is "is this still the promotion the head names?". A promotion written
     * before `5b67c1b` carries no `restore` at all and is deliberately NOT voidable: putting the
     * head back would mean guessing the level the student came from, the instant it started and
     * the imported baseline the promotion dropped — silent, wrong edits to a real person's belt
     * record. The operator is refused and the record stays exactly as it is.
     */
    async voidPromotion(params): Promise<VoidPromotionResult> {
      const { academyId, input, decidedBy, decidedByStaffId, decidedByRole } = params;
      assertValidAcademyId(academyId);
      assertPromotionDecisionRole(decidedByRole);
      const reason = voidReasonOf(input.reason);
      const now = params.decidedAt ?? new Date().toISOString();
      const voidId = `void_${input.promotionId}`;
      const promotionRef = firestore.doc(
        `academies/${academyId}/levelPromotions/${input.promotionId}`,
      );
      const voidRef = firestore.doc(`academies/${academyId}/levelPromotions/${voidId}`);
      const headRef = firestore.doc(
        `academies/${academyId}/studentLevelProgress/${input.studentId}`,
      );
      const audit = levelAuditDraft({
        academyId,
        actorId: decidedBy,
        action: "level.promotion.voided",
        targetCollection: "levelPromotions",
        targetId: voidId,
        purpose: "student-level-promotion",
      });
      const auditRef = firestore.doc(`academies/${academyId}/auditEvents/${auditEventId(audit)}`);
      return firestore.runTransaction(async (transaction) => {
        await assertTransactionalActor(transaction, firestore, {
          academyId,
          actorId: decidedBy,
          actorRole: decidedByRole,
          actorStaffId: decidedByStaffId,
        });
        storedStudent(
          await transaction.get(
            firestore.doc(`academies/${academyId}/students/${input.studentId}`),
          ),
          academyId,
          input.studentId,
        );
        const [head, promotion, existingVoid] = await Promise.all([
          transaction.get(headRef),
          transaction.get(promotionRef),
          transaction.get(voidRef),
        ]);
        const headData = head.data();
        const promotionData = promotion.data();
        const restore = voidRestoreOf({
          headData: head.exists ? headData : undefined,
          promotionData: promotion.exists ? promotionData : undefined,
          voidExists: existingVoid.exists,
          academyId,
          studentId: input.studentId,
          promotionId: input.promotionId,
        });
        if (typeof restore === "string") {
          refuseVoid(restore, {
            academyId,
            studentId: input.studentId,
            promotionId: input.promotionId,
          });
        }
        // Grill G10, and Task 7 review m2: a stored baseline that does not parse refuses the void
        // itself rather than silently restoring a head with no imported classes. A stored `null`
        // means the head had no baseline.
        const restoredBaseline = storedImportedBaseline(restore.importedBaseline ?? undefined);
        transaction.create(voidRef, {
          promotionId: voidId,
          kind: "void",
          academyId,
          studentId: input.studentId,
          // `voidRestoreOf` refused already unless this is the approved promotion the head names.
          systemId: (promotionData as Record<string, unknown>).systemId,
          voidsPromotionId: input.promotionId,
          reason,
          decidedBy,
          decidedByRole,
          decidedByStaffId,
          decidedAt: now,
          schemaVersion: "1",
          createdAt: now,
          createdBy: decidedBy,
          updatedAt: now,
          updatedBy: decidedBy,
        });
        const nextHead: Record<string, unknown> = {
          ...headData,
          currentDefinitionKey: restore.currentDefinitionKey,
          currentLevelStartedAt: restore.currentLevelStartedAt,
          lastApprovedPromotionId: restore.lastApprovedPromotionId,
          updatedAt: now,
          updatedBy: decidedBy,
        };
        delete nextHead.importedBaseline;
        if (restoredBaseline !== null) nextHead.importedBaseline = restoredBaseline;
        transaction.set(headRef, nextHead);
        appendAuditEventInTransaction(transaction, auditRef, audit);
        return Object.freeze({
          voidId,
          voidsPromotionId: input.promotionId,
          restoredDefinitionKey: restore.currentDefinitionKey,
        });
      });
    },

    async getStudentLevelHistory(
      academyId: string,
      studentId: string,
    ): Promise<StudentLevelHistory> {
      assertValidAcademyId(academyId);
      storedStudent(
        await firestore.doc(`academies/${academyId}/students/${studentId}`).get(),
        academyId,
        studentId,
      );
      // ponytail: the whole promotions collection, filtered in memory, exactly as
      // `listGraduations` already reads it — the same 400-record ceiling (`withinLimit`), no new
      // composite index and no second restricted read per record open.
      const [head, snapshot] = await Promise.all([
        firestore.doc(`academies/${academyId}/studentLevelProgress/${studentId}`).get(),
        firestore.collection(`academies/${academyId}/levelPromotions`).get(),
      ]);
      const headData = head.data();
      if (head.exists && (headData?.academyId !== academyId || headData.studentId !== studentId)) {
        throw new LevelStoreError("tenant", "Progress head is invalid");
      }
      const promotions = withinLimit(snapshot, "Level promotions").docs.flatMap((document) => {
        const data = document.data();
        if (data.academyId !== academyId || data.promotionId !== document.id) {
          throw new LevelStoreError("tenant", "Promotion scope is invalid");
        }
        return data.studentId === studentId ? [data] : [];
      });
      return buildLevelHistory(studentId, head.exists ? headData : undefined, promotions);
    },

    async rejectPromotion(params): Promise<GraduationRecord> {
      const { academyId, input, decidedBy, decidedByStaffId, decidedByRole } = params;
      assertValidAcademyId(academyId);
      if (!["headCoach", "owner", "administrator"].includes(decidedByRole)) {
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
          actorRole: decidedByRole,
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
        .flatMap((document) => {
          const data = document.data();
          if (data.academyId !== academyId || data.promotionId !== document.id) {
            throw new LevelStoreError("tenant", "Promotion scope is invalid");
          }
          // Task 10: a void lives in the same collection but is not a graduation, and every
          // existing reader of this list would read it as one.
          return data.kind === "void" ? [] : [data as unknown as GraduationRecord];
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
  // Like the Firestore promotion document, an approved promotion carries its `restore`; `rejected`
  // promotions never move a head, so they carry none.
  const graduations = new Map<
    string,
    GraduationRecord & { readonly restore?: PromotionRestore } & Partial<PromotionAssignment>
  >();
  const heads = new Map<string, StudentLevelHead>();
  // Task 10: the Firestore store keeps voids in the `levelPromotions` collection beside the
  // promotions and filters them out of `listGraduations`; here they get their own map, which is
  // the same thing said in a way this store can type. A void is never a `GraduationRecord`.
  const voids = new Map<string, Record<string, unknown>>();

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
      if (
        [...systems.values()].some(
          (system) => system["academyId"] === academyId && system["systemId"] !== systemId,
        )
      ) {
        // ponytail: one published catalogue per academy; switching versions is rollback + seed.
        throw new LevelStoreError("conflict", "Another level catalogue is already published.");
      }
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

    /**
     * Task 11, Decision 3 (parity): implemented rather than stubbed. The plan's stub delegated to
     * `recordEvaluation` with a made-up `sessionId: "manage-view"` and mapped the owner to a head
     * coach — it would have hidden the two things this method exists for (a session-less record and
     * the owner's own role) behind green tests. Identity is NOT checked here (this store has no
     * `assertTransactionalActor`), so every identity case is proved on the Firestore fake instead.
     */
    async recordSkillRatings(params): Promise<RecordSkillRatingsResult> {
      assertValidAcademyId(params.academyId);
      const { academyId, input, evaluatorId, evaluatorStaffId, evaluatorRole } = params;
      assertRatingRole(evaluatorRole);
      const ratings = skillRatingsOf(input.ratings);
      const evidenceNotes = evidenceNotesOf(input.evidenceNotes);
      const { studentId, definitionKey } = skillRatingsInputOf(input);
      const now = new Date().toISOString();
      const evaluatedAt = params.evaluatedAt ?? now;
      const catalog = await this.listPublished(academyId);
      const catalogKeys = new Set(catalog.skills.map((skill) => skill.key));
      if (!catalog.definitions.some((definition) => definition.definitionKey === definitionKey)) {
        throw new LevelStoreError("conflict", "Assessment references are not current");
      }
      const planned = ratings.map((rating) => ({
        rating,
        key: `${academyId}__${studentId}__${buildEvaluationId(studentId, rating.skillKey, evaluatedAt)}`,
        evaluationId: buildEvaluationId(studentId, rating.skillKey, evaluatedAt),
      }));
      if (
        planned.some(
          (entry) => !catalogKeys.has(entry.rating.skillKey) || evaluations.has(entry.key),
        )
      ) {
        throw new LevelStoreError("conflict", "Assessment catalog is not current");
      }
      for (const entry of planned) {
        evaluations.set(entry.key, {
          evaluationId: entry.evaluationId,
          academyId,
          studentId,
          sessionId: null,
          definitionKey,
          skillKey: entry.rating.skillKey,
          score: entry.rating.score,
          evidenceNotes,
          evaluatorId,
          evaluatorRole,
          evaluatedAt,
          schemaVersion: "1",
          createdAt: now,
          createdBy: evaluatorId,
          updatedAt: now,
          updatedBy: evaluatorId,
        });
      }
      // The staff id has no home in this store's record shape; it is named so a reader can see it
      // is deliberately unused here rather than forgotten.
      void evaluatorStaffId;
      return { studentId, recorded: planned.length };
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
      return summariseStudentSkills(studentEvals);
    },

    async getStudentProgressSummary(
      academyId: string,
      studentId: string,
    ): Promise<StudentProgressSummary> {
      assertValidAcademyId(academyId);
      const head = heads.get(`${academyId}_${studentId}`);
      if (head === undefined || head.academyId !== academyId || head.studentId !== studentId) {
        return buildUninitializedStudentProgressSummary(studentId);
      }
      const [catalog, studentEvaluations] = await Promise.all([
        this.listPublished(academyId),
        this.listStudentEvaluations(academyId, studentId),
      ]);
      if (
        catalog.system.systemId !== head.systemId ||
        !catalog.definitions.some((d) => d.definitionKey === head.currentDefinitionKey)
      ) {
        throw new LevelStoreError("conflict", "Progress definition is not current");
      }
      // The in-memory store keeps no attendance and no student records, so BPT attendance is empty
      // and the date of birth is unknown; the baseline, the level start and the whole shape of the
      // summary come from the same helpers the Firestore store uses.
      return buildStudentProgressSummary({
        catalog,
        studentId,
        currentDefinitionKey: head.currentDefinitionKey,
        evaluations: studentEvaluations,
        attendedClassesCount: 0,
        totalHours: 0,
        currentLevelStartedAt: head.currentLevelStartedAt,
        classesAtLevel: countClassesAtLevel({
          attendedAt: [],
          currentLevelStartedAt: head.currentLevelStartedAt,
          importedBaseline: storedImportedBaseline(head.importedBaseline),
        }),
        dateOfBirth: null,
      });
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
      const graduationKey = `${academyId}_${input.studentId}_${graduationId}`;
      const headKey = `${academyId}_${input.studentId}`;
      const head = heads.get(headKey);
      const definitionOf = (definitionKey: string) =>
        Array.from(definitions.values()).find(
          (candidate) =>
            candidate["academyId"] === academyId && candidate["definitionKey"] === definitionKey,
        );
      const fromDefinition = definitionOf(input.fromDefinitionKey);
      const toDefinition = definitionOf(input.toDefinitionKey);
      // The same refusal the Firestore store raises, for the same five reasons.
      if (
        head === undefined ||
        head.academyId !== academyId ||
        head.studentId !== input.studentId ||
        head.state !== "initialized" ||
        head.currentDefinitionKey !== input.fromDefinitionKey ||
        fromDefinition === undefined ||
        toDefinition === undefined ||
        fromDefinition["systemId"] !== head.systemId ||
        toDefinition["systemId"] !== head.systemId ||
        typeof fromDefinition["sequence"] !== "number" ||
        toDefinition["sequence"] !== fromDefinition["sequence"] + 1 ||
        graduations.has(graduationKey)
      ) {
        throw new LevelStoreError("conflict", "Promotion references are not current");
      }

      const record: GraduationRecord & { readonly restore: PromotionRestore } = Object.freeze({
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
        restore: promotionRestoreOf(head),
      });

      graduations.set(graduationKey, record);
      const nextHead: Record<string, unknown> = { ...head };
      // Grill G10: the imported baseline belongs to the level it was imported at.
      delete nextHead.importedBaseline;
      heads.set(
        headKey,
        Object.freeze({
          ...(nextHead as StudentLevelHead),
          currentDefinitionKey: input.toDefinitionKey,
          currentLevelStartedAt: now,
          lastApprovedPromotionId: graduationId,
          state: "initialized",
          schemaVersion: "1",
          updatedAt: now,
          updatedBy: decidedBy,
        }),
      );
      return record;
    },

    async openStudentLevel(params): Promise<OpenedStudentLevel> {
      const { academyId, input, openedBy, openedByStaffId, openedByRole } = params;
      assertValidAcademyId(academyId);
      assertLevelOpeningRole(openedByRole);
      const now = params.openedAt ?? new Date().toISOString();
      assertLevelStartNotInTheFuture(input.startedOn, now);
      const key = `${academyId}_${input.studentId}`;
      if (heads.has(key)) throw new LevelStoreError("conflict", "Student level is already open");
      const definition = Array.from(definitions.values()).find(
        (candidate) =>
          candidate["academyId"] === academyId &&
          candidate["definitionKey"] === input.definitionKey,
      );
      if (definition === undefined) {
        throw new LevelStoreError("conflict", "Level definition is not current");
      }
      const record: StudentLevelHead = Object.freeze({
        academyId,
        studentId: input.studentId,
        systemId: String(definition["systemId"]),
        currentDefinitionKey: input.definitionKey,
        // Parity with the Firestore store: one day derives both opening fields.
        currentLevelStartedAt: `${input.startedOn ?? jerseyDateOf(now)}T00:00:00.000Z`,
        lastApprovedPromotionId: null,
        openedByStaffId,
        openingNotes: input.decisionNotes,
        openedDefinitionKey: input.definitionKey,
        openedOn: input.startedOn ?? jerseyDateOf(now),
        openedByRole,
        state: "initialized",
        schemaVersion: "1",
        createdAt: now,
        createdBy: openedBy,
        updatedAt: now,
        updatedBy: openedBy,
      });
      heads.set(key, record);
      // The in-memory store keeps no student records, so the band is evaluated without a birth
      // date and reads as not met whenever the belt has one: fail closed, never open.
      return { head: record, ageBand: openingAgeBand(definition, null, now) };
    },

    /**
     * Parity with the Firestore store: the same role, date and reference guards, the same shared
     * gap computation, the same restore snapshot and the same dropped baseline. Two things this
     * store cannot do are documented rather than faked: it has no `assertTransactionalActor`, so
     * actor identity is only ever proved against the Firestore store, and it keeps no attendance
     * and no student record, so classes count from the baseline alone and an unknown date of birth
     * makes an age band read as not met — an EXTRA gap, never a missing one.
     *
     * Three of the reference guards below are kept for parity but cannot be REACHED from this
     * store's public API, and are therefore proved against the Firestore store only: an in-memory
     * head is always `state: "initialized"`, always carries the systemId of the one catalogue this
     * academy can publish (a second `seed` is refused), and never carries an `importedBaseline`.
     */
    async assignLevel(params): Promise<AssignLevelResult> {
      const { academyId, input, decidedBy, decidedByRole } = params;
      assertValidAcademyId(academyId);
      assertPromotionDecisionRole(decidedByRole);
      const now = params.decidedAt ?? new Date().toISOString();
      assertOperatorDayNotInTheFuture("Promotion date", input.promotedOn, now);
      const promotionId = buildGraduationId(input.studentId, input.toDefinitionKey, now);
      const graduationKey = `${academyId}_${input.studentId}_${promotionId}`;
      const headKey = `${academyId}_${input.studentId}`;
      const head = heads.get(headKey);
      const [catalog, studentEvaluations] = await Promise.all([
        this.listPublished(academyId),
        this.listStudentEvaluations(academyId, input.studentId),
      ]);
      const definitionOf = (definitionKey: string) =>
        catalog.definitions.find((definition) => definition.definitionKey === definitionKey);
      const from = definitionOf(input.fromDefinitionKey);
      const to = definitionOf(input.toDefinitionKey);
      if (
        head === undefined ||
        head.academyId !== academyId ||
        head.studentId !== input.studentId ||
        head.state !== "initialized" ||
        head.systemId !== catalog.system.systemId ||
        head.currentDefinitionKey !== input.fromDefinitionKey ||
        from === undefined ||
        to === undefined ||
        to.sequence <= from.sequence ||
        graduations.has(graduationKey)
      ) {
        throw new LevelStoreError("conflict", "Promotion references are not current");
      }
      assertPromotionNotBeforeLevelStart(input.promotedOn, head.currentLevelStartedAt);
      const assignment = promotionAssignmentOf({
        catalog,
        from,
        to,
        input,
        currentLevelStartedAt: head.currentLevelStartedAt,
        importedBaseline: storedImportedBaseline(head.importedBaseline),
        attendedAt: [],
        evaluations: studentEvaluations,
        dateOfBirth: null,
      });
      graduations.set(
        graduationKey,
        Object.freeze({
          graduationId: promotionId,
          academyId,
          studentId: input.studentId,
          fromDefinitionKey: from.definitionKey,
          toDefinitionKey: to.definitionKey,
          status: "approved",
          decisionNotes: assignment.note ?? "",
          decidedBy,
          decidedByRole,
          decidedAt: now,
          ceremonyDate: null,
          schemaVersion: "1",
          createdAt: now,
          createdBy: decidedBy,
          updatedAt: now,
          updatedBy: decidedBy,
          ...assignment,
          restore: promotionRestoreOf(head),
        }),
      );
      const nextHead: Record<string, unknown> = { ...head };
      // Grill G10: the imported baseline belongs to the level it was imported at.
      delete nextHead.importedBaseline;
      heads.set(
        headKey,
        Object.freeze({
          ...(nextHead as StudentLevelHead),
          currentDefinitionKey: to.definitionKey,
          currentLevelStartedAt: `${input.promotedOn}T00:00:00.000Z`,
          lastApprovedPromotionId: promotionId,
          updatedAt: now,
          updatedBy: decidedBy,
        }),
      );
      return Object.freeze({
        promotionId,
        toDefinitionKey: to.definitionKey,
        promotedOn: input.promotedOn,
        gaps: [...assignment.gaps],
      });
    },

    /**
     * Parity with the Firestore store: the same role guard with the same message, the same
     * "only the promotion the head names, only once" rule, the same refusal for a promotion with
     * no restore snapshot, and the same restored head. As everywhere else in this store, actor
     * identity is not checked here (there is no `assertTransactionalActor`), so the identity half
     * is proved against the Firestore store only.
     */
    async voidPromotion(params): Promise<VoidPromotionResult> {
      const { academyId, input, decidedBy, decidedByStaffId, decidedByRole } = params;
      assertValidAcademyId(academyId);
      assertPromotionDecisionRole(decidedByRole);
      const reason = voidReasonOf(input.reason);
      const now = params.decidedAt ?? new Date().toISOString();
      const voidId = `void_${input.promotionId}`;
      const voidKey = `${academyId}_${input.studentId}_${voidId}`;
      const headKey = `${academyId}_${input.studentId}`;
      const head = heads.get(headKey);
      const promotion = graduations.get(`${academyId}_${input.studentId}_${input.promotionId}`);
      // Review of Task 10 (Major-5): the refusal clauses are no longer written twice. Both stores
      // ask the SAME function, so the in-memory store cannot drift from the Firestore one on any
      // of them — which is also why there is no separate in-memory clause left to mutate.
      const restore = voidRestoreOf({
        headData: head as unknown as Record<string, unknown> | undefined,
        promotionData: promotion as unknown as Record<string, unknown> | undefined,
        voidExists: voids.has(voidKey),
        academyId,
        studentId: input.studentId,
        promotionId: input.promotionId,
      });
      if (typeof restore === "string") {
        refuseVoid(restore, {
          academyId,
          studentId: input.studentId,
          promotionId: input.promotionId,
        });
      }
      const restoredBaseline = storedImportedBaseline(restore.importedBaseline ?? undefined);
      voids.set(
        voidKey,
        Object.freeze({
          promotionId: voidId,
          kind: "void",
          academyId,
          studentId: input.studentId,
          // As above: there is no head here only if `voidRestoreOf` already refused.
          systemId: (head as StudentLevelHead).systemId,
          voidsPromotionId: input.promotionId,
          reason,
          decidedBy,
          decidedByRole,
          decidedByStaffId,
          decidedAt: now,
          schemaVersion: "1",
          createdAt: now,
          createdBy: decidedBy,
          updatedAt: now,
          updatedBy: decidedBy,
        }),
      );
      const nextHead: Record<string, unknown> = {
        ...head,
        currentDefinitionKey: restore.currentDefinitionKey,
        currentLevelStartedAt: restore.currentLevelStartedAt,
        lastApprovedPromotionId: restore.lastApprovedPromotionId,
        updatedAt: now,
        updatedBy: decidedBy,
      };
      delete nextHead.importedBaseline;
      if (restoredBaseline !== null) nextHead.importedBaseline = restoredBaseline;
      heads.set(headKey, Object.freeze(nextHead as StudentLevelHead));
      return Object.freeze({
        voidId,
        voidsPromotionId: input.promotionId,
        restoredDefinitionKey: restore.currentDefinitionKey,
      });
    },

    async getStudentLevelHistory(
      academyId: string,
      studentId: string,
    ): Promise<StudentLevelHistory> {
      assertValidAcademyId(academyId);
      const head = heads.get(`${academyId}_${studentId}`);
      const promotions = [
        ...Array.from(graduations.values())
          .filter((record) => record.academyId === academyId && record.studentId === studentId)
          // The stored promotion is keyed by `graduationId` here and by `promotionId` in
          // Firestore; one shared builder reads both.
          .map((record) => ({ ...record, promotionId: record.graduationId })),
        ...Array.from(voids.values()).filter(
          (record) => record.academyId === academyId && record.studentId === studentId,
        ),
      ];
      return buildLevelHistory(
        studentId,
        head as unknown as Record<string, unknown> | undefined,
        promotions,
      );
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
