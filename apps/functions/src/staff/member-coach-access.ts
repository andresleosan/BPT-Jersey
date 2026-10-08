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
import { profileNames } from "./profile-names.js";

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
  // ponytail: scans Auth like listTeamDirectory (no index); fine for a few thousand accounts.
  const candidates: { uid: string; email: string; authName: string }[] = [];
  let pageToken: string | undefined;
  do {
    const page = await getAuth().listUsers(1000, pageToken);
    for (const user of page.users) {
      if (
        user.disabled || !user.email || user.customClaims?.academyId !== actor.academyId ||
        !memberCoachRoleSchema.safeParse(user.customClaims?.role).success || staff.has(user.uid)
      ) continue;
      candidates.push({ uid: user.uid, email: user.email, authName: user.displayName?.trim() ?? "" });
    }
    pageToken = page.pageToken;
  } while (pageToken);
  // Member logins often have no Auth name: the member profile holds it.
  const names = await profileNames(db, actor.academyId, candidates.filter((item) => !item.authName).map((item) => item.uid));
  const members = candidates
    .map((item) => ({ userId: item.uid, name: item.authName || names.get(item.uid) || "", email: item.email }))
    .filter((item) => item.name.toLowerCase().includes(needle) || item.email.toLowerCase().includes(needle))
    .slice(0, 20);
  return coachEligibleMembersResponseSchema.parse({ members });
});

export const switchAccessMode = onCall(browserAdminCallableOptions, async (request) => {
  const actor = requireUserActor(request);
  const input = switchAccessModeSchema.safeParse(request.data);
  if (!input.success) throw new HttpsError("invalid-argument", "Invalid access mode.");
  const db = getFirestore();
  const coachActive = async () =>
    (await readMemberCoachRole(db, actor.academyId, actor.userId)) !== null &&
    (await coachProfiles(db, actor.academyId, actor.userId)).some((doc) => doc.data().active === true);
  const storedRole = await readMemberCoachRole(db, actor.academyId, actor.userId);
  if (!storedRole) throw new HttpsError("failed-precondition", "This account has one access mode.");
  const user = await getAuth().getUser(actor.userId);
  // The live claim wins while in member mode: an adult who adds a child becomes a guardian after
  // the grant, and switching back must restore that, not the role stored at grant time.
  const liveRole = memberCoachRoleSchema.safeParse(user.customClaims?.role);
  const memberRole = liveRole.success ? liveRole.data : storedRole;
  if (memberRole !== storedRole)
    await db.doc(coachMemberAccessPath(actor.academyId, actor.userId)).update({ memberRole });
  if (input.data.mode === "coach" && !(await coachActive()))
    throw new HttpsError("failed-precondition", "Coach access is not active.");
  const role = input.data.mode === "coach" ? "coach" : memberRole;
  if (user.customClaims?.role === role) return { switched: false };
  // Keeps the claims already there (only academyId, role and non-authority keys pass requireUserActor).
  await getAuth().setCustomUserClaims(actor.userId, { ...user.customClaims, academyId: actor.academyId, role });
  // The office may have removed or deactivated coach access while this ran (Delete/Deactivate write
  // the member role without this lock): re-check after writing so a stale coach claim never stays.
  if (role === "coach" && !(await coachActive())) {
    await getAuth().setCustomUserClaims(actor.userId, { ...user.customClaims, academyId: actor.academyId, role: memberRole });
    throw new HttpsError("failed-precondition", "Coach access is not active.");
  }
  return { switched: true };
});
