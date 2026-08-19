import { HttpsError, type CallableRequest } from "firebase-functions/v2/https";

import {
  canReadRestrictedIp,
  parseAdminClaims,
  type AdminRole,
} from "@bpt-jersey/domain/auth/admin-contracts";

import { requireUserActor } from "./user-authorization.js";

export type AdminActor = Readonly<{
  uid: string;
  academyId: string;
  role: AdminRole;
}>;

export function requireAdminActor(request: CallableRequest): AdminActor {
  const actor = requireUserActor(request);
  const claims = parseAdminClaims({ academyId: actor.academyId, role: actor.role });
  if (!claims.ok) {
    throw new HttpsError("permission-denied", "Administrative claims are required");
  }

  return Object.freeze({
    uid: actor.userId,
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
