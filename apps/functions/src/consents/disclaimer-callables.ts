import { getFirestore } from "firebase-admin/firestore";
import { HttpsError, onCall, type CallableRequest } from "firebase-functions/v2/https";

import {
  parseDisclaimerAcceptanceInput,
  parseDisclaimerPublicationInput,
  parseDisclaimerWithdrawalInput,
} from "@bpt-jersey/domain/consents/disclaimers";

import { browserAdminCallableOptions } from "../auth/callable-options.js";
import { requireUserActor } from "../auth/user-authorization.js";
import {
  DisclaimerError,
  createDisclaimerService,
  type DisclaimerClientRole,
  type DisclaimerFirestore,
  type DisclaimerService,
} from "./disclaimer-service.js";

/**
 * T117 callables. Office writes the corpus; a participant reads only what is outstanding for them
 * and accepts it. Nobody reads anybody else's acceptances: the office list carries counts, not
 * names.
 */
export const disclaimerClientCallableOptions = { enforceAppCheck: true };

function office(request: CallableRequest<unknown>) {
  const actor = requireUserActor(request);
  if (actor.role !== "owner" && actor.role !== "administrator") {
    throw new HttpsError("permission-denied", "Disclaimer administration is not permitted");
  }
  return actor;
}

function client(request: CallableRequest<unknown>) {
  const actor = requireUserActor(request);
  if (actor.role !== "guardian" && actor.role !== "adultStudent") {
    throw new HttpsError("permission-denied", "Disclaimer access is not permitted");
  }
  return { ...actor, role: actor.role as DisclaimerClientRole };
}

function mapError(error: unknown): never {
  if (error instanceof HttpsError) throw error;
  if (error instanceof DisclaimerError) {
    if (error.code === "invalid") {
      throw new HttpsError("invalid-argument", "Disclaimer request is invalid");
    }
    if (error.code === "denied" || error.code === "tenant") {
      throw new HttpsError("permission-denied", "Disclaimer access is not permitted");
    }
    if (error.code === "not-found") {
      throw new HttpsError("not-found", "Disclaimer is not available");
    }
    // A stale hash is its own answer: the participant must read the new text, not retry blindly.
    if (error.code === "stale") {
      throw new HttpsError("aborted", "The disclaimer changed and must be read again");
    }
    throw new HttpsError("failed-precondition", "Disclaimer operation is not available", {
      reason: error.code,
    });
  }
  throw new HttpsError("internal", "Disclaimer operation failed");
}

function noPayload(value: unknown): void {
  if (value !== null && value !== undefined) {
    throw new HttpsError("invalid-argument", "This disclaimer call takes no payload");
  }
}

export function createPublishDisclaimerHandler(options: { service: DisclaimerService }) {
  return async (request: CallableRequest<unknown>) => {
    const actor = office(request);
    const parsed = parseDisclaimerPublicationInput(request.data);
    if (!parsed.ok) throw new HttpsError("invalid-argument", "Disclaimer payload is invalid");
    try {
      return {
        disclaimer: await options.service.publishDisclaimer({
          academyId: actor.academyId,
          actorId: actor.userId,
          input: parsed.value,
        }),
      };
    } catch (error) {
      return mapError(error);
    }
  };
}

export function createWithdrawDisclaimerHandler(options: { service: DisclaimerService }) {
  return async (request: CallableRequest<unknown>) => {
    const actor = office(request);
    const data = request.data as { disclaimerId?: unknown } | null;
    if (
      data === null ||
      typeof data !== "object" ||
      Object.keys(data).length !== 1 ||
      typeof data.disclaimerId !== "string"
    ) {
      throw new HttpsError("invalid-argument", "disclaimerId is required");
    }
    try {
      return {
        disclaimer: await options.service.withdrawDisclaimer({
          academyId: actor.academyId,
          actorId: actor.userId,
          disclaimerId: data.disclaimerId,
        }),
      };
    } catch (error) {
      return mapError(error);
    }
  };
}

export function createListDisclaimersHandler(options: { service: DisclaimerService }) {
  return async (request: CallableRequest<unknown>) => {
    const actor = office(request);
    noPayload(request.data);
    try {
      return { disclaimers: await options.service.listDisclaimers({ academyId: actor.academyId }) };
    } catch (error) {
      return mapError(error);
    }
  };
}

export function createGetOutstandingDisclaimersHandler(options: { service: DisclaimerService }) {
  return async (request: CallableRequest<unknown>) => {
    const actor = client(request);
    const data = request.data as { studentId?: unknown } | null;
    if (
      data === null ||
      typeof data !== "object" ||
      Object.keys(data).length !== 1 ||
      typeof data.studentId !== "string"
    ) {
      throw new HttpsError("invalid-argument", "studentId is required");
    }
    try {
      return {
        outstanding: await options.service.getOutstandingDisclaimers({
          academyId: actor.academyId,
          actorId: actor.userId,
          role: actor.role,
          studentId: data.studentId,
        }),
      };
    } catch (error) {
      return mapError(error);
    }
  };
}

export function createAcceptDisclaimerHandler(options: { service: DisclaimerService }) {
  return async (request: CallableRequest<unknown>) => {
    const actor = client(request);
    const parsed = parseDisclaimerAcceptanceInput(request.data);
    if (!parsed.ok) throw new HttpsError("invalid-argument", "Acceptance payload is invalid");
    try {
      return {
        acceptance: await options.service.acceptDisclaimer({
          academyId: actor.academyId,
          actorId: actor.userId,
          role: actor.role,
          input: parsed.value,
        }),
      };
    } catch (error) {
      return mapError(error);
    }
  };
}

export function createWithdrawDisclaimerAcceptanceHandler(options: { service: DisclaimerService }) {
  return async (request: CallableRequest<unknown>) => {
    const actor = client(request);
    const parsed = parseDisclaimerWithdrawalInput(request.data);
    if (!parsed.ok) throw new HttpsError("invalid-argument", "Withdrawal payload is invalid");
    try {
      return {
        acceptance: await options.service.withdrawAcceptance({
          academyId: actor.academyId,
          actorId: actor.userId,
          role: actor.role,
          acceptanceId: parsed.value.acceptanceId,
        }),
      };
    } catch (error) {
      return mapError(error);
    }
  };
}

let service: DisclaimerService | undefined;
function getService(): DisclaimerService {
  service ??= createDisclaimerService({
    firestore: getFirestore() as unknown as DisclaimerFirestore,
  });
  return service;
}

export const publishDisclaimer = onCall(browserAdminCallableOptions, (request) =>
  createPublishDisclaimerHandler({ service: getService() })(request),
);

export const withdrawDisclaimer = onCall(browserAdminCallableOptions, (request) =>
  createWithdrawDisclaimerHandler({ service: getService() })(request),
);

export const listDisclaimers = onCall(browserAdminCallableOptions, (request) =>
  createListDisclaimersHandler({ service: getService() })(request),
);

export const getOutstandingDisclaimers = onCall(disclaimerClientCallableOptions, (request) =>
  createGetOutstandingDisclaimersHandler({ service: getService() })(request),
);

export const acceptDisclaimer = onCall(disclaimerClientCallableOptions, (request) =>
  createAcceptDisclaimerHandler({ service: getService() })(request),
);

export const withdrawDisclaimerAcceptance = onCall(disclaimerClientCallableOptions, (request) =>
  createWithdrawDisclaimerAcceptanceHandler({ service: getService() })(request),
);
