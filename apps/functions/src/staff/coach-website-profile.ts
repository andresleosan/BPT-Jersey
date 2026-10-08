import { randomUUID } from "node:crypto";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { warn } from "firebase-functions/logger";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { getCoachWebsiteProfileSchema, setCoachWebsiteProfileSchema, setCoachWebsiteVisibilitySchema } from "@bpt-jersey/domain/staff/team-access";
import { PhotoRejected, sanitiseAvatar } from "../account-settings/profile-photo.js";
import { browserAdminCallableOptions } from "../auth/callable-options.js";
import { requireActiveOfficeActor } from "../auth/office-actor.js";
import { enrolmentStorageSecrets } from "../members/enrolment-payment-proof.js";
import { createPrivateStorageR2Client, type R2Client } from "../storage/r2-client.js";
import { coachAudit, coachProfiles } from "./coach-account-callables.js";

/** Landing card photo: 3:4, re-encoded on the server like every avatar (ADR-003 private bucket). */
export const coachPhotoSize = Object.freeze({ width: 600, height: 800 });
/** The R2 client signs avatar-pattern keys for exactly 15 minutes. */
const photoUrlSeconds = 900;

/** Website text and photo of one coach; a doc of its own so the strict staff parser stays as it is. */
export const coachWebsitePath = (academyId: string, userId: string) => `academies/${academyId}/coachWebsite/${userId}`;

export async function signCoachPhoto(r2: R2Client, photoKey: unknown): Promise<string | null> {
  if (typeof photoKey !== "string" || !r2.createPrivateImageUrl) return null;
  return r2.createPrivateImageUrl({ objectKey: photoKey, expiresInSeconds: photoUrlSeconds, contentType: "image/webp" });
}

/** Same authority as the belt: office roles, and only an owner edits an owner. */
async function requireEditableCoach(request: Parameters<typeof requireActiveOfficeActor>[0], userId: string) {
  const actor = await requireActiveOfficeActor(request);
  if (actor.role !== "owner") {
    const target = await getAuth().getUser(userId).catch((error: { code?: string }) => {
      if (error.code === "auth/user-not-found") throw new HttpsError("not-found", "This account no longer exists.");
      throw error;
    });
    if (target.customClaims?.role === "owner") throw new HttpsError("permission-denied", "Only an owner can change an owner's website settings.");
  }
  if ((await coachProfiles(getFirestore(), actor.academyId, userId)).length === 0) {
    throw new HttpsError("failed-precondition", "This account has no coach profile.");
  }
  return actor;
}

const storageOptions = { ...browserAdminCallableOptions, secrets: enrolmentStorageSecrets };

export const getCoachWebsiteProfile = onCall(storageOptions, async (request) => {
  const input = getCoachWebsiteProfileSchema.safeParse(request.data);
  if (!input.success) throw new HttpsError("invalid-argument", "Choose a coach.");
  const actor = await requireEditableCoach(request, input.data.userId);
  const data = (await getFirestore().doc(coachWebsitePath(actor.academyId, input.data.userId)).get()).data();
  return {
    bio: typeof data?.bio === "string" ? data.bio : "",
    photoUrl: await signCoachPhoto(createPrivateStorageR2Client(), data?.photoKey),
  };
});

/** sharp decodes up to 20 MP: room for one upload at a time per instance, as for member avatars. */
export const setCoachWebsiteProfile = onCall({ ...storageOptions, memory: "512MiB", concurrency: 1, timeoutSeconds: 30 }, async (request) => {
  const input = setCoachWebsiteProfileSchema.safeParse(request.data);
  if (!input.success) throw new HttpsError("invalid-argument", "Keep the description within the limit and use a JPEG, PNG or WebP photo under 2 MB.");
  const { userId, bio, photo } = input.data;
  const actor = await requireEditableCoach(request, userId);
  const r2 = createPrivateStorageR2Client();
  let newKey: string | null | undefined;
  if (photo) {
    let webp: Buffer;
    try {
      webp = await sanitiseAvatar(Buffer.from(photo.base64, "base64"), photo.mime, coachPhotoSize);
    } catch (error) {
      if (error instanceof PhotoRejected) throw new HttpsError("invalid-argument", "That photo could not be used. Choose a JPEG, PNG or WebP under 2 MB.");
      throw error;
    }
    newKey = `academies/${actor.academyId}/coach-photos/${userId}/${randomUUID()}.webp`;
    // Orphan-safe order, as for avatars: object first, then the pointer, then the old object.
    await r2.putObject(newKey, webp, "image/webp");
  } else if (photo === null) {
    newKey = null;
  }

  const db = getFirestore();
  const ref = db.doc(coachWebsitePath(actor.academyId, userId));
  const now = new Date().toISOString();
  const { oldKey, photoKey } = await db.runTransaction(async (tx) => {
    const current = (await tx.get(ref)).data();
    const oldKey = typeof current?.photoKey === "string" ? current.photoKey : null;
    const photoKey = newKey === undefined ? oldKey : newKey;
    // Keeps Hide/Show: the card text and photo never change whether the coach is listed.
    tx.set(ref, { userId, academyId: actor.academyId, bio, photoKey, ...(current?.hidden === true ? { hidden: true } : {}), schemaVersion: "1", updatedAt: now, updatedBy: actor.userId });
    tx.create(db.collection(`academies/${actor.academyId}/auditEvents`).doc(), coachAudit(actor.academyId, actor.userId, userId, "staff.coach_website_profile_set", "coach photo and description shown on the website", now));
    return { oldKey, photoKey };
  });
  if (oldKey && oldKey !== photoKey) {
    await r2.deleteObject(oldKey).catch(() => warn("Coach photo object could not be deleted", { academyId: actor.academyId, userId }));
  }
  return { bio, photoUrl: await signCoachPhoto(r2, photoKey) };
});

/** Hide/Show on the landing page only: coach access, belt and card stay as they are. */
export const setCoachWebsiteVisibility = onCall(browserAdminCallableOptions, async (request) => {
  const input = setCoachWebsiteVisibilitySchema.safeParse(request.data);
  if (!input.success) throw new HttpsError("invalid-argument", "Choose a coach.");
  const { userId, hidden } = input.data;
  const actor = await requireEditableCoach(request, userId);
  const db = getFirestore();
  const now = new Date().toISOString();
  const batch = db.batch();
  batch.set(db.doc(coachWebsitePath(actor.academyId, userId)), { userId, academyId: actor.academyId, hidden, schemaVersion: "1", updatedAt: now, updatedBy: actor.userId }, { merge: true });
  batch.create(db.collection(`academies/${actor.academyId}/auditEvents`).doc(), coachAudit(actor.academyId, actor.userId, userId, hidden ? "staff.coach_website_hidden" : "staff.coach_website_shown", "coach visibility on the website", now));
  await batch.commit();
  return { hidden };
});
