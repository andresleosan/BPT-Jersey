import { createHash } from "node:crypto";
import { createStaffProfileHandler, staffCallableServices } from "./staff-callables.js";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { HttpsError, onCall, type CallableRequest } from "firebase-functions/v2/https";
import { browserAdminCallableOptions } from "../auth/callable-options.js";
import {
  provisionAdminRoleWithServices,
  type SyntheticFirestore,
} from "../auth/admin-provisioning.js";
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
    async grant(actor, target, transition) {
      // Actor was checked against live Auth: either the caller or the still-authorised inviter.
      // Reuse the existing cross-Auth/Firestore lock, audit and compensation rather than writing claims here.
      const delegatedRequest = {
        app: request.app,
        auth: { uid: actor.uid, token: { academyId: actor.academyId, role: actor.role } },
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
