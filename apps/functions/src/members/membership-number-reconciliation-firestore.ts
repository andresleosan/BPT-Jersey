import { FieldPath, getFirestore, type Firestore } from "firebase-admin/firestore";

import type { AuditEventDraft } from "@bpt-jersey/domain/audit";
import {
  membershipNumberPlanSchema,
  type MembershipNumberPlan,
  type MembershipNumberPlanRow,
} from "@bpt-jersey/domain/members/membership-number";
import { z } from "zod";

import { appendAuditEventInTransaction } from "../audit/audit-writer.js";
import type { MemberDirectoryFirestore } from "./canonical-member-directory-service.js";
import { createMemberDirectoryFirestoreAdapters } from "./member-directory-firestore.js";
import { buildStudentIdentityKey, studentIdentityKeySchema } from "./member-directory-crypto.js";
import {
  buildMembershipNumberReconciliationPlan,
  membershipNumberPlanContentHash,
  type MembershipNumberSourceRow,
} from "./membership-number-reconciliation.js";

const safeIdentifier = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const sha256 = /^[a-f0-9]{64}$/u;
const chunkSize = 100;

const confirmationSchema = z
  .strictObject({
    academyId: z.string().regex(safeIdentifier),
    operationId: z.string().regex(safeIdentifier),
    contentHash: z.string().regex(sha256),
    confirmation: z.string().min(1).max(384),
    actorId: z.string().regex(safeIdentifier),
    appliedAt: z.string().datetime({ offset: false }),
  })
  .readonly();

const resultStatusSchema = z.enum(["applied", "already_applied", "stale", "manual_review"]);
const storedStatusSchema = z.enum(["applied", "stale", "manual_review"]);
const resultRowSchema = z
  .strictObject({
    recordRef: z.string(),
    status: resultStatusSchema,
  })
  .readonly();
const receiptSchema = z
  .strictObject({
    academyId: z.string().regex(safeIdentifier),
    operationId: z.string().regex(safeIdentifier),
    contentHash: z.string().regex(sha256),
    chunk: z.number().int().nonnegative().safe(),
    actorId: z.string().regex(safeIdentifier),
    appliedAt: z.string().datetime({ offset: false }),
    rows: z
      .array(
        z
          .strictObject({
            recordRef: z.string(),
            status: storedStatusSchema,
          })
          .readonly(),
      )
      .max(chunkSize)
      .readonly(),
    schemaVersion: z.literal("1"),
  })
  .readonly();

export type MembershipNumberReconciliationConfirmation = Readonly<
  z.infer<typeof confirmationSchema>
>;
export type MembershipNumberReconciliationResultRow = Readonly<z.infer<typeof resultRowSchema>>;
export type MembershipNumberReconciliationResult = Readonly<{
  academyId: string;
  operationId: string;
  contentHash: string;
  rows: readonly MembershipNumberReconciliationResultRow[];
}>;

export type MembershipNumberReconciliationStore = Readonly<{
  firestore: MemberDirectoryFirestore;
  identitySecretMaterial: string;
  identitySecretVersion: string;
  listSourceRows: (
    input: Readonly<{ academyId: string }>,
  ) => Promise<readonly MembershipNumberSourceRow[]>;
}>;

function planPayload(plan: MembershipNumberPlan) {
  return {
    academyId: plan.academyId,
    generatedAt: plan.generatedAt,
    rows: plan.rows,
    schemaVersion: plan.schemaVersion,
  } as const;
}

export function expectedMembershipNumberReconciliationConfirmation(
  input: Readonly<{ academyId: string; operationId: string; contentHash: string }>,
): string {
  const academyId = z.string().regex(safeIdentifier).parse(input.academyId);
  const operationId = z.string().regex(safeIdentifier).parse(input.operationId);
  const contentHash = z.string().regex(sha256).parse(input.contentHash);
  return `APPLY MEMBERSHIP NUMBERS ${academyId} ${operationId} ${contentHash}`;
}

export async function planMembershipNumberReconciliation(
  store: MembershipNumberReconciliationStore,
  input: Readonly<{ academyId: string; generatedAt: string }>,
): Promise<MembershipNumberPlan> {
  return buildMembershipNumberReconciliationPlan({
    academyId: input.academyId,
    generatedAt: input.generatedAt,
    rows: await store.listSourceRows({ academyId: input.academyId }),
  });
}

function sourcePath(academyId: string, row: MembershipNumberPlanRow): string {
  return `academies/${academyId}/${row.recordRef}`;
}

function receiptPath(academyId: string, operationId: string, chunk: number): string {
  return `academies/${academyId}/membershipNumberReconciliationReceipts/${operationId}:${chunk}`;
}

