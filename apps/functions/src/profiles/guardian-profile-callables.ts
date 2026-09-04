import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { defineSecret } from "firebase-functions/params";
import { HttpsError, onCall, type CallableRequest } from "firebase-functions/v2/https";

import type { UserProfile } from "@bpt-jersey/domain/profiles";

import { requireUserActor } from "../auth/user-authorization.js";
import {
  createGuardianProfileStore,
  GuardianProfileStoreError,
  type GuardianProfileStore,
  type SaveGuardianProfileInput,
} from "./guardian-profile-service.js";

const migrationIntegritySecret = defineSecret("MEMBER_DIRECTORY_MIGRATION_INTEGRITY_SECRET");
const integritySecretVersion = "integrity-v1";

type GuardianProfileAuthService = Readonly<{
  getUser: (userId: string) => Promise<
    Readonly<{
      uid: string;
      disabled: boolean;
      email?: string | null;
      customClaims?: Readonly<Record<string, unknown>>;
    }>
  >;
}>;

export type GuardianProfileCallableServices = Readonly<{
  auth: GuardianProfileAuthService;
  store: GuardianProfileStore;
  now?: () => string;
}>;

type EditableGuardianProfilePayload = Readonly<{
  requestId: string;
  displayName: string;
  phoneNumber: string;
}>;

const safeIdentifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const controlCharacterPattern = /[\u0000-\u001f\u007f]/u;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function isEditableText(value: unknown, maxLength: number): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maxLength &&
    value === value.trim() &&
    !controlCharacterPattern.test(value)
  );
}

function invalidPayload(): never {
  throw new HttpsError("invalid-argument", "Guardian profile payload is invalid");
}

function parseEditablePayload(value: unknown): EditableGuardianProfilePayload {
  if (!isPlainRecord(value)) return invalidPayload();
  const fields = ["requestId", "displayName", "phoneNumber"] as const;
  const keys = Reflect.ownKeys(value);
  if (
    keys.length !== fields.length ||
    keys.some((key) => typeof key !== "string" || !fields.includes(key as (typeof fields)[number]))
  ) {
    return invalidPayload();
  }
  if (
    typeof value.requestId !== "string" ||
    !safeIdentifierPattern.test(value.requestId) ||
    !isEditableText(value.displayName, 160) ||
    !isEditableText(value.phoneNumber, 64)
  ) {
    return invalidPayload();
  }
  return Object.freeze({
    requestId: value.requestId,
    displayName: value.displayName,
    phoneNumber: value.phoneNumber,
  });
}

function requireGuardianActor(request: CallableRequest<unknown>) {
  if (request.app === undefined) {
    throw new HttpsError("unauthenticated", "Verified App Check is required");
  }
  const actor = requireUserActor(request);
  if (actor.role !== "guardian") {
    throw new HttpsError("permission-denied", "Guardian profile access is not permitted");
  }
  return actor;
}

async function requireCurrentGuardianAuth(
  actor: ReturnType<typeof requireGuardianActor>,
  services: GuardianProfileCallableServices,
): Promise<Readonly<{ uid: string; email: string }>> {
  let authUser: Awaited<ReturnType<GuardianProfileAuthService["getUser"]>>;
  try {
    authUser = await services.auth.getUser(actor.userId);
  } catch {
    throw new HttpsError("failed-precondition", "Guardian account is not available");
  }
  const claims = authUser.customClaims;
  if (
    authUser.uid !== actor.userId ||
    authUser.disabled ||
    !isPlainRecord(claims) ||
    !Object.hasOwn(claims, "academyId") ||
    !Object.hasOwn(claims, "role") ||
    claims.academyId !== actor.academyId ||
    claims.role !== "guardian" ||
    typeof authUser.email !== "string" ||
    authUser.email.trim().length === 0
  ) {
    throw new HttpsError("permission-denied", "Guardian profile access is not permitted");
  }
  return Object.freeze({ uid: authUser.uid, email: authUser.email });
}

function mapGuardianProfileError(error: unknown, operation: "load" | "save"): never {
  if (error instanceof HttpsError) throw error;
  if (error instanceof GuardianProfileStoreError) {
    if (error.code === "invalid") {
      throw new HttpsError("invalid-argument", "Guardian profile payload is invalid");
    }
    if (error.code === "replay") {
      throw new HttpsError("failed-precondition", "Guardian profile request replay was rejected");
    }
    throw new HttpsError("failed-precondition", "Guardian profile is not available");
  }
  throw new HttpsError(
    "internal",
    operation === "load" ? "Unable to load guardian profile" : "Unable to save guardian profile",
  );
}

export async function getGuardianProfileHandler(
  request: CallableRequest<unknown>,
  services: GuardianProfileCallableServices,
): Promise<UserProfile | undefined> {
  const actor = requireGuardianActor(request);
  if (request.data !== undefined && request.data !== null) invalidPayload();
  const authUser = await requireCurrentGuardianAuth(actor, services);
  try {
    return await services.store.getGuardianProfile(authUser.uid, actor.academyId, authUser.email);
  } catch (error) {
    return mapGuardianProfileError(error, "load");
  }
}

export async function saveGuardianProfileHandler(
  request: CallableRequest<unknown>,
  services: GuardianProfileCallableServices,
): Promise<UserProfile> {
  const actor = requireGuardianActor(request);
  const payload = parseEditablePayload(request.data);
  const authUser = await requireCurrentGuardianAuth(actor, services);
  const input: SaveGuardianProfileInput = {
    academyId: actor.academyId,
    userId: authUser.uid,
    email: authUser.email,
    ...payload,
    now: services.now?.() ?? new Date().toISOString(),
  };
  try {
    return await services.store.saveGuardianProfile(input);
  } catch (error) {
    return mapGuardianProfileError(error, "save");
  }
}

function guardianProfileCallableServices(): GuardianProfileCallableServices {
  return {
    auth: {
      getUser: async (userId) => {
        const user = await getAuth().getUser(userId);
        return {
          uid: user.uid,
          disabled: user.disabled,
          email: user.email ?? null,
          ...(user.customClaims === undefined ? {} : { customClaims: user.customClaims }),
        };
      },
    },
    store: createGuardianProfileStore({
      firestore: getFirestore() as unknown as Parameters<
        typeof createGuardianProfileStore
      >[0]["firestore"],
      integritySecretMaterial: migrationIntegritySecret.value(),
      integritySecretVersion,
    }),
  };
}

export const guardianProfileCallableOptions = {
  enforceAppCheck: true,
  consumeAppCheckToken: true,
  secrets: [migrationIntegritySecret],
};

export const getGuardianProfile = onCall(guardianProfileCallableOptions, async (request) =>
  getGuardianProfileHandler(request, guardianProfileCallableServices()),
);

export const saveGuardianProfile = onCall(guardianProfileCallableOptions, async (request) =>
  saveGuardianProfileHandler(request, guardianProfileCallableServices()),
);
