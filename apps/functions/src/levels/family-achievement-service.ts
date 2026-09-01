import { matchesAuditEventReplay, appendAuditEventInTransaction } from "../audit/audit-writer.js";
import { parseAuditEventDraft, type AuditEventDraft } from "@bpt-jersey/domain/audit";
import {
  parseFamilyAchievementSummary,
  type FamilyAchievementSummary,
} from "@bpt-jersey/domain/levels/achievements";

export class FamilyAchievementStoreError extends Error {
  public readonly code: "invalid" | "tenant" | "not-found" | "conflict";

  public constructor(code: "invalid" | "tenant" | "not-found" | "conflict", message: string) {
    super(message);
    this.name = "FamilyAchievementStoreError";
    this.code = code;
  }
}

export type FamilyAchievementSnapshotWriteResult = Readonly<{
  snapshotId: string;
  auditEventId: string;
  replayed: boolean;
}>;

export type FamilyAchievementStore = Readonly<{
  getSnapshot: (academyId: string, familyId: string) => Promise<FamilyAchievementSummary>;
  saveSnapshot: (input: {
    academyId: string;
    summary: FamilyAchievementSummary;
    generatedBy: string;
    correlationId: string;
  }) => Promise<FamilyAchievementSnapshotWriteResult>;
}>;

type FamilyAchievementSnapshotRecord = Readonly<{
  academyId: string;
  familyId: string;
  generatedAt: string;
  members: FamilyAchievementSummary["members"];
  adultComparison: FamilyAchievementSummary["adultComparison"];
  schemaVersion: 1;
}>;

type GenericDocumentSnapshot = Readonly<{
  exists: boolean;
  data: () => Record<string, unknown> | undefined;
}>;

type GenericDocumentReference = Readonly<{
  id: string;
  get: () => Promise<GenericDocumentSnapshot>;
}>;

export type GenericFamilyAchievementFirestore = Readonly<{
  doc: (path: string) => GenericDocumentReference;
  collection: (path: string) => Readonly<{
    get: () => Promise<{
      docs: readonly { id: string; data: () => Record<string, unknown> }[];
    }>;
  }>;
  runTransaction: <T>(
    update: (transaction: {
      get: (reference: GenericDocumentReference) => Promise<GenericDocumentSnapshot>;
      create: (
        reference: GenericDocumentReference,
        data: Readonly<Record<string, unknown>>,
      ) => void;
    }) => Promise<T>,
  ) => Promise<T>;
}>;

const safeIdentifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

function assertIdentifier(value: string, label: string): void {
  if (!safeIdentifierPattern.test(value)) {
    throw new FamilyAchievementStoreError("invalid", label + " is invalid");
  }
}

function assertAcademyScope(academyId: string, summary: FamilyAchievementSummary): void {
  assertIdentifier(academyId, "academyId");
  assertIdentifier(summary.familyId, "familyId");
}

function snapshotId(academyId: string, summary: FamilyAchievementSummary): string {
  return (
    "family-achievements-v1__" + academyId + "__" + summary.familyId + "__" + summary.generatedAt
  );
}

function toSnapshotRecord(
  academyId: string,
  summary: FamilyAchievementSummary,
): FamilyAchievementSnapshotRecord {
  return Object.freeze({
    academyId,
    familyId: summary.familyId,
    generatedAt: summary.generatedAt,
    members: summary.members,
    adultComparison: summary.adultComparison,
    schemaVersion: 1,
  });
}

function toSummary(record: FamilyAchievementSnapshotRecord): FamilyAchievementSummary {
  return Object.freeze({
    familyId: record.familyId,
    generatedAt: record.generatedAt,
    members: record.members,
    adultComparison: record.adultComparison,
  });
}

