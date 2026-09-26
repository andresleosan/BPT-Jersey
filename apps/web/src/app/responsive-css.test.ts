import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const appDir = dirname(fileURLToPath(import.meta.url));

function cssFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return cssFiles(path);
    return entry.name.endsWith(".css") ? [path] : [];
  });
}

const sheets = cssFiles(appDir).map((path) => ({ path, css: readFileSync(path, "utf8") }));
const globalsCss = readFileSync(resolve(appDir, "globals.css"), "utf8");
const adminCss = readFileSync(resolve(appDir, "admin/admin.css"), "utf8");

describe("phone and tablet breakpoints", () => {
  it("sizes full-screen layouts with dynamic viewport units so iOS toolbars do not hide content", () => {
    for (const { path, css } of sheets) expect(css, path).not.toMatch(/\b100vh\b/u);
  });

  it("collapses grids below 48rem, never at the old 50rem cut", () => {
    for (const { path, css } of sheets) {
      expect(css, path).not.toMatch(/@media \((?:max|min)-width: 50rem\)/u);
    }
    expect(adminCss).not.toMatch(/@media \(max-width: 48rem\)/u);
  });

  it("gives the landing hero two compact columns on tablets and one column on phones", () => {
    expect(globalsCss).toMatch(
      /@media \(min-width: 48rem\) and \(max-width: 63\.99rem\) \{\s*\.hero \{[^}]*grid-template-columns: minmax\(0, 1fr\) minmax\(16rem, 0\.8fr\);/u,
    );
    expect(globalsCss).toMatch(
      /@media \(max-width: 47\.99rem\) \{\s*\.hero \{[^}]*grid-template-columns: 1fr;/u,
    );
  });

  it("drops the admin header actions below the title on tablets instead of squeezing it", () => {
    expect(adminCss).toMatch(
      /@media \(min-width: 48rem\) and \(max-width: 63\.99rem\) \{\s*\.admin-header \{\s*flex-wrap: wrap;/u,
    );
  });

  it("keeps every form control at 16px or more so iOS Safari does not zoom", () => {
    expect(globalsCss).toMatch(
      /input,\s*select,\s*textarea \{\s*font-size: max\(1rem, 16px\) !important;/u,
    );
  });

  it("keeps the admin sign-out button a 44px target at every width", () => {
    expect(adminCss).toMatch(/^\.admin-signout \{[^}]*min-height: 2\.75rem;/mu);
  });
});
