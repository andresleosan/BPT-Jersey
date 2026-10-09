import { createHash } from "node:crypto";
import { coachBeltSchema, type TeamCoachProfile } from "@bpt-jersey/domain/staff/team-access";
import { createStaffProfileHandler, staffCallableServices } from "./staff-callables.js";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { HttpsError, onCall, type CallableRequest } from "firebase-functions/v2/https";
import { browserAdminCallableOptions } from "../auth/callable-options.js";
import {
  provisionAdminRoleWithServices,
  withSharedRoleLock,
  type SyntheticFirestore,
} from "../auth/admin-provisioning.js";
import { activateCoachProfile, coachAudit } from "./coach-account-callables.js";
import { profileNames } from "./profile-names.js";
import { createTeamInvitationStore } from "./team-invitations-firestore.js";
import {
  listTeamDirectoryHandler,
  changeTeamRoleHandler,
  createStaffInvitationHandler,
  listStaffInvitationsHandler,
  cancelStaffInvitationHandler,
  acceptStaffInvitationHandler,
  type TeamAccessServices,
} from "./team-access.js";

function services(request: CallableRequest): TeamAccessServices {
  const auth = getAuth();
  const firestore = getFirestore();
  return {
    auth,
    invitations: createTeamInvitationStore(firestore, request.auth?.uid ?? "anonymous"),
    now: () => new Date(),
    async coachProfilesByUser(academyId) {
      const [snapshot, websites] = await Promise.all([
        firestore.collection(`academies/${academyId}/staff`).get(),
        firestore.collection(`academies/${academyId}/coachWebsite`).where("hidden", "==", true).get(),
      ]);
      const hidden = new Set(websites.docs.map((doc) => doc.id));
      const profiles = new Map<string, TeamCoachProfile>();
      for (const doc of snapshot.docs) {
        const data = doc.data();
        if (typeof data.userId !== "string") continue;
        const belt = coachBeltSchema.safeParse(data.belt);
        const profile = {
          staffKey: doc.id,
          active: data.active === true,
          belt: belt.success ? belt.data : null,
          ...(hidden.has(data.userId) ? { hidden: true } : {}),
        };
        if (!profiles.get(data.userId)?.active) profiles.set(data.userId, profile);
      }
      return profiles;
    },
    profileNames: (academyId, userIds) => profileNames(firestore, academyId, userIds),
    async memberCoachUsers(academyId) {
      return new Set((await firestore.collection(`academies/${academyId}/coachMemberAccess`).get()).docs.map((doc) => doc.id));
    },
    async demoteToCoach(actor, uid) {
      await withSharedRoleLock(firestore as unknown as SyntheticFirestore, actor.academyId, actor.uid, uid, async () => {
        const user = await auth.getUser(uid);
        if (user.disabled || user.customClaims?.academyId !== actor.academyId || !["owner", "administrator"].includes(String(user.customClaims?.role))) {
          throw new HttpsError("failed-precondition", "Only an active owner or administrator can be changed to coach here.");
        }
        const { batch, now } = await activateCoachProfile(firestore, actor.academyId, actor.uid, uid);
        batch.set(firestore.doc(`academies/${actor.academyId}/users/${uid}`), { adminRole: null, updatedAt: now, updatedBy: actor.uid }, { merge: true });
        batch.create(firestore.collection(`academies/${actor.academyId}/auditEvents`).doc(), coachAudit(actor.academyId, actor.uid, uid, "admin.role.changed_to_coach", "administrative role management", now));
        await batch.commit();
        await auth.setCustomUserClaims(uid, { ...user.customClaims, academyId: actor.academyId, role: "coach" });
        // The old ID token still says owner/administrator for up to 1 h: end those sessions.
        await auth.revokeRefreshTokens(uid);
      });
    },
    async grant(actor, target, transition) {
      // Actor was checked against live Auth: either the caller or the still-authorised inviter.
      // Reuse the existing cross-Auth/Firestore lock, audit and compensation rather than writing claims here.
      const delegatedRequest = {
        app: request.app,
        auth: {
          uid: actor.uid,
          token: transition === "team"
            ? request.auth!.token
            : { academyId: actor.academyId, role: actor.role },
        },
        data: { action: "grant" },
      } as unknown as CallableRequest;
      if (target.role === "coach") {
        const user = await auth.getUser(target.uid);
        if (
          !target.email ||
          user.disabled ||
          user.email?.toLowerCase() !== target.email.toLowerCase()
        )
          throw new HttpsError("failed-precondition", "Account details changed.");
        if (["owner", "administrator"].includes(String(user.customClaims?.role)))
          throw new HttpsError(
            "failed-precondition",
            "Use the team directory to review this account's administrative access.",
          );
        await createStaffProfileHandler(
          {
            ...delegatedRequest,
            data: {
              userId: target.uid,
              role: "coach",
              requestId: `invite-${createHash("sha256").update(target.uid).digest("hex")}`,
            },
          } as CallableRequest,
          staffCallableServices(),
        );
        return;
      }
      await provisionAdminRoleWithServices(
        delegatedRequest,
        { ...target, role: target.role },
        {
          firestore: firestore as unknown as SyntheticFirestore,
          auth: {
            async getUser(uid) {
              const user = await auth.getUser(uid);
              return {
                uid: user.uid,
                email: user.email ?? null,
                displayName: user.displayName ?? null,
                disabled: user.disabled,
                ...(user.tokensValidAfterTime ? { tokensValidAfterTime: user.tokensValidAfterTime } : {}),
                providerData: user.providerData,
                customClaims: user.customClaims ?? {},
              };
            },
            setCustomUserClaims: (uid, claims) => auth.setCustomUserClaims(uid, claims),
          },
        },
        transition,
      );
    },
  };
}
export const listTeamDirectory = onCall(browserAdminCallableOptions, (request) =>
  listTeamDirectoryHandler(request, services(request)),
);
export const changeTeamRole = onCall(browserAdminCallableOptions, (request) =>
  changeTeamRoleHandler(request, services(request)),
);
export const createStaffInvitation = onCall(browserAdminCallableOptions, (request) =>
  createStaffInvitationHandler(request, services(request)),
);
export const listStaffInvitations = onCall(browserAdminCallableOptions, (request) =>
  listStaffInvitationsHandler(request, services(request)),
);
export const cancelStaffInvitation = onCall(browserAdminCallableOptions, (request) =>
  cancelStaffInvitationHandler(request, services(request)),
);
export const acceptStaffInvitation = onCall(browserAdminCallableOptions, (request) =>
  acceptStaffInvitationHandler(request, services(request)),
);
