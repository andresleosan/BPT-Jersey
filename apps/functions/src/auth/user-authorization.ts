import { HttpsError, type CallableRequest } from "firebase-functions/v2/https";

import type { UserActorContext, UserId } from "@bpt-jersey/domain";
import { parseUserClaims } from "@bpt-jersey/domain/auth/admin-contracts";
import {
  evaluateAccess,
  type AccessEvaluationInput,
  type AccessGrant,
} from "@bpt-jersey/domain/authorization/access-policy";

const firebaseStandardClaimKeys = new Set([
  "iss",
  "aud",
  "auth_time",
  "user_id",
  "uid",
  "sub",
  "iat",
  "exp",
  "firebase",
  "tenant",
  "name",
  "picture",
  "email",
  "email_verified",
  "phone_number",
  "phone_number_verified",
]);
const nonAuthorityCustomClaimKeys = new Set(["mfaEnrolled", "locale"]);

function extractUserClaims(token: unknown): Record<string, unknown> {
  if (typeof token !== "object" || token === null || Array.isArray(token)) {
    return {};
  }

  for (const key of Reflect.ownKeys(token)) {
    if (
      typeof key !== "string" ||
      (!firebaseStandardClaimKeys.has(key) &&
        !nonAuthorityCustomClaimKeys.has(key) &&
        key !== "academyId" &&
        key !== "role")
    ) {
      return {};
    }
  }

  const claims = token as Record<string, unknown>;
  return {
    academyId: Object.hasOwn(token, "academyId") ? claims.academyId : undefined,
    role: Object.hasOwn(token, "role") ? claims.role : undefined,
  };
}

export function requireUserActor(request: CallableRequest): UserActorContext {
  const uid = request.auth?.uid;
  if (typeof uid !== "string" || uid.trim().length === 0) {
    throw new HttpsError("unauthenticated", "Authentication is required");
  }

  const claims = parseUserClaims(extractUserClaims(request.auth?.token));
  if (!claims.ok) {
    throw new HttpsError("permission-denied", "User claims are required");
  }

  return Object.freeze({
    kind: "user",
    userId: uid as UserId,
    academyId: claims.value.academyId,
    role: claims.value.role,
  });
}

export function requireAuthorizedAccess(input: AccessEvaluationInput): AccessGrant {
  const decision = evaluateAccess(input);
  if (!decision.ok) {
    throw new HttpsError("permission-denied", "Access is not permitted");
  }
  return decision.value;
}
