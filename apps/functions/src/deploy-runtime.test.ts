import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { getApps } from "firebase-admin/app";

import {
  deployArtifactPnpmArguments,
  domainImportReplacements,
  rewriteDeployRuntimeImports,
} from "./deploy-runtime.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
  );
});

describe("deploy runtime import preparation", () => {
  it("deploys into the artifact without switching the source workspace to production mode", () => {
    expect(deployArtifactPnpmArguments).toContain("deploy");
    expect(deployArtifactPnpmArguments).not.toContain("--prod");
  });

  /**
   * A new domain subpath reaches the deploy artifact as an unrewritten import and only fails when
   * the whole runtime is prepared. This asks the sources directly, so the missing map entry is named.
   */
  it("maps every domain subpath the Functions sources import at runtime", async () => {
    async function sourceFiles(directory: string): Promise<readonly string[]> {
      const entries = await readdir(directory, { withFileTypes: true });
      const files: string[] = [];
      for (const entry of entries) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) files.push(...(await sourceFiles(path)));
        else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) files.push(path);
      }
      return files;
    }

    const unmapped: string[] = [];
    for (const path of await sourceFiles(import.meta.dirname)) {
      const source = await readFile(path, "utf8");
      // Every shape that survives compilation: `import … from`, `export … from`, `import("…")`
      // and the side-effect `import "…"`.
      const statements = source.matchAll(
        /\b(?:import\s+([^"';]*?)from\s*|export\s+([^"';]*?)from\s*|import\s*\(\s*|import\s+)["'](@bpt-jersey\/domain[^"']*)["']/gu,
      );
      for (const [, importClause, exportClause, specifier] of statements) {
        const clause = importClause ?? exportClause;
        // Type-only imports are erased by the compiler, so they never reach the runtime artifact.
        if (clause?.trimStart().startsWith("type ") === true) continue;
        if (specifier !== undefined && !Object.hasOwn(domainImportReplacements, specifier)) {
          unmapped.push(`${specifier} (${path})`);
        }
      }
    }
    expect(unmapped).toEqual([]);
    expect(domainImportReplacements["@bpt-jersey/domain/members/profile"]).toBe(
      "../../domain/members/member-profile-contracts.js",
    );
  });

  it("rewrites domain subpaths in a temporary copied runtime and rejects leftovers", async () => {
    const root = await mkdtemp(join(tmpdir(), "bpt-member-runtime-"));
    temporaryDirectories.push(root);
    const sourceRoot = join(root, "lib", "src", "auth");
    await mkdir(join(root, "lib", "src", "auth"), { recursive: true });
    await mkdir(sourceRoot, { recursive: true });
    const outputPath = join(sourceRoot, "index.js");
    await writeFile(
      outputPath,
      [
        'import "@bpt-jersey/domain/audit";',
        'import "@bpt-jersey/domain/schedule";',
        'import { dateKeyInJersey } from "@bpt-jersey/domain/schedule/member-calendar";',
        "export { SELF_CHECK_IN_MAXIMUM_DISTANCE_METRES } from '@bpt-jersey/domain/schedule/self-check-in';",
        'import "@bpt-jersey/domain/members";',
        'import "@bpt-jersey/domain/members/directory";',
        'import "@bpt-jersey/domain/members/migration";',
        'import "@bpt-jersey/domain/members/directory-migration";',
        'import "@bpt-jersey/domain/members/directory-operations";',
        'import "@bpt-jersey/domain/members/directory-private-plan";',
        'import "@bpt-jersey/domain/members/directory-transitions";',
        'import "@bpt-jersey/domain/memberships";',
        'import "@bpt-jersey/domain/memberships/lifecycle";',
        'import "@bpt-jersey/domain/auth/admin-contracts";',
        'import "@bpt-jersey/domain/authorization/access-policy";',
        'import "@bpt-jersey/domain/migration/regyfit-access";',
        'import "@bpt-jersey/domain/families";',
        'import "@bpt-jersey/domain/consents";',
        'import "@bpt-jersey/domain/finance";',
        'import "@bpt-jersey/domain/finance/access";',
        'import "@bpt-jersey/domain/finance/dashboard";',
        'import "@bpt-jersey/domain/staff";',
        'import "@bpt-jersey/domain/reports";',
        'import "@bpt-jersey/domain/exports";',
      ].join("\n"),
    );

    await rewriteDeployRuntimeImports(sourceRoot);

    const prepared = await readFile(outputPath, "utf8");
    expect(prepared).toContain("../../domain/audit/audit-event.js");
    expect(prepared).toContain("../../domain/schedule/schedule-contracts.js");
    expect(prepared).toContain("../../domain/schedule/member-calendar-contracts.js");
    expect(prepared).toContain("../../domain/schedule/self-check-in-contracts.js");
    expect(prepared).toContain("../../domain/members/member-contracts.js");
    expect(prepared).toContain("../../domain/members/member-directory-contracts.js");
    expect(prepared).toContain("../../domain/members/member-migration-contracts.js");
    expect(prepared).toContain("../../domain/members/member-directory-migration-contracts.js");
    expect(prepared).toContain("../../domain/members/member-directory-operation-contracts.js");
    expect(prepared).toContain("../../domain/members/member-directory-private-plan-contracts.js");
    expect(prepared).toContain("../../domain/members/member-directory-transitions.js");
    expect(prepared).toContain("../../domain/memberships/plan-contracts.js");
    expect(prepared).toContain("../../domain/memberships/membership-contracts.js");
    expect(prepared).toContain("../../domain/auth/admin-contracts.js");
    expect(prepared).toContain("../../domain/authorization/access-policy.js");
    expect(prepared).toContain("../../domain/migration/regyfit-access.js");
    expect(prepared).toContain("../../domain/families/family-contracts.js");
    expect(prepared).toContain("../../domain/consents/consent-contracts.js");
    expect(prepared).toContain("../../domain/finance/finance-contracts.js");
    expect(prepared).toContain("../../domain/finance/financial-access.js");
    expect(prepared).toContain("../../domain/finance/financial-dashboard.js");
    expect(prepared).toContain("../../domain/staff/staff-contracts.js");
    expect(prepared).toContain("../../domain/reports/operational-report.js");
    expect(prepared).toContain("../../domain/exports/aggregate-report-export.js");
    expect(prepared).not.toMatch(/@bpt-jersey\/domain/u);
  });

  it("rejects unknown nested schedule imports instead of rewriting their prefix", async () => {
    const root = await mkdtemp(join(tmpdir(), "bpt-unknown-schedule-runtime-"));
    temporaryDirectories.push(root);
    const outputPath = join(root, "index.js");
    const unknownSpecifier = ["@bpt-jersey/domain/schedule", "not-a-real-module"].join("/");
    await writeFile(outputPath, `const unknownScheduleModule = import("${unknownSpecifier}");`);

    await expect(rewriteDeployRuntimeImports(root)).rejects.toThrow(
      `Unrewritten domain runtime import in ${outputPath}`,
    );
  });

  it("prepares a copied Functions and domain runtime layout without workspace imports", async () => {
    const repositoryRoot = join(import.meta.dirname, "..", "..", "..");
    const packageManager = "corepack";
    execFileSync(packageManager, ["pnpm", "--filter", "@bpt-jersey/domain", "build:runtime"], {
      cwd: repositoryRoot,
      stdio: "pipe",
      shell: process.platform === "win32",
    });
    execFileSync(packageManager, ["pnpm", "--filter", "@bpt-jersey/functions", "build"], {
      cwd: repositoryRoot,
      stdio: "pipe",
      shell: process.platform === "win32",
    });
    const root = await mkdtemp(join(tmpdir(), "bpt-deploy-layout-"));
    temporaryDirectories.push(root);
    const deployRoot = join(root, "functions");
    const domainRoot = join(deployRoot, "lib", "domain");
    await mkdir(deployRoot, { recursive: true });
    await cp(
      join(repositoryRoot, "apps", "functions", "node_modules"),
      join(deployRoot, "node_modules"),
      { recursive: true },
    );
    await cp(
      join(repositoryRoot, "packages", "domain", "lib"),
      join(root, "packages", "domain", "lib"),
      { recursive: true },
    );
    await cp(join(import.meta.dirname, "..", "..", "..", "packages", "domain", "lib"), domainRoot, {
      recursive: true,
    });
    await cp(join(import.meta.dirname, "..", "lib"), join(deployRoot, "lib"), {
      recursive: true,
    });
    await expect(
      readFile(join(domainRoot, "members", "member-directory-migration-contracts.js"), "utf8"),
    ).resolves.toContain("memberDirectoryChunkReceiptSchema");
    await expect(
      readFile(join(domainRoot, "members", "member-directory-operation-contracts.js"), "utf8"),
    ).resolves.toContain("memberDirectoryOperationDocumentSchema");
    await expect(
      readFile(join(domainRoot, "members", "member-directory-private-plan-contracts.js"), "utf8"),
    ).resolves.toContain("memberDirectoryPrivateOutputPlanSchema");
    await expect(
      readFile(join(domainRoot, "members", "member-directory-transitions.js"), "utf8"),
    ).resolves.toContain("planMemberDirectoryChunkCommit");

    await writeFile(
      join(deployRoot, "package.json"),
      await readFile(join(repositoryRoot, "apps", "functions", "package.json"), "utf8"),
    );
    // The runtime preparation script is intentionally a JavaScript deploy artifact.
    // @ts-expect-error The script has no generated TypeScript declaration.
    const prepareDeployRuntime = (await import("../scripts/prepare-deploy-runtime.mjs"))
      .prepareDeployRuntime as (input: { repositoryRoot: URL; deployRoot: URL }) => Promise<void>;
    const temporaryRepositoryRoot = pathToFileURL(`${root}/`);
    const temporaryDeployRoot = pathToFileURL(`${deployRoot}/`);
    await prepareDeployRuntime({
      repositoryRoot: temporaryRepositoryRoot,
      deployRoot: temporaryDeployRoot,
    });
    expect(await readFile(join(deployRoot, "pnpm-workspace.yaml"), "utf8")).toBe(
      'packages:\n  - "."\n',
    );
    const indexPath = join(deployRoot, "lib", "src", "index.js");
    const indexSource = await readFile(indexPath, "utf8");
    expect(indexSource).not.toMatch(/@bpt-jersey\/domain/u);
    const callableSource = await readFile(
      join(deployRoot, "lib", "src", "members", "member-directory-callables.js"),
      "utf8",
    );
    expect(callableSource).toContain('defineSecret("MEMBER_DIRECTORY_IDENTITY_KEY_SECRET")');
    expect(callableSource).toContain('defineSecret("MEMBER_DIRECTORY_MIGRATION_INTEGRITY_SECRET")');
    expect(callableSource).toContain('defineSecret("MEMBER_DIRECTORY_CURSOR_SECRET")');
    await expect(
      readFile(join(domainRoot, "members", "member-recovery-contracts.js"), "utf8"),
    ).resolves.toContain("completeMemberRecoveryResultSchema");
    const deployedFunctions = await import(pathToFileURL(indexPath).href);
    expect(deployedFunctions["beginMemberRecovery"]).toBeTypeOf("function");
    expect(deployedFunctions["completeMemberRecovery"]).toBeTypeOf("function");
    expect(deployedFunctions["reviewMemberRecovery"]).toBeTypeOf("function");
    expect(deployedFunctions["createMember"]).toBeTypeOf("function");
    expect(deployedFunctions["listMembers"]).toBeTypeOf("function");
    expect(deployedFunctions["getMemberDetail"]).toBeTypeOf("function");
    expect(deployedFunctions["lookupMemberIdentity"]).toBeTypeOf("function");
    expect(deployedFunctions["searchMembers"]).toBeUndefined();
    expect(deployedFunctions["getMemberReport"]).toBeUndefined();
    expect(deployedFunctions["getMemberReportPdf"]).toBeUndefined();
    expect(deployedFunctions["getMemberReportSummary"]).toBeUndefined();
    expect(deployedFunctions["createMemberPdfImportSession"]).toBeTypeOf("function");
    expect(deployedFunctions["previewMemberPdfImport"]).toBeTypeOf("function");
    expect(deployedFunctions["confirmMemberPdfImport"]).toBeTypeOf("function");
    expect(deployedFunctions["getDailyOperationsDashboard"]).toBeTypeOf("function");
    expect(deployedFunctions["getFinancialDashboard"]).toBeTypeOf("function");
    expect(deployedFunctions["getOperationalReport"]).toBeTypeOf("function");
    expect(deployedFunctions["prepareAggregateReportExport"]).toBeTypeOf("function");
    expect(deployedFunctions["recordCheckout"]).toBeTypeOf("function");
    expect(deployedFunctions["listClassHistory"]).toBeTypeOf("function");
    expect(deployedFunctions["exportClassHistoryPdf"]).toBeTypeOf("function");
    expect(getApps()).toHaveLength(1);
  }, 60_000);
});
