import { getApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { defineSecret } from "firebase-functions/params";
import { HttpsError, onCall, type CallableRequest } from "firebase-functions/v2/https";

import {
  deriveParticipantType,
  parseStudentProfileAt,
  type ClientProfileProjection,
  type TrainingCenter,
  type TrainingTimePreference,
} from "@bpt-jersey/domain/profiles";

import { requireUserActor } from "../auth/user-authorization.js";
import {
  createProfileStore,
  ProfileStoreError,
  type ProfileStore,
  type SaveClientProfileInput,
} from "./profile-service.js";

const identityKeySecret = defineSecret("MEMBER_DIRECTORY_IDENTITY_KEY_SECRET");
const migrationIntegritySecret = defineSecret("MEMBER_DIRECTORY_MIGRATION_INTEGRITY_SECRET");
const identitySecretVersion = "identity-v1";
const integritySecretVersion = "integrity-v1";

type ProfileAuthService = Readonly<{
  getUser: (userId: string) => Promise<
    Readonly<{
      uid: string;
      disabled: boolean;
      email?: string | null;
      displayName?: string | null;
      customClaims?: Readonly<Record<string, unknown>>;
    }>
  >;
}>;

export type ProfileCallableServices = Readonly<{
  auth: ProfileAuthService;
  store: ProfileStore;
  now?: () => string;
}>;

type EditableProfilePayload = Readonly<{
  requestId: string;
  fullName: string;
  dateOfBirth: string;
  phoneNumber: string;
  trainingCenter: TrainingCenter;
  trainingTimePreferences: readonly TrainingTimePreference[];
}>;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function invalidPayload(): never {
  throw new HttpsError("invalid-argument", "Profile payload is invalid");
}

function parseEditablePayload(
  value: unknown,
  academyId: string,
  userId: string,
  now: string,
): EditableProfilePayload {
  if (!isPlainRecord(value)) return invalidPayload();
  const fields = [
    "requestId",
    "fullName",
    "dateOfBirth",
    "phoneNumber",
    "trainingCenter",
    "trainingTimePreferences",
  ] as const;
  const keys = Reflect.ownKeys(value);
  if (
    keys.length !== fields.length ||
    keys.some((key) => typeof key !== "string" || !fields.includes(key as (typeof fields)[number]))
  ) {
    return invalidPayload();
  }
  if (
    typeof value.requestId !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value.requestId)
  ) {
    return invalidPayload();
  }

  let participantType: "adult" | "minor";
  try {
    participantType = deriveParticipantType(
      typeof value.dateOfBirth === "string" ? value.dateOfBirth : "",
      now.slice(0, 10),
    );
  } catch {
    return invalidPayload();
  }

  const candidate = {
    studentId: "payload-validation",
    academyId,
    userId,
    fullName: value.fullName,
    dateOfBirth: value.dateOfBirth,
    phoneNumber: value.phoneNumber,
    email: "validation@example.test",
    trainingCenter: value.trainingCenter,
    trainingTimePreferences: value.trainingTimePreferences,
    participantType,
    active: true,
    status: "active",
    schemaVersion: "1",
    createdAt: now,
    createdBy: userId,
    updatedAt: now,
    updatedBy: userId,
  };
  const parsed = parseStudentProfileAt(candidate, now.slice(0, 10));
  if (!parsed.ok || parsed.value.participantType !== "adult") return invalidPayload();

  return Object.freeze({
    requestId: value.requestId,
    fullName: parsed.value.fullName,
    dateOfBirth: parsed.value.dateOfBirth,
    phoneNumber: parsed.value.phoneNumber ?? "",
    trainingCenter: parsed.value.trainingCenter,
    trainingTimePreferences: parsed.value.trainingTimePreferences,
  });
}

function requireClientActor(request: CallableRequest<unknown>) {
  if (request.app === undefined) {
    throw new HttpsError("unauthenticated", "Verified App Check is required");
  }
  const actor = requireUserActor(request);
  if (actor.role !== "adultStudent") {
    throw new HttpsError("permission-denied", "Profile access is not permitted");
  }
  return actor;
}

