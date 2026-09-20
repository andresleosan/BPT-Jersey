import { randomBytes, randomUUID } from "node:crypto";
import type { Firestore, Transaction } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import { z } from "zod";
import {
  beginMemberRecoveryInputSchema,
  completeMemberRecoveryInputSchema,
  reviewMemberRecoveryInputSchema,
  getMemberRecoveryDetailInputSchema,
  memberRecoveryProfileSchema,
  memberRecoveryHistorySchema,
  type MemberRecoveryProfile,
  type CompleteMemberRecoveryResult,
  type MemberRecoveryDetail,
  type MemberRecoveryRequestRow,
} from "@bpt-jersey/domain/members/recovery";
import { parseStoredRegyfitMemberRecord } from "@bpt-jersey/domain/members/regyfit-records";
import {
  loadRecoverySources,
  archiveForLegacyMember,
  normalizeRecoveryName,
  type RecoverySource,
  type RecoverySourceKind,
} from "./member-recovery-sources.js";
export { normalizeRecoveryName } from "./member-recovery-sources.js";
import {
  studentAdminProfileSchema,
  normalizeAdministrativeIdentifier,
} from "@bpt-jersey/domain/members/directory";
import {
  parseStudentProfileAt,
  parseUserProfile,
  deriveParticipantType,
  type StudentProfile,
} from "@bpt-jersey/domain/profiles";
import { parseFamilyRecord } from "@bpt-jersey/domain/families";
import { ageInCompletedYears } from "@bpt-jersey/domain/levels";
import type { AuditEventDraft } from "@bpt-jersey/domain/audit";
import { appendAuditEventInTransaction } from "../audit/audit-writer.js";
import {
  buildStudentIdentityKey,
  createMemberDirectoryIntegrityMac,
  deriveStudentIdentityKeyId,
  studentIdentityKeySchema,
  decodeMemberDirectorySecret,
} from "./member-directory-crypto.js";
import {
  assertCanonicalMemberDirectoryWriterReady,
  assertMemberDirectoryControlPlane,
  advanceMemberDirectoryControlPlane,
} from "./member-directory-state.js";
import { matchesProvisionedMemberDirectoryActor } from "./member-directory-actor-authorization.js";
import type { CanonicalMemberDirectoryActor } from "./canonical-member-directory-service.js";

export type RecoveryAuthUser = Readonly<{
  uid: string;
  disabled: boolean;
  emailVerified: boolean;
  email?: string;
  displayName?: string;
  customClaims?: Record<string, unknown>;
}>;
export type MemberRecoveryDependencies = Readonly<{
  firestore: Firestore;
  academyId: string;
  projectId: string;
  identitySecretMaterial: string;
  integritySecretMaterial: string;
  identitySecretVersion: string;
  integritySecretVersion: string;
  auth: {
    getUser: (uid: string) => Promise<RecoveryAuthUser>;
    setCustomUserClaims: (uid: string, claims: Record<string, unknown>) => Promise<void>;
    revokeRefreshTokens?: (uid: string) => Promise<void>;
  };
  now?: () => string;
}>;
const id = z.string().regex(/^[a-f0-9]{64}$/u);
const ticketSchema = z.strictObject({
  recoveryId: id,
  academyId: z.string(),
  fullName: z.string(),
  previousEmail: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  expiresAt: z.string(),
  candidates: z
    .array(
      z.strictObject({
        candidateId: id,
        recordId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u),
        kind: z.enum(["regyfit", "member", "student"]).optional(),
      }),
    )
    .max(20),
  userId: z.string().optional(),
  accountEmail: z.string().optional(),
  accountVerified: z.boolean().optional(),
  status: z.enum(["verify-email", "pending-review", "profile-required", "linked", "rejected"]),
  approvedCandidateId: id.optional(),
  approvedEmail: z.string().optional(),
  reviewedBy: z.string().optional(),
  studentId: z.string().optional(),
  profile: memberRecoveryProfileSchema.optional(),
  retiredUserId: z.string().optional(),
});
type Ticket = z.infer<typeof ticketSchema>;
const linkSchema = z.strictObject({
  academyId: z.string(),
  recordId: z.string(),
  studentId: z.string(),
  userId: z.string(),
  recoveryId: id,
  source: z.enum(["regyfit-admin-capture", "legacy-member-directory", "canonical-student"]),
  sourceCapturedAt: z.string(),
  verificationMethod: z.enum(["registered-email", "administrator-review"]),
  reviewedBy: z.string().optional(),
  createdAt: z.string(),
  createdBy: z.string(),
  schemaVersion: z.literal("1"),
});
const email = (value: string) => value.trim().toLowerCase();
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new HttpsError("invalid-argument", "Recovery request is invalid");
  return result.data;
}
function conflict(): never {
  throw new HttpsError("failed-precondition", "This recovery requires office assistance");
}
function safeSegment(value: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value))
    throw new HttpsError("failed-precondition", "Recovery configuration is unavailable");
  return value;
}
function validDate(value: string | undefined): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const n = Date.parse(value + "T00:00:00.000Z");
  return Number.isFinite(n) && new Date(n).toISOString().slice(0, 10) === value;
}
function validPhone(value: string | undefined): value is string {
  return typeof value === "string" && /^\+?[0-9 ()-]{7,40}$/u.test(value);
}

