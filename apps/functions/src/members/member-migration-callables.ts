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