function auditPath(academyId: string, operationId: string, chunk: number, index: number): string {
  return `academies/${academyId}/auditEvents/membership-number:${operationId}:${chunk}:${index}`;
}

function identityPath(academyId: string, keyId: string): string {
  return `academies/${academyId}/studentIdentityKeys/${keyId}`;
}

function sameReceipt(
  receipt: z.infer<typeof receiptSchema>,
  confirmation: MembershipNumberReconciliationConfirmation,
  chunk: number,
  expectedRows: readonly MembershipNumberPlanRow[],
): boolean {
  return (
    receipt.academyId === confirmation.academyId &&
    receipt.operationId === confirmation.operationId &&
    receipt.contentHash === confirmation.contentHash &&
    receipt.chunk === chunk &&
    receipt.actorId === confirmation.actorId &&
    receipt.appliedAt === confirmation.appliedAt &&
    receipt.rows.length === expectedRows.length &&
    receipt.rows.every(
      (row, index) =>
        row.recordRef === expectedRows[index]?.recordRef &&
        (expectedRows[index]?.action !== "manual_review" || row.status === "manual_review"),
    )
  );
}

function replayRows(receipt: z.infer<typeof receiptSchema>) {
  return receipt.rows.map((row) => ({
    ...row,
    status: row.status === "applied" ? ("already_applied" as const) : row.status,
  }));
}

function chunks<T>(values: readonly T[], size: number): readonly (readonly T[])[] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

export async function applyMembershipNumberReconciliation(
  store: MembershipNumberReconciliationStore,
  planValue: MembershipNumberPlan,
  confirmationValue: MembershipNumberReconciliationConfirmation,
): Promise<MembershipNumberReconciliationResult> {
  const plan = membershipNumberPlanSchema.parse(planValue);
  const confirmation = confirmationSchema.parse(confirmationValue);
  const recalculatedHash = membershipNumberPlanContentHash(planPayload(plan));
  if (recalculatedHash !== plan.contentHash || confirmation.contentHash !== plan.contentHash) {
    throw new Error("Membership number plan hash mismatch");
  }
  if (confirmation.academyId !== plan.academyId) {
    throw new Error("Membership number plan academy mismatch");
  }
  const expectedConfirmation = expectedMembershipNumberReconciliationConfirmation(confirmation);
  if (confirmation.confirmation !== expectedConfirmation) {
    throw new Error("Membership number reconciliation confirmation mismatch");
  }

  const allRows: MembershipNumberReconciliationResultRow[] = [];
  for (const [chunk, rows] of chunks(plan.rows, chunkSize).entries()) {
    const result = await store.firestore.runTransaction(async (transaction) => {
      const receiptReference = store.firestore.doc(
        receiptPath(plan.academyId, confirmation.operationId, chunk),
      );
      const existingReceiptSnapshot = await transaction.get(receiptReference);
      if (existingReceiptSnapshot.exists) {
        const existingReceipt = receiptSchema.safeParse(existingReceiptSnapshot.data());
        if (
          !existingReceipt.success ||
          !sameReceipt(existingReceipt.data, confirmation, chunk, rows)
        ) {
          throw new Error("Membership number reconciliation receipt conflict");
        }
        return replayRows(existingReceipt.data);
      }

      // Firestore rejects any read after the first write of a transaction, so every row is read and
      // decided first; the writes follow in a second pass.
      const appliedRows: MembershipNumberReconciliationResultRow[] = [];
      const writes: (() => void)[] = [];
      const reservedInChunk = new Map<string, string>();
      for (const [index, row] of rows.entries()) {
        if (row.action === "manual_review") {
          appliedRows.push({ recordRef: row.recordRef, status: "manual_review" });
          continue;
        }
        if (row.proposed === undefined) throw new Error("Membership number proposal is missing");
        const proposed = row.proposed;
        const reference = store.firestore.doc(sourcePath(plan.academyId, row));
        const snapshot = await transaction.get(reference);
        if (!snapshot.exists || snapshot.version !== row.sourceVersion) {
          appliedRows.push({ recordRef: row.recordRef, status: "stale" });
          continue;
        }
        const current = snapshot.data();
        if (current === undefined) {
          appliedRows.push({ recordRef: row.recordRef, status: "stale" });
          continue;
        }
        const ownerField = row.sourceKind === "canonical" ? "studentId" : "memberId";
        if (current[ownerField] !== row.ownerId) {
          appliedRows.push({ recordRef: row.recordRef, status: "stale" });
          continue;
        }

        const identity = buildStudentIdentityKey({
          academyId: plan.academyId,
          kind: "membership-number",
          value: proposed,
          ownerStudentId: row.ownerId,
          secretMaterial: store.identitySecretMaterial,
          secretVersion: store.identitySecretVersion,
          actorId: confirmation.actorId,
          now: confirmation.appliedAt,
        });
        const identityReference = store.firestore.doc(identityPath(plan.academyId, identity.keyId));
        // A pending reservation from an earlier row of this chunk is invisible to transaction reads.
        let reservedBy = reservedInChunk.get(identity.keyId);
        if (reservedBy === undefined) {
          const identitySnapshot = await transaction.get(identityReference);
          if (identitySnapshot.exists) {
            const existingIdentity = studentIdentityKeySchema.safeParse(identitySnapshot.data());
            if (!existingIdentity.success) {
              throw new Error("Membership number identity reservation conflict");
            }
            reservedBy = existingIdentity.data.ownerStudentId;
          }
        }
        if (reservedBy !== undefined && reservedBy !== row.ownerId) {
          appliedRows.push({ recordRef: row.recordRef, status: "manual_review" });
          continue;
        }
        const createReservation = reservedBy === undefined;
        reservedInChunk.set(identity.keyId, row.ownerId);

        writes.push(() => {
          if (createReservation) transaction.create(identityReference, identity);
          transaction.set(reference, { ...current, membershipNumber: proposed });
          appendAuditEventInTransaction(
            transaction,
            store.firestore.doc(auditPath(plan.academyId, confirmation.operationId, chunk, index)),
            {
              academyId: plan.academyId,
              actorId: confirmation.actorId,
              action: "member.updated",
              targetRef: "academies/" + plan.academyId + "/students/" + row.ownerId,
              purpose: "member-record-maintenance",
              correlationId: "write-" + plan.contentHash,
            } as AuditEventDraft,
          );
        });
        appliedRows.push({ recordRef: row.recordRef, status: "applied" });
      }
      for (const write of writes) write();

      transaction.create(
        receiptReference,
        receiptSchema.parse({
          academyId: plan.academyId,
          operationId: confirmation.operationId,
          contentHash: plan.contentHash,
          chunk,
          actorId: confirmation.actorId,
          appliedAt: confirmation.appliedAt,
          rows: appliedRows,
          schemaVersion: "1",
        }),
      );
      return appliedRows;
    });
    allRows.push(...result);
  }

  return Object.freeze({
    academyId: plan.academyId,
    operationId: confirmation.operationId,
    contentHash: plan.contentHash,
    rows: Object.freeze(allRows.map((row) => Object.freeze(row))),
  });
}

