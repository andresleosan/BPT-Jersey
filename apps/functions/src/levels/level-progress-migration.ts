import { createHash } from "node:crypto";

import { z } from "zod";

import type { GenericFirestore } from "./level-service.js";
import { levelCatalogStorageId } from "./level-catalog-integrity.js";

const safeIdentifier = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const hashPattern = /^[a-f0-9]{64}$/u;
const isoTimestamp = z.string().datetime({ offset: false });
const maximumHeads = 10_000;

const decisionStatusSchema = z.enum(["migrate", "already_v3", "stale", "manual_review"]);
const planStatusSchema = z.enum(["migrate", "already_v3", "manual_review"]);
const planRowSchema = z
  .strictObject({
    recordId: z.string().regex(safeIdentifier),
    studentId: z.string().regex(safeIdentifier).nullable(),
    currentDefinitionKey: z.string().regex(safeIdentifier).optional(),
    expectedUpdatedAt: isoTimestamp.optional(),
    status: planStatusSchema,
    reason: z.string().min(1).max(80).optional(),
  })
  .readonly();
const planPayloadObjectSchema = z.strictObject({
  academyId: z.string().regex(safeIdentifier),
  operationId: z.string().regex(safeIdentifier),
  generatedAt: isoTimestamp,
  fromSystemId: z.literal("ibjjf-v2"),
  toSystemId: z.literal("ibjjf-v3"),
  rows: z.array(planRowSchema).max(maximumHeads).readonly(),
  schemaVersion: z.literal("1"),
});
const planPayloadSchema = planPayloadObjectSchema.readonly();
const planSchema = planPayloadObjectSchema
  .extend({ contentHash: z.string().regex(hashPattern) })
  .readonly();
const confirmationSchema = z
  .strictObject({
    academyId: z.string().regex(safeIdentifier),
    operationId: z.string().regex(safeIdentifier),
    contentHash: z.string().regex(hashPattern),
    confirmation: z.string().min(1).max(384),
    actorId: z.string().regex(safeIdentifier),
    appliedAt: isoTimestamp,
  })
  .readonly();
const receiptSchema = z
  .strictObject({
    academyId: z.string().regex(safeIdentifier),
    operationId: z.string().regex(safeIdentifier),
    contentHash: z.string().regex(hashPattern),
    studentId: z.string().regex(safeIdentifier),
    definitionKey: z.string().regex(safeIdentifier),
    expectedUpdatedAt: isoTimestamp,
    migratedAt: isoTimestamp,
    migratedBy: z.string().regex(safeIdentifier),
    schemaVersion: z.literal("1"),
  })
  .readonly();

export type LevelProgressMigrationPlan = Readonly<z.infer<typeof planSchema>>;
export type LevelProgressMigrationConfirmation = Readonly<z.infer<typeof confirmationSchema>>;
export type LevelProgressMigrationResult = Readonly<{
  academyId: string;
  operationId: string;
  contentHash: string;
  rows: readonly Readonly<{
    studentId: string | null;
    status: z.infer<typeof decisionStatusSchema>;
  }>[];
}>;

export type LevelProgressMigrationStore = Readonly<{
  firestore: GenericFirestore;
  v3DefinitionKeys: readonly string[];
  listHeads: (academyId: string) => Promise<
    readonly Readonly<{
      recordId: string;
      data: Readonly<Record<string, unknown>>;
    }>[]
  >;
}>;

type ValidHead = Readonly<{
  academyId: string;
  studentId: string;
  systemId: string;
  currentDefinitionKey: string;
  updatedAt: string;
}>;

function validHead(value: unknown): ValidHead | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Readonly<Record<string, unknown>>;
  if (
    typeof record.academyId !== "string" ||
    !safeIdentifier.test(record.academyId) ||
    typeof record.studentId !== "string" ||
    !safeIdentifier.test(record.studentId) ||
    typeof record.systemId !== "string" ||
    typeof record.currentDefinitionKey !== "string" ||
    !safeIdentifier.test(record.currentDefinitionKey) ||
    typeof record.updatedAt !== "string" ||
    !isoTimestamp.safeParse(record.updatedAt).success ||
    record.state !== "initialized" ||
    record.schemaVersion !== "1"
  ) {
    return null;
  }
  return {
    academyId: record.academyId,
    studentId: record.studentId,
    systemId: record.systemId,
    currentDefinitionKey: record.currentDefinitionKey,
    updatedAt: record.updatedAt,
  };
}

