import { randomBytes, randomUUID } from "node:crypto";
import type { Firestore, Transaction } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import { z } from "zod";
import {
  beginMemberRecoveryInputSchema,
  completeMemberRecoveryInputSchema,
  reviewMemberRecoveryInputSchema,
  getMemberRecoveryDetailInputSchema,
  type MemberRecoveryProfile,
  type CompleteMemberRecoveryResult,
  type MemberRecoveryDetail,
  type MemberRecoveryRequestRow,
} from "@bpt-jersey/domain/members/recovery";
import {
  parseStoredRegyfitMemberRecord,
  type RegyfitMemberRecord,
} from "@bpt-jersey/domain/members/regyfit-records";
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
import { memberAgeOn } from "@bpt-jersey/domain/members/profile";
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
    .array(z.strictObject({ candidateId: id, recordId: z.string().regex(/^\d{1,12}$/u) }))
    .max(20),
  userId: z.string().optional(),
  accountEmail: z.string().optional(),
  accountVerified: z.boolean().optional(),
  status: z.enum(["verify-email", "pending-review", "profile-required", "linked", "rejected"]),
  approvedCandidateId: id.optional(),
  approvedEmail: z.string().optional(),
  reviewedBy: z.string().optional(),
  studentId: z.string().optional(),
});
type Ticket = z.infer<typeof ticketSchema>;
const linkSchema = z.strictObject({
  academyId: z.string(),
  recordId: z.string(),
  studentId: z.string(),
  userId: z.string(),
  recoveryId: id,
  source: z.literal("regyfit-admin-capture"),
  sourceCapturedAt: z.string(),
  verificationMethod: z.enum(["registered-email", "administrator-review"]),
  reviewedBy: z.string().optional(),
  createdAt: z.string(),
  createdBy: z.string(),
  schemaVersion: z.literal("1"),
});
export function normalizeRecoveryName(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .trim()
    .replace(/\s+/gu, " ")
    .toLocaleLowerCase("en-US");
}
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
  async function source(t: Transaction, recordId: string) {
    const snapshot = await t.get(ref("regyfitMemberRecords", recordId));
    const parsed = parseStoredRegyfitMemberRecord(snapshot.data());
    if (!parsed.ok || parsed.value.recordId !== recordId) conflict();
    return parsed.value;
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
    record: RegyfitMemberRecord,
    user: RecoveryAuthUser,
    supplied: MemberRecoveryProfile,
    time: string,
  ): Promise<CompleteMemberRecoveryResult> {
    const uid = user.uid;
    const accountEmail = email(user.email ?? "");
    // Imported evidence of a minor or an impossible birth date cannot be corrected by
    // self-service input or by approving account ownership. Office must reconcile the source.
    if (
      (record.age !== undefined && record.age < 18) ||
      (record.age !== undefined &&
        record.birthDate !== undefined &&
        memberAgeOn(record.birthDate, record.capturedAt.slice(0, 10)) !== record.age) ||
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
    const linkRef = ref("regyfitMemberLinks", record.recordId);
    const [stateSnap, guardSnap, authKeySnap, linkSnap, userSnap, studentsSnap, profilesSnap] =
      await Promise.all([
        t.get(stateRef),
        t.get(guardRef),
        t.get(ref("studentIdentityKeys", authKeyId)),
        t.get(linkRef),
        t.get(ref("users", uid)),
        t.get(d.firestore.collection(root + "students").limit(1001)),
        t.get(d.firestore.collection(root + "studentAdminProfiles").limit(1001)),
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
    const administrativeOwners = new Set<string>();
    const existingLink = linkSnap.exists ? parse(linkSchema, linkSnap.data()) : undefined;
    if (existingLink) {
      if (
        existingLink.academyId !== academyId ||
        existingLink.recordId !== record.recordId ||
        existingLink.userId !== uid
      )
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
      !administrativeOwners.has(existing.studentId) &&
      !samePersonByProfile(existing)
    )
      return { status: "pending-review" };
    if (existing && existing.userId !== undefined && existing.userId !== uid)
      return { status: "pending-review" };
    if (
      existing &&
      (!existing.active || existing.status !== "active" || existing.participantType !== "adult")
    )
      return { status: "pending-review" };
    if (record.membershipState !== "active") return { status: "pending-review" };
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
    const family = familySnap.exists
      ? parseFamilyRecord(familySnap.data())
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
        email:
          existing?.email ??
          (z.email().safeParse(record.email).success ? record.email : accountEmail),
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
    const receiptId = "write-" + mac("bpt-recovery-write-v1", [academyId, record.recordId, uid]);
    const receiptRef = ref("memberRecoveryWriteReceipts", receiptId);
    const receipt = await t.get(receiptRef);
    if (existingLink) {
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
    t.set(ref("students", studentId), student.value);
    t.set(ref("users", uid), client.value);
    if (!familySnap.exists) t.create(familyRef, family.value);
    if (!profiles.has(studentId)) t.create(ref("studentAdminProfiles", studentId), adminProfile);
    for (const key of planned) t.create(ref("studentIdentityKeys", key.keyId), key);
    t.create(linkRef, {
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
    return { status: "linked" };
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
      let result: CompleteMemberRecoveryResult;
      if (ticket.status === "rejected") result = { status: "rejected" };
      else if (!user.emailVerified || !user.email || !z.email().safeParse(user.email).success)
        result = { status: "verify-email" };
      else {
        const records = await Promise.all(
          ticket.candidates.map(async (candidate) => ({
            candidate,
            record: await source(t, candidate.recordId),
          })),
        );
        const exact = records.filter(
          ({ record }) =>
            normalizeRecoveryName(record.fullName) === normalizeRecoveryName(ticket.fullName) &&
            record.email !== undefined &&
            email(record.email) === ticket.previousEmail,
        );
        const approved =
          ticket.approvedEmail === email(user.email)
            ? records.find((item) => item.candidate.candidateId === ticket.approvedCandidateId)
            : undefined;
        const chosen =
          approved ??
          (exact.length === 1 && email(user.email) === ticket.previousEmail ? exact[0] : undefined);
        result = chosen
          ? await writeLink(t, ticket, chosen.record, user, input.profile ?? {}, time)
          : { status: "pending-review" };
      }
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
        updatedAt: time,
      });
      return result;
    });
    if (outcome.status === "linked") {
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
    return outcome;
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
        const snapshot = await t.get(
          d.firestore.collection(root + "regyfitMemberRecords").limit(1001),
        );
        if (snapshot.docs.length > 1000)
          throw new HttpsError("unavailable", "Recovery is temporarily unavailable");
        const candidates = snapshot.docs.flatMap((document) => {
          const parsed = parseStoredRegyfitMemberRecord(document.data());
          if (!parsed.ok || parsed.value.recordId !== document.id) return [];
          const record = parsed.value;
          return normalizeRecoveryName(record.fullName) === normalizeRecoveryName(input.fullName) ||
            (record.email !== undefined && email(record.email) === email(input.email))
            ? [
                {
                  candidateId: mac("bpt-recovery-candidate-v1", [
                    academyId,
                    recoveryId,
                    record.recordId,
                  ]),
                  recordId: record.recordId,
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
          previousEmail: email(input.email),
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
            .where("status", "==", "pending-review")
            .where("accountVerified", "==", true)
            .where("expiresAt", ">", time)
            .orderBy("expiresAt", "asc")
            .orderBy("createdAt", "asc")
            .limit(51),
        );
        const requests = snapshot.docs
          .slice(0, 50)
          .map((document) => row(parse(ticketSchema, document.data())));
        spend();
        return { requests, truncated: snapshot.docs.length > 50 };
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
        const candidates = await Promise.all(
          ticket.candidates.map(async (candidate) => {
            const record = await source(t, candidate.recordId);
            return {
              candidateId: candidate.candidateId,
              fullName: record.fullName,
              ...(record.email ? { email: record.email } : {}),
              ...(record.birthDate ? { dateOfBirth: record.birthDate } : {}),
              membershipState: record.membershipState,
            };
          }),
        );
        spend();
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
