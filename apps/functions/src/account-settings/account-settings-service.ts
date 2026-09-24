import { randomUUID } from "node:crypto";

import type { Firestore } from "firebase-admin/firestore";
import { warn } from "firebase-functions/logger";
import { HttpsError } from "firebase-functions/v2/https";
import { z } from "zod";

import { memberAgeOn, needsAdultClaim, teenAccountMinimumAge, type MemberAccessService } from "@bpt-jersey/domain/members/access";
import { teenAccessInputSchema, uploadProfilePhotoInputSchema } from "@bpt-jersey/domain/members/engagement";
import { parseEffectiveStudentProfileAt, parseUserProfile, type UserProfile } from "@bpt-jersey/domain/profiles";
import { dateKeyInJersey } from "@bpt-jersey/domain/schedule/member-calendar";

import { resolveCanonicalStudentIdInTransaction } from "../members/member-identity-resolution.js";
import type { R2Client } from "../storage/r2-client.js";
import { PhotoRejected, sanitiseAvatar, signPhotoUrl } from "./profile-photo.js";

/** academies/{academyId}/memberPublicSettings/{studentId}: server-only, default-denied by the rules. */
export type MemberPublicSettingsDoc = {
  academyId: string;
  studentId: string;
  photoObjectKey: string | null;
  photoConsentAt: string | null;
  photoConsentBy: string | null;
  /** A teen's proposal (B4), waiting for the guardian. Never shown to other members. */
  pendingPhotoObjectKey: string | null;
  showToMembers: boolean;
  updatedAt: string;
};

/** academies/{academyId}/teenAccess/{studentId}: server-only, default-denied by the rules. */
export type TeenAccessDoc = {
  academyId: string;
  studentId: string;
  uid: string;
  email: string;
  createdBy: string;
  createdAt: string;
  adultClaimedAt: string | null;
  revokedAt: string | null;
};

type MemberActor = Readonly<{ userId: string; academyId: string }>;
/** `manage`: guardian, or an adult on their own profile. `propose`: a 12–17 year old on their own profile. */
type Permission = "manage" | "propose";

export const photoRejectedMessage = "Choose a single JPEG, PNG or WebP image under 2 MB.";
const studentInputSchema = z.strictObject({ studentId: z.string().min(1).max(128) });
const visibilityInputSchema = z.strictObject({ studentId: z.string().min(1).max(128), showToMembers: z.boolean() });

const settingsPath = (academyId: string, studentId: string) => `academies/${academyId}/memberPublicSettings/${studentId}`;
const teenAccessPath = (academyId: string, studentId: string) => `academies/${academyId}/teenAccess/${studentId}`;
const userPath = (academyId: string, userId: string) => `academies/${academyId}/users/${userId}`;

export const teenAgeMessage = "Own access is available from 12 to 17.";
export const teenEmailMessage = "We couldn't create access with that email. Try a different one.";
const teenUnavailableMessage = "Own access could not be set up. Try again.";
/** The client re-authenticates right before claiming; an older sign-in is refused. */
const adultClaimSignInWindowMs = 5 * 60 * 1000;

/** The Auth calls teen access needs, so the service can be exercised without Firebase. */
export type TeenAccessAuth = Readonly<{
  createUser: (input: { email: string; password: string; emailVerified: true; disabled: false; displayName: string }) => Promise<{ uid: string }>;
  setCustomUserClaims: (uid: string, claims: Readonly<Record<string, unknown>>) => Promise<void>;
  deleteUser: (uid: string) => Promise<void>;
  updateUser: (uid: string, input: { disabled: boolean }) => Promise<unknown>;
  revokeRefreshTokens: (uid: string) => Promise<void>;
}>;
/** Sets or clears `students/{studentId}.userId` through the canonical directory writer. */
export type StudentAccountLinker = (input: Readonly<{
  actor: MemberActor; studentId: string; userId: string | null; expectedUserId: string | null; now: string;
}>) => Promise<void>;

