import { HttpsError } from "firebase-functions/v2/https";
import { describe, expect, it, vi } from "vitest";

import type { LevelAuthorizationService } from "./level-authorization";
import {
  createActivateLevelCatalogHandler,
  createCreateLevelCatalogDraftHandler,
  createGetLevelCatalogVersionHandler,
  createListLevelCatalogVersionsHandler,
  createPublishLevelCatalogDraftHandler,
  createSaveLevelCatalogDraftHandler,
} from "./level-editor-callables";
import { LevelEditorError, type LevelEditorService } from "./level-editor-service";

function request(data: unknown, role: string) {
  return { auth: { uid: "user-1", token: { academyId: "demo-academy", role } }, data } as never;
}

const authorization: LevelAuthorizationService = {
  requireActor: async (callable) => {
    const token = (callable as { auth: { uid: string; token: Record<string, string> } }).auth;
    return {
      kind: "user",
      userId: token.uid as never,
      academyId: token.token.academyId as never,
      role: token.token.role as never,
      staffId: token.token.role === "coach" || token.token.role === "headCoach" ? "staff-1" : null,
    };
  },
  resolveStudent: async () => {
    throw new Error("not used");
  },
};

const content = {
  systemId: "bpt-20260926-1",
  origin: "custom" as const,
  status: "draft" as const,
  displayName: "BPT 2026",
  levels: [],
  skills: [],
  requirements: [],
};

function fakeService(): LevelEditorService {
  return {
    listVersions: vi.fn(async () => ({ versions: [] })),
    getVersion: vi.fn(async () => content),
    createDraft: vi.fn(async () => content),
    saveDraft: vi.fn(async () => content),
    publishDraft: vi.fn(async () => ({ systemId: content.systemId, contentHash: "a".repeat(64) })),
    activate: vi.fn(async () => ({
      activeSystemId: content.systemId,
      previousSystemId: "ibjjf-v3",
      movedStudents: 0,
    })),
  };
}

const level = {
  definitionKey: "white",
  kind: "belt",
  parentDefinitionKey: null,
  name: "White belt",
  sequence: 1,
  stripeNumber: null,
  criteria: { minAge: 4, maxAge: null, minClasses: 0, minimumTime: null },
  visual: { colors: ["#FFFFFF"], stripeColor: "#111111", stripeCount: 0 },
};
const saveBody = {
  systemId: "bpt-20260926-1",
  displayName: "BPT 2026",
  levels: [level],
  skills: [],
  requirements: [],
};

const writeCases = [
  ["getLevelCatalogVersion", createGetLevelCatalogVersionHandler, { systemId: "bpt-20260926-1" }],
  ["createLevelCatalogDraft", createCreateLevelCatalogDraftHandler, { fromSystemId: "ibjjf-v3" }],
  ["saveLevelCatalogDraft", createSaveLevelCatalogDraftHandler, saveBody],
  [
    "publishLevelCatalogDraft",
    createPublishLevelCatalogDraftHandler,
    { systemId: "bpt-20260926-1" },
  ],
  ["activateLevelCatalog", createActivateLevelCatalogHandler, { systemId: "bpt-20260926-1" }],
] as const;

describe("belt catalogue editor callables", () => {
  for (const role of ["coach", "headCoach", "adultStudent"]) {
    for (const [name, factory, body] of writeCases) {
      it(`denies ${name} to ${role}`, async () => {
        const service = fakeService();
        await expect(
          factory({ service, authorization })(request(body, role)),
        ).rejects.toMatchObject({ code: "permission-denied" });
      });
    }
  }

  for (const role of ["owner", "administrator"]) {
    for (const [name, factory, body] of writeCases) {
      it(`allows ${name} to ${role}`, async () => {
        await expect(
          factory({ service: fakeService(), authorization })(request(body, role)),
        ).resolves.toBeDefined();
      });
    }
  }

  it("lets coaches and head coaches read the version list, but not members", async () => {
    for (const role of ["coach", "headCoach", "owner"]) {
      await expect(
        createListLevelCatalogVersionsHandler({ service: fakeService(), authorization })(
          request(undefined, role),
        ),
      ).resolves.toEqual({ versions: [] });
    }
    await expect(
      createListLevelCatalogVersionsHandler({ service: fakeService(), authorization })(
        request(undefined, "adultStudent"),
      ),
    ).rejects.toMatchObject({ code: "permission-denied" });
  });

  it("refuses to edit a code catalogue as a state conflict", async () => {
    const service = fakeService();
    await expect(
      createSaveLevelCatalogDraftHandler({ service, authorization })(
        request({ ...saveBody, systemId: "ibjjf-v3" }, "owner"),
      ),
    ).rejects.toMatchObject({ code: "failed-precondition" });
    expect(service.saveDraft).not.toHaveBeenCalled();
  });

  it("rejects an invalid colour before the service", async () => {
    const service = fakeService();
    await expect(
      createSaveLevelCatalogDraftHandler({ service, authorization })(
        request(
          { ...saveBody, levels: [{ ...level, visual: { ...level.visual, colors: ["red"] } }] },
          "owner",
        ),
      ),
    ).rejects.toMatchObject({ code: "invalid-argument" });
    expect(service.saveDraft).not.toHaveBeenCalled();
  });

  it("returns the missing keys and student counts when activation is refused", async () => {
    const service = fakeService();
    vi.mocked(service.activate).mockRejectedValue(
      new LevelEditorError("missing-levels", "Students hold levels this version removes.", [
        { definitionKey: "white-stripe-2", students: 2 },
      ]),
    );
    const refusal = await createActivateLevelCatalogHandler({ service, authorization })(
      request({ systemId: "bpt-20260926-1" }, "owner"),
    ).catch((error: unknown) => error);
    expect(refusal).toBeInstanceOf(HttpsError);
    expect(refusal).toMatchObject({
      code: "failed-precondition",
      details: {
        reason: "missing-levels",
        missing: [{ definitionKey: "white-stripe-2", students: 2 }],
      },
    });
  });

  it("maps a published-version conflict to failed-precondition", async () => {
    const service = fakeService();
    vi.mocked(service.saveDraft).mockRejectedValue(
      new LevelEditorError("conflict", "Only a draft version can be edited."),
    );
    await expect(
      createSaveLevelCatalogDraftHandler({ service, authorization })(request(saveBody, "owner")),
    ).rejects.toMatchObject({ code: "failed-precondition" });
  });
});
