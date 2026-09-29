import { randomUUID } from "node:crypto";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { deleteCoachAccountSchema, setCoachBeltSchema, setOwnerTeachesSchema, type CoachBelt } from "@bpt-jersey/domain/staff/team-access";
import { browserAdminCallableOptions } from "../auth/callable-options.js";
import { requireActiveOfficeActor } from "../auth/office-actor.js";

/** Coach profiles of one login. Direct accounts use staffId === uid; invited ones do not. */
export async function coachProfiles(db: Firestore, academyId: string, userId: string) {
  return (await db.collection(`academies/${academyId}/staff`).where("userId", "==", userId).get()).docs;
}

export function coachAudit(academyId: string, actorId: string, userId: string, action: string, purpose: string, now: string) {
  return { eventId: randomUUID(), academyId, actorId, action, targetRef: `academies/${academyId}/users/${userId}`, purpose, correlationId: userId, occurredAt: now, schemaVersion: "1" };
}

export const setCoachBelt = onCall(browserAdminCallableOptions, async (request) => {
  const actor = await requireActiveOfficeActor(request);
  const input = setCoachBeltSchema.safeParse(request.data);
  if (!input.success) throw new HttpsError("invalid-argument", "Choose a belt from the list.");
  const db = getFirestore();
  if (actor.role !== "owner") {
    const target = await getAuth().getUser(input.data.userId).catch((error: { code?: string }) => {
      if (error.code === "auth/user-not-found") throw new HttpsError("not-found", "This account no longer exists.");
      throw error;
    });
    if (target.customClaims?.role === "owner") throw new HttpsError("permission-denied", "Only an owner can change an owner's website settings.");
  }
  const profiles = await coachProfiles(db, actor.academyId, input.data.userId);
  if (profiles.length === 0) throw new HttpsError("failed-precondition", "This account has no coach profile.");
  const now = new Date().toISOString();
  const batch = db.batch();
  for (const profile of profiles) batch.update(profile.ref, { belt: input.data.belt, updatedAt: now, updatedBy: actor.userId });
  batch.create(db.collection(`academies/${actor.academyId}/auditEvents`).doc(), coachAudit(actor.academyId, actor.userId, input.data.userId, "staff.coach_belt_set", "coach belt shown on the website", now));
  await batch.commit();
  return { belt: input.data.belt };
});

function upcomingLabel(title: unknown, startAt: string): string {
  return `${typeof title === "string" && title ? title : "Session"} on ${new Date(startAt).toLocaleString("en-GB", { timeZone: "Europe/Jersey", dateStyle: "medium", timeStyle: "short" })}`;
}

