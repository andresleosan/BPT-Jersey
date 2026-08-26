import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { getApps } from "firebase-admin/app";

import { rewriteDeployRuntimeImports } from "./deploy-runtime.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
  );
});

describe("deploy runtime import preparation", () => {
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
        'import "@bpt-jersey/domain/members";',
        'import "@bpt-jersey/domain/memberships";',
        'import "@bpt-jersey/domain/memberships/lifecycle";',
        'import "@bpt-jersey/domain/auth/admin-contracts";',
        'import "@bpt-jersey/domain/authorization/access-policy";',
        'import "@bpt-jersey/domain/migration/regyfit-access";',
        'import "@bpt-jersey/domain/families";',
        'import "@bpt-jersey/domain/consents";',
        'import "@bpt-jersey/domain/finance";',
        'import "@bpt-jersey/domain/finance/dashboard";',
        'import "@bpt-jersey/domain/staff";',
        'import "@bpt-jersey/domain/reports";',
        'import "@bpt-jersey/domain/exports";',
      ].join("\n"),
    );

    await rewriteDeployRuntimeImports(sourceRoot);

    const prepared = await readFile(outputPath, "utf8");
    expect(prepared).toContain("../../domain/audit/audit-event.js");
    expect(prepared).toContain("../../domain/members/member-contracts.js");
    expect(prepared).toContain("../../domain/memberships/plan-contracts.js");
    expect(prepared).toContain("../../domain/memberships/membership-contracts.js");
    expect(prepared).toContain("../../domain/auth/admin-contracts.js");
    expect(prepared).toContain("../../domain/authorization/access-policy.js");
    expect(prepared).toContain("../../domain/migration/regyfit-access.js");
    expect(prepared).toContain("../../domain/families/family-contracts.js");
    expect(prepared).toContain("../../domain/consents/consent-contracts.js");
    expect(prepared).toContain("../../domain/finance/finance-contracts.js");
    expect(prepared).toContain("../../domain/finance/financial-dashboard.js");
    expect(prepared).toContain("../../domain/staff/staff-contracts.js");
    expect(prepared).toContain("../../domain/reports/operational-report.js");
    expect(prepared).toContain("../../domain/exports/aggregate-report-export.js");
    expect(prepared).not.toMatch(/@bpt-jersey\/domain/u);
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
    const indexPath = join(deployRoot, "lib", "src", "index.js");
    const indexSource = await readFile(indexPath, "utf8");
    expect(indexSource).not.toMatch(/@bpt-jersey\/domain/u);
    const callableSource = await readFile(
      join(deployRoot, "lib", "src", "members", "member-callables.js"),
      "utf8",
    );
    expect(callableSource).toContain('defineSecret("MEMBER_PAGE_TOKEN_SECRET")');
    expect(callableSource).toContain("secrets: [memberPageTokenSecret]");
    const deployedFunctions = await import(pathToFileURL(indexPath).href);
    expect(deployedFunctions["getDailyOperationsDashboard"]).toBeTypeOf("function");
    expect(deployedFunctions["getFinancialDashboard"]).toBeTypeOf("function");
    expect(deployedFunctions["getOperationalReport"]).toBeTypeOf("function");
    expect(deployedFunctions["prepareAggregateReportExport"]).toBeTypeOf("function");
    expect(deployedFunctions["recordCheckout"]).toBeTypeOf("function");
    expect(getApps()).toHaveLength(1);
  }, 60_000);
});