function defaults(academyId: string, studentId: string): MemberPublicSettingsDoc {
  return {
    academyId, studentId, photoObjectKey: null, photoConsentAt: null, photoConsentBy: null,
    pendingPhotoObjectKey: null, showToMembers: true, updatedAt: new Date(0).toISOString(),
  };
}

const nullableString = (value: unknown): string | null => (typeof value === "string" && value.length > 0 ? value : null);

function fromData(academyId: string, studentId: string, data: Readonly<Record<string, unknown>> | undefined): MemberPublicSettingsDoc {
  const base = defaults(academyId, studentId);
  if (!data) return base;
  return {
    ...base,
    photoObjectKey: nullableString(data.photoObjectKey),
    photoConsentAt: nullableString(data.photoConsentAt),
    photoConsentBy: nullableString(data.photoConsentBy),
    pendingPhotoObjectKey: nullableString(data.pendingPhotoObjectKey),
    showToMembers: data.showToMembers !== false,
    updatedAt: nullableString(data.updatedAt) ?? base.updatedAt,
  };
}

/** Q9: a member without a settings document is visible and has no photo. */
export async function readPublicSettings(db: Firestore, academyId: string, studentId: string): Promise<MemberPublicSettingsDoc> {
  const snapshot = await db.doc(settingsPath(academyId, studentId)).get();
  return fromData(academyId, studentId, snapshot.exists ? snapshot.data() : undefined);
}

/**
 * A teen's unconsented proposal, signed only for callers already authorised on this student (the teen and
 * their guardian, in their own settings). Module-private on purpose: public cards sign through signPhotoUrl.
 */
async function signProposalPreview(r2: R2Client, objectKey: string | null): Promise<string | null> {
  if (!objectKey || !r2.createPrivateImageUrl) return null;
  return r2.createPrivateImageUrl({ objectKey, expiresInSeconds: 900, contentType: "image/webp" });
}

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new HttpsError("invalid-argument", "Check the request details.");
  return parsed.data;
}

/** Strict base64: Buffer.from silently skips junk, so the round trip must reproduce the input. */
function decodeBase64(base64: string): Buffer {
  const bytes = Buffer.from(base64, "base64");
  if (bytes.length === 0 || bytes.toString("base64") !== base64) throw new PhotoRejected();
  return bytes;
}

export type AccountSettingsDependencies = Readonly<{
  firestore: Firestore;
  r2: R2Client;
  access: Pick<MemberAccessService, "authorise"> & Partial<Pick<MemberAccessService, "listProfiles">>;
  /** Only the teen access callables provide these (they carry the directory writer secrets). */
  teen?: Readonly<{ auth: TeenAccessAuth; linkStudentAccount?: StudentAccountLinker }>;
  now?: () => string;
}>;

