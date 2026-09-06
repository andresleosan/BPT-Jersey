import { getFirestore } from "firebase-admin/firestore";
import { HttpsError, onCall, type CallableRequest } from "firebase-functions/v2/https";

import {
  noShowPenaltyStatuses,
  parseResolveNoShowPenaltyInput,
  type NoShowPenaltyStatus,
} from "@bpt-jersey/domain/penalties";

import { requireUserActor } from "../auth/user-authorization.js";
import { allowedByRoleOrGrant } from "../staff/permission-grant-callables.js";
import {
  createPermissionGrantService,
  type GrantFirestore,
  type PermissionGrantService,
} from "../staff/permission-grant-service.js";
import {
  NoShowPenaltyError,
  createNoShowPenaltyService,
  type NoShowPenaltyService,
  type PenaltyFirestore,
} from "./no-show-penalty-service.js";

/**
 * T111 callables. Staff may propose the penalties of a session they operated; only office
 * (owner or administrator) reads the queue and resolves an entry, which is what BRIEF decision 2
 * means by "resolucion por office".
 */
const staffRoles = ["owner", "administrator", "headCoach", "coach"] as const;
const officeRoles = ["owner", "administrator"] as const;

export const noShowPenaltyCallableOptions = {
  cors: ["https://bptjersey.pages.dev"],
  invoker: "public" as const,
  enforceAppCheck: true,
  consumeAppCheckToken: true,
};

function mapError(error: unknown): never {
  if (error instanceof HttpsError) throw error;
  if (error instanceof NoShowPenaltyError) {
    if (error.code === "invalid") {
      throw new HttpsError("invalid-argument", "Penalty request is invalid");
    }
    if (error.code === "tenant") {
      throw new HttpsError("permission-denied", "Penalty access is not permitted");
    }
    if (error.code === "not-found") {
      throw new HttpsError("not-found", "Penalty resource is not available");
    }
    throw new HttpsError("failed-precondition", "Penalty operation is not available", {
      reason: error.code,
    });
  }
  throw new HttpsError("internal", "Penalty operation failed");
}

function requireRole(
  request: CallableRequest<unknown>,
  permitted: readonly string[],
  message: string,
) {
  const actor = requireUserActor(request);
  if (!permitted.includes(actor.role)) {
    throw new HttpsError("permission-denied", message);
  }
  return actor;
}

/**
 * T116: the office queue is the first consumer of a delegated permission. Office still reaches it by
 * role; a coach reaches it only while holding a live `reviewPenalties` grant. The role check runs
 * first and unchanged, so nothing office could do before depends on the grant store being readable.
 */
async function requireOfficeOrGrant(
  request: CallableRequest<unknown>,
  permissions: PermissionGrantService,
  message: string,
) {
  const actor = requireUserActor(request);
  const allowed = await allowedByRoleOrGrant({
    service: permissions,
    academyId: actor.academyId,
    userId: actor.userId,
    role: actor.role,
    permittedRoles: officeRoles,
    permission: "reviewPenalties",
  });
  if (!allowed) throw new HttpsError("permission-denied", message);
  return actor;
}

export function createProposeNoShowPenaltiesHandler(options: { service: NoShowPenaltyService }) {
  return async (request: CallableRequest<unknown>) => {
    const actor = requireRole(
      request,
      staffRoles,
      "Staff access required to propose no-show penalties",
    );
    const data = request.data as { sessionId?: unknown } | null;
    if (
      data === null ||
      typeof data !== "object" ||
      Object.keys(data).length !== 1 ||
      typeof data.sessionId !== "string" ||
      data.sessionId.trim().length === 0
    ) {
      throw new HttpsError("invalid-argument", "sessionId is required");
    }
    try {
      return {
        result: await options.service.proposeNoShowPenalties({
          academyId: actor.academyId,
          sessionId: data.sessionId.trim(),
          actorId: actor.userId,
        }),
      };
    } catch (error) {
      return mapError(error);
    }
  };
}

export function createListNoShowPenaltiesHandler(options: {
  service: NoShowPenaltyService;
  permissions: PermissionGrantService;
}) {
  return async (request: CallableRequest<unknown>) => {
    const actor = await requireOfficeOrGrant(
      request,
      options.permissions,
      "Office access required to review penalties",
    );
    const data = request.data as { status?: unknown } | null;
    let status: NoShowPenaltyStatus | undefined;
    if (data !== null && data !== undefined) {
      if (typeof data !== "object" || Object.keys(data).some((key) => key !== "status")) {
        throw new HttpsError("invalid-argument", "Penalty filter accepts only status");
      }
      if (data.status !== undefined) {
        if (
          typeof data.status !== "string" ||
          !noShowPenaltyStatuses.includes(data.status as NoShowPenaltyStatus)
        ) {
          throw new HttpsError("invalid-argument", "status is invalid");
        }
        status = data.status as NoShowPenaltyStatus;
      }
    }
    try {
      return {
        penalties: await options.service.listNoShowPenalties({
          academyId: actor.academyId,
          ...(status === undefined ? {} : { status }),
        }),
      };
    } catch (error) {
      return mapError(error);
    }
  };
}

export function createResolveNoShowPenaltyHandler(options: {
  service: NoShowPenaltyService;
  permissions: PermissionGrantService;
}) {
  return async (request: CallableRequest<unknown>) => {
    const actor = await requireOfficeOrGrant(
      request,
      options.permissions,
      "Office access required to resolve penalties",
    );
    const parsed = parseResolveNoShowPenaltyInput(request.data);
    if (!parsed.ok) {
      throw new HttpsError("invalid-argument", parsed.error);
    }
    try {
      return {
        penalty: await options.service.resolveNoShowPenalty({
          academyId: actor.academyId,
          actorId: actor.userId,
          resolution: parsed.value,
        }),
      };
    } catch (error) {
      return mapError(error);
    }
  };
}

let service: NoShowPenaltyService | undefined;
function getService(): NoShowPenaltyService {
  service ??= createNoShowPenaltyService({
    firestore: getFirestore() as unknown as PenaltyFirestore,
  });
  return service;
}

let permissions: PermissionGrantService | undefined;
function getPermissions(): PermissionGrantService {
  permissions ??= createPermissionGrantService({
    firestore: getFirestore() as unknown as GrantFirestore,
  });
  return permissions;
}

export const proposeNoShowPenalties = onCall(noShowPenaltyCallableOptions, async (request) =>
  createProposeNoShowPenaltiesHandler({ service: getService() })(request),
);

export const listNoShowPenalties = onCall(noShowPenaltyCallableOptions, async (request) =>
  createListNoShowPenaltiesHandler({ service: getService(), permissions: getPermissions() })(
    request,
  ),
);

export const resolveNoShowPenalty = onCall(noShowPenaltyCallableOptions, async (request) =>
  createResolveNoShowPenaltyHandler({ service: getService(), permissions: getPermissions() })(
    request,
  ),
);
