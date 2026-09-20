import { resolveCanonicalStudentIdInTransaction } from "../members/member-identity-resolution.js";
import { createMemberAccessService } from "../members/member-access-service.js";
import { dateKeyInJersey } from "@bpt-jersey/domain/schedule/member-calendar";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { HttpsError, type CallableRequest } from "firebase-functions/v2/https";

import type { UserActorContext } from "@bpt-jersey/domain";
import {
  parseEffectiveStudentProfileAt,
  parseUserProfile,
  type StudentProfile,
} from "@bpt-jersey/domain/profiles";
import { parseStaffProfile } from "@bpt-jersey/domain/staff";
import { requireUserActor } from "../auth/user-authorization.js";
import { matchesProvisionedMemberDirectoryActor } from "../members/member-directory-actor-authorization.js";

export type LevelAuthorizationDocument = Readonly<{
  id: string;
  exists: boolean;
  data: Readonly<Record<string, unknown>> | undefined;
}>;

export type LevelAuthorizationDependencies = Readonly<{
  getAuthUser: (uid: string) => Promise<
    Readonly<{
      uid: string;
      disabled: boolean;
      emailVerified: boolean;
      tokensValidAfterTime?: string;
      customClaims: Readonly<Record<string, unknown>>;
    }>
  >;
  getDocument: (path: string) => Promise<LevelAuthorizationDocument>;
  queryDocuments: (
    collectionPath: string,
    field: string,
    value: unknown,
    limit: number,
  ) => Promise<readonly LevelAuthorizationDocument[]>;
  now?: () => string;
}>;

export type AuthorizedLevelActor = UserActorContext &
  Readonly<{
    staffId: string | null;
  }>;

export type LevelAuthorizationService = Readonly<{
  requireActor: (request: CallableRequest<unknown>) => Promise<AuthorizedLevelActor>;
  resolveStudent: (
    actor: AuthorizedLevelActor,
    requestedStudentId: string | undefined,
  ) => Promise<StudentProfile>;
}>;

const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const supportedRoles = new Set([
  "owner",
  "administrator",
  "headCoach",
  "coach",
  "guardian",
  "adultStudent",
  "teenStudent",
]);
const clientRoles = new Set(["guardian", "adultStudent", "teenStudent"]);
const administrativeRoles = new Set(["owner", "administrator"]);
const staffRoles = new Set(["headCoach", "coach"]);
const permittedCustomClaims = new Set(["academyId", "role", "mfaEnrolled", "locale"]);

function denied(): never {
  throw new HttpsError("permission-denied", "Levels access is not permitted");
}

function unavailable(): never {
  throw new HttpsError("failed-precondition", "Levels authorization is unavailable");
}

function safeIdentifier(value: unknown): value is string {
  return typeof value === "string" && identifierPattern.test(value);
}

function exactAuthorityClaims(
  claims: Readonly<Record<string, unknown>>,
  academyId: string,
  role: string,
): boolean {
  return (
    Reflect.ownKeys(claims).every(
      (key) => typeof key === "string" && permittedCustomClaims.has(key),
    ) &&
    claims.academyId === academyId &&
    (claims.role === role || (clientRoles.has(role) && clientRoles.has(String(claims.role))))
  );
}

function activeStaffUser(
  document: LevelAuthorizationDocument,
  academyId: string,
  userId: string,
): boolean {
  const value = document.data;
  return (
    document.exists &&
    document.id === userId &&
    value !== undefined &&
    value.userId === userId &&
    value.academyId === academyId &&
    value.accountType === "staff" &&
    value.active === true &&
    value.status === "active"
  );
}

function storedStudent(
  document: LevelAuthorizationDocument,
  academyId: string,
  expectedStudentId?: string,
): StudentProfile {
  if (!document.exists || document.data === undefined) return denied();
  const parsed = parseEffectiveStudentProfileAt(document.data, dateKeyInJersey(new Date()));
  if (
    !parsed.ok ||
    document.id !== parsed.value.studentId ||
    parsed.value.academyId !== academyId ||
    (expectedStudentId !== undefined && parsed.value.studentId !== expectedStudentId)
  ) {
    return denied();
  }
  return parsed.value;
}

