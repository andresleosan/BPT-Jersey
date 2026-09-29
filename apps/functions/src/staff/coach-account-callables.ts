import { randomUUID } from "node:crypto";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { setCoachBeltSchema } from "@bpt-jersey/domain/staff/team-access";
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
  const profiles = await coachProfiles(db, actor.academyId, input.data.userId);
  if (profiles.length === 0) throw new HttpsError("failed-precondition", "This account has no coach profile.");
  const now = new Date().toISOString();
  const batch = db.batch();
  for (const profile of profiles) batch.update(profile.ref, { belt: input.data.belt, updatedAt: now, updatedBy: actor.userId });
  batch.create(db.collection(`academies/${actor.academyId}/auditEvents`).doc(), coachAudit(actor.academyId, actor.userId, input.data.userId, "staff.coach_belt_set", "coach belt shown on the website", now));
  await batch.commit();
  return { belt: input.data.belt };
});
