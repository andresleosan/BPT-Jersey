import { getFirestore } from "firebase-admin/firestore";
import { HttpsError, onCall, type CallableRequest } from "firebase-functions/v2/https";

import {
  activateLevelCatalogInputSchema,
  createLevelCatalogDraftInputSchema,
  getLevelCatalogVersionInputSchema,
  isCustomLevelSystemId,
  publishLevelCatalogDraftInputSchema,
  saveLevelCatalogDraftInputSchema,
  type ActivateLevelCatalogResult,
  type LevelCatalogVersionContent,
  type ListLevelCatalogVersionsResult,
} from "@bpt-jersey/domain/levels/editor";

import {
  createFirebaseLevelAuthorization,
  type AuthorizedLevelActor,
  type LevelAuthorizationService,
} from "./level-authorization.js";
import {
  createLevelEditorService,
  LevelEditorError,
  type LevelEditorService,
} from "./level-editor-service.js";
import { LevelStoreError } from "./level-service.js";

type EditorDependencies = Readonly<{
  service: LevelEditorService;
  authorization: LevelAuthorizationService;
}>;

const editorRoles = new Set(["owner", "administrator"]);
const readerRoles = new Set(["owner", "administrator", "headCoach", "coach"]);

async function requireRole(
  dependencies: EditorDependencies,
  request: CallableRequest<unknown>,
  roles: ReadonlySet<string>,
): Promise<AuthorizedLevelActor> {
  const actor = await dependencies.authorization.requireActor(request);
  if (!roles.has(actor.role)) {
    throw new HttpsError("permission-denied", "An administrator or owner is required");
  }
  return actor;
}

function parse<T>(
  schema: { safeParse: (value: unknown) => { success: boolean; data?: T } },
  value: unknown,
): T {
  const result = schema.safeParse(value);
  if (!result.success)
    throw new HttpsError("invalid-argument", "Belt catalogue payload is invalid");
  return result.data as T;
}

function mapEditorError(error: unknown): never {
  if (error instanceof HttpsError) throw error;
  if (error instanceof LevelEditorError) {
    if (error.code === "missing-levels") {
      throw new HttpsError("failed-precondition", "Students hold levels this version removes", {
        reason: "missing-levels",
        missing: error.missing,
      });
    }
    if (error.code === "invalid") {
      throw new HttpsError("invalid-argument", "Belt catalogue request is invalid");
    }
    if (error.code === "not-found") {
      throw new HttpsError("not-found", "Belt catalogue version is not available");
    }
    throw new HttpsError("failed-precondition", error.message);
  }
  if (error instanceof LevelStoreError) {
    throw new HttpsError("failed-precondition", "Levels state conflicts");
  }
  throw new HttpsError("internal", "Unable to update the belt catalogue");
}

export function createListLevelCatalogVersionsHandler(dependencies: EditorDependencies) {
  return async (request: CallableRequest<unknown>): Promise<ListLevelCatalogVersionsResult> => {
    const actor = await requireRole(dependencies, request, readerRoles);
    if (request.data !== null && request.data !== undefined) {
      throw new HttpsError("invalid-argument", "Belt catalogue payload is invalid");
    }
    try {
      return await dependencies.service.listVersions(actor.academyId);
    } catch (error) {
      return mapEditorError(error);
    }
  };
}

export function createGetLevelCatalogVersionHandler(dependencies: EditorDependencies) {
  return async (request: CallableRequest<unknown>): Promise<LevelCatalogVersionContent> => {
    const actor = await requireRole(dependencies, request, editorRoles);
    const input = parse(getLevelCatalogVersionInputSchema, request.data);
    try {
      return await dependencies.service.getVersion(actor.academyId, input.systemId);
    } catch (error) {
      return mapEditorError(error);
    }
  };
}

export function createCreateLevelCatalogDraftHandler(dependencies: EditorDependencies) {
  return async (request: CallableRequest<unknown>): Promise<LevelCatalogVersionContent> => {
    const actor = await requireRole(dependencies, request, editorRoles);
    const input = parse(createLevelCatalogDraftInputSchema, request.data);
    try {
      return await dependencies.service.createDraft({
        academyId: actor.academyId,
        fromSystemId: input.fromSystemId,
        actorId: actor.userId,
      });
    } catch (error) {
      return mapEditorError(error);
    }
  };
}

export function createSaveLevelCatalogDraftHandler(dependencies: EditorDependencies) {
  return async (request: CallableRequest<unknown>): Promise<LevelCatalogVersionContent> => {
    const actor = await requireRole(dependencies, request, editorRoles);
    const data: unknown = request.data;
    const systemId =
      typeof data === "object" && data !== null ? (data as { systemId?: unknown }).systemId : null;
    // A code catalogue (ibjjf-*) is never editable: that is a state refusal, not a bad payload.
    if (typeof systemId === "string" && !isCustomLevelSystemId(systemId)) {
      throw new HttpsError("failed-precondition", "Only a draft version can be edited.");
    }
    const draft = parse(saveLevelCatalogDraftInputSchema, data);
    try {
      return await dependencies.service.saveDraft({
        academyId: actor.academyId,
        draft,
        actorId: actor.userId,
      });
    } catch (error) {
      return mapEditorError(error);
    }
  };
}

export function createPublishLevelCatalogDraftHandler(dependencies: EditorDependencies) {
  return async (
    request: CallableRequest<unknown>,
  ): Promise<{ systemId: string; contentHash: string }> => {
    const actor = await requireRole(dependencies, request, editorRoles);
    const input = parse(publishLevelCatalogDraftInputSchema, request.data);
    try {
      return await dependencies.service.publishDraft({
        academyId: actor.academyId,
        systemId: input.systemId,
        actorId: actor.userId,
      });
    } catch (error) {
      return mapEditorError(error);
    }
  };
}

export function createActivateLevelCatalogHandler(dependencies: EditorDependencies) {
  return async (request: CallableRequest<unknown>): Promise<ActivateLevelCatalogResult> => {
    const actor = await requireRole(dependencies, request, editorRoles);
    const input = parse(activateLevelCatalogInputSchema, request.data);
    try {
      return await dependencies.service.activate({
        academyId: actor.academyId,
        systemId: input.systemId,
        actorId: actor.userId,
      });
    } catch (error) {
      return mapEditorError(error);
    }
  };
}

let defaultDependencies: EditorDependencies | undefined;

function dependencies(): EditorDependencies {
  defaultDependencies ??= {
    service: createLevelEditorService({ firestore: getFirestore() as never }),
    authorization: createFirebaseLevelAuthorization(),
  };
  return defaultDependencies;
}

const options = { enforceAppCheck: true } as const;

export const listLevelCatalogVersions = onCall(options, (request) =>
  createListLevelCatalogVersionsHandler(dependencies())(request),
);
export const getLevelCatalogVersion = onCall(options, (request) =>
  createGetLevelCatalogVersionHandler(dependencies())(request),
);
export const createLevelCatalogDraft = onCall(options, (request) =>
  createCreateLevelCatalogDraftHandler(dependencies())(request),
);
export const saveLevelCatalogDraft = onCall(options, (request) =>
  createSaveLevelCatalogDraftHandler(dependencies())(request),
);
export const publishLevelCatalogDraft = onCall(options, (request) =>
  createPublishLevelCatalogDraftHandler(dependencies())(request),
);
export const activateLevelCatalog = onCall(options, (request) =>
  createActivateLevelCatalogHandler(dependencies())(request),
);
