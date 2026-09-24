import { randomUUID } from "node:crypto";

import type { Firestore } from "firebase-admin/firestore";
import { warn } from "firebase-functions/logger";
import { HttpsError } from "firebase-functions/v2/https";
import { z } from "zod";

import { memberAgeOn, type MemberAccessService } from "@bpt-jersey/domain/members/access";
import { uploadProfilePhotoInputSchema } from "@bpt-jersey/domain/members/engagement";
import { parseEffectiveStudentProfileAt } from "@bpt-jersey/domain/profiles";
import { dateKeyInJersey } from "@bpt-jersey/domain/schedule/member-calendar";

import { resolveCanonicalStudentIdInTransaction } from "../members/member-identity-resolution.js";
import type { R2Client } from "../storage/r2-client.js";
import { PhotoRejected, sanitiseAvatar, signAvatarObject, signPhotoUrl } from "./profile-photo.js";

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

type MemberActor = Readonly<{ userId: string; academyId: string }>;
/** `manage`: guardian, or an adult on their own profile. `propose`: a 12–17 year old on their own profile. */
type Permission = "manage" | "propose";

export const photoRejectedMessage = "Choose a single JPEG, PNG or WebP image under 2 MB.";
const studentInputSchema = z.strictObject({ studentId: z.string().min(1).max(128) });
const visibilityInputSchema = z.strictObject({ studentId: z.string().min(1).max(128), showToMembers: z.boolean() });

const settingsPath = (academyId: string, studentId: string) => `academies/${academyId}/memberPublicSettings/${studentId}`;

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
  access: Pick<MemberAccessService, "authorise">;
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
  async function permissionFor(actor: MemberActor, requestedStudentId: string): Promise<{ studentId: string; permission: Permission }> {
    const decision = await deps.access.authorise(actor.academyId, actor.userId, requestedStudentId);
    if (!decision.allowed) throw new HttpsError("permission-denied", "This member is not available to your account.");
    let studentId: string;
    try {
      studentId = await resolveCanonicalStudentIdInTransaction({ get: readDoc }, actor.academyId, requestedStudentId);
    } catch {
      throw new HttpsError("permission-denied", "This member is not available to your account.");
    }
    if (decision.via === "guardian") return { studentId, permission: "manage" };
    const student = await readDoc(`academies/${actor.academyId}/students/${studentId}`);
    const academyDate = dateKeyInJersey(new Date(now()));
    const parsed = parseEffectiveStudentProfileAt(student.data, academyDate);
    if (!student.exists || !parsed.ok) throw new HttpsError("permission-denied", "This member is not available to your account.");
    const age = memberAgeOn(parsed.value.dateOfBirth, academyDate);
    return { studentId, permission: age !== null && age >= 18 ? "manage" : "propose" };
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
        : { photoUrl: await signAvatarObject(deps.r2, objectKey), pending: true };
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
        pendingPhotoUrl: await signAvatarObject(deps.r2, settings.pendingPhotoObjectKey),
        showToMembers: settings.showToMembers,
        canManage: permission === "manage",
        teenAccess: email ? { email, active: teen.data?.revokedAt === null || teen.data?.revokedAt === undefined } : null,
      };
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
