import { getFirestore } from "firebase-admin/firestore";
import { HttpsError, onCall, type CallableRequest } from "firebase-functions/v2/https";

import {
  saveLevelCatalogInputSchema,
  type EditableLevelCatalog,
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

type EditorDependencies = Readonly<{
  service: LevelEditorService;
  authorization: LevelAuthorizationService;
}>;

const editorRoles = new Set(["owner", "administrator"]);

async function requireEditor(
  dependencies: EditorDependencies,
  request: CallableRequest<unknown>,
): Promise<AuthorizedLevelActor> {
  const actor = await dependencies.authorization.requireActor(request);
  if (!editorRoles.has(actor.role)) {
    throw new HttpsError("permission-denied", "An administrator or owner is required");
  }
  return actor;
}

function mapEditorError(error: unknown): never {
  if (error instanceof HttpsError) throw error;
  if (error instanceof LevelEditorError) {
    if (error.code === "stale") {
      throw new HttpsError("aborted", "The belt catalogue changed since it was loaded");
    }
    if (error.code === "invalid") {
      throw new HttpsError("invalid-argument", "Belt catalogue request is invalid");
    }
    if (error.code === "not-found") {
      throw new HttpsError("not-found", "Belt catalogue is not available");
    }
    throw new HttpsError("failed-precondition", error.message);
  }
  throw new HttpsError("internal", "Unable to update the belt catalogue");
}

export function createGetEditableLevelCatalogHandler(dependencies: EditorDependencies) {
  return async (request: CallableRequest<unknown>): Promise<EditableLevelCatalog> => {
    const actor = await requireEditor(dependencies, request);
    if (request.data !== null && request.data !== undefined) {
      throw new HttpsError("invalid-argument", "Belt catalogue payload is invalid");
    }
    try {
      return await dependencies.service.getEditable(actor.academyId);
    } catch (error) {
      return mapEditorError(error);
    }
  };
}

export function createSaveLevelCatalogHandler(dependencies: EditorDependencies) {
  return async (request: CallableRequest<unknown>): Promise<EditableLevelCatalog> => {
    const actor = await requireEditor(dependencies, request);
    const parsed = saveLevelCatalogInputSchema.safeParse(request.data);
    if (!parsed.success) {
      throw new HttpsError("invalid-argument", "Belt catalogue payload is invalid");
    }
    try {
      return await dependencies.service.save({
        academyId: actor.academyId,
        catalog: parsed.data,
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

export const getEditableLevelCatalog = onCall(options, (request) =>
  createGetEditableLevelCatalogHandler(dependencies())(request),
);
export const saveLevelCatalog = onCall(options, (request) =>
  createSaveLevelCatalogHandler(dependencies())(request),
);
