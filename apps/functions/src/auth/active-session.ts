import { HttpsError, type CallableRequest } from "firebase-functions/v2/https";
import { getAuth } from "firebase-admin/auth";
import type { UserActorContext } from "@bpt-jersey/domain";

type SessionUser = Readonly<{
  uid: string;
  disabled: boolean;
  tokensValidAfterTime?: string;
}>;

/** The callable verified the JWT; compare its original sign-in time with live Auth revocation. */
export function assertActiveSession(request: CallableRequest, user: SessionUser): void {
  const authTime = request.auth?.token.auth_time;
  const validAfter = user.tokensValidAfterTime ? Date.parse(user.tokensValidAfterTime) : 0;
  if (
    request.auth?.uid !== user.uid ||
    user.disabled ||
    typeof authTime !== "number" ||
    !Number.isFinite(authTime) ||
    authTime <= 0 ||
    !Number.isFinite(validAfter) ||
    authTime * 1000 < validAfter
  ) {
    throw new HttpsError("unauthenticated", "Your session has expired. Sign in again.");
  }
}

export async function isCurrentActorSession(
  actor: UserActorContext,
  request: CallableRequest<unknown>,
): Promise<boolean> {
  const user = await getAuth().getUser(actor.userId);
  assertActiveSession(request, user);
  return user.customClaims?.academyId === actor.academyId &&
    user.customClaims?.role === actor.role;
}
