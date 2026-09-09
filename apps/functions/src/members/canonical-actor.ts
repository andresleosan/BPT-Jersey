import { HttpsError, type CallableRequest } from "firebase-functions/v2/https";

import { requireAdminActor } from "../auth/admin-authorization.js";
import type { CanonicalMemberDirectoryActor } from "./canonical-member-directory-service.js";
import { matchesProvisionedMemberDirectoryActor } from "./member-directory-actor-authorization.js";

/**
 * The office actor that every write against the canonical member directory has to prove, in one
 * place so that a second door cannot accidentally settle for less. Three things are checked, and
 * a caller who passes only two is refused:
 *
 * 1. App Check is verified **in the handler**, not only in the callable's options, so a handler
 *    invoked directly - by a test, by another module, by a future callable that forgets the
 *    option - cannot be reached from an unattested client.
 * 2. The claim says owner or administrator, for this academy.
 * 3. The account is still alive right now: the Auth user is not disabled, its custom claims still
 *    say what the token said, the academy still holds a provisioned staff document for it, and no
 *    role lock has been dropped on it. A revoked administrator carries a valid token until it
 *    expires; without this probe that token still writes.
 */
export type MemberDirectoryActorStatusInput = Readonly<{
  uid: string;
  academyId: string;
  role: "owner" | "administrator";
}>;

type MemberDirectoryActivityAuthUser = Readonly<{
  uid: string;
  disabled: boolean;
  customClaims?: Readonly<Record<string, unknown>>;
}>;

type MemberDirectoryActivityDocument = Readonly<{
  exists: boolean;
  data: () => unknown;
}>;

export type MemberDirectoryActorActivityDependencies = Readonly<{
  getAuthUser: (uid: string) => Promise<MemberDirectoryActivityAuthUser>;
  getDocument: (path: string) => Promise<MemberDirectoryActivityDocument>;
}>;

export type MemberDirectoryActorActivityCheck = (
  input: MemberDirectoryActorStatusInput,
) => Promise<boolean>;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function createMemberDirectoryActorActivityCheck(
  dependencies: MemberDirectoryActorActivityDependencies,
): MemberDirectoryActorActivityCheck {
  return async ({ uid, academyId, role }) => {
    try {
      const [authUser, adminDocument, roleLock] = await Promise.all([
        dependencies.getAuthUser(uid),
        dependencies.getDocument(`academies/${academyId}/users/${uid}`),
        dependencies.getDocument(`academies/${academyId}/adminRoleLocks/${uid}`),
      ]);
      if (authUser.uid !== uid || authUser.disabled || !adminDocument.exists || roleLock.exists) {
        return false;
      }
      const claims = authUser.customClaims;
      return (
        matchesProvisionedMemberDirectoryActor(adminDocument.data(), {
          actorId: uid,
          academyId,
          role,
        }) &&
        isRecord(claims) &&
        claims.academyId === academyId &&
        claims.role === role
      );
    } catch {
      return false;
    }
  };
}

/**
 * The same door, narrowed to the owner. Initializing the canonical directory is not member
 * management: it fixes the integrity posture every later write is checked against, so it is not
 * something an administrator should be able to do on their own.
 */
export async function requireCanonicalMemberDirectoryOwner(
  request: CallableRequest<unknown>,
  isActorActive: MemberDirectoryActorActivityCheck,
): Promise<CanonicalMemberDirectoryActor> {
  const actor = await requireCanonicalMemberDirectoryActor(request, isActorActive);
  if (actor.role !== "owner") {
    throw new HttpsError("permission-denied", "Owner access is required");
  }
  return actor;
}

export async function requireCanonicalMemberDirectoryActor(
  request: CallableRequest<unknown>,
  isActorActive: MemberDirectoryActorActivityCheck,
): Promise<CanonicalMemberDirectoryActor> {
  const actor = requireAdminActor(request);
  if (request.app === undefined) {
    throw new HttpsError("unauthenticated", "Verified App Check is required");
  }
  if (actor.role !== "owner" && actor.role !== "administrator") {
    throw new HttpsError("permission-denied", "Owner or administrator access is required");
  }
  let active: boolean;
  try {
    active = await isActorActive({
      uid: actor.uid,
      academyId: actor.academyId,
      role: actor.role,
    });
  } catch {
    throw new HttpsError("failed-precondition", "Administrative account status is unavailable");
  }
  if (!active) {
    throw new HttpsError("permission-denied", "An active administrative account is required");
  }
  return Object.freeze({
    actorId: actor.uid,
    academyId: actor.academyId,
    role: actor.role,
    active: true,
    appCheckVerified: true,
  });
}
