import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const webSource = fileURLToPath(new URL("../../apps/web/src/", import.meta.url));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(name) && !/\.(test|spec)\.tsx?$/.test(name) ? [path] : [];
  });
}

// Comments may explain where data came from; nobody sees them. `\b` also skips identifiers such as
// listRegyfitMemberRecords, which never reach the screen.
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("web copy never names the legacy system (2026-09-19 decision Q1)", () => {
  it("has no visible 'Regyfit' in apps/web/src", () => {
    const offenders = sourceFiles(webSource).flatMap((file) =>
      withoutComments(readFileSync(file, "utf8"))
        .split("\n")
        .filter((line) => /\bRegyfit\b/.test(line))
        .map((line) => `${relative(webSource, file)}: ${line.trim()}`),
    );
    expect(offenders).toEqual([]);
  });
});
