import { FieldPath, getFirestore, type Firestore, type Transaction } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import { parseEffectiveStudentProfileAt, parseUserProfile, type StudentProfile } from "@bpt-jersey/domain/profiles";
import { parseFamilyRecord, parseFamilyRelationship, type FamilyRelationship } from "@bpt-jersey/domain/families";
import { dateKeyInJersey } from "@bpt-jersey/domain/schedule/member-calendar";
import { accountMemberProfileSchema, decideMemberAccess, memberAgeOn, memberGuardianStateSchema,
  type MemberAccessDecision, type MemberAccessService, type AccountMemberProfile } from "@bpt-jersey/domain/members/access";
import { reviewIdentifierSchema } from "@bpt-jersey/domain/members/reconciliation";
import { resolveCanonicalStudentIdInTransaction } from "./member-identity-resolution.js";

export type MemberAccessDocument = Readonly<{ id: string; exists: boolean; data: Readonly<Record<string, unknown>> | undefined }>;
export type MemberAccessDependencies = Readonly<{
  getDocument: (path: string) => Promise<MemberAccessDocument>;
  queryDocuments: (collectionPath: string, field: string, value: unknown, limit: number) => Promise<readonly MemberAccessDocument[]>;
  queryPage?: (collectionPath: string, field: string, value: unknown, limit: number, afterDocumentId?: string) => Promise<readonly MemberAccessDocument[]>;
  now?: () => string;
}>;
const denied = { allowed: false } as const;
const safeId = (id: string) => reviewIdentifierSchema.safeParse(id).success;
const unavailable = () => new HttpsError("failed-precondition", "Member access needs office review");
function currentGuardian(link: FamilyRelationship, now: string): boolean {
  return link.relationshipType === "guardian" && link.active && link.status === "active" &&
    Date.parse(link.validFrom) <= Date.parse(now) && (link.validTo === undefined || Date.parse(now) < Date.parse(link.validTo));
}