function parseStoredSnapshot(
  data: Record<string, unknown> | undefined,
): FamilyAchievementSnapshotRecord {
  if (
    data === undefined ||
    Object.keys(data).length !== 6 ||
    data.schemaVersion !== 1 ||
    typeof data.academyId !== "string" ||
    typeof data.familyId !== "string" ||
    typeof data.generatedAt !== "string" ||
    !Array.isArray(data.members) ||
    !Array.isArray(data.adultComparison)
  ) {
    throw new FamilyAchievementStoreError(
      "invalid",
      "Persisted family achievement snapshot is invalid",
    );
  }

  const parsed = parseFamilyAchievementSummary({
    familyId: data.familyId,
    generatedAt: data.generatedAt,
    members: data.members,
    adultComparison: data.adultComparison,
  });
  if (!parsed.ok) {
    throw new FamilyAchievementStoreError(
      "invalid",
      "Persisted family achievement summary is invalid",
    );
  }
  assertIdentifier(data.academyId, "academyId");
  return Object.freeze({
    academyId: data.academyId,
    familyId: parsed.value.familyId,
    generatedAt: parsed.value.generatedAt,
    members: parsed.value.members,
    adultComparison: parsed.value.adultComparison,
    schemaVersion: 1,
  });
}

function sameSnapshot(
  left: FamilyAchievementSnapshotRecord,
  right: FamilyAchievementSnapshotRecord,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function buildAuditDraft(input: {
  academyId: string;
  summary: FamilyAchievementSummary;
  generatedBy: string;
  correlationId: string;
  snapshotId: string;
}): AuditEventDraft {
  const candidateCount = input.summary.members.reduce(
    (count, member) => count + member.achievementCandidates.length,
    0,
  );
  const draft = {
    academyId: input.academyId,
    actorId: input.generatedBy,
    action: "family.achievements.generated" as const,
    targetRef:
      "academies/" + input.academyId + "/familyAchievementSnapshots/" + input.summary.familyId,
    purpose: "family achievement snapshot generation",
    correlationId: input.correlationId,
    familyId: input.summary.familyId,
    snapshotId: input.snapshotId,
    memberCount: input.summary.members.length,
    candidateCount,
    generatedAt: input.summary.generatedAt,
  };
  const parsed = parseAuditEventDraft(draft);
  if (!parsed.ok) {
    throw new FamilyAchievementStoreError("invalid", "Family achievement audit is invalid");
  }
  return parsed.value;
}

function findLatestSnapshot(
  docs: readonly { id: string; data: () => Record<string, unknown> }[],
  academyId: string,
  familyId: string,
): FamilyAchievementSummary | undefined {
  const candidates = docs
    .map((document) => parseStoredSnapshot(document.data()))
    .filter((record) => record.academyId === academyId && record.familyId === familyId)
    .sort((left, right) => right.generatedAt.localeCompare(left.generatedAt));
  return candidates[0] ? toSummary(candidates[0]) : undefined;
}

export function buildFamilyAchievementSnapshotId(
  academyId: string,
  familyId: string,
  generatedAt: string,
): string {
  assertIdentifier(academyId, "academyId");
  assertIdentifier(familyId, "familyId");
  const parsed = parseFamilyAchievementSummary({
    familyId,
    generatedAt,
    members: [],
    adultComparison: [],
  });
  if (!parsed.ok) {
    throw new FamilyAchievementStoreError("invalid", "generatedAt is invalid");
  }
  return snapshotId(academyId, parsed.value);
}

export function createInMemoryFamilyAchievementStore(): FamilyAchievementStore {
  const snapshots = new Map<string, FamilyAchievementSnapshotRecord>();
  const audits = new Map<string, Readonly<Record<string, unknown>>>();

  return {
    async getSnapshot(academyId, familyId) {
      assertIdentifier(academyId, "academyId");
      assertIdentifier(familyId, "familyId");
      const latest = [...snapshots.values()]
        .filter((record) => record.academyId === academyId && record.familyId === familyId)
        .sort((left, right) => right.generatedAt.localeCompare(left.generatedAt))[0];
      if (!latest) {
        throw new FamilyAchievementStoreError("not-found", "Family achievement snapshot not found");
      }
      return toSummary(latest);
    },

    async saveSnapshot(input) {
      const parsed = parseFamilyAchievementSummary(input.summary);
      if (!parsed.ok) {
        throw new FamilyAchievementStoreError("invalid", "Family achievement summary is invalid");
      }
      assertAcademyScope(input.academyId, parsed.value);
      assertIdentifier(input.generatedBy, "generatedBy");
      if (input.correlationId.length === 0 || input.correlationId.length > 256) {
        throw new FamilyAchievementStoreError("invalid", "correlationId is invalid");
      }
      const summary = parsed.value;
      const id = snapshotId(input.academyId, summary);
      const audit = buildAuditDraft({ ...input, summary, snapshotId: id });
      const record = toSnapshotRecord(input.academyId, summary);
      const existing = snapshots.get(id);
      const existingAudit = audits.get(id);

      if (existing || existingAudit) {
        if (
          !existing ||
          !existingAudit ||
          !sameSnapshot(existing, record) ||
          !matchesAuditEventReplay(existingAudit, id, audit)
        ) {
          throw new FamilyAchievementStoreError("conflict", "Family achievement replay differs");
        }
        return Object.freeze({ snapshotId: id, auditEventId: id, replayed: true });
      }

      snapshots.set(id, record);
      audits.set(
        id,
        Object.freeze({
          ...audit,
          auditEventId: id,
          occurredAt: summary.generatedAt,
          result: "completed",
          schemaVersion: 1,
        }),
      );
      return Object.freeze({ snapshotId: id, auditEventId: id, replayed: false });
    },
  };
}

export function createFirestoreFamilyAchievementStore({
  firestore,
}: {
  firestore: GenericFamilyAchievementFirestore;
}): FamilyAchievementStore {
  return {
    async getSnapshot(academyId, familyId) {
      assertIdentifier(academyId, "academyId");
      assertIdentifier(familyId, "familyId");
      const result = await firestore
        .collection("academies/" + academyId + "/familyAchievementSnapshots")
        .get();
      const latest = findLatestSnapshot(result.docs, academyId, familyId);
      if (!latest) {
        throw new FamilyAchievementStoreError("not-found", "Family achievement snapshot not found");
      }
      return latest;
    },

    async saveSnapshot(input) {
      const parsed = parseFamilyAchievementSummary(input.summary);
      if (!parsed.ok) {
        throw new FamilyAchievementStoreError("invalid", "Family achievement summary is invalid");
      }
      assertAcademyScope(input.academyId, parsed.value);
      assertIdentifier(input.generatedBy, "generatedBy");
      if (input.correlationId.length === 0 || input.correlationId.length > 256) {
        throw new FamilyAchievementStoreError("invalid", "correlationId is invalid");
      }
      const summary = parsed.value;
      const id = snapshotId(input.academyId, summary);
      const audit = buildAuditDraft({ ...input, summary, snapshotId: id });
      const record = toSnapshotRecord(input.academyId, summary);
      const snapshotReference = firestore.doc(
        "academies/" + input.academyId + "/familyAchievementSnapshots/" + id,
      );
      const auditReference = firestore.doc("academies/" + input.academyId + "/auditEvents/" + id);

      return firestore.runTransaction(async (transaction) => {
        const [snapshotState, auditState] = await Promise.all([
          transaction.get(snapshotReference),
          transaction.get(auditReference),
        ]);
        if (snapshotState.exists || auditState.exists) {
          if (!snapshotState.exists || !auditState.exists) {
            throw new FamilyAchievementStoreError(
              "conflict",
              "Family achievement replay is incomplete",
            );
          }
          const existing = parseStoredSnapshot(snapshotState.data());
          if (
            !sameSnapshot(existing, record) ||
            !matchesAuditEventReplay(auditState.data(), id, audit)
          ) {
            throw new FamilyAchievementStoreError("conflict", "Family achievement replay differs");
          }
          return Object.freeze({ snapshotId: id, auditEventId: id, replayed: true });
        }

        transaction.create(snapshotReference, record);
        appendAuditEventInTransaction(transaction, auditReference, audit);
        return Object.freeze({ snapshotId: id, auditEventId: id, replayed: false });
      });
    },
  };
}
