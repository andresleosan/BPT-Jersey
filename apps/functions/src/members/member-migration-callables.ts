import {
  assignMemberGuardianInputSchema,
  setMemberDateOfBirthInputSchema,
} from "@bpt-jersey/domain/members/migration";
import { CanonicalMemberDirectoryError } from "./canonical-member-directory-service.js";
import { getFirestore } from "firebase-admin/firestore";
import { defineSecret } from "firebase-functions/params";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { browserAdminCallableOptions } from "../auth/callable-options.js";
import { requireCanonicalMemberDirectoryActor } from "./canonical-actor.js";
import type {
  CanonicalMemberDirectoryActor,
  OfficeMemberDirectoryService,
} from "./canonical-member-directory-service.js";
import { defaultMemberDirectoryCallableServices } from "./member-directory-callables.js";
import { createFirestoreMemberMigrationStore } from "./member-migration-firestore.js";
import {
  createMemberMigrationService,
  MemberMigrationInputError,
} from "./member-migration-service.js";

const secrets = [
  defineSecret("MEMBER_DIRECTORY_IDENTITY_KEY_SECRET"),
  defineSecret("MEMBER_DIRECTORY_MIGRATION_INTEGRITY_SECRET"),
  defineSecret("MEMBER_DIRECTORY_CURSOR_SECRET"),
];
type Service = Pick<ReturnType<typeof createMemberMigrationService>, "listQueue" | "decide">;

function requireOffice(actor: CanonicalMemberDirectoryActor): void {
  if (actor.role !== "owner" && actor.role !== "administrator") {
    throw new HttpsError("permission-denied", "Only the office can review the member migration.");
  }
}

export async function listMemberMigrationQueueHandler(
  actor: CanonicalMemberDirectoryActor,
  service: Service,
) {
  requireOffice(actor);
  return service.listQueue(actor);
}

export async function decideMemberMigrationHandler(
  actor: CanonicalMemberDirectoryActor,
  data: unknown,
  service: Service,
) {
  requireOffice(actor);
  try {
    return await service.decide(actor, data);
  } catch (error) {
    if (error instanceof MemberMigrationInputError) {
      throw new HttpsError("invalid-argument", "Check the decisions and try again.");
    }
    throw new HttpsError("internal", "The migration queue is unavailable. Try again.");
  }
}

function productionService() {
  const services = defaultMemberDirectoryCallableServices();
  return {
    services,
    migration: createMemberMigrationService({
      store: createFirestoreMemberMigrationStore(getFirestore()),
      writer: services.writer as OfficeMemberDirectoryService,
      now: () => new Date().toISOString(),
    }),
  };
}

export const listMemberMigrationQueue = onCall(
  { ...browserAdminCallableOptions, secrets },
  async (request) => {
    const { services, migration } = productionService();
    const actor = await requireCanonicalMemberDirectoryActor(request, services.isActorActive);
    try {
      return await listMemberMigrationQueueHandler(actor, migration);
    } catch (error) {
      if (error instanceof HttpsError) throw error;
      throw new HttpsError("internal", "The migration queue is unavailable. Try again.");
    }
  },
);

export const decideMemberMigration = onCall(
  { ...browserAdminCallableOptions, secrets },
  async (request) => {
    const { services, migration } = productionService();
    const actor = await requireCanonicalMemberDirectoryActor(request, services.isActorActive);
    return decideMemberMigrationHandler(actor, request.data, migration);
  },
);

export async function reviewMemberHandler(
  actor: CanonicalMemberDirectoryActor,
  data: unknown,
  kind: "assign-guardian" | "set-date-of-birth",
  writer: Pick<OfficeMemberDirectoryService, "reviewMember">,
  now: string,
) {
  requireOffice(actor);
  const schema =
    kind === "assign-guardian" ? assignMemberGuardianInputSchema : setMemberDateOfBirthInputSchema;
  const parsed = schema.safeParse(data);
  if (!parsed.success)
    throw new HttpsError("invalid-argument", "Check the review details and try again.");
  try {
    return await writer.reviewMember({ actor, value: { ...parsed.data, kind }, now });
  } catch (error) {
    if (error instanceof CanonicalMemberDirectoryError) {
      const code =
        error.code === "unauthorized"
          ? "permission-denied"
          : error.code === "invalid"
            ? "invalid-argument"
            : "failed-precondition";
      throw new HttpsError(code, "Could not save this review. Refresh the member and try again.");
    }
    throw new HttpsError("internal", "Could not save this review. Please try again.");
  }
}

export const assignMemberGuardian = onCall(
  { ...browserAdminCallableOptions, secrets },
  async (request) => {
    const services = defaultMemberDirectoryCallableServices();
    const actor = await requireCanonicalMemberDirectoryActor(request, services.isActorActive);
    return reviewMemberHandler(
      actor,
      request.data,
      "assign-guardian",
      services.writer as OfficeMemberDirectoryService,
      services.now(),
    );
  },
);

export const setMemberDateOfBirth = onCall(
  { ...browserAdminCallableOptions, secrets },
  async (request) => {
    const services = defaultMemberDirectoryCallableServices();
    const actor = await requireCanonicalMemberDirectoryActor(request, services.isActorActive);
    return reviewMemberHandler(
      actor,
      request.data,
      "set-date-of-birth",
      services.writer as OfficeMemberDirectoryService,
      services.now(),
    );
  },
);