async function requireCurrentClientAuth(
  actor: ReturnType<typeof requireClientActor>,
  services: ProfileCallableServices,
): Promise<Awaited<ReturnType<ProfileAuthService["getUser"]>>> {
  let authUser: Awaited<ReturnType<ProfileAuthService["getUser"]>>;
  try {
    authUser = await services.auth.getUser(actor.userId);
  } catch {
    throw new HttpsError("failed-precondition", "Account profile is not available");
  }
  if (
    authUser.uid !== actor.userId ||
    authUser.disabled ||
    authUser.customClaims?.academyId !== actor.academyId ||
    authUser.customClaims?.role !== "adultStudent"
  ) {
    throw new HttpsError("permission-denied", "Profile access is not permitted");
  }
  return authUser;
}

function mapProfileError(error: unknown, operation: "load" | "save"): never {
  if (error instanceof HttpsError) throw error;
  if (error instanceof ProfileStoreError) {
    if (error.code === "tenant" || error.code === "duplicate" || error.code === "conflict") {
      throw new HttpsError("permission-denied", "Profile access is not permitted");
    }
    if (error.code === "invalid") {
      throw new HttpsError("invalid-argument", "Profile payload is invalid");
    }
    if (error.code === "replay") {
      throw new HttpsError("failed-precondition", "Profile request replay was rejected");
    }
    throw new HttpsError("failed-precondition", "Profile data is not available");
  }
  throw new HttpsError(
    "internal",
    operation === "load" ? "Unable to load profile" : "Unable to save profile",
  );
}

export async function getClientProfileHandler(
  request: CallableRequest<unknown>,
  services: ProfileCallableServices,
): Promise<ClientProfileProjection | undefined> {
  const actor = requireClientActor(request);
  if (request.data !== undefined && request.data !== null) {
    throw new HttpsError("invalid-argument", "Profile payload is invalid");
  }
  await requireCurrentClientAuth(actor, services);
  try {
    return await services.store.getClientProfile(actor.userId, actor.academyId);
  } catch (error) {
    return mapProfileError(error, "load");
  }
}

export async function saveClientProfileHandler(
  request: CallableRequest<unknown>,
  services: ProfileCallableServices,
): Promise<ClientProfileProjection> {
  const actor = requireClientActor(request);
  const now = services.now?.() ?? new Date().toISOString();
  const payload = parseEditablePayload(request.data, actor.academyId, actor.userId, now);
  const authUser = await requireCurrentClientAuth(actor, services);
  if (typeof authUser.email !== "string" || authUser.email.trim().length === 0) {
    throw new HttpsError("failed-precondition", "Account profile is not available");
  }

  const input: SaveClientProfileInput = {
    academyId: actor.academyId,
    userId: actor.userId,
    email: authUser.email,
    displayName: authUser.displayName?.trim() || payload.fullName,
    ...payload,
    now,
  };
  try {
    return await services.store.saveClientProfile(input);
  } catch (error) {
    return mapProfileError(error, "save");
  }
}

function profileCallableServices(): ProfileCallableServices {
  return {
    auth: {
      getUser: async (userId) => {
        const user = await getAuth().getUser(userId);
        return {
          uid: user.uid,
          disabled: user.disabled,
          email: user.email ?? null,
          displayName: user.displayName ?? null,
          ...(user.customClaims === undefined ? {} : { customClaims: user.customClaims }),
        };
      },
    },
    store: createProfileStore({
      firestore: getFirestore() as unknown as Parameters<typeof createProfileStore>[0]["firestore"],
      projectId: requiredProjectId(),
      identitySecretMaterial: identityKeySecret.value(),
      identitySecretVersion,
      integritySecretMaterial: migrationIntegritySecret.value(),
      integritySecretVersion,
    }),
  };
}

function requiredProjectId(): string {
  const projectId = getApp().options.projectId;
  if (typeof projectId !== "string" || projectId.length === 0) {
    throw new HttpsError("failed-precondition", "Firebase project binding is unavailable");
  }
  return projectId;
}

export const profileCallableOptions = {
  enforceAppCheck: true,
  secrets: [identityKeySecret, migrationIntegritySecret],
};

export const getClientProfile = onCall(profileCallableOptions, async (request) =>
  getClientProfileHandler(request, profileCallableServices()),
);

export const saveClientProfile = onCall(profileCallableOptions, async (request) =>
  saveClientProfileHandler(request, profileCallableServices()),
);
