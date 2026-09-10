import { getFirestore } from "firebase-admin/firestore";
import { HttpsError, onCall, type CallableRequest } from "firebase-functions/v2/https";

import {
  createFirebaseLevelAuthorization,
  type LevelAuthorizationService,
} from "./level-authorization.js";
import {
  createFirestoreFamilyAchievementStore,
  FamilyAchievementStoreError,
  type FamilyAchievementStore,
} from "./family-achievement-service.js";
import type { FamilyAchievementSummary } from "@bpt-jersey/domain";

const staffRoles = ["owner", "administrator", "headCoach"] as const;
const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

function parseFamilyIdPayload(data: unknown): string {
  if (
    typeof data !== "object" ||
    data === null ||
    Array.isArray(data) ||
    Reflect.ownKeys(data).length !== 1 ||
    !Object.hasOwn(data, "familyId")
  ) {
    throw new HttpsError(
      "invalid-argument",
      "getFamilyAchievementSummary requires exactly one familyId field.",
    );
  }
  const familyId = (data as { familyId?: unknown }).familyId;
  if (typeof familyId !== "string" || !identifierPattern.test(familyId)) {
    throw new HttpsError("invalid-argument", "familyId is invalid.");
  }
  return familyId;
}

export function createGetFamilyAchievementSummaryHandler({
  store,
  authorization,
}: {
  store: FamilyAchievementStore;
  authorization: LevelAuthorizationService;
}) {
  return async (
    request: CallableRequest<unknown>,
  ): Promise<{ summary: FamilyAchievementSummary }> => {
    const actor = await authorization.requireActor(request);
    if (!staffRoles.includes(actor.role as (typeof staffRoles)[number])) {
      throw new HttpsError(
        "permission-denied",
        "Only owners, administrators and head coaches may view family achievements.",
      );
    }

    const familyId = parseFamilyIdPayload(request.data);

    try {
      return { summary: await store.getSnapshot(actor.academyId, familyId) };
    } catch (error) {
      if (error instanceof FamilyAchievementStoreError) {
        if (error.code === "not-found") {
          throw new HttpsError("not-found", "Family achievement snapshot not found.");
        }
        if (error.code === "tenant" || error.code === "invalid") {
          throw new HttpsError("permission-denied", "Family achievement tenant scope is invalid.");
        }
      }
      throw new HttpsError("internal", "Unable to retrieve family achievement summary.");
    }
  };
}

let defaultStore: FamilyAchievementStore | undefined;
let defaultAuthorization: LevelAuthorizationService | undefined;

function getStore(): FamilyAchievementStore {
  if (!defaultStore) {
    const firestore = getFirestore();
    defaultStore = createFirestoreFamilyAchievementStore({
      firestore: firestore as unknown as Parameters<
        typeof createFirestoreFamilyAchievementStore
      >[0]["firestore"],
    });
  }
  return defaultStore;
}

function getAuthorization(): LevelAuthorizationService {
  defaultAuthorization ??= createFirebaseLevelAuthorization();
  return defaultAuthorization;
}

export const getFamilyAchievementSummary = onCall(
  {
    enforceAppCheck: true,
  },
  async (request) =>
    createGetFamilyAchievementSummaryHandler({
      store: getStore(),
      authorization: getAuthorization(),
    })(request),
);