export function createMemberAccessService(deps: MemberAccessDependencies): MemberAccessService {
  const resolve = (academyId: string, id: string) => resolveCanonicalStudentIdInTransaction({ get: deps.getDocument }, academyId, id);
  // Page through historical links without silently dropping later children. Oversize data requires review.
  async function allMatches(path: string, field: string, value: string) {
    if (!deps.queryPage) {
      const docs = await deps.queryDocuments(path, field, value, 101);
      if (docs.length > 100) throw unavailable();
      return docs;
    }
    const docs: MemberAccessDocument[] = [];
    let after: string | undefined;
    for (let page = 0; page < 20; page++) {
      const fetched = await deps.queryPage(path, field, value, 101, after);
      const visible = fetched.slice(0, 100);
      docs.push(...visible);
      if (fetched.length <= 100) return docs;
      const next = visible.at(-1)?.id;
      if (!next || next === after) throw unavailable();
      after = next;
    }
    throw unavailable();
  }
  async function context(academyId: string, actorUserId: string) {
    if (!safeId(academyId) || !safeId(actorUserId)) throw unavailable();
    const time = deps.now?.() ?? new Date().toISOString();
    if (!Number.isFinite(Date.parse(time))) throw unavailable();
    const academyDate = dateKeyInJersey(new Date(time));
    const base = `academies/${academyId}`;
    const actorDoc = await deps.getDocument(`${base}/users/${actorUserId}`);
    const actor = parseUserProfile(actorDoc.data);
    if (!actorDoc.exists || actorDoc.id !== actorUserId || !actor.ok || actor.value.academyId !== academyId ||
        actor.value.userId !== actorUserId || !actor.value.active || actor.value.status !== "active") throw unavailable();
    const own = await allMatches(`${base}/students`, "userId", actorUserId);
    const ownIds = new Set<string>();
    for (const doc of own) {
      const student = parseEffectiveStudentProfileAt(doc.data, academyDate);
      if (!student.ok || student.value.studentId !== doc.id || student.value.academyId !== academyId || student.value.userId !== actorUserId) throw unavailable();
      if (student.value.active && student.value.status === "active") ownIds.add(await resolve(academyId, doc.id));
    }
    return { academyId, actorUserId, base, time, academyDate, ownIds };
  }
  async function inspect(ctx: Awaited<ReturnType<typeof context>>, requestedStudentId: string): Promise<{
    decision: MemberAccessDecision; student: StudentProfile;
  }> {
    if (!safeId(requestedStudentId)) throw unavailable();
    const canonicalId = await resolve(ctx.academyId, requestedStudentId);
    const doc = await deps.getDocument(`${ctx.base}/students/${canonicalId}`);
    const parsed = parseEffectiveStudentProfileAt(doc.data, ctx.academyDate);
    if (!doc.exists || doc.id !== canonicalId || !parsed.ok || parsed.value.studentId !== canonicalId || parsed.value.academyId !== ctx.academyId) throw unavailable();
    const student = parsed.value;
    const age = memberAgeOn(student.dateOfBirth, ctx.academyDate);
    const ownLinkApproved = ctx.ownIds.size === 1 && ctx.ownIds.has(canonicalId) && student.userId === ctx.actorUserId;
    let guardianLinkCurrent = false;
    if (age !== null && age < 18) {
      const [links, anchorDoc] = await Promise.all([
        allMatches(`${ctx.base}/relationships`, "studentId", canonicalId),
        deps.getDocument(`${ctx.base}/memberGuardianStates/${canonicalId}`),
      ]);
      const active: FamilyRelationship[] = [];
      for (const linkDoc of links) {
        const link = parseFamilyRelationship(linkDoc.data);
        if (!link.ok || link.value.relationshipId !== linkDoc.id || link.value.academyId !== ctx.academyId || link.value.studentId !== canonicalId) throw unavailable();
        if (currentGuardian(link.value, ctx.time)) active.push(link.value);
      }
      // Never choose an arbitrary winner between two live guardian records.
      const link = active.length === 1 ? active[0] : undefined;
      let anchorMatches = !anchorDoc.exists;
      if (anchorDoc.exists) {
        const anchor = memberGuardianStateSchema.safeParse(anchorDoc.data);
        anchorMatches = anchor.success && anchor.data.academyId === ctx.academyId && anchor.data.studentId === canonicalId &&
          anchor.data.relationshipId === (link?.relationshipId ?? null) && anchor.data.guardianUserId === (link?.adultUserId ?? null);
      }
      if (link && anchorMatches && link.adultUserId === ctx.actorUserId && link.permissions.includes("readProfile") && link.familyId === student.familyId) {
        const familyDoc = await deps.getDocument(`${ctx.base}/families/${link.familyId}`);
        const family = parseFamilyRecord(familyDoc.data);
        guardianLinkCurrent = family.ok && familyDoc.id === link.familyId && family.value.familyId === link.familyId &&
          family.value.academyId === ctx.academyId && family.value.active && family.value.status === "active";
      }
    }
    return { student, decision: decideMemberAccess({ actorActive: true, academyMatches: true,
      memberAccessible: student.active && student.status === "active", confirmedAge: age, ownLinkApproved, guardianLinkCurrent }) };
  }
  return {
    async authorise(academyId, actorUserId, studentId) {
      try { return (await inspect(await context(academyId, actorUserId), studentId)).decision; }
      catch { return denied; }
    },
    async listProfiles(academyId, actorUserId) {
      const ctx = await context(academyId, actorUserId);
      const links = await allMatches(`${ctx.base}/relationships`, "adultUserId", actorUserId);
      const candidateIds = new Set(ctx.ownIds);
      for (const doc of links) {
        const link = parseFamilyRelationship(doc.data);
        if (!link.ok || link.value.relationshipId !== doc.id || link.value.academyId !== academyId || link.value.adultUserId !== actorUserId) throw unavailable();
        if (currentGuardian(link.value, ctx.time)) candidateIds.add(await resolve(academyId, link.value.studentId));
      }
      if (candidateIds.size > 100) throw unavailable();
      const profiles: AccountMemberProfile[] = [];
      for (const id of candidateIds) {
        const { student, decision } = await inspect(ctx, id);
        if (!decision.allowed) continue;
        const training = await deps.getDocument(`${ctx.base}/memberTrainingStates/${id}`);
        profiles.push(accountMemberProfileSchema.parse({ studentId: student.studentId, fullName: student.fullName,
          via: decision.via, trainingDetailsRequired: !training.exists || training.data?.academyId !== academyId ||
            training.data?.studentId !== id || training.data?.status !== "confirmed" }));
      }
      return profiles.sort((a, b) => (a.via === b.via ? a.fullName.localeCompare(b.fullName) : a.via === "self" ? -1 : 1));
    },
  };
}

/** Use this adapter inside a mutation transaction so a concurrent guardian change invalidates it. */
export function memberAccessDependenciesInTransaction(db: Firestore, tx: Transaction, now?: () => string): MemberAccessDependencies {
  const readQuery = async (path: string, field: string, value: unknown, limit: number, after?: string) => {
    if (!['userId', 'studentId', 'adultUserId'].includes(field) || limit < 1 || limit > 101) throw unavailable();
    let query = db.collection(path).where(field, "==", value).orderBy(FieldPath.documentId());
    if (after) query = query.startAfter(after);
    return (await tx.get(query.limit(limit))).docs.map((doc) => ({ id: doc.id, exists: doc.exists, data: doc.data() }));
  };
  return { ...(now ? { now } : {}), getDocument: async (path) => {
    const doc = await tx.get(db.doc(path));
    return { id: doc.id, exists: doc.exists, data: doc.data() };
  }, queryDocuments: readQuery, queryPage: readQuery };
}
export function createFirestoreMemberAccessService(options: Readonly<{ firestore?: Firestore; now?: () => string }> = {}): MemberAccessService {
  const db = () => options.firestore ?? getFirestore();
  return {
    authorise: (academyId, actorId, studentId) => db().runTransaction((tx) =>
      createMemberAccessService(memberAccessDependenciesInTransaction(db(), tx, options.now)).authorise(academyId, actorId, studentId)),
    listProfiles: (academyId, actorId) => db().runTransaction((tx) =>
      createMemberAccessService(memberAccessDependenciesInTransaction(db(), tx, options.now)).listProfiles(academyId, actorId)),
  };
}
