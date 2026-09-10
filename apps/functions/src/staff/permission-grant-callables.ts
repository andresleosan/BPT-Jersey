import { getFirestore } from "firebase-admin/firestore";
import { HttpsError, onCall, type CallableRequest } from "firebase-functions/v2/https";

import {
  parseGrantPermissionCommand,
  parseRevokePermissionCommand,
  type DelegablePermission,
} from "@bpt-jersey/domain/staff/permission-grants";

import { requireUserActor } from "../auth/user-authorization.js";
import {
  PermissionGrantError,
  createPermissionGrantService,
  type GrantFirestore,
  type PermissionGrantService,
} from "./permission-grant-service.js";

/**
 * T116 callables. Only office grants, revokes and reads the delegation list; a coach never sees who
 * else holds what, because the list is an administrative record rather than a staff roster.
 */
const officeRoles = ["owner", "administrator"] as const;

export const permissionGrantCallableOptions = {
  cors: ["https://bptjersey.pages.dev"],
  invoker: "public" as const,
  enforceAppCheck: true,
  consumeAppCheckToken: true,
};

function mapError(error: unknown): never {
  if (error instanceof HttpsError) throw error;
  if (error instanceof PermissionGrantError) {
    if (error.code === "invalid")
      throw new HttpsError("invalid-argument", "Grant request is invalid");
    if (error.code === "denied" || error.code === "tenant") {
      throw new HttpsError("permission-denied", "Grant operation is not permitted");
    }
    if (error.code === "not-found") throw new HttpsError("not-found", "Grant is not available");
    throw new HttpsError("failed-precondition", "Grant operation is not available", {
      reason: error.code,
    });
  }
  throw new HttpsError("internal", "Grant operation failed");
}

function requireOffice(request: CallableRequest<unknown>, message: string) {
  const actor = requireUserActor(request);
  if (!officeRoles.includes(actor.role as (typeof officeRoles)[number])) {
    throw new HttpsError("permission-denied", message);
  }
  return actor;
}

/**
 * The gate every delegating callable uses: the role decides first, exactly as before, and only a
 * refusal is given a second chance through a live grant. A caller that would have been allowed by
 * role never touches the grant store.
 */
export async function allowedByRoleOrGrant(input: {
  service: PermissionGrantService;
  academyId: string;
  userId: string;
  role: string;
  permittedRoles: readonly string[];
  permission: DelegablePermission;
}): Promise<boolean> {
  if (input.permittedRoles.includes(input.role)) return true;
  const decision = await input.service.evaluatePermission({
    academyId: input.academyId,
    subjectUserId: input.userId,
    permission: input.permission,
  });
  return decision.allowed;
}

export function createGrantStaffPermissionHandler(options: { service: PermissionGrantService }) {
  return async (request: CallableRequest<unknown>) => {
    const actor = requireOffice(request, "Office access required to grant a permission");
    const parsed = parseGrantPermissionCommand(request.data);
    if (!parsed.ok) throw new HttpsError("invalid-argument", parsed.error);
    try {
      return {
        grant: await options.service.grantPermission({
          academyId: actor.academyId,
          actorId: actor.userId,
          actorRole: actor.role,
          command: parsed.value,
        }),
      };
    } catch (error) {
      return mapError(error);
    }
  };
}

export function createRevokeStaffPermissionHandler(options: { service: PermissionGrantService }) {
  return async (request: CallableRequest<unknown>) => {
    const actor = requireOffice(request, "Office access required to revoke a permission");
    const parsed = parseRevokePermissionCommand(request.data);
    if (!parsed.ok) throw new HttpsError("invalid-argument", parsed.error);
    try {
      return {
        grant: await options.service.revokePermission({
          academyId: actor.academyId,
          actorId: actor.userId,
          actorRole: actor.role,
          command: parsed.value,
        }),
      };
    } catch (error) {
      return mapError(error);
    }
  };
}

export function createListStaffPermissionGrantsHandler(options: {
  service: PermissionGrantService;
}) {
  return async (request: CallableRequest<unknown>) => {
    const actor = requireOffice(request, "Office access required to read permission grants");
    const data = request.data as { subjectUserId?: unknown } | null | undefined;
    let subjectUserId: string | undefined;
    if (data !== null && data !== undefined) {
      if (typeof data !== "object" || Object.keys(data).some((key) => key !== "subjectUserId")) {
        throw new HttpsError("invalid-argument", "Grant filter accepts only subjectUserId");
      }
      if (data.subjectUserId !== undefined) {
        if (typeof data.subjectUserId !== "string" || data.subjectUserId.trim().length === 0) {
          throw new HttpsError("invalid-argument", "subjectUserId is invalid");
        }
        subjectUserId = data.subjectUserId.trim();
      }
    }
    try {
      return {
        grants: await options.service.listPermissionGrants({
          academyId: actor.academyId,
          ...(subjectUserId === undefined ? {} : { subjectUserId }),
        }),
      };
    } catch (error) {
      return mapError(error);
    }
  };
}

function service(): PermissionGrantService {
  return createPermissionGrantService({
    firestore: getFirestore() as unknown as GrantFirestore,
  });
}

export const grantStaffPermission = onCall(permissionGrantCallableOptions, (request) =>
  createGrantStaffPermissionHandler({ service: service() })(request),
);

export const revokeStaffPermission = onCall(permissionGrantCallableOptions, (request) =>
  createRevokeStaffPermissionHandler({ service: service() })(request),
);

export const listStaffPermissionGrants = onCall(permissionGrantCallableOptions, (request) =>
  createListStaffPermissionGrantsHandler({ service: service() })(request),
);
