import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import type { CallableRequest } from "firebase-functions/v2/https";
import { requireUserActor } from "../auth/user-authorization.js";
import { createMemberDirectoryActorActivityCheck, requireCanonicalMemberDirectoryActor } from "../members/canonical-actor.js";
import { courseFailure, type CourseActor } from "./course-store.js";
export type { CourseActor } from "./course-store.js";
export async function requireCourseActor(request: CallableRequest): Promise<CourseActor> {
  if (!request.app) courseFailure("forbidden", "A verified application is required.");
  const actor = requireUserActor(request);
  const current = await getAuth().getUser(actor.userId);
  if (current.disabled || current.customClaims?.academyId !== actor.academyId || current.customClaims?.role !== actor.role)
    courseFailure("forbidden", "Your account is not active. Sign in again or contact the office.");
  if (["owner", "administrator"].includes(actor.role)) return requireCourseOffice(request);
  if (["coach", "headCoach"].includes(actor.role)) {
    const user = await getFirestore().doc(`academies/${actor.academyId}/users/${actor.userId}`).get();
    if (!user.exists || user.data()?.active === false || user.data()?.status === "inactive") courseFailure("forbidden", "An active staff account is required.");
  }
  return {uid: actor.userId, academyId: actor.academyId, role: actor.role};
}
export async function requireCourseOffice(request: CallableRequest): Promise<CourseActor> {
  const db = getFirestore();
  const actor = await requireCanonicalMemberDirectoryActor(request, createMemberDirectoryActorActivityCheck({getAuthUser: uid => getAuth().getUser(uid), getDocument: path => db.doc(path).get()}));
  return {uid: actor.actorId, academyId: actor.academyId, role: actor.role};
}
export function requireCourseApplicant(actor: CourseActor): void {
  if (actor.role === "teenStudent") courseFailure("forbidden", "A parent or guardian must arrange this enrolment.");
}
