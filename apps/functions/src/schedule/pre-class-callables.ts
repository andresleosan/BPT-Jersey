import { getFirestore } from "firebase-admin/firestore";
import { HttpsError, onCall, type CallableRequest } from "firebase-functions/v2/https";

import { parsePreClassViewQuery } from "@bpt-jersey/domain/schedule/pre-class";

import { requireUserActor } from "../auth/user-authorization.js";
import { scheduleCallableOptions } from "./schedule-callable-options.js";
import {
  PreClassError,
  createPreClassService,
  type PreClassFirestore,
  type PreClassService,
} from "./pre-class-service.js";

/**
 * T114: staff read the pre-class view of one session. Members never do: who else trains a class is
 * not a member's business, and the list exists to speed up the coach's check-in.
 */
const staffRoles = ["owner", "administrator", "headCoach", "coach"] as const;

export function createGetPreClassViewHandler(options: { service: PreClassService }) {
  return async (request: CallableRequest<unknown>) => {
    const actor = requireUserActor(request);
    if (!staffRoles.includes(actor.role as (typeof staffRoles)[number])) {
      throw new HttpsError("permission-denied", "Staff access required to prepare a class");
    }
    const parsed = parsePreClassViewQuery(request.data);
    if (!parsed.ok) throw new HttpsError("invalid-argument", parsed.error);
    try {
      return {
        view: await options.service.getPreClassView({
          academyId: actor.academyId,
          sessionId: parsed.value.sessionId,
        }),
      };
    } catch (error) {
      if (error instanceof HttpsError) throw error;
      if (error instanceof PreClassError) {
        if (error.code === "invalid") {
          throw new HttpsError("invalid-argument", "Pre-class request is invalid");
        }
        if (error.code === "not-found") {
          throw new HttpsError("not-found", "Session is not available");
        }
        if (error.code === "tenant") {
          throw new HttpsError("permission-denied", "Session access is not permitted");
        }
        throw new HttpsError("failed-precondition", "Pre-class view is not available", {
          reason: error.code,
        });
      }
      throw new HttpsError("internal", "Pre-class view failed");
    }
  };
}

let service: PreClassService | undefined;
function getService(): PreClassService {
  service ??= createPreClassService({
    firestore: getFirestore() as unknown as PreClassFirestore,
  });
  return service;
}

export const getPreClassView = onCall(scheduleCallableOptions, async (request) =>
  createGetPreClassViewHandler({ service: getService() })(request),
);
