import { getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { HttpsError, onCall, type CallableRequest } from "firebase-functions/v2/https";

import type { UserRole } from "@bpt-jersey/domain";
import type { AuditEventDraft } from "@bpt-jersey/domain/audit";
import { parseUserClaims } from "@bpt-jersey/domain/auth/admin-contracts";
import { appendAuditEventInTransaction } from "../audit/audit-writer.js";
import { browserAdminCallableOptions } from "./callable-options.js";

/**
 * Self-service client registration. Signing in with Google leaves an account with no claim at all,
 * and every callable requires one, so before this existed a visitor who registered stayed locked
 * out of the shop for ever with nobody to fix it. This grants the lowest claim the platform has -
 * `shopper`, a buyer with no access to any student data - and only ever when the account has no
 * role yet. It never overwrites a role the academy granted, so it cannot be used to escape, widen
 * or downgrade an existing one.
 */
export type ShopperAccountProjection = Readonly<{ academyId: string; role: UserRole }>;

type Claims = Record<string, unknown>;

type AuditTransaction = Readonly<{
  create: (ref: { id: string }, data: Record<string, unknown>) => unknown;
}>;

export type ShopperRegistrationServices = Readonly<{
  auth: Readonly<{
    getUser: (uid: string) => Promise<{ uid: string; customClaims?: Claims }>;
    setCustomUserClaims: (uid: string, claims: Claims) => Promise<void>;
  }>;
  firestore: Readonly<{
    collection: (path: string) => { doc: (id?: string) => { id: string } };
    runTransaction: <T>(
      updateFunction: (transaction: AuditTransaction) => Promise<T>,
    ) => Promise<T>;
  }>;
  academyId: string;
  now?: () => string;
}>;

const academyIdPattern = /^[a-z][a-z0-9-]{2,60}$/u;

function currentClaims(user: { customClaims?: Claims }): Claims {
  const claims = user.customClaims;
  if (typeof claims !== "object" || claims === null || Array.isArray(claims)) return {};
  return { ...claims };
}

// The claim parser is the single definition of a valid role, so a role added to the vocabulary is
// honoured here without this file having to list one.
function knownRole(academyId: string, value: unknown): UserRole | undefined {
  const parsed = parseUserClaims({ academyId, role: value });
  return parsed.ok ? parsed.value.role : undefined;
}

async function writeAudit(
  services: ShopperRegistrationServices,
  uid: string,
  occurredAt: string,
): Promise<void> {
  const draft: AuditEventDraft = {
    action: "client.role.self_assigned",
    academyId: services.academyId as AuditEventDraft["academyId"],
    actorId: uid as AuditEventDraft["actorId"],
    targetRef: `academies/${services.academyId}/users/${uid}`,
    purpose: "self-service client account",
    correlationId:
      `shopper:${services.academyId}:${uid}:${occurredAt}` as AuditEventDraft["correlationId"],
  };
  const reference = services.firestore
    .collection(`academies/${services.academyId}/auditEvents`)
    .doc();
  await services.firestore.runTransaction(async (transaction) => {
    appendAuditEventInTransaction(transaction, reference, draft);
  });
}

export async function registerShopperAccountHandler(
  request: CallableRequest<unknown>,
  services: ShopperRegistrationServices,
): Promise<ShopperAccountProjection> {
  const uid = request.auth?.uid;
  if (typeof uid !== "string" || uid.trim().length === 0) {
    throw new HttpsError("unauthenticated", "Authentication is required");
  }
  // The academy is configuration, never payload: a caller must not be able to name the tenant its
  // own account lands in.
  if (request.data !== null && request.data !== undefined) {
    throw new HttpsError("invalid-argument", "Client registration takes no payload");
  }
  if (!academyIdPattern.test(services.academyId)) {
    throw new HttpsError("failed-precondition", "The academy is not configured");
  }

  const user = await services.auth.getUser(uid);
  const claims = currentClaims(user);
  const scopedAcademyId = claims.academyId;
  if (typeof scopedAcademyId === "string" && scopedAcademyId !== services.academyId) {
    throw new HttpsError("permission-denied", "This account belongs to another academy");
  }

  const existingRole = knownRole(services.academyId, claims.role);
  if (existingRole) {
    return Object.freeze({ academyId: services.academyId, role: existingRole });
  }

  const next: Claims = { ...claims, academyId: services.academyId, role: "shopper" };
  await services.auth.setCustomUserClaims(uid, next);

  const observed = currentClaims(await services.auth.getUser(uid));
  if (observed.role !== "shopper" || observed.academyId !== services.academyId) {
    // The claim did not stick. Leave the account exactly as it was rather than half-registered.
    try {
      await services.auth.setCustomUserClaims(uid, claims);
    } catch {
      throw new HttpsError("internal", "Client registration could not be rolled back");
    }
    throw new HttpsError("internal", "Client registration did not persist");
  }

  await writeAudit(services, uid, services.now?.() ?? new Date().toISOString());
  return Object.freeze({ academyId: services.academyId, role: "shopper" });
}

function callableServices(): ShopperRegistrationServices {
  const auth = getAuth();
  const firestore = getFirestore();
  return {
    academyId: process.env.ACADEMY_ID?.trim() || "demo-academy",
    auth: {
      getUser: async (uid) => {
        const user = await auth.getUser(uid);
        return { uid: user.uid, ...(user.customClaims ? { customClaims: user.customClaims } : {}) };
      },
      setCustomUserClaims: (uid, claims) => auth.setCustomUserClaims(uid, claims),
    },
    firestore: firestore as unknown as ShopperRegistrationServices["firestore"],
  };
}

export const registerShopperAccount = onCall(browserAdminCallableOptions, (request) =>
  registerShopperAccountHandler(request, callableServices()),
);