export const deleteCoachAccount = onCall(browserAdminCallableOptions, async (request) => {
  const actor = await requireActiveOfficeActor(request);
  if (actor.role !== "owner") throw new HttpsError("permission-denied", "Only an owner can delete a coach.");
  const input = deleteCoachAccountSchema.safeParse(request.data);
  if (!input.success) throw new HttpsError("invalid-argument", "Choose a coach to delete.");
  const { userId } = input.data;
  const auth = getAuth();
  const db = getFirestore();
  const base = db.doc(`academies/${actor.academyId}`);
  const user = await auth.getUser(userId).catch((error: { code?: string }) => {
    if (error.code === "auth/user-not-found") return null;
    throw error;
  });
  const profiles = await coachProfiles(db, actor.academyId, userId);
  // A deactivated coach has no role claim left, only a coach profile.
  const claimRole = user?.customClaims?.role;
  const isCoach = claimRole === undefined ? profiles.length > 0 : ["coach", "headCoach"].includes(String(claimRole));
  if (user && (user.customClaims?.academyId !== actor.academyId || !isCoach)) {
    throw new HttpsError("failed-precondition", "Only coach accounts can be deleted. Change the role to Coach first.");
  }
  if (!user && profiles.length === 0) throw new HttpsError("not-found", "This coach no longer exists.");

  // Sessions and classes store the staffId; direct accounts use the uid as staffId.
  const ids = [...new Set([userId, ...profiles.map((profile) => profile.id)])];
  const now = new Date().toISOString();
  const blockers = new Set<string>();
  for (const id of ids) {
    // ponytail: reads every session this coach ever taught and filters in memory (no composite
    // index). Fine for a few hundred per coach; add an instructorId+startAt index if it grows.
    const [classes, single, multi] = await Promise.all([
      base.collection("classes").where("instructorIds", "array-contains", id).get(),
      base.collection("sessions").where("instructorId", "==", id).get(),
      base.collection("sessions").where("instructorIds", "array-contains", id).get(),
    ]);
    for (const doc of classes.docs) if (doc.data().active === true) blockers.add(`class ${String(doc.data().name ?? doc.id)}`);
    for (const doc of [...single.docs, ...multi.docs]) {
      const session = doc.data();
      if (typeof session.startAt === "string" && session.startAt >= now && session.status !== "cancelled") blockers.add(upcomingLabel(session.title, session.startAt));
    }
  }
  if (blockers.size > 0) {
    const list = [...blockers];
    const more = list.length > 10 ? ` and ${list.length - 10} more` : "";
    throw new HttpsError("failed-precondition", `Reassign these to another coach first: ${list.slice(0, 10).join("; ")}${more}.`);
  }

  const batch = db.batch();
  for (const profile of profiles) batch.delete(profile.ref);
  for (const collection of ["staffAvailability", "staffAssignments"]) {
    for (const doc of (await base.collection(collection).where("staffId", "in", ids).get()).docs) batch.delete(doc.ref);
  }
  for (const doc of (await base.collection("staffPermissionGrants").where("subjectUserId", "==", userId).get()).docs) batch.delete(doc.ref);
  for (const doc of (await db.collection("staffLoginCredentials").where("userId", "==", userId).get()).docs) batch.delete(doc.ref);
  batch.set(base.collection("users").doc(userId), { active: false, status: "inactive", deletedAt: now, updatedAt: now, updatedBy: actor.userId }, { merge: true });
  batch.create(base.collection("auditEvents").doc(), coachAudit(actor.academyId, actor.userId, userId, "staff.coach_deleted", "coach account deletion", now));
  await batch.commit();
  // Auth goes last: if it fails, the account stays visible in the directory and a second Delete finishes it.
  if (user) await auth.deleteUser(userId).catch((error: { code?: string }) => { if (error.code !== "auth/user-not-found") throw error; });
  return { deleted: true as const };
});

/** Creates the coach profile (staffId = uid) or reactivates the existing ones. Idempotent. */
export async function activateCoachProfile(db: Firestore, academyId: string, actorId: string, userId: string, belt?: CoachBelt) {
  const profiles = await coachProfiles(db, academyId, userId);
  const now = new Date().toISOString();
  const batch = db.batch();
  if (profiles.length === 0) {
    batch.create(db.doc(`academies/${academyId}/staff/${userId}`), { staffId: userId, academyId, userId, role: "coach", ...(belt ? { belt } : {}), active: true, status: "active", schemaVersion: "1", createdAt: now, createdBy: actorId, updatedAt: now, updatedBy: actorId });
  } else {
    for (const profile of profiles) batch.update(profile.ref, { active: true, status: "active", ...(belt ? { belt } : {}), updatedAt: now, updatedBy: actorId });
  }
  return { batch, now };
}

export const setOwnerTeaches = onCall(browserAdminCallableOptions, async (request) => {
  const actor = await requireActiveOfficeActor(request);
  if (actor.role !== "owner") throw new HttpsError("permission-denied", "Only an owner can choose which owners appear on the website.");
  const input = setOwnerTeachesSchema.safeParse(request.data);
  if (!input.success) throw new HttpsError("invalid-argument", "Choose a belt before showing this owner on the website.");
  const { userId, teaches, belt } = input.data;
  const user = await getAuth().getUser(userId);
  if (user.customClaims?.academyId !== actor.academyId || user.customClaims?.role !== "owner") {
    throw new HttpsError("failed-precondition", "Only owner accounts use this setting.");
  }
  const db = getFirestore();
  if (teaches) {
    const { batch, now } = await activateCoachProfile(db, actor.academyId, actor.userId, userId, belt);
    batch.create(db.collection(`academies/${actor.academyId}/auditEvents`).doc(), coachAudit(actor.academyId, actor.userId, userId, "staff.owner_teaches_on", "owner shown on the website", now));
    await batch.commit();
  } else {
    const now = new Date().toISOString();
    const batch = db.batch();
    for (const profile of await coachProfiles(db, actor.academyId, userId)) batch.update(profile.ref, { active: false, status: "inactive", updatedAt: now, updatedBy: actor.userId });
    batch.create(db.collection(`academies/${actor.academyId}/auditEvents`).doc(), coachAudit(actor.academyId, actor.userId, userId, "staff.owner_teaches_off", "owner hidden from the website", now));
    await batch.commit();
  }
  return { teaches };
});
