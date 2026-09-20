import { getAuth } from "firebase-admin/auth";
import { HttpsError, onCall, type CallableRequest } from "firebase-functions/v2/https";
import { z } from "zod";
import { accountMemberProfileSchema } from "@bpt-jersey/domain/members/access";
import { requireUserActor } from "../auth/user-authorization.js";
import { browserAdminCallableOptions } from "../auth/callable-options.js";
import { createFirestoreMemberAccessService } from "./member-access-service.js";

/** Live Auth is an account entry check; current per-athlete documents decide the available profiles. */
export async function requireMemberAccountActor(request: CallableRequest<unknown>) {
  if (!request.app || !request.auth) throw new HttpsError("unauthenticated", "Verified sign-in is required");
  const actor = requireUserActor(request);
  const roles = ["guardian", "adultStudent", "teenStudent"];
  if (!roles.includes(actor.role)) throw new HttpsError("permission-denied", "Member access is unavailable");
  const user = await getAuth().getUser(actor.userId);
  const authenticationTime = Number(request.auth.token.auth_time) * 1000;
  if (user.disabled || !user.emailVerified || user.customClaims?.academyId !== actor.academyId ||
      !roles.includes(String(user.customClaims?.role)) || !Number.isFinite(authenticationTime) ||
      (user.tokensValidAfterTime && authenticationTime < Date.parse(user.tokensValidAfterTime))) {
    throw new HttpsError("permission-denied", "Sign in again to access your member profiles");
  }
  return actor;
}
export const listMyMemberProfiles = onCall(browserAdminCallableOptions, async (request) => {
  const actor = await requireMemberAccountActor(request);
  if (!z.strictObject({}).safeParse(request.data).success) throw new HttpsError("invalid-argument", "Invalid member profile request");
  const profiles = await createFirestoreMemberAccessService().listProfiles(actor.academyId, actor.userId);
  return { profiles: z.array(accountMemberProfileSchema).max(100).parse(profiles) };
});
