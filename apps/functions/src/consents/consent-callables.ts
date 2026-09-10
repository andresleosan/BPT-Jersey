import { getFirestore } from "firebase-admin/firestore";
import { defineString } from "firebase-functions/params";
import { HttpsError, onCall, type CallableRequest } from "firebase-functions/v2/https";

import {
  parseConsentIdInput,
  parseWaiverAcceptanceInput,
  parseWaiverPublicationInput,
  parseWaiverVersionIdInput,
  toWaiverVersionProjection,
} from "@bpt-jersey/domain/consents";
import type { AuditEventDraft } from "@bpt-jersey/domain/audit";
import { browserAdminCallableOptions } from "../auth/callable-options.js";
import { appendAuditEventInTransaction } from "../audit/audit-writer.js";
import { requireUserActor } from "../auth/user-authorization.js";
import { createPrivateStorageR2Client } from "../storage/r2-client.js";
import {
  createConsentStore,
  ConsentStoreError,
  type ConsentClientRole,
  type ConsentStore,
} from "./consent-service.js";
import { createWaiverEvidencePdf } from "./waiver-evidence-pdf.js";

/**
 * Whether waiver registration is open in this deployment (T127).
 *
 * It replaces `BPT_SYNTHETIC_PILOT` as the production gate, and the reason is the name: that flag
 * says "synthetic pilot", so setting it in production would have been a false statement about the
 * environment rather than a decision about the capability. A deployment can be production and have
 * waiver registration closed, or be an Emulator and have it open; those are two facts and they now
 * have two flags.
 *
 * It is a `defineString` rather than an env var so the value travels with the deployment and is
 * visible in the function's own configuration - `firebase functions:describe` shows it - instead of
 * living in a file the artifact has to remember to copy. Its default is `disabled`, so a function
 * deployed before anyone decides **fails closed**, which is the same posture the synthetic gate had
 * and the one the release runbook's precondition 6 asks for.
 *
 * Anything that is not exactly `enabled` leaves it closed. A typo has one meaning, not two.
 */
const waiverRegistrationMode = defineString("BPT_WAIVER_REGISTRATION", {
  default: "disabled",
  description:
    "Set to 'enabled' to open waiver registration in this deployment. Anything else keeps it closed.",
});

export type ConsentCallableServices = Readonly<{
  store: ConsentStore;
  registrationEnabled?: boolean;
  now?: () => string;
}>;

function assertRegistrationEnabled(services: ConsentCallableServices): void {
  if (services.registrationEnabled !== true)
    throw new HttpsError(
      "failed-precondition",
      "Waiver registration is not enabled in this deployment",
    );
}
function invalid(): never {
  throw new HttpsError("invalid-argument", "Waiver payload is invalid");
}
function noPayload(value: unknown): void {
  if (value !== null) invalid();
}
function admin(request: CallableRequest<unknown>) {
  const actor = requireUserActor(request);
  if (actor.role !== "owner" && actor.role !== "administrator")
    throw new HttpsError("permission-denied", "Waiver administration is not permitted");
  return actor;
}
function client(request: CallableRequest<unknown>) {
  const actor = requireUserActor(request);
  if (actor.role !== "guardian" && actor.role !== "adultStudent")
    throw new HttpsError("permission-denied", "Waiver registration is not permitted");
  return { ...actor, role: actor.role as ConsentClientRole };
}
function evidenceActor(request: CallableRequest<unknown>) {
  const actor = requireUserActor(request);
  if (!["owner", "administrator", "guardian", "adultStudent"].includes(actor.role))
    throw new HttpsError("permission-denied", "Waiver evidence access is not permitted");
  return actor as typeof actor & { role: "owner" | "administrator" | "guardian" | "adultStudent" };
}
function mapError(error: unknown, operation: "read" | "write"): never {
  if (error instanceof HttpsError) throw error;
  if (error instanceof ConsentStoreError) {
    if (error.code === "invalid")
      throw new HttpsError("invalid-argument", "Waiver payload is invalid");
    if (error.code === "forbidden" || error.code === "not-found")
      throw new HttpsError("permission-denied", "Waiver access is not permitted");
    if (error.code === "conflict" || error.code === "precondition")
      throw new HttpsError("failed-precondition", "Waiver operation is not available");
  }
  throw new HttpsError(
    "internal",
    operation === "read"
      ? "Unable to read waiver registration"
      : "Unable to update waiver registration",
  );
}
function now(services: ConsentCallableServices): string {
  return services.now?.() ?? new Date().toISOString();
}