async function activeActor(
  actor: UserActorContext,
  dependencies: LevelAuthorizationDependencies,
  authenticationTime: number,
): Promise<AuthorizedLevelActor> {
  if (
    !safeIdentifier(actor.userId) ||
    !safeIdentifier(actor.academyId) ||
    !supportedRoles.has(actor.role)
  ) {
    return denied();
  }

  let authUser: Awaited<ReturnType<LevelAuthorizationDependencies["getAuthUser"]>>;
  try {
    authUser = await dependencies.getAuthUser(actor.userId);
  } catch {
    return unavailable();
  }
  if (
    authUser.uid !== actor.userId ||
    authUser.disabled ||
    !exactAuthorityClaims(authUser.customClaims, actor.academyId, actor.role)
  ) {
    return denied();
  }

  if (administrativeRoles.has(actor.role)) {
    const [user, roleLock] = await Promise.all([
      dependencies.getDocument(`academies/${actor.academyId}/users/${actor.userId}`),
      dependencies.getDocument(`academies/${actor.academyId}/adminRoleLocks/${actor.userId}`),
    ]).catch(() => unavailable());
    if (
      !user.exists ||
      user.data === undefined ||
      roleLock.exists ||
      roleLock.data !== undefined ||
      !matchesProvisionedMemberDirectoryActor(user.data, {
        actorId: actor.userId,
        academyId: actor.academyId,
        role: actor.role,
      })
    ) {
      return denied();
    }
    return Object.freeze({ ...actor, staffId: null });
  }

  if (staffRoles.has(actor.role)) {
    const [user, staffDocuments] = await Promise.all([
      dependencies.getDocument(`academies/${actor.academyId}/users/${actor.userId}`),
      dependencies.queryDocuments(`academies/${actor.academyId}/staff`, "userId", actor.userId, 2),
    ]).catch(() => unavailable());
    if (!activeStaffUser(user, actor.academyId, actor.userId) || staffDocuments.length !== 1) {
      return denied();
    }
    const staffDocument = staffDocuments[0];
    const parsed =
      staffDocument?.data === undefined ? undefined : parseStaffProfile(staffDocument.data);
    if (
      staffDocument === undefined ||
      !staffDocument.exists ||
      parsed === undefined ||
      !parsed.ok ||
      parsed.value.staffId !== staffDocument.id ||
      parsed.value.academyId !== actor.academyId ||
      parsed.value.userId !== actor.userId ||
      parsed.value.role !== actor.role ||
      !parsed.value.active ||
      parsed.value.status !== "active"
    ) {
      return denied();
    }
    return Object.freeze({ ...actor, staffId: parsed.value.staffId });
  }

  if (clientRoles.has(actor.role)) {
    if (!authUser.emailVerified || !Number.isFinite(authenticationTime) ||
        (authUser.tokensValidAfterTime && authenticationTime < Date.parse(authUser.tokensValidAfterTime))) return denied();
    const user = await dependencies
      .getDocument(`academies/${actor.academyId}/users/${actor.userId}`)
      .catch(() => unavailable());
    const parsed = user.data === undefined ? undefined : parseUserProfile(user.data);
    if (
      !user.exists ||
      user.id !== actor.userId ||
      parsed === undefined ||
      !parsed.ok ||
      parsed.value.userId !== actor.userId ||
      parsed.value.academyId !== actor.academyId ||
      !parsed.value.active ||
      parsed.value.status !== "active"
    ) {
      return denied();
    }
    return Object.freeze({ ...actor, staffId: null });
  }

  return denied();
}

export function createLevelAuthorization(
  dependencies: LevelAuthorizationDependencies,
): LevelAuthorizationService {
  return {
    async requireActor(request) {
      if (request.app === undefined) {
        throw new HttpsError("unauthenticated", "Verified App Check is required");
      }
      const actor = requireUserActor(request);
      return activeActor(actor, dependencies, Number(request.auth?.token.auth_time) * 1000);
    },

    async resolveStudent(actor, requestedStudentId) {
      const access = createMemberAccessService(dependencies);
      let studentId = requestedStudentId;
      if (clientRoles.has(actor.role)) {
        if (studentId === undefined) {
          const profiles = await access.listProfiles(actor.academyId, actor.userId);
          studentId = profiles.find((profile) => profile.via === "self")?.studentId;
        }
        if (!studentId || !(await access.authorise(actor.academyId, actor.userId, studentId)).allowed) return denied();
      }
      if (!safeIdentifier(studentId)) return denied();
      studentId = await resolveCanonicalStudentIdInTransaction({ get: dependencies.getDocument }, actor.academyId, studentId);
      const document = await dependencies.getDocument(`academies/${actor.academyId}/students/${studentId}`).catch(() => unavailable());
      return storedStudent(document, actor.academyId, studentId);

    },
  };
}

export function createFirebaseLevelAuthorization(): LevelAuthorizationService {
  const firestore = getFirestore();
  return createLevelAuthorization({
    getAuthUser: async (uid) => {
      const user = await getAuth().getUser(uid);
      return {
        uid: user.uid,
        disabled: user.disabled,
        emailVerified: user.emailVerified,
        ...(user.tokensValidAfterTime === undefined ? {} : { tokensValidAfterTime: user.tokensValidAfterTime }),
        customClaims: user.customClaims ?? {},
      };
    },
    getDocument: async (path) => {
      const snapshot = await firestore.doc(path).get();
      return {
        id: snapshot.id,
        exists: snapshot.exists,
        data: snapshot.data(),
      };
    },
    queryDocuments: async (path, field, value, limit) => {
      const snapshot = await firestore
        .collection(path)
        .where(field, "==", value)
        .limit(limit)
        .get();
      return snapshot.docs.map((document) => ({
        id: document.id,
        exists: document.exists,
        data: document.data(),
      }));
    },
  });
}