export function createMemberRecoveryService(d: MemberRecoveryDependencies) {
  const academyId = safeSegment(d.academyId);
  safeSegment(d.projectId);
  decodeMemberDirectorySecret(d.identitySecretMaterial, "identity");
  decodeMemberDirectorySecret(d.integritySecretMaterial, "integrity");
  if (d.identitySecretMaterial === d.integritySecretMaterial)
    throw new Error("Recovery purpose secrets must be distinct");
  const root = `academies/${academyId}/`;
  const now = () => d.now?.() ?? new Date().toISOString();
  const mac = (domain: string, values: readonly string[]) =>
    createMemberDirectoryIntegrityMac({
      domain,
      values,
      secretMaterial: d.integritySecretMaterial,
    });
  const ref = (collection: string, key: string) => d.firestore.doc(root + collection + "/" + key);
  async function quota(t: Transaction, subject: string, limit: number, time: string) {
    const key = mac("bpt-recovery-quota-v1", [academyId, subject]);
    const reference = ref("memberRecoveryRateLimits", key);
    const snapshot = await t.get(reference);
    const old = snapshot.data();
    const window = Math.floor(Date.parse(time) / 900000);
    const count = old?.window === window ? Number(old.count) : 0;
    if (!Number.isSafeInteger(count) || count >= limit)
      throw new HttpsError("resource-exhausted", "Too many attempts. Please try again later.");
    return () =>
      t.set(reference, {
        window,
        count: count + 1,
        expiresAt: new Date((window + 2) * 900000).toISOString(),
      });
  }
  async function load(t: Transaction, recoveryId: string) {
    const snapshot = await t.get(ref("memberRecoveryRequests", recoveryId));
    if (!snapshot.exists) throw new HttpsError("not-found", "Recovery request is unavailable");
    const ticket = parse(ticketSchema, snapshot.data());
    if (ticket.academyId !== academyId || ticket.recoveryId !== recoveryId) conflict();
    return ticket;
  }
  function source(
    sources: readonly RecoverySource[],
    recordId: string,
    kind: RecoverySourceKind = "regyfit",
  ) {
    const record = sources.find((s) => s.kind === kind && s.recordId === recordId);
    if (!record) conflict();
    return archiveForLegacyMember(record, sources);
  }
  async function account(uid: string) {
    safeSegment(uid);
    const user = await d.auth.getUser(uid);
    const claims = user.customClaims ?? {};
    if (
      user.uid !== uid ||
      user.disabled ||
      (claims.academyId !== undefined && claims.academyId !== academyId) ||
      (claims.role !== undefined && !["shopper", "adultStudent"].includes(String(claims.role)))
    )
      throw new HttpsError("permission-denied", "This account cannot recover a member profile");
    return user;
  }
  async function admin(t: Transaction, actor: CanonicalMemberDirectoryActor) {
    if (
      actor.academyId !== academyId ||
      !actor.active ||
      !actor.appCheckVerified ||
      !["owner", "administrator"].includes(actor.role)
    )
      throw new HttpsError("permission-denied", "Active office access is required");
    const [user, lock] = await Promise.all([
      t.get(ref("users", actor.actorId)),
      t.get(ref("adminRoleLocks", actor.actorId)),
    ]);
    if (lock.exists || !matchesProvisionedMemberDirectoryActor(user.data(), actor))
      throw new HttpsError("permission-denied", "Active office access is required");
  }
  const row = (ticket: Ticket): MemberRecoveryRequestRow => ({
    requestId: ticket.recoveryId,
    fullName: ticket.fullName,
    status: ticket.status,
    createdAt: ticket.createdAt,
    updatedAt: ticket.updatedAt,
    accountVerified: ticket.accountVerified === true,
  });
  function audit(
    t: Transaction,
    actorId: string,
    recoveryId: string,
    action: "member.recovery.reviewed" | "member.recovery.detail.read",
  ) {
    appendAuditEventInTransaction(t, ref("auditEvents", randomUUID()), {
      academyId,
      actorId,
      action,
      targetRef: root + "memberRecoveryRequests/" + recoveryId,
      purpose: "member-account-recovery",
      correlationId: recoveryId,
    } as AuditEventDraft);
  }

  async function writeLink(
    t: Transaction,
    ticket: Ticket,
    record: RecoverySource,
    user: RecoveryAuthUser,
    supplied: MemberRecoveryProfile,
    time: string,
  ): Promise<CompleteMemberRecoveryResult & { retiredUserId?: string }> {
    const uid = user.uid;
    const accountEmail = email(user.email ?? "");
    // Imported evidence of a minor or an impossible birth date cannot be corrected by
    // self-service input or by approving account ownership. Office must reconcile the source.
    if (
      (record.age !== undefined && record.age < 18) ||
      (record.age !== undefined &&
        record.birthDate !== undefined &&
        ageInCompletedYears(record.birthDate, record.capturedAt.slice(0, 10)) !== record.age) ||
      (record.birthDate !== undefined &&
        (!validDate(record.birthDate) || record.birthDate > time.slice(0, 10)))
    )
      return { status: "pending-review" };
    const sourceBirthDate = record.birthDate;
    if (
      sourceBirthDate !== undefined &&
      deriveParticipantType(sourceBirthDate, time.slice(0, 10)) !== "adult"
    )
      return { status: "pending-review" };
    const samePersonByProfile = (student: StudentProfile): boolean =>
      normalizeRecoveryName(student.fullName) === normalizeRecoveryName(record.fullName) &&
      sourceBirthDate !== undefined &&
      student.dateOfBirth === sourceBirthDate;
    const stateRef = ref("memberDirectoryStates", "current");
    const guardRef = d.firestore.doc(`memberDirectoryRestoreGuards/${academyId}`);
    const authKeyId = deriveStudentIdentityKeyId({
      academyId,
      kind: "auth-user-id",
      value: uid,
      secretMaterial: d.identitySecretMaterial,
    });
    const sourceKey =
      record.kind === "regyfit"
        ? record.recordId
        : mac("bpt-recovery-source-v1", [academyId, record.kind, record.recordId]);
    const linkRef = ref(
      record.kind === "regyfit" ? "regyfitMemberLinks" : "memberRecoverySourceLinks",
      sourceKey,
    );
    const [
      stateSnap,
      guardSnap,
      authKeySnap,
      linkSnap,
      userSnap,
      studentsSnap,
      profilesSnap,
      officeLinkSnap,
      migrationSnap,
    ] = await Promise.all([
      t.get(stateRef),
      t.get(guardRef),
      t.get(ref("studentIdentityKeys", authKeyId)),
      t.get(linkRef),
      t.get(ref("users", uid)),
      t.get(d.firestore.collection(root + "students").limit(1001)),
      t.get(d.firestore.collection(root + "studentAdminProfiles").limit(1001)),
      t.get(
        ref(
          "regyfitOfficeLinks",
          record.kind === "regyfit" ? record.recordId : "not-an-archive-record",
        ),
      ),
      t.get(ref("memberMigrationDecisions", record.legacyMemberId ?? "not-a-legacy-record")),
    ]);
    if (studentsSnap.docs.length > 1000 || profilesSnap.docs.length > 1000)
      throw new HttpsError("unavailable", "Recovery requires office assistance");
    const state = assertCanonicalMemberDirectoryWriterReady(stateSnap.data(), {
      academyId,
      digestVersion: "hmac-sha256-v1",
      secretVersion: d.identitySecretVersion,
    });
    const guard = guardSnap.data();
    if (!guard) conflict();
    const eventSnap = await t.get(
      d.firestore.doc(
        `memberDirectoryRestoreGuards/${academyId}/events/${String(guard.lastEventId)}`,
      ),
    );
    const control = assertMemberDirectoryControlPlane({
      projectId: d.projectId,
      state,
      guard,
      event: eventSnap.data(),
      integritySecretMaterial: d.integritySecretMaterial,
      integritySecretVersion: d.integritySecretVersion,
    });
    const students = new Map<string, StudentProfile>();
    for (const snapshot of studentsSnap.docs) {
      const parsed = parseStudentProfileAt(snapshot.data(), time.slice(0, 10));
      if (
        !parsed.ok ||
        parsed.value.studentId !== snapshot.id ||
        parsed.value.academyId !== academyId
      )
        conflict();
      students.set(snapshot.id, parsed.value);
    }
    const profiles = new Map(
      profilesSnap.docs.map((snapshot) => {
        const value = parse(studentAdminProfileSchema, snapshot.data());
        if (
          value.studentId !== snapshot.id ||
          value.academyId !== academyId ||
          !students.has(snapshot.id)
        )
          conflict();
        return [snapshot.id, value] as const;
      }),
    );
    const administrative = [
      ["membership-number", record.memberNumber, "membershipNumber"],
      ["id-card-number", record.idCardNumber, "idCardNumber"],
      ["vat-number", record.vatNumber, "vatNumber"],
    ] as const;
    const ids = administrative.flatMap(([kind, value, field]) => {
      if (!value) return [];
      try {
        return [{ kind, value: normalizeAdministrativeIdentifier(value), field }];
      } catch {
        return [];
      }
    });
    const keys = ids.map((item) => ({
      ...item,
      keyId: deriveStudentIdentityKeyId({
        academyId,
        kind: item.kind,
        value: item.value,
        secretMaterial: d.identitySecretMaterial,
      }),
    }));
    const keySnaps = await Promise.all(
      keys.map((key) => t.get(ref("studentIdentityKeys", key.keyId))),
    );
    const targets = new Set<string>();
    if (record.canonicalStudentId) targets.add(record.canonicalStudentId);
    const migration = migrationSnap.data();
    if (migrationSnap.exists && migration?.kind !== "skip") {
      if (
        migration?.academyId !== academyId ||
        migration?.legacyMemberId !== record.legacyMemberId ||
        typeof migration?.studentId !== "string"
      )
        conflict();
      targets.add(migration.studentId);
    }
    const officeLink = officeLinkSnap.data();
    if (officeLinkSnap.exists) {
      if (
        !officeLink ||
        officeLink.academyId !== academyId ||
        officeLink.recordId !== record.recordId ||
        typeof officeLink.studentId !== "string" ||
        !students.has(officeLink.studentId)
      )
        conflict();
      targets.add(officeLink.studentId);
    }
    const administrativeOwners = new Set<string>();
    const existingLink = linkSnap.exists ? parse(linkSchema, linkSnap.data()) : undefined;
    if (existingLink) {
      if (existingLink.academyId !== academyId || existingLink.recordId !== record.recordId)
        return { status: "pending-review" };
      targets.add(existingLink.studentId);
    }
    for (const [key, index] of keys.map((key, index) => [key, index] as const)) {
      const snapshot = keySnaps[index]!;
      if (!snapshot.exists) continue;
      const stored = parse(studentIdentityKeySchema, snapshot.data());
      const profile = profiles.get(stored.ownerStudentId);
      if (
        stored.academyId !== academyId ||
        stored.keyId !== key.keyId ||
        stored.kind !== key.kind ||
        stored.secretVersion !== d.identitySecretVersion ||
        !profile ||
        profile[key.field] === undefined ||
        normalizeAdministrativeIdentifier(profile[key.field]!) !== key.value
      )
        conflict();
      targets.add(stored.ownerStudentId);
      administrativeOwners.add(stored.ownerStudentId);
    }
    if (authKeySnap.exists) {
      const key = parse(studentIdentityKeySchema, authKeySnap.data());
      if (
        key.academyId !== academyId ||
        key.keyId !== authKeyId ||
        key.kind !== "auth-user-id" ||
        key.secretVersion !== d.identitySecretVersion ||
        students.get(key.ownerStudentId)?.userId !== uid
      )
        conflict();
      targets.add(key.ownerStudentId);
    }
    const owned = [...students.values()].filter((student) => student.userId === uid);
    if (owned.length > 1) conflict();
    owned.forEach((student) => targets.add(student.studentId));
    if (targets.size > 1) return { status: "pending-review" };
    let existing = students.get([...targets][0] ?? "");
    if (targets.size && !existing) conflict();
    // A canonical person without reservations must be reviewed, never silently duplicated.
    const similar = [...students.values()].filter(
      (student) =>
        normalizeRecoveryName(student.fullName) === normalizeRecoveryName(record.fullName) ||
        (student.email !== undefined &&
          record.email !== undefined &&
          email(student.email) === email(record.email)),
    );
    if (!existing && similar.length) {
      if (
        ticket.approvedCandidateId &&
        ticket.reviewedBy &&
        similar.length === 1 &&
        similar[0] !== undefined &&
        samePersonByProfile(similar[0])
      )
        existing = similar[0];
      else return { status: "pending-review" };
    }
    if (
      existing &&
      !existingLink &&
      existing.studentId !== record.canonicalStudentId &&
      existing.studentId !== officeLink?.studentId &&
      existing.studentId !== migration?.studentId &&
      !administrativeOwners.has(existing.studentId) &&
      !samePersonByProfile(existing)
    )
      return { status: "pending-review" };
    const previousUid = existing?.userId && existing.userId !== uid ? existing.userId : undefined;
    const transferApproved =
      previousUid !== undefined &&
      ticket.status !== "linked" &&
      ticket.reviewedBy !== undefined &&
      ticket.approvedCandidateId !== undefined &&
      ticket.approvedEmail === accountEmail;
    if (previousUid && !transferApproved) return { status: "pending-review" };
    const oldKeyId = previousUid
      ? deriveStudentIdentityKeyId({
          academyId,
          kind: "auth-user-id",
          value: previousUid,
          secretMaterial: d.identitySecretMaterial,
        })
      : undefined;
    const oldProfileSnap = previousUid ? await t.get(ref("users", previousUid)) : undefined;
    const oldKeySnap = oldKeyId ? await t.get(ref("studentIdentityKeys", oldKeyId)) : undefined;
    if (previousUid) {
      const oldAuth = await d.auth.getUser(previousUid);
      const oldProfile = parseUserProfile(oldProfileSnap?.data());
      const oldKey = oldKeySnap?.exists
        ? parse(studentIdentityKeySchema, oldKeySnap.data())
        : undefined;
      if (
        !oldProfile.ok ||
        oldProfile.value.academyId !== academyId ||
        oldProfile.value.userId !== previousUid ||
        oldProfile.value.accountType !== "client" ||
        oldAuth.customClaims?.academyId !== academyId ||
        !["adultStudent", "shopper"].includes(String(oldAuth.customClaims?.role)) ||
        [...students.values()].some(
          (s) => s.userId === previousUid && s.studentId !== existing?.studentId,
        ) ||
        (oldKey &&
          (oldKey.academyId !== academyId ||
            oldKey.ownerStudentId !== existing?.studentId ||
            oldKey.kind !== "auth-user-id" ||
            oldKey.keyId !== oldKeyId))
      )
        conflict();
    }
    if (
      existing &&
      (!existing.active || existing.status !== "active" || existing.participantType !== "adult")
    )
      return { status: "pending-review" };
    if (!existing && record.membershipState !== "active") return { status: "pending-review" };
    if (existing && sourceBirthDate && existing.dateOfBirth !== sourceBirthDate)
      return { status: "pending-review" };
    const profile: MemberRecoveryProfile = {
      ...(sourceBirthDate ? { dateOfBirth: sourceBirthDate } : {}),
      ...(validPhone(record.mobile) ? { phoneNumber: record.mobile } : {}),
      ...supplied,
      ...(existing
        ? {
            dateOfBirth: existing.dateOfBirth,
            trainingCenter: existing.trainingCenter,
            trainingTimePreferences: [...existing.trainingTimePreferences],
            ...(existing.phoneNumber ? { phoneNumber: existing.phoneNumber } : {}),
          }
        : {}),
    };
    // Source identity is authoritative; an applicant cannot replace a known birth date.
    if (sourceBirthDate) profile.dateOfBirth = sourceBirthDate;
    if (validPhone(record.mobile) && !existing?.phoneNumber) profile.phoneNumber = record.mobile;
    if (profile.dateOfBirth && profile.dateOfBirth > time.slice(0, 10))
      throw new HttpsError("invalid-argument", "Date of birth must be in the past");
    if (
      validDate(profile.dateOfBirth) &&
      deriveParticipantType(profile.dateOfBirth, time.slice(0, 10)) !== "adult"
    )
      return { status: "pending-review" };
    if (
      !validDate(profile.dateOfBirth) ||
      !validPhone(profile.phoneNumber) ||
      !profile.trainingCenter ||
      !profile.trainingTimePreferences?.length
    )
      return { status: "profile-required", profile };
    const studentId = existing?.studentId ?? randomUUID();
    const familyId =
      existing?.familyId ?? "adult-" + mac("bpt-adult-family-identity-v1", [academyId, uid]);
    const familyRef = ref("families", familyId);
    const familySnap = await t.get(familyRef);
    const envelope = {
      active: true,
      status: "active" as const,
      schemaVersion: "1" as const,
      createdAt: time,
      createdBy: uid,
      updatedAt: time,
      updatedBy: uid,
    };
    const oldFamily = familySnap.exists ? parseFamilyRecord(familySnap.data()) : undefined;
    const claimOfficeFamily =
      oldFamily?.ok &&
      oldFamily.value.primaryContactUserId === null &&
      oldFamily.value.billingContactUserId === null &&
      (officeLink?.studentId === studentId || familyId === `office-${studentId}`);
    const transferFamily =
      transferApproved &&
      oldFamily?.ok &&
      oldFamily.value.primaryContactUserId === previousUid &&
      oldFamily.value.billingContactUserId === previousUid &&
      ![...students.values()].some((s) => s.familyId === familyId && s.studentId !== studentId);
    const claimFamily = claimOfficeFamily || transferFamily;
    const onlineFamily = claimFamily && oldFamily?.ok ? { ...oldFamily.value } : undefined;
    if (onlineFamily) delete onlineFamily.guardianContact;
    const family = familySnap.exists
      ? parseFamilyRecord(
          claimFamily
            ? {
                ...onlineFamily,
                primaryContactUserId: uid,
                billingContactUserId: uid,
                updatedAt: time,
                updatedBy: uid,
              }
            : familySnap.data(),
        )
      : parseFamilyRecord({
          ...envelope,
          familyId,
          academyId,
          primaryContactUserId: uid,
          billingContactUserId: uid,
        });
    if (
      !family.ok ||
      family.value.academyId !== academyId ||
      family.value.familyId !== familyId ||
      !family.value.active ||
      family.value.status !== "active" ||
      family.value.primaryContactUserId !== uid ||
      family.value.billingContactUserId !== uid
    )
      conflict();
    if (existing?.familyId && !familySnap.exists) conflict();
    const previousUser = userSnap.exists ? parseUserProfile(userSnap.data()) : undefined;
    if (
      previousUser &&
      (!previousUser.ok ||
        previousUser.value.userId !== uid ||
        previousUser.value.academyId !== academyId ||
        !previousUser.value.active ||
        previousUser.value.status !== "active")
    )
      conflict();
    const client = parseUserProfile({
      ...envelope,
      ...(previousUser?.ok ? previousUser.value : {}),
      userId: uid,
      academyId,
      accountType: "client",
      displayName:
        user.displayName?.trim() && user.displayName.trim().length <= 160
          ? user.displayName.trim()
          : record.fullName,
      email: accountEmail,
      phoneNumber: profile.phoneNumber,
      updatedAt: time,
      updatedBy: uid,
    });
    const student = parseStudentProfileAt(
      {
        ...envelope,
        ...(existing ?? {}),
        studentId,
        academyId,
        userId: uid,
        familyId,
        fullName: existing?.fullName ?? record.fullName,
        dateOfBirth: profile.dateOfBirth,
        phoneNumber: profile.phoneNumber,
        email: accountEmail,
        trainingCenter: profile.trainingCenter,
        trainingTimePreferences: profile.trainingTimePreferences,
        participantType: "adult",
        updatedAt: time,
        updatedBy: uid,
      },
      time.slice(0, 10),
    );
    if (!client.ok || !student.ok) return { status: "profile-required", profile };
    if (
      !existing &&
      !state.globalLegacyReadEliminated &&
      state.rollbackEligibleStudentCount >= state.rollbackCapacityLimit
    )
      throw new HttpsError("unavailable", "Recovery is temporarily unavailable");
    const adminProfile =
      profiles.get(studentId) ??
      parse(studentAdminProfileSchema, {
        studentId,
        academyId,
        gender: record.gender,
        source: "regyfit-account-recovery",
        recoveryId: ticket.recoveryId,
        schemaVersion: "1",
        createdAt: time,
        createdBy: uid,
        updatedAt: time,
        updatedBy: uid,
        ...Object.fromEntries(ids.map((item) => [item.field, item.value])),
      });
    // Never overwrite an existing administrative profile just to import source identifiers.
    for (const item of ids)
      if (profiles.has(studentId) && adminProfile[item.field] !== item.value)
        return { status: "pending-review" };
    const receiptId = "write-" + mac("bpt-recovery-write-v1", [academyId, sourceKey, uid]);
    const receiptRef = ref("memberRecoveryWriteReceipts", receiptId);
    const receipt = await t.get(receiptRef);
    if (existingLink && !previousUid) {
      if (
        !receipt.exists ||
        receipt.data()?.studentId !== studentId ||
        existing?.userId !== uid ||
        !authKeySnap.exists
      )
        conflict();
      return { status: "linked" };
    }
    if (receipt.exists) conflict();
    const nextState = {
      ...state,
      stateRevision: state.stateRevision + 1,
      rollbackEligibleStudentCount:
        !existing && !state.globalLegacyReadEliminated
          ? state.rollbackEligibleStudentCount + 1
          : state.rollbackEligibleStudentCount,
      updatedAt: time,
      updatedBy: uid,
    };
    const next = advanceMemberDirectoryControlPlane({
      projectId: d.projectId,
      state: control.state,
      guard: control.guard,
      event: control.event,
      nextState,
      operationId: receiptId,
      transitionKind: "adult-auth-link",
      integritySecretMaterial: d.integritySecretMaterial,
      integritySecretVersion: d.integritySecretVersion,
      now: time,
      actorId: uid,
    });
    const planned = [
      ...keys.filter((_, index) => !keySnaps[index]!.exists),
      ...(!authKeySnap.exists
        ? [{ kind: "auth-user-id" as const, value: uid, keyId: authKeyId }]
        : []),
    ].map((key) =>
      buildStudentIdentityKey({
        academyId,
        kind: key.kind,
        value: key.value,
        ownerStudentId: studentId,
        secretMaterial: d.identitySecretMaterial,
        secretVersion: d.identitySecretVersion,
        now: time,
        actorId: uid,
      }),
    );
    const historicalLinks = previousUid
      ? await Promise.all(
          ["regyfitMemberLinks", "memberRecoverySourceLinks"].map((collection) =>
            t.get(
              d.firestore
                .collection(root + collection)
                .where("studentId", "==", studentId)
                .limit(1001),
            ),
          ),
        )
      : [];
    if (historicalLinks.some((snapshot) => snapshot.docs.length > 1000)) conflict();
    for (const snapshot of historicalLinks)
      for (const document of snapshot.docs) {
        const linked = parse(linkSchema, document.data());
        if (
          linked.academyId !== academyId ||
          linked.studentId !== studentId ||
          linked.userId !== previousUid
        )
          conflict();
      }
    // Keep the same student and family IDs. Historical collections stay attached to them.
    if (previousUid && oldProfileSnap?.exists) {
      t.update(ref("users", previousUid), {
        active: false,
        status: "inactive",
        updatedAt: time,
        updatedBy: ticket.reviewedBy,
      });
      if (oldKeySnap?.exists) t.delete(oldKeySnap.ref);
      for (const snapshot of historicalLinks)
        for (const document of snapshot.docs)
          t.update(document.ref, {
            userId: uid,
            recoveryId: ticket.recoveryId,
            verificationMethod: "administrator-review",
            reviewedBy: ticket.reviewedBy,
          });
    }
    t.set(ref("students", studentId), student.value);
    t.set(ref("users", uid), client.value);
    if (!familySnap.exists) t.create(familyRef, family.value);
    else if (claimFamily) t.set(familyRef, family.value);
    if (!profiles.has(studentId)) t.create(ref("studentAdminProfiles", studentId), adminProfile);
    for (const key of planned) t.create(ref("studentIdentityKeys", key.keyId), key);
    t.set(linkRef, {
      academyId,
      recordId: record.recordId,
      studentId,
      userId: uid,
      recoveryId: ticket.recoveryId,
      source: record.source,
      sourceCapturedAt: record.capturedAt,
      verificationMethod:
        ticket.approvedCandidateId && ticket.approvedEmail === accountEmail
          ? "administrator-review"
          : "registered-email",
      ...(ticket.approvedCandidateId && ticket.approvedEmail === accountEmail && ticket.reviewedBy
        ? { reviewedBy: ticket.reviewedBy }
        : {}),
      createdAt: time,
      createdBy: uid,
      schemaVersion: "1",
    });
    t.create(receiptRef, {
      receiptId,
      academyId,
      studentId,
      userId: uid,
      recoveryId: ticket.recoveryId,
      createdAt: time,
      schemaVersion: "1",
      stateRevisionBefore: state.stateRevision,
      stateRevisionAfter: nextState.stateRevision,
    });
    t.set(stateRef, nextState);
    t.set(guardRef, next.guard);
    t.create(
      d.firestore.doc(`memberDirectoryRestoreGuards/${academyId}/events/${next.event.eventId}`),
      next.event,
    );
    appendAuditEventInTransaction(t, ref("auditEvents", randomUUID()), {
      academyId,
      actorId: uid,
      action: existing ? "member.updated" : "member.created",
      targetRef: root + "students/" + studentId,
      purpose: "member-record-maintenance",
      correlationId: receiptId,
    } as AuditEventDraft);
    return { status: "linked", ...(previousUid ? { retiredUserId: previousUid } : {}) };
  }

  async function complete(value: unknown, uid: string): Promise<CompleteMemberRecoveryResult> {
    const input = parse(completeMemberRecoveryInputSchema, value);
    const user = await account(uid);
    const time = now();
    const outcome = await d.firestore.runTransaction(async (t) => {
      const ticket = await load(t, input.recoveryId);
      if (ticket.userId && ticket.userId !== uid)
        throw new HttpsError("permission-denied", "Recovery request is unavailable");
      if (Date.parse(ticket.expiresAt) <= Date.parse(time) && ticket.status !== "linked")
        throw new HttpsError(
          "deadline-exceeded",
          "Recovery request has expired. Please start again.",
        );
      const spend = await quota(t, "account:" + uid, 30, time);
      let result: CompleteMemberRecoveryResult & { retiredUserId?: string };
      if (ticket.status === "rejected") result = { status: "rejected" };
      else if (!user.emailVerified || !user.email || !z.email().safeParse(user.email).success)
        result = { status: "verify-email" };
      else {
        const sources = await loadRecoverySources(t, d.firestore, academyId, time);
        const records = ticket.candidates.map((candidate) => ({
          candidate,
          record: source(sources, candidate.recordId, candidate.kind),
        }));
        const approved =
          ticket.approvedEmail === email(user.email)
            ? records.find((item) => item.candidate.candidateId === ticket.approvedCandidateId)
            : undefined;
        let chosen = approved;
        if (ticket.status === "linked") {
          // A completed ticket cannot become a new approval or reclaim a replaced account.
          const candidates = await Promise.all(
            records.map(async (item) => {
              const r = item.record;
              const key =
                r.kind === "regyfit"
                  ? r.recordId
                  : mac("bpt-recovery-source-v1", [academyId, r.kind, r.recordId]);
              const link = (
                await t.get(
                  ref(
                    r.kind === "regyfit" ? "regyfitMemberLinks" : "memberRecoverySourceLinks",
                    key,
                  ),
                )
              ).data();
              return link?.academyId === academyId &&
                link?.userId === uid &&
                link?.recordId === r.recordId
                ? item
                : undefined;
            }),
          );
          chosen = candidates.find((item) => item !== undefined);
          if (!chosen)
            throw new HttpsError(
              "permission-denied",
              "This recovery no longer owns the member account.",
            );
        }
        result = chosen
          ? await writeLink(
              t,
              ticket,
              chosen.record,
              user,
              { ...ticket.profile, ...input.profile },
              time,
            )
          : { status: "pending-review" };
      }
      if (ticket.status === "linked" && result.status !== "linked") conflict();
      spend();
      t.set(ref("memberRecoveryRequests", ticket.recoveryId), {
        ...ticket,
        userId: uid,
        // An authenticated review may take days; the unbound public ticket lasts only 24 hours.
        expiresAt: ticket.userId
          ? ticket.expiresAt
          : new Date(Date.parse(time) + 30 * 24 * 3600000).toISOString(),
        ...(user.email ? { accountEmail: email(user.email) } : {}),
        accountVerified:
          user.emailVerified &&
          typeof user.email === "string" &&
          z.email().safeParse(user.email).success,
        status: result.status,
        ...(result.retiredUserId ? { retiredUserId: result.retiredUserId } : {}),
        ...(input.profile ? { profile: { ...ticket.profile, ...input.profile } } : {}),
        updatedAt: time,
      });
      return {
        ...result,
        ...(ticket.retiredUserId && !result.retiredUserId
          ? { retiredUserId: ticket.retiredUserId }
          : {}),
      };
    });
    if (outcome.status === "linked") {
      if (outcome.retiredUserId) await d.auth.revokeRefreshTokens?.(outcome.retiredUserId);
      const fresh = await account(uid);
      if (!fresh.emailVerified || email(fresh.email ?? "") !== email(user.email ?? ""))
        throw new HttpsError("failed-precondition", "Verify your account and try recovery again");
      if (
        fresh.customClaims?.role !== "adultStudent" ||
        fresh.customClaims?.academyId !== academyId
      )
        await d.auth.setCustomUserClaims(uid, {
          ...fresh.customClaims,
          academyId,
          role: "adultStudent",
        });
      const observed = await account(uid);
      if (
        observed.customClaims?.role !== "adultStudent" ||
        observed.customClaims?.academyId !== academyId
      )
        throw new HttpsError(
          "unavailable",
          "Account access is still being updated. Please try again.",
        );
    }
    const { retiredUserId: _retiredUserId, ...publicOutcome } = outcome;
    return publicOutcome;
  }

  return {
    async begin(value: unknown, ip: string) {
      const input = parse(beginMemberRecoveryInputSchema, value);
      if (!ip || ip.length > 128)
        throw new HttpsError("failed-precondition", "Recovery is unavailable");
      const time = now();
      const recoveryId = randomBytes(32).toString("hex");
      const expiresAt = new Date(Date.parse(time) + 24 * 3600000).toISOString();
      await d.firestore.runTransaction(async (t) => {
        const spend = await quota(t, "ip:" + ip, 10, time);
        const sources = await loadRecoverySources(t, d.firestore, academyId, time);
        const candidates = sources.flatMap((record) => {
          return normalizeRecoveryName(record.fullName) === normalizeRecoveryName(input.fullName) ||
            (input.email !== undefined &&
              record.email !== undefined &&
              email(record.email) === email(input.email))
            ? [
                {
                  candidateId: mac("bpt-recovery-candidate-v1", [
                    academyId,
                    recoveryId,
                    record.kind,
                    record.recordId,
                  ]),
                  recordId: record.recordId,
                  kind: record.kind,
                },
              ]
            : [];
        });
        // Oversized ambiguous matches remain generic and cannot be automatically linked.
        spend();
        t.create(ref("memberRecoveryRequests", recoveryId), {
          recoveryId,
          academyId,
          fullName: input.fullName,
          previousEmail: input.email ? email(input.email) : "",
          createdAt: time,
          updatedAt: time,
          expiresAt,
          candidates: candidates.length <= 20 ? candidates : [],
          accountVerified: false,
          status: "pending-review",
        });
      });
      return { recoveryId, expiresAt };
    },
    complete,
    async history(uid: string) {
      const user = await account(uid);
      if (!user.emailVerified || user.customClaims?.role !== "adultStudent")
        throw new HttpsError("permission-denied", "Member access is required.");
      return d.firestore.runTransaction(async (t) => {
        const spend = await quota(t, "history:" + uid, 30, now());
        const profile = parseUserProfile((await t.get(ref("users", uid))).data());
        if (
          !profile.ok ||
          profile.value.academyId !== academyId ||
          profile.value.userId !== uid ||
          !profile.value.active ||
          profile.value.status !== "active"
        )
          conflict();
        const owned = await t.get(
          d.firestore
            .collection(root + "students")
            .where("userId", "==", uid)
            .limit(2),
        );
        if (owned.docs.length !== 1) conflict();
        const student = parseStudentProfileAt(owned.docs[0]!.data(), now().slice(0, 10));
        if (
          !student.ok ||
          student.value.academyId !== academyId ||
          student.value.studentId !== owned.docs[0]!.id ||
          !student.value.active ||
          student.value.status !== "active"
        )
          conflict();
        const snapshots = await Promise.all(
          ["regyfitMemberLinks", "regyfitOfficeLinks"].map((collection) =>
            t.get(
              d.firestore
                .collection(root + collection)
                .where("studentId", "==", student.value.studentId)
                .limit(21),
            ),
          ),
        );
        const ids = new Set<string>();
        for (const snapshot of snapshots)
          for (const doc of snapshot.docs) {
            const link = doc.data();
            if (
              link.academyId !== academyId ||
              link.studentId !== student.value.studentId ||
              link.recordId !== doc.id ||
              (link.userId !== undefined && link.userId !== uid)
            )
              conflict();
            ids.add(doc.id);
          }
        if (ids.size > 20) conflict();
        const records = await Promise.all(
          [...ids].map(async (recordId) => {
            const stored = (await t.get(ref("regyfitMemberRecords", recordId))).data();
            const parsed = parseStoredRegyfitMemberRecord(stored);
            if (
              !parsed.ok ||
              parsed.value.recordId !== recordId ||
              (stored?.academyId !== undefined && stored.academyId !== academyId)
            )
              conflict();
            const { fullName, capturedAt, graduation, plan, attendance, payments } = parsed.value;
            return { recordId, fullName, capturedAt, graduation, plan, attendance, payments };
          }),
        );
        const result = memberRecoveryHistorySchema.parse({ records });
        spend();
        return result;
      });
    },
    async list(actor: CanonicalMemberDirectoryActor) {
      return d.firestore.runTransaction(async (t) => {
        await admin(t, actor);
        const time = now();
        const spend = await quota(t, "office:" + actor.actorId, 60, time);
        // Filtering must happen in Firestore before limit: terminal, unbound or expired
        // requests must never displace work the office can resolve. Account-bound expiry
        // is fixed at binding + 30 days, so ascending expiry serves oldest bindings first.
        const snapshot = await t.get(
          d.firestore
            .collection(root + "memberRecoveryRequests")
            .where("status", "in", ["pending-review", "profile-required"])
            .where("accountVerified", "==", true)
            .where("expiresAt", ">", time)
            .orderBy("expiresAt", "asc")
            .orderBy("createdAt", "asc")
            .limit(51),
        );
        const unverified = await t.get(
          d.firestore
            .collection(root + "memberRecoveryRequests")
            .where("status", "==", "verify-email")
            .where("accountVerified", "==", false)
            .where("expiresAt", ">", time)
            .orderBy("expiresAt", "asc")
            .orderBy("createdAt", "asc")
            .limit(51),
        );
        const actionable = [...snapshot.docs, ...unverified.docs].sort(
          (a, b) =>
            String(a.data().expiresAt).localeCompare(String(b.data().expiresAt)) ||
            String(a.data().createdAt).localeCompare(String(b.data().createdAt)),
        );
        const requests = actionable
          .slice(0, 50)
          .map((document) => row(parse(ticketSchema, document.data())));
        spend();
        return { requests, truncated: actionable.length > 50 };
      });
    },
    async detail(
      value: unknown,
      actor: CanonicalMemberDirectoryActor,
    ): Promise<MemberRecoveryDetail> {
      const input = parse(getMemberRecoveryDetailInputSchema, value);
      return d.firestore.runTransaction(async (t) => {
        await admin(t, actor);
        const spend = await quota(t, "detail:" + actor.actorId, 20, now());
        const ticket = await load(t, input.requestId);
        const sources = await loadRecoverySources(t, d.firestore, academyId, now());
        // Refresh candidates for old tickets and let office staff resolve misspelled names.
        const found = sources.filter((record) =>
          input.search
            ? normalizeRecoveryName(record.fullName).includes(
                normalizeRecoveryName(input.search),
              ) ||
              (record.email && email(record.email).includes(email(input.search))) ||
              record.memberNumber === input.search
            : normalizeRecoveryName(record.fullName) === normalizeRecoveryName(ticket.fullName) ||
              (ticket.previousEmail &&
                record.email &&
                email(record.email) === ticket.previousEmail),
        );
        const fresh = found.map((record) => ({
          kind: record.kind,
          recordId: record.recordId,
          candidateId: mac("bpt-recovery-candidate-v1", [
            academyId,
            ticket.recoveryId,
            record.kind,
            record.recordId,
          ]),
        }));
        const retained = input.search
          ? ticket.candidates.filter((c) => c.candidateId === ticket.approvedCandidateId)
          : ticket.candidates;
        const selections = [...retained];
        for (const candidate of fresh)
          if (
            !selections.some(
              (c) => (c.kind ?? "regyfit") === candidate.kind && c.recordId === candidate.recordId,
            )
          )
            selections.push(candidate);
        ticket.candidates = selections.slice(0, 20);
        const candidates = ticket.candidates.map((candidate) => {
          const record = source(sources, candidate.recordId, candidate.kind);
          return {
            candidateId: candidate.candidateId,
            ...(record.kind === "regyfit" ? { archiveRecordId: record.recordId } : {}),
            fullName: record.fullName,
            ...(record.email ? { email: record.email } : {}),
            ...(record.birthDate ? { dateOfBirth: record.birthDate } : {}),
            membershipState: record.membershipState,
            source: candidate.kind ?? "regyfit",
          };
        });
        spend();
        if (ticket.status !== "linked" && ticket.status !== "rejected")
          t.set(ref("memberRecoveryRequests", ticket.recoveryId), ticket);
        audit(t, actor.actorId, ticket.recoveryId, "member.recovery.detail.read");
        return {
          request: {
            ...row(ticket),
            previousEmail: ticket.previousEmail,
            ...(ticket.accountEmail ? { accountEmail: ticket.accountEmail } : {}),
          },
          candidates,
        };
      });
    },
    async review(
      value: unknown,
      actor: CanonicalMemberDirectoryActor,
    ): Promise<CompleteMemberRecoveryResult> {
      const input = parse(reviewMemberRecoveryInputSchema, value);
      let uid: string | undefined;
      // Account state is rechecked after the review and again before any canonical write.
      await d.firestore.runTransaction(async (t) => {
        await admin(t, actor);
        const spend = await quota(t, "review:" + actor.actorId, 20, now());
        const ticket = await load(t, input.requestId);
        if (ticket.status === "linked" || ticket.status === "rejected") conflict();
        if (Date.parse(ticket.expiresAt) <= Date.parse(now())) conflict();
        uid = ticket.userId;
        if (
          input.decision === "approve" &&
          (!uid ||
            !ticket.accountVerified ||
            !ticket.accountEmail ||
            !ticket.candidates.some((candidate) => candidate.candidateId === input.candidateId))
        )
          conflict();
        spend();
        t.set(ref("memberRecoveryRequests", ticket.recoveryId), {
          ...ticket,
          status: input.decision === "reject" ? "rejected" : "pending-review",
          reviewedBy: actor.actorId,
          ...(input.decision === "approve"
            ? { approvedCandidateId: input.candidateId, approvedEmail: ticket.accountEmail }
            : {}),
          updatedAt: now(),
        });
        audit(t, actor.actorId, ticket.recoveryId, "member.recovery.reviewed");
      });
      if (input.decision === "reject") return { status: "rejected" };
      return complete({ recoveryId: input.requestId }, uid!);
    },
  };
}
export type MemberRecoveryService = ReturnType<typeof createMemberRecoveryService>;