export type LevelProgressMigrationDecision = Readonly<{
  status: "migrate" | "already_v3" | "manual_review";
  studentId: string | null;
  fromSystemId?: "ibjjf-v2";
  toSystemId?: "ibjjf-v3";
  currentDefinitionKey?: string;
  expectedUpdatedAt?: string;
  reason?: string;
}>;

export function decideProgressHeadMigration(
  value: unknown,
  v3DefinitionKeys: readonly string[],
): LevelProgressMigrationDecision {
  const head = validHead(value);
  if (head === null) return { status: "manual_review", studentId: null, reason: "invalid_head" };
  const definitions = new Set(v3DefinitionKeys);
  if (!definitions.has(head.currentDefinitionKey)) {
    return {
      status: "manual_review",
      studentId: head.studentId,
      currentDefinitionKey: head.currentDefinitionKey,
      expectedUpdatedAt: head.updatedAt,
      reason: "unknown_definition",
    };
  }
  if (head.systemId === "ibjjf-v3") {
    return {
      status: "already_v3",
      studentId: head.studentId,
      currentDefinitionKey: head.currentDefinitionKey,
      expectedUpdatedAt: head.updatedAt,
    };
  }
  if (head.systemId !== "ibjjf-v2") {
    return {
      status: "manual_review",
      studentId: head.studentId,
      currentDefinitionKey: head.currentDefinitionKey,
      expectedUpdatedAt: head.updatedAt,
      reason: "unsupported_source_system",
    };
  }
  return {
    status: "migrate",
    studentId: head.studentId,
    fromSystemId: "ibjjf-v2",
    toSystemId: "ibjjf-v3",
    currentDefinitionKey: head.currentDefinitionKey,
    expectedUpdatedAt: head.updatedAt,
  };
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new Error("Unsafe migration plan number");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new Error("Unsupported migration plan value");
  }
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
    .join(",")}}`;
}

function contentHash(payload: z.infer<typeof planPayloadSchema>): string {
  return createHash("sha256")
    .update(canonicalJson(planPayloadSchema.parse(payload)))
    .digest("hex");
}

function payloadOf(plan: LevelProgressMigrationPlan): z.infer<typeof planPayloadSchema> {
  return {
    academyId: plan.academyId,
    operationId: plan.operationId,
    generatedAt: plan.generatedAt,
    fromSystemId: plan.fromSystemId,
    toSystemId: plan.toSystemId,
    rows: plan.rows,
    schemaVersion: plan.schemaVersion,
  };
}

export async function planLevelProgressMigration(
  store: LevelProgressMigrationStore,
  input: Readonly<{ academyId: string; operationId: string; generatedAt: string }>,
): Promise<LevelProgressMigrationPlan> {
  const scope = z
    .strictObject({
      academyId: z.string().regex(safeIdentifier),
      operationId: z.string().regex(safeIdentifier),
      generatedAt: isoTimestamp,
    })
    .parse(input);
  const definitions = [...new Set(store.v3DefinitionKeys)].sort();
  if (definitions.length === 0 || definitions.some((key) => !safeIdentifier.test(key))) {
    throw new Error("Invalid ibjjf-v3 definition set");
  }
  const sourceRows = await store.listHeads(scope.academyId);
  if (sourceRows.length > maximumHeads) throw new Error("Progress head limit exceeded");
  const rows = sourceRows
    .map(({ recordId, data }) => {
      const candidate = decideProgressHeadMigration(data, definitions);
      const scoped =
        data.academyId === scope.academyId &&
        candidate.studentId !== null &&
        candidate.studentId === recordId;
      const decision =
        candidate.studentId === null
          ? candidate
          : scoped
            ? candidate
            : ({
                status: "manual_review",
                studentId: candidate.studentId,
                reason: "scope_mismatch",
              } as const);
      return {
        recordId,
        studentId: decision.studentId,
        ...(decision.currentDefinitionKey === undefined
          ? {}
          : { currentDefinitionKey: decision.currentDefinitionKey }),
        ...(decision.expectedUpdatedAt === undefined
          ? {}
          : { expectedUpdatedAt: decision.expectedUpdatedAt }),
        status: decision.status,
        ...(decision.reason === undefined ? {} : { reason: decision.reason }),
      };
    })
    .sort((left, right) =>
      left.recordId < right.recordId ? -1 : left.recordId > right.recordId ? 1 : 0,
    );
  const payload = planPayloadSchema.parse({
    ...scope,
    fromSystemId: "ibjjf-v2",
    toSystemId: "ibjjf-v3",
    rows,
    schemaVersion: "1",
  });
  return planSchema.parse({ ...payload, contentHash: contentHash(payload) });
}

export function expectedLevelProgressMigrationConfirmation(
  input: Readonly<{ academyId: string; operationId: string; contentHash: string }>,
): string {
  const academyId = z.string().regex(safeIdentifier).parse(input.academyId);
  const operationId = z.string().regex(safeIdentifier).parse(input.operationId);
  const hash = z.string().regex(hashPattern).parse(input.contentHash);
  return `APPLY LEVEL PROGRESS V3 ${academyId} ${operationId} ${hash}`;
}

export function expectedLevelCatalogActivationConfirmation(
  input: Readonly<{ academyId: string; operationId: string; contentHash: string }>,
): string {
  const academyId = z.string().regex(safeIdentifier).parse(input.academyId);
  const operationId = z.string().regex(safeIdentifier).parse(input.operationId);
  const hash = z.string().regex(hashPattern).parse(input.contentHash);
  return `ACTIVATE LEVEL CATALOG V3 ${academyId} ${operationId} ${hash}`;
}

function receiptId(academyId: string, operationId: string, recordId: string): string {
  return createHash("sha256").update(`${academyId}:${operationId}:${recordId}`).digest("hex");
}

export async function applyLevelProgressMigration(
  store: LevelProgressMigrationStore,
  planValue: LevelProgressMigrationPlan,
  confirmationValue: LevelProgressMigrationConfirmation,
): Promise<LevelProgressMigrationResult> {
  const plan = planSchema.parse(planValue);
  const confirmation = confirmationSchema.parse(confirmationValue);
  if (
    contentHash(payloadOf(plan)) !== plan.contentHash ||
    plan.contentHash !== confirmation.contentHash
  ) {
    throw new Error("Level progress migration hash mismatch");
  }
  if (plan.academyId !== confirmation.academyId) {
    throw new Error("Level progress migration academy mismatch");
  }
  if (plan.operationId !== confirmation.operationId) {
    throw new Error("Level progress migration operation mismatch");
  }
  if (confirmation.confirmation !== expectedLevelProgressMigrationConfirmation(confirmation)) {
    throw new Error("Level progress migration confirmation mismatch");
  }

  const resultRows: { studentId: string | null; status: z.infer<typeof decisionStatusSchema> }[] =
    [];
  for (const row of plan.rows) {
    if (
      row.status === "manual_review" ||
      row.studentId === null ||
      row.currentDefinitionKey === undefined ||
      row.expectedUpdatedAt === undefined
    ) {
      resultRows.push({ studentId: row.studentId, status: "manual_review" });
      continue;
    }
    const outcome = await store.firestore.runTransaction(async (transaction) => {
      const headRef = store.firestore.doc(
        `academies/${plan.academyId}/studentLevelProgress/${row.recordId}`,
      );
      const definitionRef = store.firestore.doc(
        `academies/${plan.academyId}/levelDefinitions/${levelCatalogStorageId("ibjjf-v3", row.currentDefinitionKey)}`,
      );
      const systemRef = store.firestore.doc(`academies/${plan.academyId}/levelSystems/ibjjf-v3`);
      const id = receiptId(plan.academyId, plan.operationId, row.recordId);
      const receiptRef = store.firestore.doc(
        `academies/${plan.academyId}/levelProgressMigrationReceipts/${id}`,
      );
      const [headSnapshot, definitionSnapshot, systemSnapshot, receiptSnapshot] = await Promise.all(
        [
          transaction.get(headRef),
          transaction.get(definitionRef),
          transaction.get(systemRef),
          transaction.get(receiptRef),
        ],
      );
      const current = headSnapshot.data();
      const definition = definitionSnapshot.data();
      const system = systemSnapshot.data();
      if (receiptSnapshot.exists) {
        const receipt = receiptSchema.safeParse(receiptSnapshot.data());
        const head = validHead(current);
        const migration =
          typeof current?.levelCatalogMigration === "object" &&
          current.levelCatalogMigration !== null &&
          !Array.isArray(current.levelCatalogMigration)
            ? (current.levelCatalogMigration as Readonly<Record<string, unknown>>)
            : undefined;
        if (
          !receipt.success ||
          receipt.data.academyId !== plan.academyId ||
          receipt.data.operationId !== plan.operationId ||
          receipt.data.contentHash !== plan.contentHash ||
          receipt.data.studentId !== row.studentId ||
          receipt.data.definitionKey !== row.currentDefinitionKey ||
          head === null ||
          head.systemId !== "ibjjf-v3" ||
          head.currentDefinitionKey !== row.currentDefinitionKey ||
          head.updatedAt !== receipt.data.migratedAt ||
          current?.updatedBy !== receipt.data.migratedBy ||
          migration?.operationId !== plan.operationId ||
          migration?.fromSystemId !== "ibjjf-v2" ||
          migration?.toSystemId !== "ibjjf-v3"
        ) {
          throw new Error("Level progress migration receipt conflict");
        }
        return "already_v3" as const;
      }
      const head = validHead(current);
      if (
        !headSnapshot.exists ||
        head === null ||
        head.academyId !== plan.academyId ||
        head.studentId !== row.studentId ||
        head.updatedAt !== row.expectedUpdatedAt
      ) {
        return "stale" as const;
      }
      const currentDecision = decideProgressHeadMigration(current, store.v3DefinitionKeys);
      if (currentDecision.status === "already_v3") return "already_v3" as const;
      if (row.status !== "migrate") return "stale" as const;
      if (currentDecision.status !== "migrate") return "manual_review" as const;
      if (
        !systemSnapshot.exists ||
        system?.academyId !== plan.academyId ||
        system.systemId !== "ibjjf-v3" ||
        system.status !== "published" ||
        !definitionSnapshot.exists ||
        definition?.academyId !== plan.academyId ||
        definition.systemId !== "ibjjf-v3" ||
        definition.definitionKey !== row.currentDefinitionKey
      ) {
        return "manual_review" as const;
      }

      const migration = {
        fromSystemId: "ibjjf-v2",
        toSystemId: "ibjjf-v3",
        operationId: plan.operationId,
        migratedAt: confirmation.appliedAt,
        migratedBy: confirmation.actorId,
      } as const;
      transaction.set(
        headRef,
        {
          systemId: "ibjjf-v3",
          updatedAt: confirmation.appliedAt,
          updatedBy: confirmation.actorId,
          levelCatalogMigration: migration,
        },
        { merge: true },
      );
      transaction.create(
        store.firestore.doc(`academies/${plan.academyId}/levelProgressMigrationAudits/${id}`),
        {
          auditId: id,
          academyId: plan.academyId,
          action: "level.progress.head.migrated",
          targetRef: `academies/${plan.academyId}/studentLevelProgress/${row.recordId}`,
          actorId: confirmation.actorId,
          operationId: plan.operationId,
          definitionKey: row.currentDefinitionKey,
          occurredAt: confirmation.appliedAt,
          schemaVersion: "1",
        },
      );
      transaction.create(
        receiptRef,
        receiptSchema.parse({
          academyId: plan.academyId,
          operationId: plan.operationId,
          contentHash: plan.contentHash,
          studentId: row.studentId,
          definitionKey: row.currentDefinitionKey,
          expectedUpdatedAt: row.expectedUpdatedAt,
          migratedAt: confirmation.appliedAt,
          migratedBy: confirmation.actorId,
          schemaVersion: "1",
        }),
      );
      return "migrate" as const;
    });
    resultRows.push({ studentId: row.studentId, status: outcome });
  }
  return Object.freeze({
    academyId: plan.academyId,
    operationId: plan.operationId,
    contentHash: plan.contentHash,
    rows: Object.freeze(resultRows.map((row) => Object.freeze(row))),
  });
}

export function createLevelProgressMigrationStore(
  firestore: GenericFirestore,
  v3DefinitionKeys: readonly string[],
): LevelProgressMigrationStore {
  return Object.freeze({
    firestore,
    v3DefinitionKeys: Object.freeze([...v3DefinitionKeys]),
    async listHeads(academyId) {
      const snapshot = await firestore
        .collection(`academies/${academyId}/studentLevelProgress`)
        .get();
      if (snapshot.docs.length > maximumHeads) throw new Error("Progress head limit exceeded");
      return Object.freeze(
        snapshot.docs.map((document) =>
          Object.freeze({ recordId: document.id, data: Object.freeze({ ...document.data() }) }),
        ),
      );
    },
  });
}
