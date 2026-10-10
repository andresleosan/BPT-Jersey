import { getAuth } from "firebase-admin/auth";
import {
  HttpsError,
  onCall,
  type CallableOptions,
  type CallableRequest,
  type CallableResponse,
} from "firebase-functions/v2/https";
import { requireUserActor } from "./user-authorization.js";
import { assertActiveSession } from "./active-session.js";

async function validateCurrentActor(
  request: CallableRequest<unknown>,
  actor: ReturnType<typeof requireUserActor>,
) {
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

export async function requireActiveUserActor(request: CallableRequest<unknown>) {
  return validateCurrentActor(request, requireUserActor(request));
}

export async function requireActiveOfficeActor(request: CallableRequest<unknown>) {
  const actor = requireUserActor(request);
  if (actor.role !== "owner" && actor.role !== "administrator") {
    throw new HttpsError("permission-denied", "Administrator access is required.");
  }
  return validateCurrentActor(request, actor);
}

export function onCallWithActiveOfficeActor<T = unknown, Return = unknown, Stream = unknown>(
  options: CallableOptions<T>,
  handler: (request: CallableRequest<T>, response?: CallableResponse<Stream>) => Return,
) {
  return onCall(options, async (request, response) => {
    await requireActiveOfficeActor(request);
    return handler(request, response);
  });
}

export function onCallWithActiveUserActor<T = unknown, Return = unknown, Stream = unknown>(
  options: CallableOptions<T>,
  handler: (request: CallableRequest<T>, response?: CallableResponse<Stream>) => Return,
) {
  return onCall(options, async (request, response) => {
    await requireActiveUserActor(request);
    return handler(request, response);
  });
}
