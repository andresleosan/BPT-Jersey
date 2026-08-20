import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { HttpsError, onCall, type CallableRequest } from "firebase-functions/v2/https";

import {
  deriveParticipantType,
  parseStudentProfile,
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

type ProfileAuthService = Readonly<{
  getUser: (
    userId: string,
  ) => Promise<Readonly<{ email?: string | null; displayName?: string | null }>>;
}>;

export type ProfileCallableServices = Readonly<{
  auth: ProfileAuthService;
  store: ProfileStore;
  now?: () => string;
}>;

type EditableProfilePayload = Readonly<{
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
  const parsed = parseStudentProfile(candidate);
  if (!parsed.ok || parsed.value.participantType !== "adult") return invalidPayload();

  return Object.freeze({
    fullName: parsed.value.fullName,
    dateOfBirth: parsed.value.dateOfBirth,
    phoneNumber: parsed.value.phoneNumber ?? "",
    trainingCenter: parsed.value.trainingCenter,
    trainingTimePreferences: parsed.value.trainingTimePreferences,
  });
}

function requireClientActor(request: CallableRequest<unknown>) {
  const actor = requireUserActor(request);
  if (actor.role !== "adultStudent") {
    throw new HttpsError("permission-denied", "Profile access is not permitted");
  }
  return actor;
}

function mapProfileError(error: unknown, operation: "load" | "save"): never {
  if (error instanceof HttpsError) throw error;
  if (error instanceof ProfileStoreError) {
    if (error.code === "tenant" || error.code === "duplicate" || error.code === "conflict") {
      throw new HttpsError("permission-denied", "Profile access is not permitted");
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
  let authUser: Readonly<{ email?: string | null; displayName?: string | null }>;
  try {
    authUser = await services.auth.getUser(actor.userId);
  } catch {
    throw new HttpsError("failed-precondition", "Account profile is not available");
  }
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
        return { email: user.email ?? null, displayName: user.displayName ?? null };
      },
    },
    store: createProfileStore({
      firestore: getFirestore() as unknown as Parameters<typeof createProfileStore>[0]["firestore"],
    }),
  };
}

export const getClientProfile = onCall(async (request) =>
  getClientProfileHandler(request, profileCallableServices()),
);

export const saveClientProfile = onCall(async (request) =>
  saveClientProfileHandler(request, profileCallableServices()),
);
