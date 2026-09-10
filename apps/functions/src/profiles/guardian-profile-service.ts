import { randomUUID } from "node:crypto";

import { parseUserProfile, type UserProfile } from "@bpt-jersey/domain/profiles";
import type { AuditEventDraft } from "@bpt-jersey/domain/audit";
import { z } from "zod";

import { appendAuditEventInTransaction, matchesAuditEventReplay } from "../audit/audit-writer.js";
import {
  constantTimeMacEquals,
  createMemberDirectoryIntegrityMac,
  decodeMemberDirectorySecret,
} from "../members/member-directory-crypto.js";

export type GuardianProfileDocumentData = Readonly<Record<string, unknown>>;
export type GuardianProfileDocumentReference = Readonly<{ id: string; path: string }>;
export type GuardianProfileDocumentSnapshot = Readonly<{
  id: string;
  exists: boolean;
  data: () => GuardianProfileDocumentData | undefined;
}>;
export type GuardianProfileTransaction = Readonly<{
  get: (reference: GuardianProfileDocumentReference) => Promise<GuardianProfileDocumentSnapshot>;
  create: (
    reference: GuardianProfileDocumentReference,
    data: GuardianProfileDocumentData,
  ) => GuardianProfileTransaction;
  set: (
    reference: GuardianProfileDocumentReference,
    data: GuardianProfileDocumentData,
  ) => GuardianProfileTransaction;
}>;
export type GuardianProfileFirestore = Readonly<{
  doc: (path: string) => GuardianProfileDocumentReference;
  runTransaction: <T>(
    callback: (transaction: GuardianProfileTransaction) => Promise<T>,
  ) => Promise<T>;
}>;

export type SaveGuardianProfileInput = Readonly<{
  academyId: string;
  userId: string;
  email: string;
  requestId: string;
  displayName: string;
  phoneNumber: string;
  now: string;
}>;

export type GuardianProfileStore = Readonly<{
  getGuardianProfile: (
    userId: string,
    academyId: string,
    email: string,
  ) => Promise<UserProfile | undefined>;
  saveGuardianProfile: (input: SaveGuardianProfileInput) => Promise<UserProfile>;
}>;

export type GuardianProfileStoreDependencies = Readonly<{
  firestore: GuardianProfileFirestore;
  integritySecretMaterial: string;
  integritySecretVersion: string;
  generateAuditId?: () => string;
}>;

export class GuardianProfileStoreError extends Error {
  public readonly code: "invalid" | "conflict" | "replay" | "unavailable";

  public constructor(code: "invalid" | "conflict" | "replay" | "unavailable", message: string) {
    super(message);
    this.name = "GuardianProfileStoreError";
    this.code = code;
  }
}

const safeIdentifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const utcMillisecondPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const macPattern = /^[a-f0-9]{64}$/u;

const guardianProfileReceiptSchema = z.strictObject({
  receiptId: z.string().regex(/^guardian-write-[a-f0-9]{64}$/u),
  academyId: z.string().regex(safeIdentifierPattern),
  actorId: z.string().regex(safeIdentifierPattern),
  requestMac: z.string().regex(macPattern),
  auditEventId: z.string().regex(safeIdentifierPattern),
  outcome: z.enum(["created", "updated"]),
  integritySecretVersion: z.string().regex(safeIdentifierPattern),
  status: z.literal("completed"),
  createdAt: z.string().regex(utcMillisecondPattern),
  schemaVersion: z.literal("1"),
});

type GuardianProfileReceipt = Readonly<z.infer<typeof guardianProfileReceiptSchema>>;

function pathSegment(value: string, label: string): string {
  if (!safeIdentifierPattern.test(value)) {
    throw new GuardianProfileStoreError("invalid", `Invalid ${label}`);
  }
  return value;
}

