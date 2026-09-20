import { randomBytes } from "node:crypto";
import { z } from "zod";
import type { Transaction } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import { appendAuditEventInTransaction } from "../audit/audit-writer.js";
import type { AuditEventDraft } from "@bpt-jersey/domain/audit";
import { readRecoverySourcePage, normalizeRecoveryName } from "./member-recovery-sources.js";
import {
  beginMemberRecoveryV2InputSchema, memberRecoveryProfileSchema,
  recoverySubjectInputSchema, recoveryRequestStatus,
} from "@bpt-jersey/domain/members/recovery";
import type { CanonicalMemberDirectoryActor } from "./canonical-member-directory-service.js";
import type { MemberRecoveryDependencies } from "./member-recovery-service.js";
import { createMemberDirectoryIntegrityMac } from "./member-directory-crypto.js";
import { matchesProvisionedMemberDirectoryActor } from "./member-directory-actor-authorization.js";
import { readRecoveryTicket, recoveryTicketForApplicant, recoveryTicketV2Schema, type RecoveryTicketV2 } from "./member-recovery-ticket.js";

const opaqueId = z.string().regex(/^[a-f0-9]{64}$/u);
const accountId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u);
const completeInputSchema = z.strictObject({
  version: z.literal("2"), recoveryId: opaqueId,
  expectedRevision: opaqueId.optional(),
  accountPhoneNumber: z.string().trim().min(7).max(40).optional(),
  subjects: z.array(z.strictObject({
    subjectId: opaqueId, details: recoverySubjectInputSchema.optional(),
    profile: memberRecoveryProfileSchema.optional(),
  })).min(1).max(11).optional(),
}).refine((input) => input.subjects === undefined ||
  (input.expectedRevision !== undefined && new Set(input.subjects.map((subject) => subject.subjectId)).size === input.subjects.length));
const detailInputSchema = z.strictObject({
  version: z.literal("2"), requestId: opaqueId, subjectId: opaqueId,
  source: z.enum(["regyfit", "member", "student"]).default("student"),
  cursor: accountId.optional(), search: z.string().trim().min(2).max(160).optional(),
});
const newId = () => randomBytes(32).toString("hex");
const unavailable = () => new HttpsError("failed-precondition", "This recovery request needs office review");

