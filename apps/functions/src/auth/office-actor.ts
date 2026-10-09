import { getAuth } from "firebase-admin/auth";
import { HttpsError, type CallableRequest } from "firebase-functions/v2/https";
import { requireUserActor } from "./user-authorization.js";
import { assertActiveSession } from "./active-session.js";

export async function requireActiveOfficeActor(request: CallableRequest<unknown>) {
  const actor = requireUserActor(request);
  if (actor.role !== "owner" && actor.role !== "administrator") {
    throw new HttpsError("permission-denied", "Administrator access is required.");
  }
  const user = await getAuth().getUser(actor.userId);
  assertActiveSession(request, user);
  if (
    user.disabled ||
    user.customClaims?.academyId !== actor.academyId ||
    user.customClaims?.role !== actor.role
  ) {
    throw new HttpsError("permission-denied", "Administrator access is required.");
  }
  return actor;
}
