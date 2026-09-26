import { beforeEach, describe, expect, it, vi } from "vitest";

const calls: { name: string; data: unknown }[] = [];
let result: unknown;
let failure: unknown = null;

vi.mock("firebase/functions", () => ({
  httpsCallable: (_functions: unknown, name: string) => async (data: unknown) => {
    calls.push({ name, data });
    if (failure) throw failure;
    return { data: result };
  },
}));
vi.mock("./firebase-client", () => ({ getFirebaseFunctions: () => ({}) }));

import {
  activateLevelCatalog,
  createLevelCatalogDraft,
  levelEditorSafeErrors,
  listLevelCatalogVersions,
  saveLevelCatalogDraft,
} from "./level-editor-client";

const content = {
  systemId: "bpt-20260926-1",
  origin: "custom",
  status: "draft",
  displayName: "BPT 2026",
  levels: [
    {
      definitionKey: "white",
      kind: "belt",
      parentDefinitionKey: null,
      name: "White belt",
      sequence: 1,
      stripeNumber: null,
      criteria: { minAge: 4, maxAge: null, minClasses: 0, minimumTime: null },
      visual: { colors: ["#FFFFFF"], stripeColor: "#111111", stripeCount: 0 },
    },
  ],
  skills: [],
  requirements: [],
};

beforeEach(() => {
  calls.length = 0;
  result = undefined;
  failure = null;
});

describe("level editor client", () => {
  it("lists versions through the callable and parses them", async () => {
    result = {
      versions: [
        {
          systemId: "ibjjf-v3",
          displayName: "JIU-JITSU - IBJJF",
          origin: "code",
          status: "published",
          active: true,
          publishedAt: null,
        },
      ],
    };
    await expect(listLevelCatalogVersions()).resolves.toEqual(result);
    expect(calls).toEqual([{ name: "listLevelCatalogVersions", data: null }]);
  });

  it("refuses a malformed response with a safe message", async () => {
    result = { versions: [{ systemId: "x" }] };
    await expect(listLevelCatalogVersions()).rejects.toThrow(levelEditorSafeErrors.list);
  });

  it("creates a draft from a version", async () => {
    result = content;
    await expect(createLevelCatalogDraft("ibjjf-v3")).resolves.toEqual(content);
    expect(calls[0]).toEqual({ name: "createLevelCatalogDraft", data: { fromSystemId: "ibjjf-v3" } });
  });

  it("never sends a draft with a colour that is not hex", async () => {
    const bad = {
      ...content,
      levels: [{ ...content.levels[0]!, visual: { colors: ["red"], stripeColor: null, stripeCount: 0 } }],
    };
    await expect(
      saveLevelCatalogDraft({
        systemId: bad.systemId,
        displayName: bad.displayName,
        levels: bad.levels as never,
        skills: [],
        requirements: [],
      }),
    ).rejects.toThrow(levelEditorSafeErrors.save);
    expect(calls).toEqual([]);
  });

  it("returns the missing levels when activation is refused", async () => {
    failure = Object.assign(new Error("Students hold levels this version removes"), {
      code: "functions/failed-precondition",
      details: { reason: "missing-levels", missing: [{ definitionKey: "white-stripe-2", students: 2 }] },
    });
    await expect(activateLevelCatalog("bpt-20260926-1")).resolves.toEqual({
      kind: "missing",
      missing: [{ definitionKey: "white-stripe-2", students: 2 }],
    });
  });

  it("hides a raw Firebase error behind a safe message", async () => {
    failure = Object.assign(new Error("internal stack trace"), { code: "functions/internal" });
    await expect(activateLevelCatalog("bpt-20260926-1")).rejects.toThrow(
      levelEditorSafeErrors.activate,
    );
  });
});
