import { getAuth } from "firebase-admin/auth";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import {
  coachEligibleMembersResponseSchema,
  coachMemberAccessPath,
  coachMemberAccessSchema,
  grantMemberCoachAccessSchema,
  listCoachEligibleMembersSchema,
  memberCoachRoleSchema,
  switchAccessModeSchema,
  type MemberCoachRole,
} from "@bpt-jersey/domain/staff/team-access";
import { browserAdminCallableOptions } from "../auth/callable-options.js";
import { requireActiveOfficeActor } from "../auth/office-actor.js";
import { requireUserActor } from "../auth/user-authorization.js";
import { activateCoachProfile, coachAudit, coachProfiles } from "./coach-account-callables.js";

/** The member role to restore, or null when the account is not a member with coach access. */
export async function readMemberCoachRole(db: Firestore, academyId: string, userId: string): Promise<MemberCoachRole | null> {
  const parsed = coachMemberAccessSchema.safeParse((await db.doc(coachMemberAccessPath(academyId, userId)).get()).data());
  return parsed.success && parsed.data.academyId === academyId && parsed.data.userId === userId ? parsed.data.memberRole : null;
}

export const grantMemberCoachAccess = onCall(browserAdminCallableOptions, async (request) => {
  const actor = await requireActiveOfficeActor(request);
  const input = grantMemberCoachAccessSchema.safeParse(request.data);
  if (!input.success) throw new HttpsError("invalid-argument", "Choose a member and a belt.");
  const { userId, belt } = input.data;
  const db = getFirestore();
  const user = await getAuth().getUser(userId).catch(() => null);
  const memberRole = memberCoachRoleSchema.safeParse(user?.customClaims?.role);
  const profile = (await db.doc(`academies/${actor.academyId}/users/${userId}`).get()).data();
  if (
    !user || user.disabled || user.customClaims?.academyId !== actor.academyId || !memberRole.success ||
    profile?.accountType !== "client" || profile.active !== true || profile.status !== "active"
  ) throw new HttpsError("failed-precondition", "Only an active adult member can get coach access.");
  if ((await coachProfiles(db, actor.academyId, userId)).length > 0)
    throw new HttpsError("failed-precondition", "This account already has a coach profile.");
  const { batch, now } = await activateCoachProfile(db, actor.academyId, actor.userId, userId, belt);
  // create() makes a second, simultaneous grant fail instead of overwriting the first.
  batch.create(db.doc(coachMemberAccessPath(actor.academyId, userId)), {
    userId, academyId: actor.academyId, memberRole: memberRole.data, grantedAt: now, grantedBy: actor.userId, schemaVersion: "1",
  });
  batch.create(db.collection(`academies/${actor.academyId}/auditEvents`).doc(),
    coachAudit(actor.academyId, actor.userId, userId, "staff.member_coach_access_granted", "member coach access", now));
  await batch.commit().catch(() => {
    throw new HttpsError("failed-precondition", "Coach access could not be given. Refresh and try again.");
  });
  // The claim is untouched: the person stays a member until they sign in from /staff/login.
  return { granted: true as const };
});

export const listCoachEligibleMembers = onCall(browserAdminCallableOptions, async (request) => {
  const actor = await requireActiveOfficeActor(request);
  const input = listCoachEligibleMembersSchema.safeParse(request.data);
  if (!input.success) throw new HttpsError("invalid-argument", "Type at least two letters.");
  const needle = input.data.query.toLowerCase();
  const db = getFirestore();
  const staff = new Set((await db.collection(`academies/${actor.academyId}/staff`).get()).docs.map((doc) => String(doc.data().userId)));
  const members: { userId: string; name: string; email: string }[] = [];
  // ponytail: scans Auth like listTeamDirectory (no index); fine for a few thousand accounts.
  let pageToken: string | undefined;
  do {
    const page = await getAuth().listUsers(1000, pageToken);
    for (const user of page.users) {
      if (members.length >= 20) break;
      const name = user.displayName?.trim() ?? "";
      if (
        user.disabled || !user.email || user.customClaims?.academyId !== actor.academyId ||
        !memberCoachRoleSchema.safeParse(user.customClaims?.role).success || staff.has(user.uid) ||
        !(name.toLowerCase().includes(needle) || user.email.toLowerCase().includes(needle))
      ) continue;
      members.push({ userId: user.uid, name, email: user.email });
    }
    pageToken = page.pageToken;
  } while (pageToken && members.length < 20);
  return coachEligibleMembersResponseSchema.parse({ members });
});

export const switchAccessMode = onCall(browserAdminCallableOptions, async (request) => {
  const actor = requireUserActor(request);
  const input = switchAccessModeSchema.safeParse(request.data);
  if (!input.success) throw new HttpsError("invalid-argument", "Invalid access mode.");
  const db = getFirestore();
  const memberRole = await readMemberCoachRole(db, actor.academyId, actor.userId);
  if (!memberRole) throw new HttpsError("failed-precondition", "This account has one access mode.");
  if (input.data.mode === "coach") {
    const active = (await coachProfiles(db, actor.academyId, actor.userId)).some((doc) => doc.data().active === true);
    if (!active) throw new HttpsError("failed-precondition", "Coach access is not active.");
  }
  const role = input.data.mode === "coach" ? "coach" : memberRole;
  const user = await getAuth().getUser(actor.userId);
  if (user.customClaims?.role === role) return { switched: false };
  // Keeps the claims already there (only academyId, role and non-authority keys pass requireUserActor).
  await getAuth().setCustomUserClaims(actor.userId, { ...user.customClaims, academyId: actor.academyId, role });
  return { switched: true };
});
