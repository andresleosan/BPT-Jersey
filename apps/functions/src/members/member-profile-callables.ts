import { getFirestore } from "firebase-admin/firestore";
import { HttpsError, onCall, type CallableRequest } from "firebase-functions/v2/https";

import {
  memberProfileRequestSchema,
  type MemberNameSearchResult,
  type MemberProfile,
} from "@bpt-jersey/domain/members/profile";

import { requireUserActor } from "../auth/user-authorization.js";
import {
  createFirebaseLevelAuthorization,
  type LevelAuthorizationService,
} from "../levels/level-authorization.js";
import { requireCanonicalMemberDirectoryActor } from "./canonical-actor.js";
import {
  defaultMemberDirectoryCallableServices,
  mapMemberDirectoryError,
  memberDirectoryCallableOptions,
  type MemberDirectoryCallableServices,
} from "./member-directory-callables.js";
import { createMemberProfileFirestoreStore } from "./member-profile-firestore.js";
import {
  MemberProfileError,
  createMemberProfileService,
  type MemberProfileService,
} from "./member-profile-service.js";

export type MemberProfileCallableServices = Readonly<{
  directory: MemberDirectoryCallableServices;
  levelAuthorization: LevelAuthorizationService;
  profiles: MemberProfileService;
}>;

export type MemberNameSearchCallableServices = Readonly<{
  levelAuthorization: LevelAuthorizationService;
  profiles: MemberProfileService;
}>;

const officeRoles: ReadonlySet<string> = new Set(["owner", "administrator"]);
const matRoles: ReadonlySet<string> = new Set(["headCoach", "coach"]);

function mapProfileError(error: unknown): never {
  if (error instanceof MemberProfileError) {
    if (error.code === "invalid") {
      throw new HttpsError("invalid-argument", "Invalid member request");
    }
    throw new HttpsError("failed-precondition", "Member record is unavailable");
  }
  return mapMemberDirectoryError(error);
}

/**
 * T051V2 (grill G6): one record, trimmed by role on the server. Office reads everything through the
 * audited restricted read; the mat gets the header only; clients get nothing.
 */
export async function getMemberProfileHandler(
  request: CallableRequest<unknown>,
  services: MemberProfileCallableServices,
): Promise<MemberProfile> {
  const claimed = requireUserActor(request);

  if (officeRoles.has(claimed.role)) {
    const actor = await requireCanonicalMemberDirectoryActor(
      request,
      services.directory.isActorActive,
    );
    try {
      const now = services.directory.now();
      const record = await services.directory.reader.memberProfileRecord({
        actor,
        value: request.data,
        now,
      });
      return await services.profiles.fullProfile({ academyId: actor.academyId, record, now });
    } catch (error) {
      return mapProfileError(error);
    }
  }

  if (matRoles.has(claimed.role)) {
    // `requireActor` re-reads the Auth user and refuses unless its custom claims equal the token's,
    // so the verified role is the claimed one; a second role check here would be dead weight.
    const actor = await services.levelAuthorization.requireActor(request);
    const input = memberProfileRequestSchema.safeParse(request.data);
    if (!input.success) throw new HttpsError("invalid-argument", "Invalid member request");
    const student = await services.levelAuthorization.resolveStudent(actor, input.data.studentId);
    try {
      return services.profiles.coachProfile({ student, now: services.directory.now() });
    } catch (error) {
      return mapProfileError(error);
    }
  }

  throw new HttpsError("permission-denied", "Member record access is not permitted");
}

export async function searchMemberNamesHandler(
  request: CallableRequest<unknown>,
  services: MemberNameSearchCallableServices,
): Promise<MemberNameSearchResult> {
  const actor = await services.levelAuthorization.requireActor(request);
  if (!officeRoles.has(actor.role) && !matRoles.has(actor.role)) {
    throw new HttpsError("permission-denied", "Member search is not permitted");
  }
  try {
    return await services.profiles.searchNames({ academyId: actor.academyId, value: request.data });
  } catch (error) {
    return mapProfileError(error);
  }
}

function profileService(): MemberProfileService {
  return createMemberProfileService({ store: createMemberProfileFirestoreStore(getFirestore()) });
}

export const getMemberProfile = onCall(memberDirectoryCallableOptions, async (request) =>
  getMemberProfileHandler(request, {
    directory: defaultMemberDirectoryCallableServices(),
    levelAuthorization: createFirebaseLevelAuthorization(),
    profiles: profileService(),
  }),
);

/** Needs no directory secret: it reads names only, under the level authorization. */
export const searchMemberNames = onCall({ enforceAppCheck: true }, async (request) =>
  searchMemberNamesHandler(request, {
    levelAuthorization: createFirebaseLevelAuthorization(),
    profiles: profileService(),
  }),
);
