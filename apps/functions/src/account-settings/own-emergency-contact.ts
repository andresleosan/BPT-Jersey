import { createHash, randomUUID } from "node:crypto";

import type { AuditEventDraft } from "@bpt-jersey/domain/audit";
import {
  emergencyContactSchema,
  studentAdminProfileSchema,
  type EmergencyContact,
} from "@bpt-jersey/domain/members/directory";
import { ownEmergencyContactInputSchema } from "@bpt-jersey/domain/members/engagement";
import { HttpsError } from "firebase-functions/v2/https";
import { z } from "zod";

import { appendAuditEventInTransaction } from "../audit/audit-writer.js";
import { memberAccessInStoreTransaction } from "../members/member-access-service.js";
import {
  advanceMemberDirectoryControlPlane,
  assertCanonicalMemberDirectoryWriterReady,
  assertMemberDirectoryControlPlane,
  memberDirectoryRestoreGuardSchema,
} from "../members/member-directory-state.js";
import { resolveCanonicalStudentIdInTransaction } from "../members/member-identity-resolution.js";

/**
 * A member, or the guardian of a child member, keeps the emergency contact on
 * `studentAdminProfiles/{studentId}` up to date from account settings. The office sees the same field.
 * It is a canonical directory write: it needs an open writer and advances the control plane once.
 */
export type OwnContactReference = Readonly<{ id: string; path: string }>;
export type OwnContactQuery = Readonly<{
  path: string;
  field: string;
  value: unknown;
  limit: number;
}>;
export type OwnContactSnapshot = Readonly<{
  id: string;
  exists: boolean;
  data: () => Readonly<Record<string, unknown>> | undefined;
}>;
export type OwnContactTransaction = Readonly<{
  get: (
    target: OwnContactReference | OwnContactQuery,
  ) => Promise<OwnContactSnapshot | Readonly<{ docs: readonly OwnContactSnapshot[] }>>;
  set: (ref: OwnContactReference, data: Readonly<Record<string, unknown>>) => unknown;
  create: (ref: OwnContactReference, data: Readonly<Record<string, unknown>>) => unknown;
}>;
export type OwnContactFirestore = Readonly<{
  doc: (path: string) => OwnContactReference;
  collection: (path: string) => Readonly<{
    where: (
      field: string,
      operator: "==",
      value: unknown,
    ) => Readonly<{ limit: (count: number) => OwnContactQuery }>;
  }>;
  runTransaction: <T>(callback: (tx: OwnContactTransaction) => Promise<T>) => Promise<T>;
}>;

export type OwnEmergencyContactDependencies = Readonly<{
  firestore: OwnContactFirestore;
  projectId: string;
  identitySecretVersion: string;
  integritySecretMaterial: string;
  integritySecretVersion: string;
  /** Reads: returns the canonical student id, or throws `permission-denied`. */
  resolveAccess: (academyId: string, userId: string, studentId: string) => Promise<string>;
  /** Reads: one plain document read, outside any transaction. */
  readDocument: (path: string) => Promise<Readonly<Record<string, unknown>> | undefined>;
  now?: () => string;
  generateAuditId?: () => string;
}>;

type MemberActor = Readonly<{ userId: string; academyId: string }>;

export const directoryBusyMessage = "Saving is paused for maintenance. Try again in a few minutes.";
const deniedMessage = "This member is not available to your account.";
const studentInputSchema = z.strictObject({ studentId: z.string().min(1).max(128) });
const receiptSchema = z.object({
  actorId: z.string(),
  studentId: z.string(),
  contactDigest: z.string(),
});

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success)
    throw new HttpsError("invalid-argument", "Check the emergency contact details.");
  return parsed.data;
}

const digest = (...values: readonly string[]) =>
  createHash("sha256").update(JSON.stringify(values)).digest("hex");

const profilePath = (academyId: string, studentId: string) =>
  `academies/${academyId}/studentAdminProfiles/${studentId}`;

function contactDigest(contact: EmergencyContact): string {
  return digest(
    contact.fullName,
    contact.relationship,
    contact.phoneNumber,
    contact.alternatePhoneNumber ?? "",
  );
}

async function getDocument(tx: OwnContactTransaction, ref: OwnContactReference) {
  const snapshot = await tx.get(ref);
  if ("docs" in snapshot) throw new HttpsError("unavailable", directoryBusyMessage);
  return snapshot;
}

