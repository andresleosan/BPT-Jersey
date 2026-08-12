import { HttpsError, type CallableRequest } from "firebase-functions/v2/https";

import {
  canReadRestrictedIp,
  parseAdminClaims,
  type AdminRole,
} from "@bpt-jersey/domain/auth/admin-contracts";

export type AdminActor = Readonly<{
  uid: string;
  academyId: string;
  role: AdminRole;
}>;

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

function extractAdminClaims(token: unknown): Record<string, unknown> {
  if (typeof token !== "object" || token === null || Array.isArray(token)) {
    return {};
  }

  for (const key of Reflect.ownKeys(token)) {
    if (
      typeof key !== "string" ||
      (!firebaseStandardClaimKeys.has(key) && key !== "academyId" && key !== "role")
    ) {
      return {};
    }
  }

  const claims = token as Record<string, unknown>;
  return { academyId: claims.academyId, role: claims.role };
}

export function requireAdminActor(request: CallableRequest): AdminActor {
  const uid = request.auth?.uid;
  if (typeof uid !== "string" || uid.trim().length === 0) {
    throw new HttpsError("unauthenticated", "Authentication is required");
  }

  const claims = parseAdminClaims(extractAdminClaims(request.auth?.token));
  if (!claims.ok) {
    throw new HttpsError("permission-denied", "Administrative claims are required");
  }

  return Object.freeze({
    uid,
    academyId: claims.value.academyId,
    role: claims.value.role,
  });
}

export function assertAcademyScope(actor: AdminActor, academyId: string): void {
  if (actor.academyId !== academyId) {
    throw new HttpsError("permission-denied", "Academy scope denied");
  }
}

export function getRegyfitProjectionScope(role: AdminRole): "safe" | "restricted" {
  return canReadRestrictedIp(role) ? "restricted" : "safe";
}
