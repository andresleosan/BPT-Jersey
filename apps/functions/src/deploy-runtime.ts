import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const domainImportReplacements: Readonly<Record<string, string>> = Object.freeze({
  "@bpt-jersey/domain/audit": "../../domain/audit/audit-event.js",
  "@bpt-jersey/domain/consents": "../../domain/consents/consent-contracts.js",
  "@bpt-jersey/domain/crm": "../../domain/crm/crm-contracts.js",
  "@bpt-jersey/domain/payments": "../../domain/payments/payment-contracts.js",
  "@bpt-jersey/domain/members": "../../domain/members/member-contracts.js",
  "@bpt-jersey/domain/memberships/lifecycle": "../../domain/memberships/membership-contracts.js",
  "@bpt-jersey/domain/memberships": "../../domain/memberships/plan-contracts.js",
  "@bpt-jersey/domain/profiles": "../../domain/profiles/profile-contracts.js",
  "@bpt-jersey/domain/auth/admin-contracts": "../../domain/auth/admin-contracts.js",
  "@bpt-jersey/domain/authorization/access-policy": "../../domain/authorization/access-policy.js",
  "@bpt-jersey/domain/migration/regyfit-access": "../../domain/migration/regyfit-access.js",
  "@bpt-jersey/domain/families": "../../domain/families/family-contracts.js",
  "@bpt-jersey/domain/finance/access": "../../domain/finance/financial-access.js",
  "@bpt-jersey/domain/finance": "../../domain/finance/finance-contracts.js",
  "@bpt-jersey/domain/finance/dashboard": "../../domain/finance/financial-dashboard.js",
  "@bpt-jersey/domain/staff": "../../domain/staff/staff-contracts.js",
  "@bpt-jersey/domain/levels": "../../domain/levels/level-contracts.js",
  "@bpt-jersey/domain/levels/achievements": "../../domain/levels/achievement-contracts.js",
  "@bpt-jersey/domain/levels/lesson-planning": "../../domain/levels/lesson-planning-contracts.js",
  "@bpt-jersey/domain/schedule": "../../domain/schedule/schedule-contracts.js",
  "@bpt-jersey/domain/schedule/advanced-booking":
    "../../domain/schedule/advanced-booking-contracts.js",
  "@bpt-jersey/domain/announcements": "../../domain/announcements/announcement-contracts.js",
  "@bpt-jersey/domain/reminders": "../../domain/reminders/reminder-contracts.js",
  "@bpt-jersey/domain/retention": "../../domain/retention-contracts.js",
  "@bpt-jersey/domain/delivery": "../../domain/delivery/delivery-contracts.js",
  "@bpt-jersey/domain/health": "../../domain/health/health-contracts.js",
  "@bpt-jersey/domain/documents": "../../domain/documents/document-contracts.js",
  "@bpt-jersey/domain/reports": "../../domain/reports/operational-report.js",
  "@bpt-jersey/domain/exports": "../../domain/exports/aggregate-report-export.js",
});

// `pnpm deploy --prod` first synchronizes the source workspace in production mode.
// The generated package manifest is pruned by prepare-deploy-runtime.mjs instead,
// so the source workspace keeps its development toolchain intact.
export const deployArtifactPnpmArguments = Object.freeze([
  "pnpm",
  "--filter",
  "@bpt-jersey/functions",
  "deploy",
  "--legacy",
  "--config.confirmModulesPurge=false",
] as const);

async function runtimeFiles(directory: string): Promise<readonly string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await runtimeFiles(path)));
    else if (entry.name.endsWith(".js")) files.push(path);
  }
  return files;
}

export async function rewriteDeployRuntimeImports(deploySourceRoot: string): Promise<void> {
  for (const outputPath of await runtimeFiles(deploySourceRoot)) {
    const source = await readFile(outputPath, "utf8");
    let prepared = source;
    for (const [specifier, replacement] of Object.entries(domainImportReplacements).sort(
      ([left], [right]) => right.length - left.length,
    )) {
      prepared = prepared.replaceAll(specifier, replacement);
    }
    if (/(?:from|import)\s*(?:[^"']*from\s*)?["']@bpt-jersey\/domain(?:["'/])/u.test(prepared)) {
      throw new Error(`Unrewritten domain runtime import in ${outputPath}`);
    }
    await writeFile(outputPath, prepared, "utf8");
  }
}