export function createAccountSettingsService(deps: AccountSettingsDependencies) {
  const db = deps.firestore;
  const now = () => deps.now?.() ?? new Date().toISOString();
  const readDoc = async (path: string) => {
    const snapshot = await db.doc(path).get();
    return { id: snapshot.id, exists: snapshot.exists, data: snapshot.data() };
  };

  /** One permission decision per call: authorise() first, then age for own profiles (D10: consent is the guardian's until 18). */
  async function permissionFor(actor: MemberActor, requestedStudentId: string): Promise<{ studentId: string; permission: Permission; via: "self" | "guardian" }> {
    const decision = await deps.access.authorise(actor.academyId, actor.userId, requestedStudentId);
    if (!decision.allowed) throw new HttpsError("permission-denied", "This member is not available to your account.");
    let studentId: string;
    try {
      studentId = await resolveCanonicalStudentIdInTransaction({ get: readDoc }, actor.academyId, requestedStudentId);
    } catch {
      throw new HttpsError("permission-denied", "This member is not available to your account.");
    }
    if (decision.via === "guardian") return { studentId, permission: "manage", via: "guardian" };
    const student = await readDoc(`academies/${actor.academyId}/students/${studentId}`);
    const academyDate = dateKeyInJersey(new Date(now()));
    const parsed = parseEffectiveStudentProfileAt(student.data, academyDate);
    if (!student.exists || !parsed.ok) throw new HttpsError("permission-denied", "This member is not available to your account.");
    const age = memberAgeOn(parsed.value.dateOfBirth, academyDate);
    return { studentId, permission: age !== null && age >= 18 ? "manage" : "propose", via: "self" };
  }

  function teenDeps() {
    if (!deps.teen) throw new HttpsError("unavailable", teenUnavailableMessage);
    return deps.teen;
  }

  function teenWriterDeps() {
    const { auth, linkStudentAccount } = teenDeps();
    if (!linkStudentAccount) throw new HttpsError("unavailable", teenUnavailableMessage);
    return { auth, linkStudentAccount };
  }

  async function studentAge(academyId: string, studentId: string) {
    const student = await readDoc(`academies/${academyId}/students/${studentId}`);
    const academyDate = dateKeyInJersey(new Date(now()));
    const parsed = parseEffectiveStudentProfileAt(student.data, academyDate);
    if (!student.exists || !parsed.ok) throw new HttpsError("permission-denied", "This member is not available to your account.");
    return { student: parsed.value, age: memberAgeOn(parsed.value.dateOfBirth, academyDate) };
  }

  function readTeenAccess(data: Readonly<Record<string, unknown>> | undefined): TeenAccessDoc | null {
    if (!data || typeof data.uid !== "string" || typeof data.email !== "string") return null;
    return {
      academyId: String(data.academyId), studentId: String(data.studentId), uid: data.uid, email: data.email,
      createdBy: String(data.createdBy), createdAt: String(data.createdAt),
      adultClaimedAt: nullableString(data.adultClaimedAt), revokedAt: nullableString(data.revokedAt),
    };
  }

  /** The own-profile (`via: "self"`) student of this account, and its teen access record if any. */
  async function ownTeenAccess(actor: MemberActor) {
    if (!deps.access.listProfiles) throw new HttpsError("unavailable", "Your account could not be checked. Try again.");
    const own = (await deps.access.listProfiles(actor.academyId, actor.userId)).find((profile) => profile.via === "self");
    if (!own) return null;
    const { age } = await studentAge(actor.academyId, own.studentId);
    const teen = await readDoc(teenAccessPath(actor.academyId, own.studentId));
    const doc = teen.exists ? readTeenAccess(teen.data) : null;
    const required = needsAdultClaim({
      age, via: "self", createdByGuardian: doc !== null && doc.uid === actor.userId, adultClaimedAt: doc?.adultClaimedAt ?? null,
    });
    return { studentId: own.studentId, required };
  }

  async function requireManage(actor: MemberActor, requestedStudentId: string): Promise<string> {
    const { studentId, permission } = await permissionFor(actor, requestedStudentId);
    if (permission !== "manage") throw new HttpsError("permission-denied", "Ask your guardian to change this.");
    return studentId;
  }

  /** A failed delete leaves a harmless orphan in the private bucket; log the key, never the bytes. */
  async function deleteQuietly(objectKey: string | null, academyId: string, studentId: string): Promise<void> {
    if (!objectKey) return;
    try {
      await deps.r2.deleteObject(objectKey);
    } catch {
      warn("Profile photo object could not be deleted", { academyId, studentId, objectKey });
    }
  }

  return {
    async uploadProfilePhoto(actor: MemberActor, data: unknown): Promise<{ photoUrl: string | null; pending: boolean }> {
      const input = parse(uploadProfilePhotoInputSchema, data);
      const { studentId, permission } = await permissionFor(actor, input.studentId);
      let webp: Buffer;
      try {
        webp = await sanitiseAvatar(decodeBase64(input.base64), input.mime);
      } catch (error) {
        if (error instanceof PhotoRejected) throw new HttpsError("invalid-argument", photoRejectedMessage);
        throw error;
      }
      const objectKey = `academies/${actor.academyId}/avatars/${studentId}/${randomUUID()}.webp`;
      // Orphan-safe order: object first, then the pointer, then the old object.
      await deps.r2.putObject(objectKey, webp, "image/webp");
      const at = now();
      let previous: string | null;
      try {
        previous = await db.runTransaction(async (tx) => {
          const ref = db.doc(settingsPath(actor.academyId, studentId));
          const snapshot = await tx.get(ref);
          const current = fromData(actor.academyId, studentId, snapshot.exists ? snapshot.data() : undefined);
          const next: MemberPublicSettingsDoc = permission === "manage"
            ? { ...current, photoObjectKey: objectKey, photoConsentAt: at, photoConsentBy: actor.userId, updatedAt: at }
            : { ...current, pendingPhotoObjectKey: objectKey, updatedAt: at };
          tx.set(ref, next);
          return permission === "manage" ? current.photoObjectKey : current.pendingPhotoObjectKey;
        });
      } catch (error) {
        await deleteQuietly(objectKey, actor.academyId, studentId);
        throw error;
      }
      if (previous !== objectKey) await deleteQuietly(previous, actor.academyId, studentId);
      return permission === "manage"
        ? { photoUrl: await signPhotoUrl(deps.r2, objectKey, at), pending: false }
        : { photoUrl: await signProposalPreview(deps.r2, objectKey), pending: true };
    },

    /** Q2: removing the photo clears every pointer (and any pending proposal) and deletes the objects. */
    async removeProfilePhoto(actor: MemberActor, data: unknown): Promise<Record<string, never>> {
      const studentId = await requireManage(actor, parse(studentInputSchema, data).studentId);
      const at = now();
      const removed = await db.runTransaction(async (tx) => {
        const ref = db.doc(settingsPath(actor.academyId, studentId));
        const snapshot = await tx.get(ref);
        const current = fromData(actor.academyId, studentId, snapshot.exists ? snapshot.data() : undefined);
        tx.set(ref, { ...current, photoObjectKey: null, photoConsentAt: null, photoConsentBy: null, pendingPhotoObjectKey: null, updatedAt: at });
        return [current.photoObjectKey, current.pendingPhotoObjectKey];
      });
      for (const key of removed) await deleteQuietly(key, actor.academyId, studentId);
      return {};
    },

    /** B4: the guardian turns a teen's proposal into the consented photo. */
    async approveProposedPhoto(actor: MemberActor, data: unknown): Promise<{ photoUrl: string | null }> {
      const studentId = await requireManage(actor, parse(studentInputSchema, data).studentId);
      const at = now();
      const { approved, previous } = await db.runTransaction(async (tx) => {
        const ref = db.doc(settingsPath(actor.academyId, studentId));
        const snapshot = await tx.get(ref);
        const current = fromData(actor.academyId, studentId, snapshot.exists ? snapshot.data() : undefined);
        if (!current.pendingPhotoObjectKey) throw new HttpsError("failed-precondition", "There is no proposed photo to approve.");
        tx.set(ref, { ...current, photoObjectKey: current.pendingPhotoObjectKey, photoConsentAt: at, photoConsentBy: actor.userId, pendingPhotoObjectKey: null, updatedAt: at });
        return { approved: current.pendingPhotoObjectKey, previous: current.photoObjectKey };
      });
      if (previous !== approved) await deleteQuietly(previous, actor.academyId, studentId);
      return { photoUrl: await signPhotoUrl(deps.r2, approved, at) };
    },

    async getMySettings(actor: MemberActor, data: unknown) {
      const { studentId, permission } = await permissionFor(actor, parse(studentInputSchema, data).studentId);
      const settings = await readPublicSettings(db, actor.academyId, studentId);
      const teen = await readDoc(`academies/${actor.academyId}/teenAccess/${studentId}`);
      const email = teen.exists ? nullableString(teen.data?.email) : null;
      return {
        photoUrl: await signPhotoUrl(deps.r2, settings.photoObjectKey, settings.photoConsentAt),
        pendingPhotoUrl: await signProposalPreview(deps.r2, settings.pendingPhotoObjectKey),
        showToMembers: settings.showToMembers,
        canManage: permission === "manage",
        teenAccess: email ? { email, active: teen.data?.revokedAt === null || teen.data?.revokedAt === undefined } : null,
      };
    },

    /**
     * ADR-019: a guardian gives a 12–17 year old their own sign-in. The Auth user is created verified
     * (the member door rejects unverified accounts) with role `teenStudent`, which keeps every consent
     * path closed to them (D10). Any failure after the user exists removes it again.
     */
    async createTeenAccess(actor: MemberActor, data: unknown): Promise<{ email: string }> {
      const teen = teenWriterDeps();
      const input = parse(teenAccessInputSchema, data);
      const { studentId, via } = await permissionFor(actor, input.studentId);
      if (via !== "guardian") throw new HttpsError("permission-denied", "Only a guardian can set up own access.");
      const { student, age } = await studentAge(actor.academyId, studentId);
      if (age === null || age < teenAccountMinimumAge || age >= 18) throw new HttpsError("failed-precondition", teenAgeMessage);
      if (student.userId !== undefined) throw new HttpsError("already-exists", "This member already has their own access.");
      const existing = await readDoc(teenAccessPath(actor.academyId, studentId));
      const existingDoc = existing.exists ? readTeenAccess(existing.data) : null;
      if (existing.exists && (existingDoc === null || existingDoc.revokedAt === null)) {
        throw new HttpsError("already-exists", "This member already has their own access.");
      }
      const guardianDoc = await readDoc(userPath(actor.academyId, actor.userId));
      const guardian = parseUserProfile(guardianDoc.data);
      const phoneNumber = student.phoneNumber ?? (guardian.ok ? guardian.value.phoneNumber : undefined);
      if (!phoneNumber) throw new HttpsError("failed-precondition", "Add a phone number to your profile first.");

      let uid: string;
      try {
        ({ uid } = await teen.auth.createUser({
          email: input.email, password: input.password, emailVerified: true, disabled: false, displayName: student.fullName,
        }));
      } catch (error) {
        const code = (error as { code?: unknown }).code;
        if (code === "auth/email-already-exists" || code === "auth/invalid-email") throw new HttpsError("already-exists", teenEmailMessage);
        if (code === "auth/invalid-password") throw new HttpsError("invalid-argument", "Choose a password of at least 10 characters.");
        throw new HttpsError("unavailable", teenUnavailableMessage);
      }
      const at = now();
      try {
        await teen.auth.setCustomUserClaims(uid, { academyId: actor.academyId, role: "teenStudent" });
        const profile: UserProfile = {
          userId: uid, academyId: actor.academyId, accountType: "client", displayName: student.fullName, email: input.email,
          phoneNumber, active: true, status: "active", schemaVersion: "1",
          createdAt: at, createdBy: actor.userId, updatedAt: at, updatedBy: actor.userId,
        };
        const parsedProfile = parseUserProfile(profile);
        if (!parsedProfile.ok) throw new Error("Teen user profile is invalid");
        await db.doc(userPath(actor.academyId, uid)).create(parsedProfile.value);
        await teen.linkStudentAccount({ actor, studentId, userId: uid, expectedUserId: null, now: at });
        const doc: TeenAccessDoc = {
          academyId: actor.academyId, studentId, uid, email: input.email,
          createdBy: actor.userId, createdAt: at, adultClaimedAt: null, revokedAt: null,
        };
        await db.doc(teenAccessPath(actor.academyId, studentId)).set(doc);
      } catch {
        // The link write may have committed even if the call failed: re-read and unlink only our own uid.
        try {
          const { student: current } = await studentAge(actor.academyId, studentId);
          if (current.userId === uid) {
            await teen.linkStudentAccount({ actor, studentId, userId: null, expectedUserId: uid, now: now() });
          }
        } catch {
          warn("Teen access rollback could not unlink the student", { academyId: actor.academyId, studentId });
        }
        await db.doc(userPath(actor.academyId, uid)).delete().catch(() => undefined);
        await teen.auth.deleteUser(uid).catch(() =>
          warn("Teen access rollback could not delete the Auth user", { academyId: actor.academyId, studentId, uid }));
        throw new HttpsError("unavailable", teenUnavailableMessage);
      }
      return { email: input.email };
    },

    /** The guardian takes own access back, only while it has not been handed over at 18. */
    async revokeTeenAccess(actor: MemberActor, data: unknown): Promise<Record<string, never>> {
      const teen = teenWriterDeps();
      const { studentId, via } = await permissionFor(actor, parse(studentInputSchema, data).studentId);
      if (via !== "guardian") throw new HttpsError("permission-denied", "Only a guardian can remove own access.");
      const record = await readDoc(teenAccessPath(actor.academyId, studentId));
      const doc = record.exists ? readTeenAccess(record.data) : null;
      if (!doc || doc.revokedAt !== null) throw new HttpsError("not-found", "This member has no own access to remove.");
      if (doc.adultClaimedAt !== null) throw new HttpsError("failed-precondition", "This account now belongs to the member.");
      const at = now();
      try {
        await teen.auth.updateUser(doc.uid, { disabled: true });
        await teen.auth.revokeRefreshTokens(doc.uid);
        await db.doc(userPath(actor.academyId, doc.uid)).update({ active: false, updatedAt: at, updatedBy: actor.userId });
        const { student } = await studentAge(actor.academyId, studentId);
        if (student.userId === doc.uid) await teen.linkStudentAccount({ actor, studentId, userId: null, expectedUserId: doc.uid, now: at });
        await db.doc(teenAccessPath(actor.academyId, studentId)).update({ revokedAt: at });
      } catch {
        throw new HttpsError("unavailable", "Own access could not be removed. Try again.");
      }
      return {};
    },

    async getAdultClaimStatus(actor: MemberActor, data: unknown): Promise<{ required: boolean; studentId: string | null }> {
      parse(z.strictObject({}), data ?? {});
      const own = await ownTeenAccess(actor);
      return own?.required ? { required: true, studentId: own.studentId } : { required: false, studentId: null };
    },

    /**
     * Q4: at 18 the member takes the account over once. The client has just re-authenticated and set a
     * new password; this records the hand-over, makes the role adult and ends every older session.
     */
    async claimAdultAccount(actor: MemberActor, data: unknown, authTimeMs: number): Promise<Record<string, never>> {
      const teen = teenDeps();
      const input = parse(studentInputSchema, data);
      const current = Date.parse(now());
      if (!Number.isFinite(authTimeMs) || current - authTimeMs > adultClaimSignInWindowMs) {
        throw new HttpsError("unauthenticated", "Sign in again to continue.");
      }
      const own = await ownTeenAccess(actor);
      if (!own || !own.required || own.studentId !== input.studentId) throw new HttpsError("failed-precondition", "There is nothing to claim on this account.");
      const at = now();
      // Marker last: every step before it is idempotent, so a partial failure leaves the block showing
      // and a retry completes the hand-over. Revoke first so no older session mints an adult token.
      await teen.auth.revokeRefreshTokens(actor.userId);
      await teen.auth.setCustomUserClaims(actor.userId, { academyId: actor.academyId, role: "adultStudent" });
      await db.doc(teenAccessPath(actor.academyId, own.studentId)).update({ adultClaimedAt: at });
      return {};
    },

    async setMemberVisibility(actor: MemberActor, data: unknown): Promise<Record<string, never>> {
      const input = parse(visibilityInputSchema, data);
      const studentId = await requireManage(actor, input.studentId);
      const at = now();
      await db.runTransaction(async (tx) => {
        const ref = db.doc(settingsPath(actor.academyId, studentId));
        const snapshot = await tx.get(ref);
        const current = fromData(actor.academyId, studentId, snapshot.exists ? snapshot.data() : undefined);
        tx.set(ref, { ...current, showToMembers: input.showToMembers, updatedAt: at });
      });
      return {};
    },
  };
}
