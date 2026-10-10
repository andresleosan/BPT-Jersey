import { getFirestore } from "firebase-admin/firestore";
import { HttpsError, type CallableRequest } from "firebase-functions/v2/https";

import { parseUpcomingBirthdayQuery } from "@bpt-jersey/domain/birthdays";

import { onCallWithFreshAppCheck } from "../auth/app-check.js";
import { browserOrigins } from "../auth/callable-options.js";
import { requireUserActor } from "../auth/user-authorization.js";
import { requireActiveUserActor } from "../auth/office-actor.js";
import {
  UpcomingBirthdayError,
  createUpcomingBirthdayService,
  type BirthdayFirestore,
  type UpcomingBirthdayService,
} from "./upcoming-birthday-service.js";

/**
 * T112: staff read the upcoming birthdays of the academy so the coach panel greets real members.
 * Clients never call it: a member has no business knowing when the rest of the mat was born.
 */
const staffRoles = ["owner", "administrator", "headCoach", "coach"] as const;

export const upcomingBirthdayCallableOptions = {
  cors: browserOrigins,
  invoker: "public" as const,
  enforceAppCheck: true,
  consumeAppCheckToken: true,
};

export function createListUpcomingBirthdaysHandler(options: { service: UpcomingBirthdayService }) {
  return async (request: CallableRequest<unknown>) => {
    const actor = requireUserActor(request);
    if (!staffRoles.includes(actor.role as (typeof staffRoles)[number])) {
      throw new HttpsError("permission-denied", "Staff access required to read birthdays");
    }
    await requireActiveUserActor(request); // live claims, not just the token (H-03)
    const parsed = parseUpcomingBirthdayQuery(request.data);
    if (!parsed.ok) throw new HttpsError("invalid-argument", parsed.error);
    // turningAge plus daysAway is the full date of birth, which only the office may see; a short
    // window for coaches also stops one call from listing the whole year.
    const office = actor.role === "owner" || actor.role === "administrator";
    const query = office
      ? parsed.value
      : { ...parsed.value, windowDays: Math.min(parsed.value.windowDays, 14) };
    try {
      const birthdays = await options.service.listUpcomingBirthdays({
        academyId: actor.academyId,
        query,
      });
      return {
        birthdays: office ? birthdays : birthdays.map(({ turningAge: _omit, ...rest }) => rest),
      };
    } catch (error) {
      if (error instanceof HttpsError) throw error;
      if (error instanceof UpcomingBirthdayError) {
        if (error.code === "invalid") {
          throw new HttpsError("invalid-argument", "Birthday request is invalid");
        }
        throw new HttpsError("failed-precondition", "Birthday list is not available", {
          reason: error.code,
        });
      }
      throw new HttpsError("internal", "Birthday lookup failed");
    }
  };
}

let service: UpcomingBirthdayService | undefined;
function getService(): UpcomingBirthdayService {
  service ??= createUpcomingBirthdayService({
    firestore: getFirestore() as unknown as BirthdayFirestore,
  });
  return service;
}

export const listUpcomingBirthdays = onCallWithFreshAppCheck(
  upcomingBirthdayCallableOptions,
  async (request) => createListUpcomingBirthdaysHandler({ service: getService() })(request),
);