function requiredTimestamp(value: string): string {
  if (!utcMillisecondPattern.test(value) || Number.isNaN(Date.parse(value))) {
    throw new GuardianProfileStoreError("invalid", "Invalid operation time");
  }
  return value;
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function userPath(academyId: string, userId: string): string {
  return `academies/${academyId}/users/${userId}`;
}

function receiptPath(academyId: string, receiptId: string): string {
  return `academies/${academyId}/profileWriteReceipts/${receiptId}`;
}

function auditPath(academyId: string, auditEventId: string): string {
  return `academies/${academyId}/auditEvents/${auditEventId}`;
}

function guardianReceiptId(
  academyId: string,
  userId: string,
  requestId: string,
  secretMaterial: string,
): string {
  const digest = createMemberDirectoryIntegrityMac({
    domain: "bpt-guardian-profile-request-id-v1",
    values: [academyId, userId, requestId],
    secretMaterial,
  });
  return `guardian-write-${digest}`;
}

function guardianRequestMac(
  input: SaveGuardianProfileInput,
  academyId: string,
  userId: string,
  email: string,
  secretMaterial: string,
): string {
  return createMemberDirectoryIntegrityMac({
    domain: "bpt-guardian-profile-payload-v1",
    values: [academyId, userId, input.requestId, email, input.displayName, input.phoneNumber],
    secretMaterial,
  });
}

function guardianAuditDraft(
  academyId: string,
  actorId: string,
  receiptId: string,
  outcome: GuardianProfileReceipt["outcome"],
): AuditEventDraft {
  return {
    academyId,
    actorId,
    action: outcome === "created" ? "guardian.profile.created" : "guardian.profile.updated",
    targetRef: userPath(academyId, actorId),
    purpose: "guardian-profile-maintenance",
    correlationId: receiptId,
  } as unknown as AuditEventDraft;
}

function requiredDocumentData(
  snapshot: GuardianProfileDocumentSnapshot,
  errorCode: "conflict" | "replay",
): GuardianProfileDocumentData {
  const data = snapshot.data();
  if (!snapshot.exists || data === undefined) {
    throw new GuardianProfileStoreError(errorCode, "Guardian profile evidence is incomplete");
  }
  return data;
}

function readStoredGuardianProfile(
  snapshot: GuardianProfileDocumentSnapshot,
  academyId: string,
  userId: string,
  normalizedAuthEmail: string,
  errorCode: "conflict" | "replay" = "conflict",
): UserProfile {
  const parsed = parseUserProfile(requiredDocumentData(snapshot, errorCode));
  if (
    !parsed.ok ||
    snapshot.id !== userId ||
    parsed.value.userId !== userId ||
    parsed.value.academyId !== academyId ||
    parsed.value.accountType !== "client" ||
    parsed.value.active !== true ||
    parsed.value.status !== "active" ||
    parsed.value.email !== normalizedAuthEmail
  ) {
    throw new GuardianProfileStoreError(errorCode, "Guardian profile is inconsistent");
  }
  return parsed.value;
}

function validateNewProfile(
  input: SaveGuardianProfileInput,
  academyId: string,
  userId: string,
  email: string,
  now: string,
): UserProfile {
  const candidate: UserProfile = {
    userId,
    academyId,
    accountType: "client",
    displayName: input.displayName,
    email,
    phoneNumber: input.phoneNumber,
    active: true,
    status: "active",
    schemaVersion: "1",
    createdAt: now,
    createdBy: userId,
    updatedAt: now,
    updatedBy: userId,
  };
  const parsed = parseUserProfile(candidate);
  if (!parsed.ok) {
    throw new GuardianProfileStoreError("invalid", "Invalid guardian profile input");
  }
  return parsed.value;
}

async function resolveReplay(
  transaction: GuardianProfileTransaction,
  dependencies: GuardianProfileStoreDependencies,
  receiptValue: unknown,
  expectedReceiptId: string,
  expectedRequestMac: string,
  academyId: string,
  userId: string,
  normalizedAuthEmail: string,
): Promise<UserProfile> {
  const receipt = guardianProfileReceiptSchema.safeParse(receiptValue);
  if (
    !receipt.success ||
    receipt.data.receiptId !== expectedReceiptId ||
    receipt.data.academyId !== academyId ||
    receipt.data.actorId !== userId ||
    receipt.data.integritySecretVersion !== dependencies.integritySecretVersion ||
    !constantTimeMacEquals(receipt.data.requestMac, expectedRequestMac)
  ) {
    throw new GuardianProfileStoreError("replay", "Divergent guardian profile retry");
  }

  const userRef = dependencies.firestore.doc(userPath(academyId, userId));
  const auditRef = dependencies.firestore.doc(auditPath(academyId, receipt.data.auditEventId));
  const [userSnapshot, auditSnapshot] = await Promise.all([
    transaction.get(userRef),
    transaction.get(auditRef),
  ]);
  const profile = readStoredGuardianProfile(
    userSnapshot,
    academyId,
    userId,
    normalizedAuthEmail,
    "replay",
  );
  const audit = requiredDocumentData(auditSnapshot, "replay");
  if (
    auditSnapshot.id !== receipt.data.auditEventId ||
    !matchesAuditEventReplay(
      audit,
      receipt.data.auditEventId,
      guardianAuditDraft(academyId, userId, receipt.data.receiptId, receipt.data.outcome),
    )
  ) {
    throw new GuardianProfileStoreError("replay", "Guardian profile retry evidence is invalid");
  }
  return profile;
}

export function createGuardianProfileStore(
  dependencies: GuardianProfileStoreDependencies,
): GuardianProfileStore {
  pathSegment(dependencies.integritySecretVersion, "integrity secret version");
  try {
    decodeMemberDirectorySecret(dependencies.integritySecretMaterial, "integrity");
  } catch {
    throw new GuardianProfileStoreError("invalid", "Invalid guardian profile purpose secret");
  }
  const generateAuditId = dependencies.generateAuditId ?? randomUUID;

  return Object.freeze({
    async getGuardianProfile(userId, academyId, email) {
      const safeUserId = pathSegment(userId, "user");
      const safeAcademyId = pathSegment(academyId, "academy");
      const normalizedAuthEmail = normalizeEmail(email);
      const userRef = dependencies.firestore.doc(userPath(safeAcademyId, safeUserId));
      return dependencies.firestore.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(userRef);
        if (!snapshot.exists) return undefined;
        return readStoredGuardianProfile(snapshot, safeAcademyId, safeUserId, normalizedAuthEmail);
      });
    },

    async saveGuardianProfile(input) {
      const safeAcademyId = pathSegment(input.academyId, "academy");
      const safeUserId = pathSegment(input.userId, "user");
      const safeRequestId = pathSegment(input.requestId, "request");
      const operationTime = requiredTimestamp(input.now);
      const normalizedAuthEmail = normalizeEmail(input.email);
      const newProfile = validateNewProfile(
        input,
        safeAcademyId,
        safeUserId,
        normalizedAuthEmail,
        operationTime,
      );
      const receiptId = guardianReceiptId(
        safeAcademyId,
        safeUserId,
        safeRequestId,
        dependencies.integritySecretMaterial,
      );
      const requestMac = guardianRequestMac(
        input,
        safeAcademyId,
        safeUserId,
        normalizedAuthEmail,
        dependencies.integritySecretMaterial,
      );
      const auditEventId = pathSegment(generateAuditId(), "generated audit");
      const userRef = dependencies.firestore.doc(userPath(safeAcademyId, safeUserId));
      const receiptRef = dependencies.firestore.doc(receiptPath(safeAcademyId, receiptId));

      return dependencies.firestore.runTransaction(async (transaction) => {
        const receiptSnapshot = await transaction.get(receiptRef);
        if (receiptSnapshot.exists) {
          return resolveReplay(
            transaction,
            dependencies,
            receiptSnapshot.data(),
            receiptId,
            requestMac,
            safeAcademyId,
            safeUserId,
            normalizedAuthEmail,
          );
        }

        const userSnapshot = await transaction.get(userRef);
        const existing = userSnapshot.exists
          ? readStoredGuardianProfile(userSnapshot, safeAcademyId, safeUserId, normalizedAuthEmail)
          : undefined;
        if (existing !== undefined && operationTime < existing.createdAt) {
          throw new GuardianProfileStoreError("conflict", "Guardian profile chronology is invalid");
        }
        const candidate: UserProfile =
          existing === undefined
            ? newProfile
            : {
                ...existing,
                displayName: newProfile.displayName,
                phoneNumber: newProfile.phoneNumber,
                updatedAt: operationTime,
                updatedBy: safeUserId,
              };
        const parsed = parseUserProfile(candidate);
        if (!parsed.ok) {
          throw new GuardianProfileStoreError("invalid", "Invalid guardian profile input");
        }

        const outcome = existing === undefined ? "created" : "updated";
        const auditRef = dependencies.firestore.doc(auditPath(safeAcademyId, auditEventId));
        const receipt: GuardianProfileReceipt = guardianProfileReceiptSchema.parse({
          receiptId,
          academyId: safeAcademyId,
          actorId: safeUserId,
          requestMac,
          auditEventId,
          outcome,
          integritySecretVersion: dependencies.integritySecretVersion,
          status: "completed",
          createdAt: operationTime,
          schemaVersion: "1",
        });
        const auditDraft = guardianAuditDraft(safeAcademyId, safeUserId, receiptId, outcome);

        if (existing === undefined) transaction.create(userRef, parsed.value);
        else transaction.set(userRef, parsed.value);
        appendAuditEventInTransaction(transaction, auditRef, auditDraft);
        transaction.create(receiptRef, receipt);
        return parsed.value;
      });
    },
  });
}
