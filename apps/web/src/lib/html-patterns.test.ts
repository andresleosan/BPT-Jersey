import { readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const patterns: { source: string; location: string }[] = [];

// Discover attributes rather than maintaining a list that new inputs could bypass.
// Include packages so shared UI components receive the same check. Fail closed on
// expressions we cannot resolve: shared/dynamic sources need explicit coverage here.
for (const directory of ["apps/web", "packages"]) {
  const files = ts.sys.readDirectory(
    resolve(root, directory),
    [".ts", ".tsx", ".js", ".jsx"],
    [
      "**/node_modules/**",
      "**/.next/**",
      "**/dist/**",
      "**/out/**",
      "**/build/**",
      "**/coverage/**",
      "**/*.test.*",
      "**/*.d.ts",
    ],
  );
  for (const file of files) {
    const source = ts.createSourceFile(
      file,
      readFileSync(file, "utf8"),
      ts.ScriptTarget.Latest,
      true,
    );
    function visit(node: ts.Node): void {
      if (ts.isJsxAttribute(node) && node.name.getText(source) === "pattern") {
        const line = source.getLineAndCharacterOfPosition(node.getStart()).line + 1;
        const location = `${relative(root, file)}:${line}`;
        const value = node.initializer;
        const literal = value && ts.isJsxExpression(value) ? value.expression : value;
        if (!literal || !ts.isStringLiteralLike(literal)) {
          throw new Error(`Resolve and test the non-literal HTML pattern at ${location}`);
        }
        patterns.push({ source: literal.text, location });
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
}

describe("HTML pattern attributes", () => {
  it("discovers the app's pattern attributes", () => {
    expect(patterns.length).toBeGreaterThan(0);
  });

  it.each(patterns)("compiles $location in both u and v modes", ({ source }) => {
    for (const flag of ["u", "v"]) {
      expect(() => new RegExp(source, flag)).not.toThrow();
    }
  });

  it("preserves abbreviation acceptance before and after escaping the hyphen", () => {
    const before = new RegExp("^(?:[A-Za-z0-9_-]{2,12})$", "u");
    const abbreviations = patterns.filter(({ location }) =>
      location.includes("classes-services/locations/page.tsx:"),
    );
    expect(abbreviations).toHaveLength(2);
    const accepted = ["AB", "town", "A-Z", "_-", "a_9", "AZaz09_-AZaz"];
    const rejected = ["", "A", "A".repeat(13), "a b", "a.b", "éé", "中中", "a/b", "a\\b", "ab\n"];
    // Exercise every ASCII character and both length boundaries as well as named samples.
    const samples = [...accepted, ...rejected];
    for (let code = 0; code < 128; code++) {
      for (const length of [1, 2, 12, 13]) {
        samples.push(String.fromCharCode(code).repeat(length));
      }
    }
    for (const { source } of abbreviations) {
      for (const flag of ["u", "v"]) {
        const after = new RegExp(`^(?:${source})$`, flag);
        for (const sample of accepted) expect(after.test(sample), sample).toBe(true);
        for (const sample of rejected) expect(after.test(sample), sample).toBe(false);
        for (const sample of samples) {
          expect(after.test(sample), JSON.stringify(sample)).toBe(before.test(sample));
        }
      }
    }
  });
});