type ReconciliationFirestoreStoreOptions = Readonly<{
  firestore?: Firestore;
  identitySecretMaterial: string;
  identitySecretVersion?: string;
}>;

async function listCollectionRows(
  firestore: Firestore,
  academyId: string,
  collection: "studentAdminProfiles" | "members",
): Promise<readonly MembershipNumberSourceRow[]> {
  const rows: MembershipNumberSourceRow[] = [];
  let afterId: string | undefined;
  do {
    let query = firestore
      .collection(`academies/${academyId}/${collection}`)
      .orderBy(FieldPath.documentId())
      .limit(250);
    if (afterId !== undefined) query = query.startAfter(afterId);
    const snapshot = await query.get();
    for (const document of snapshot.docs) {
      const data = document.data();
      const membershipNumber = data.membershipNumber;
      const ownerId = collection === "studentAdminProfiles" ? data.studentId : data.memberId;
      if (typeof membershipNumber !== "string" || typeof ownerId !== "string") continue;
      if (document.updateTime === undefined) {
        throw new Error("Membership number source version is unavailable");
      }
      rows.push({
        recordRef: `${collection}/${document.id}`,
        sourceKind: collection === "studentAdminProfiles" ? "canonical" : "legacy",
        ownerId,
        sourceVersion: `${document.updateTime.seconds}:${document.updateTime.nanoseconds}`,
        membershipNumber,
      });
    }
    afterId = snapshot.size === 250 ? snapshot.docs.at(-1)?.id : undefined;
  } while (afterId !== undefined);
  return rows;
}

export function createMembershipNumberReconciliationFirestoreStore(
  options: ReconciliationFirestoreStoreOptions,
): MembershipNumberReconciliationStore {
  const firestore = options.firestore ?? getFirestore();
  return Object.freeze({
    firestore: createMemberDirectoryFirestoreAdapters(firestore).writer,
    identitySecretMaterial: options.identitySecretMaterial,
    identitySecretVersion: options.identitySecretVersion ?? "identity-v1",
    async listSourceRows({ academyId }) {
      const [canonical, legacy] = await Promise.all([
        listCollectionRows(firestore, academyId, "studentAdminProfiles"),
        listCollectionRows(firestore, academyId, "members"),
      ]);
      return Object.freeze([...canonical, ...legacy]);
    },
  });
}