export async function publishWaiverVersionHandler(
  request: CallableRequest<unknown>,
  services: ConsentCallableServices,
) {
  assertRegistrationEnabled(services);
  const actor = admin(request);
  const parsed = parseWaiverPublicationInput(request.data);
  if (!parsed.ok) return invalid();
  try {
    return toWaiverVersionProjection(
      await services.store.publishWaiverVersion({
        academyId: actor.academyId,
        actorId: actor.userId,
        now: now(services),
        publication: parsed.value,
      }),
    );
  } catch (error) {
    return mapError(error, "write");
  }
}
export async function getCurrentWaiverAdminHandler(
  request: CallableRequest<unknown>,
  services: ConsentCallableServices,
) {
  assertRegistrationEnabled(services);
  const actor = admin(request);
  noPayload(request.data);
  try {
    return await services.store.getCurrentWaiverAdmin({ academyId: actor.academyId });
  } catch (error) {
    return mapError(error, "read");
  }
}
export async function withdrawCurrentWaiverHandler(
  request: CallableRequest<unknown>,
  services: ConsentCallableServices,
) {
  assertRegistrationEnabled(services);
  const actor = admin(request);
  const parsed = parseWaiverVersionIdInput(request.data);
  if (!parsed.ok) return invalid();
  try {
    return toWaiverVersionProjection(
      await services.store.withdrawCurrentWaiver({
        academyId: actor.academyId,
        actorId: actor.userId,
        now: now(services),
        waiverVersionId: parsed.value.waiverVersionId,
      }),
    );
  } catch (error) {
    return mapError(error, "write");
  }
}
export async function getWaiverRegistrationHandler(
  request: CallableRequest<unknown>,
  services: ConsentCallableServices,
) {
  assertRegistrationEnabled(services);
  const actor = client(request);
  noPayload(request.data);
  try {
    return await services.store.getWaiverRegistration({
      academyId: actor.academyId,
      actorId: actor.userId,
      role: actor.role,
      now: now(services),
    });
  } catch (error) {
    return mapError(error, "read");
  }
}
export async function acceptWaiverHandler(
  request: CallableRequest<unknown>,
  services: ConsentCallableServices,
) {
  assertRegistrationEnabled(services);
  const actor = client(request);
  const parsed = parseWaiverAcceptanceInput(request.data);
  if (!parsed.ok) return invalid();
  try {
    return await services.store.acceptWaiver({
      academyId: actor.academyId,
      actorId: actor.userId,
      role: actor.role,
      now: now(services),
      ...parsed.value,
    });
  } catch (error) {
    return mapError(error, "write");
  }
}
export async function revokeWaiverConsentHandler(
  request: CallableRequest<unknown>,
  services: ConsentCallableServices,
) {
  assertRegistrationEnabled(services);
  const actor = client(request);
  const parsed = parseConsentIdInput(request.data);
  if (!parsed.ok) return invalid();
  try {
    return await services.store.revokeWaiverConsent({
      academyId: actor.academyId,
      actorId: actor.userId,
      role: actor.role,
      consentId: parsed.value.consentId,
      now: now(services),
    });
  } catch (error) {
    return mapError(error, "write");
  }
}
export async function getWaiverEvidenceDownloadHandler(
  request: CallableRequest<unknown>,
  services: ConsentCallableServices,
) {
  assertRegistrationEnabled(services);
  const actor = evidenceActor(request);
  const parsed = parseConsentIdInput(request.data);
  if (!parsed.ok) return invalid();
  try {
    return await services.store.getWaiverEvidenceDownload({
      academyId: actor.academyId,
      actorId: actor.userId,
      role: actor.role,
      consentId: parsed.value.consentId,
      now: now(services),
    });
  } catch (error) {
    return mapError(error, "read");
  }
}

function callableServices(): ConsentCallableServices {
  const firestore = getFirestore() as unknown as Parameters<
    typeof createConsentStore
  >[0]["firestore"];
  return {
    // Either gate opens it, and they mean different things: the production parameter is a decision
    // about the capability, the synthetic flag is a statement about the environment. Keeping both
    // is what lets the Emulator suites keep working without production borrowing their name.
    registrationEnabled:
      waiverRegistrationMode.value() === "enabled" || process.env.BPT_SYNTHETIC_PILOT === "true",
    store: createConsentStore({
      firestore,
      r2: createPrivateStorageR2Client(),
      createEvidencePdf: createWaiverEvidencePdf,
      appendAudit: (transaction, reference, draft) =>
        appendAuditEventInTransaction(transaction, reference, draft as AuditEventDraft),
    }),
  };
}

export const publishWaiverVersion = onCall(browserAdminCallableOptions, (request) =>
  publishWaiverVersionHandler(request, callableServices()),
);
export const getCurrentWaiverAdmin = onCall(browserAdminCallableOptions, (request) =>
  getCurrentWaiverAdminHandler(request, callableServices()),
);
export const withdrawCurrentWaiver = onCall(browserAdminCallableOptions, (request) =>
  withdrawCurrentWaiverHandler(request, callableServices()),
);
export const consentClientCallableOptions = { enforceAppCheck: true };

export const getWaiverRegistration = onCall(consentClientCallableOptions, (request) =>
  getWaiverRegistrationHandler(request, callableServices()),
);
export const acceptWaiver = onCall(consentClientCallableOptions, (request) =>
  acceptWaiverHandler(request, callableServices()),
);
export const revokeWaiverConsent = onCall(consentClientCallableOptions, (request) =>
  revokeWaiverConsentHandler(request, callableServices()),
);
export const getWaiverEvidenceDownload = onCall(consentClientCallableOptions, (request) =>
  getWaiverEvidenceDownloadHandler(request, callableServices()),
);