export function createOwnEmergencyContactService(deps: OwnEmergencyContactDependencies) {
  const db = deps.firestore;
  const now = () => deps.now?.() ?? new Date().toISOString();
  const generateAuditId = deps.generateAuditId ?? randomUUID;

  return {
    async get(actor: MemberActor, data: unknown): Promise<{ contact: EmergencyContact | null }> {
      const input = parse(studentInputSchema, data);
      const studentId = await deps.resolveAccess(actor.academyId, actor.userId, input.studentId);
      const stored = emergencyContactSchema.safeParse(
        (await deps.readDocument(profilePath(actor.academyId, studentId)))?.emergencyContact,
      );
      return { contact: stored.success ? stored.data : null };
    },

    async save(actor: MemberActor, data: unknown): Promise<{ saved: true }> {
      const input = parse(ownEmergencyContactInputSchema, data);
      const at = now();
      const academyId = actor.academyId;
      const receiptId = `write-${digest("bpt-own-emergency-contact-v1", academyId, actor.userId, input.requestId)}`;
      const expectedDigest = contactDigest(input.contact);
      const receiptRef = db.doc(`academies/${academyId}/profileWriteReceipts/${receiptId}`);
      const auditRef = db.doc(`academies/${academyId}/auditEvents/${generateAuditId()}`);
      const stateRef = db.doc(`academies/${academyId}/memberDirectoryStates/current`);
      const guardRef = db.doc(`memberDirectoryRestoreGuards/${academyId}`);

      await db.runTransaction(async (tx) => {
        // Authorise inside the write, so a guardian link revoked meanwhile stops it.
        const decision = await memberAccessInStoreTransaction(db, tx, at).authorise(
          academyId,
          actor.userId,
          input.studentId,
        );
        if (!decision.allowed) throw new HttpsError("permission-denied", deniedMessage);
        let studentId: string;
        try {
          studentId = await resolveCanonicalStudentIdInTransaction(
            {
              get: async (path) => {
                const doc = await getDocument(tx, db.doc(path));
                return { id: doc.id, exists: doc.exists, data: doc.data() };
              },
            },
            academyId,
            input.studentId,
          );
        } catch {
          throw new HttpsError("permission-denied", deniedMessage);
        }

        const receipt = await getDocument(tx, receiptRef);
        if (receipt.exists) {
          const prior = receiptSchema.safeParse(receipt.data());
          if (
            prior.success &&
            prior.data.actorId === actor.userId &&
            prior.data.studentId === studentId &&
            prior.data.contactDigest === expectedDigest
          ) {
            return;
          }
          throw new HttpsError("failed-precondition", "Reload the page and try again.");
        }

        const [stateSnapshot, guardSnapshot] = await Promise.all([
          getDocument(tx, stateRef),
          getDocument(tx, guardRef),
        ]);
        let currentControl;
        try {
          const state = assertCanonicalMemberDirectoryWriterReady(stateSnapshot.data(), {
            academyId,
            digestVersion: "hmac-sha256-v1",
            secretVersion: deps.identitySecretVersion,
          });
          const guard = memberDirectoryRestoreGuardSchema.parse(guardSnapshot.data());
          const event = await getDocument(
            tx,
            db.doc(`memberDirectoryRestoreGuards/${academyId}/events/${guard.lastEventId}`),
          );
          currentControl = assertMemberDirectoryControlPlane({
            projectId: deps.projectId,
            state,
            guard,
            event: event.data(),
            integritySecretMaterial: deps.integritySecretMaterial,
            integritySecretVersion: deps.integritySecretVersion,
          });
        } catch {
          throw new HttpsError("unavailable", directoryBusyMessage);
        }

        const profileRef = db.doc(profilePath(academyId, studentId));
        const current = await getDocument(tx, profileRef);
        // A member the office has not profiled yet starts from the same empty admin profile the office would.
        const base = current.exists
          ? studentAdminProfileSchema.safeParse(current.data())
          : studentAdminProfileSchema.safeParse({
              studentId,
              academyId,
              gender: "unknown",
              source: "admin",
              schemaVersion: "1",
              createdAt: at,
              createdBy: actor.userId,
              updatedAt: at,
              updatedBy: actor.userId,
            });
        if (!base.success)
          throw new HttpsError("failed-precondition", "Ask the academy to update this contact.");
        const next = studentAdminProfileSchema.safeParse({
          ...base.data,
          emergencyContact: { ...input.contact },
          updatedAt: at,
          updatedBy: actor.userId,
        });
        if (!next.success)
          throw new HttpsError("invalid-argument", "Check the emergency contact details.");

        const { state } = currentControl;
        const nextState = {
          ...state,
          stateRevision: state.stateRevision + 1,
          updatedAt: at,
          updatedBy: actor.userId,
        };
        let nextControl;
        try {
          nextControl = advanceMemberDirectoryControlPlane({
            projectId: deps.projectId,
            state,
            guard: currentControl.guard,
            event: currentControl.event,
            nextState,
            operationId: receiptId,
            transitionKind: "canonical-identity-update",
            integritySecretMaterial: deps.integritySecretMaterial,
            integritySecretVersion: deps.integritySecretVersion,
            now: at,
            actorId: actor.userId,
          });
        } catch {
          throw new HttpsError("unavailable", directoryBusyMessage);
        }

        tx.set(profileRef, next.data);
        tx.set(stateRef, nextState);
        tx.set(guardRef, nextControl.guard);
        tx.create(
          db.doc(`memberDirectoryRestoreGuards/${academyId}/events/${nextControl.event.eventId}`),
          nextControl.event,
        );
        appendAuditEventInTransaction(tx, auditRef, {
          academyId,
          actorId: actor.userId,
          action: "member.updated",
          targetRef: `academies/${academyId}/students/${studentId}`,
          purpose: "member-record-maintenance",
          correlationId: receiptId,
        } as unknown as AuditEventDraft);
        tx.create(receiptRef, {
          receiptId,
          kind: "own-emergency-contact",
          academyId,
          actorId: actor.userId,
          studentId,
          contactDigest: expectedDigest,
          auditEventId: auditRef.id,
          stateRevisionBefore: state.stateRevision,
          stateRevisionAfter: nextState.stateRevision,
          status: "completed",
          createdAt: at,
          schemaVersion: "1",
        });
      });
      return { saved: true };
    },
  };
}
