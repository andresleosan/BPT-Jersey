import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { hotFunctions, warmHotFunctions } from "./keep-hot-functions-warm.js";

describe("keepHotFunctionsWarm", () => {
  it("sends one credential-less preflight per function and tolerates failures", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      if (url.endsWith("/listSessions")) throw new Error("offline");
      return new Response(null, { status: 204 });
    }) as unknown as typeof fetch;

    const results = await warmHotFunctions(fetchImpl, "bptjersey-f5a25");

    expect(calls.map((call) => call.url)).toEqual(
      hotFunctions.map((name) => `https://europe-west9-bptjersey-f5a25.cloudfunctions.net/${name}`),
    );
    for (const { init } of calls) {
      expect(init.method).toBe("OPTIONS");
      const headers = Object.keys(init.headers as Record<string, string>).map((key) =>
        key.toLowerCase(),
      );
      expect(headers).not.toContain("authorization");
      expect(headers).not.toContain("x-firebase-appcheck");
    }
    expect(results.find((result) => result.name === "listSessions")?.status).toBe(0);
    expect(results.filter((result) => result.status === 204)).toHaveLength(hotFunctions.length - 1);
  });

  it("does nothing without a project, so no deploy elsewhere can ping production", async () => {
    let called = false;
    const fetchImpl = (async () => {
      called = true;
      return new Response(null, { status: 204 });
    }) as unknown as typeof fetch;
    expect(await warmHotFunctions(fetchImpl, undefined)).toEqual([]);
    expect(called).toBe(false);
  });

  it("names only functions that index.ts exports, so a rename cannot go unnoticed", async () => {
    const index = await readFile(new URL("../index.ts", import.meta.url), "utf8");
    const starSources = await Promise.all(
      [...index.matchAll(/export \* from "\.\/(.+?)\.js";/g)].map((match) =>
        readFile(new URL(`../${match[1]}.ts`, import.meta.url), "utf8"),
      ),
    );
    const exported = (name: string) =>
      new RegExp(`\\b${name}\\b`).test(index) ||
      starSources.some((source) => new RegExp(`export const ${name}\\b`).test(source));

    expect(hotFunctions.filter((name) => !exported(name))).toEqual([]);
  });
});