/** Version-2 lifecycle. Its account binding creates no athlete, guardian relationship or subscription. */
export function createRecoverySubjectService(d: MemberRecoveryDependencies) {
  const academyId = accountId.parse(d.academyId);
  const base = `academies/${academyId}`;
  const ref = (collection: string, id: string) => d.firestore.doc(`${base}/${collection}/${id}`);
  const now = () => d.now?.() ?? new Date().toISOString();
  const mac = (domain: string, values: readonly string[]) => createMemberDirectoryIntegrityMac({
    domain, values: [academyId, ...values], secretMaterial: d.integritySecretMaterial,
  });
  async function quota(tx: Transaction, key: string, limit: number, time: string) {
    const quotaRef = ref("memberRecoveryRateLimits", mac("bpt-recovery-quota-v2", [key]));
    const snapshot = await tx.get(quotaRef);
    const window = Math.floor(Date.parse(time) / 900000);
    const previous = snapshot.data();
    const count = previous?.window === window ? Number(previous.count) : 0;
    if (!Number.isSafeInteger(count) || count < 0 || count >= limit) {
      throw new HttpsError("resource-exhausted", "Too many attempts. Please try again later.");
    }
    return () => tx.set(quotaRef, { window, count: count + 1,
      expiresAt: new Date((window + 2) * 900000).toISOString() });
  }
  async function load(tx: Transaction, id: string) {
    const snapshot = await tx.get(ref("memberRecoveryRequests", opaqueId.parse(id)));
    if (!snapshot.exists) throw unavailable();
    return readRecoveryTicket(snapshot.data(), academyId, id);
  }
  async function account(uid: string) {
    accountId.parse(uid);
    const user = await d.auth.getUser(uid);
    if (user.uid !== uid || user.disabled ||
        (user.customClaims?.academyId !== undefined && user.customClaims.academyId !== academyId)) {
      throw new HttpsError("permission-denied", "This account cannot continue recovery");
    }
    return user;
  }
  async function requireOffice(tx: Transaction, actor: CanonicalMemberDirectoryActor) {
    if (!actor.active || !actor.appCheckVerified || actor.academyId !== academyId ||
        !["owner", "administrator"].includes(actor.role)) throw new HttpsError("permission-denied", "Active office access is required");
    const [user, lock] = await Promise.all([tx.get(ref("users", actor.actorId)), tx.get(ref("adminRoleLocks", actor.actorId))]);
    if (lock.exists || !matchesProvisionedMemberDirectoryActor(user.data(), actor)) {
      throw new HttpsError("permission-denied", "Active office access is required");
    }
  }
  function assertNotExpired(ticket: RecoveryTicketV2, time: string) {
    if (Date.parse(ticket.expiresAt) <= Date.parse(time) && !["linked", "rejected"].includes(ticket.status)) {
      throw new HttpsError("deadline-exceeded", "Recovery request has expired. Please start again.");
    }
  }
  return {
    async begin(value: unknown, ip: string) {
      const input = beginMemberRecoveryV2InputSchema.parse(value);
      if (!ip || ip.length > 128) throw unavailable();
      const time = now();
      const recoveryId = newId();
      const expiresAt = new Date(Date.parse(time) + 24 * 3600000).toISOString();
      const subjects = input.subjects.map((subject) => ({ ...subject, subjectId: newId(), status: "pending-review" as const }));
      const ticket = recoveryTicketV2Schema.parse({
        version: "2", recoveryId, academyId, revision: newId(), mode: input.mode,
        fullName: subjects[0]!.fullName, previousEmail: subjects[0]!.previousEmail ?? "",
        createdAt: time, updatedAt: time, expiresAt, accountVerified: false,
        status: recoveryRequestStatus(subjects, false), subjects, candidates: [],
      });
      await d.firestore.runTransaction(async (tx) => {
        const spend = await quota(tx, `ip:${ip}`, 10, time);
        spend();
        tx.create(ref("memberRecoveryRequests", recoveryId), ticket);
      });
      // Matching is deliberately absent: same work and response for found and unknown identities.
      return { recoveryId, expiresAt };
    },
    async complete(value: unknown, uid: string) {
      const input = completeInputSchema.parse(value);
      const user = await account(uid);
      const time = now();
      const verified = user.emailVerified && z.email().safeParse(user.email).success;
      return d.firestore.runTransaction(async (tx) => {
        const ticket = await load(tx, input.recoveryId);
        if (ticket.userId !== undefined && ticket.userId !== uid) {
          throw new HttpsError("permission-denied", "Recovery request is unavailable");
        }
        assertNotExpired(ticket, time);
        if (input.expectedRevision !== undefined && input.expectedRevision !== ticket.revision) {
          throw new HttpsError("aborted", "The request changed. Reload before editing.");
        }
        const spend = await quota(tx, `account:${uid}`, 30, time);
        const subjects = ticket.subjects.map((subject) => ({ ...subject }));
        for (const patch of input.subjects ?? []) {
          const subject = subjects.find((candidate) => candidate.subjectId === patch.subjectId);
          if (!subject || subject.status === "approved" || subject.status === "rejected") throw unavailable();
          if (patch.details) {
            if (patch.details.kind !== subject.kind) throw unavailable();
            subject.fullName = patch.details.fullName;
            if (patch.details.dateOfBirth === undefined) delete subject.dateOfBirth;
            else subject.dateOfBirth = patch.details.dateOfBirth;
            if (patch.details.previousEmail === undefined) delete subject.previousEmail;
            else subject.previousEmail = patch.details.previousEmail;
          }
          if (patch.profile) subject.profile = { ...subject.profile, ...patch.profile };
          subject.status = "pending-review";
        }
        const changedIds = new Set((input.subjects ?? []).map((subject) => subject.subjectId));
        const next = recoveryTicketV2Schema.parse({
          ...ticket, userId: uid, accountVerified: verified,
          ...(user.email && z.email().safeParse(user.email).success ? { accountEmail: user.email.toLowerCase() } : {}),
          ...(input.accountPhoneNumber ? { accountPhoneNumber: input.accountPhoneNumber } : {}),
          subjects, candidates: ticket.candidates.filter((candidate) => !changedIds.has(candidate.subjectId)),
          status: recoveryRequestStatus(subjects, verified), revision: newId(), updatedAt: time,
          expiresAt: ticket.userId ? ticket.expiresAt : new Date(Date.parse(time) + 30 * 24 * 3600000).toISOString(),
        });
        spend();
        tx.set(ref("memberRecoveryRequests", ticket.recoveryId), next);
        return recoveryTicketForApplicant(next, subjects.some((subject) => subject.status === "approved"));
      });
    },
    async detail(value: unknown, actor: CanonicalMemberDirectoryActor) {
      const input = detailInputSchema.parse(value);
      return d.firestore.runTransaction(async (tx) => {
        await requireOffice(tx, actor);
        const time = now();
        const ticket = await load(tx, input.requestId);
        assertNotExpired(ticket, time);
        const subject = ticket.subjects.find((candidate) => candidate.subjectId === input.subjectId);
        if (!subject) throw unavailable();
        const spend = await quota(tx, `detail:${actor.actorId}`, 30, time);
        const page = await readRecoverySourcePage(tx, d.firestore, academyId, input.source, time, input.cursor);
        const search = normalizeRecoveryName(input.search ?? subject.fullName);
        const matches = page.records.filter(({ source }) => {
          const name = normalizeRecoveryName(source.fullName);
          if (input.search) return name.includes(search) || source.memberNumber === input.search ||
            source.email?.toLowerCase().includes(input.search.toLowerCase());
          const sameName = name === search;
          if (subject.kind === "child") return sameName && source.birthDate === subject.dateOfBirth;
          return sameName || (subject.previousEmail !== undefined && source.email?.toLowerCase() === subject.previousEmail.toLowerCase());
        });
        // A page with >20 matches needs a narrower staff search. Never retain an arbitrary winner.
        const selected = matches.length > 20 ? [] : matches;
        const bindings = selected.map(({ source, revision }) => ({
          subjectId: subject.subjectId, kind: source.kind, recordId: source.recordId, sourceRevision: revision,
          candidateId: mac("bpt-recovery-candidate-v2", [ticket.recoveryId, subject.subjectId, source.kind, source.recordId, revision]),
        }));
        const next = recoveryTicketV2Schema.parse({ ...ticket,
          candidates: [...ticket.candidates.filter((candidate) => candidate.subjectId !== subject.subjectId), ...bindings],
          revision: newId(), updatedAt: time,
        });
        spend();
        tx.set(ref("memberRecoveryRequests", ticket.recoveryId), next);
        appendAuditEventInTransaction(tx, ref("auditEvents", newId()), {
          academyId, actorId: actor.actorId, action: "member.recovery.detail.read",
          targetRef: `${base}/memberRecoveryRequests/${ticket.recoveryId}`,
          purpose: "member-account-recovery", correlationId: ticket.recoveryId,
        } as AuditEventDraft);
        return {
          request: { ...recoveryTicketForApplicant(next), fullName: ticket.fullName,
            accountVerified: ticket.accountVerified, accountEmail: ticket.accountEmail ?? null,
            createdAt: ticket.createdAt, updatedAt: next.updatedAt },
          subject: next.subjects.find((candidate) => candidate.subjectId === subject.subjectId)!,
          candidates: selected.map(({ source }, index) => ({
            candidateId: bindings[index]!.candidateId, fullName: source.fullName,
            ...(source.email ? { email: source.email } : {}),
            ...(source.birthDate ? { dateOfBirth: source.birthDate } : {}),
            membershipState: source.membershipState, source: source.kind,
            ...(source.kind === "regyfit" ? { archiveRecordId: source.recordId } : {}),
          })),
          ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
          refineSearch: matches.length > 20,
        };
      });
    },
    async list(actor: CanonicalMemberDirectoryActor) {
      return d.firestore.runTransaction(async (tx) => {
        await requireOffice(tx, actor);
        const time = now();
        const spend = await quota(tx, `office:${actor.actorId}`, 60, time);
        const snapshot = await tx.get(d.firestore.collection(`${base}/memberRecoveryRequests`)
          .where("status", "in", ["pending-review", "profile-required", "more-information", "partially-linked"])
          .where("accountVerified", "==", true)
          .where("expiresAt", ">", time).orderBy("expiresAt").orderBy("createdAt").limit(51));
        const requests = snapshot.docs.slice(0, 50).map((document) => {
          const ticket = readRecoveryTicket(document.data(), academyId, document.id);
          return { requestId: ticket.recoveryId, fullName: ticket.fullName, status: ticket.status,
            createdAt: ticket.createdAt, updatedAt: ticket.updatedAt, accountVerified: ticket.accountVerified,
            subjects: recoveryTicketForApplicant(ticket).subjects, revision: ticket.revision, version: "2" as const };
        });
        spend();
        return { requests, truncated: snapshot.docs.length > 50 };
      });
    },
  };
}
