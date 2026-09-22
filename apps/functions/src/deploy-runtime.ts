import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const domainImportReplacements: Readonly<Record<string, string>> = Object.freeze({
  "@bpt-jersey/domain/members/reconciliation": "../../domain/members/member-reconciliation-contracts.js",
  "@bpt-jersey/domain/members/membership-number": "../../domain/members/membership-number-contracts.js",
  "@bpt-jersey/domain/members/inventory": "../../domain/members/member-inventory-contracts.js",
  "@bpt-jersey/domain/members/history": "../../domain/members/member-history-contracts.js",
  "@bpt-jersey/domain/members/access": "../../domain/members/member-access-contracts.js",
  "@bpt-jersey/domain/courses": "../../domain/courses/index.js",
  "@bpt-jersey/domain/audit": "../../domain/audit/audit-event.js",
  "@bpt-jersey/domain/audit/class-history": "../../domain/audit/class-history-contracts.js",
  "@bpt-jersey/domain/consents": "../../domain/consents/consent-contracts.js",
  "@bpt-jersey/domain/consents/enrolment-waiver": "../../domain/consents/enrolment-waiver-terms.js",
  "@bpt-jersey/domain/crm": "../../domain/crm/crm-contracts.js",
  "@bpt-jersey/domain/payments": "../../domain/payments/payment-contracts.js",
  "@bpt-jersey/domain/members": "../../domain/members/member-contracts.js",
  "@bpt-jersey/domain/members/directory": "../../domain/members/member-directory-contracts.js",
  "@bpt-jersey/domain/members/migration": "../../domain/members/member-migration-contracts.js",
  "@bpt-jersey/domain/members/overview": "../../domain/members/member-overview-contracts.js",
  "@bpt-jersey/domain/members/directory-migration":
    "../../domain/members/member-directory-migration-contracts.js",
  "@bpt-jersey/domain/members/directory-operations":
    "../../domain/members/member-directory-operation-contracts.js",
  "@bpt-jersey/domain/members/directory-private-plan":
    "../../domain/members/member-directory-private-plan-contracts.js",
  "@bpt-jersey/domain/members/directory-transitions":
    "../../domain/members/member-directory-transitions.js",
  "@bpt-jersey/domain/members/enrolment-requests":
    "../../domain/members/enrolment-request-contracts.js",
  "@bpt-jersey/domain/members/recovery": "../../domain/members/member-recovery-contracts.js",
  "@bpt-jersey/domain/members/regyfit-records":
    "../../domain/members/regyfit-member-record-contracts.js",
  "@bpt-jersey/domain/members/engagement": "../../domain/members/member-engagement-contracts.js",
  "@bpt-jersey/domain/members/profile": "../../domain/members/member-profile-contracts.js",
  "@bpt-jersey/domain/memberships/lifecycle": "../../domain/memberships/membership-contracts.js",
  "@bpt-jersey/domain/memberships/intro-conversion": "../../domain/memberships/intro-conversion-contracts.js",
  "@bpt-jersey/domain/memberships/admin":
    "../../domain/memberships/subscription-admin-contracts.js",
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
  "@bpt-jersey/domain/schedule/groups": "../../domain/schedule/groups.js",
  "@bpt-jersey/domain/schedule": "../../domain/schedule/schedule-contracts.js",
  "@bpt-jersey/domain/schedule/member-calendar":
    "../../domain/schedule/member-calendar-contracts.js",
  "@bpt-jersey/domain/schedule/member-class-records":
    "../../domain/schedule/member-class-record-contracts.js",
  "@bpt-jersey/domain/schedule/self-check-in": "../../domain/schedule/self-check-in-contracts.js",
  "@bpt-jersey/domain/schedule/advanced-booking":
    "../../domain/schedule/advanced-booking-contracts.js",
  "@bpt-jersey/domain/schedule/classes-services":
    "../../domain/schedule/classes-services-contracts.js",
  "@bpt-jersey/domain/schedule/pre-class": "../../domain/schedule/pre-class-contracts.js",
  "@bpt-jersey/domain/announcements": "../../domain/announcements/announcement-contracts.js",
  "@bpt-jersey/domain/reminders": "../../domain/reminders/reminder-contracts.js",
  "@bpt-jersey/domain/retention": "../../domain/retention-contracts.js",
  "@bpt-jersey/domain/delivery": "../../domain/delivery/delivery-contracts.js",
  "@bpt-jersey/domain/delivery/notification-policy": "../../domain/delivery/notification-policy.js",
  "@bpt-jersey/domain/health": "../../domain/health/health-contracts.js",
  "@bpt-jersey/domain/documents": "../../domain/documents/document-contracts.js",
  "@bpt-jersey/domain/reports": "../../domain/reports/operational-report.js",
  "@bpt-jersey/domain/exports": "../../domain/exports/aggregate-report-export.js",
  "@bpt-jersey/domain/shop": "../../domain/shop/shop-contracts.js",
  "@bpt-jersey/domain/penalties": "../../domain/penalties/no-show-penalty-contracts.js",
  "@bpt-jersey/domain/birthdays": "../../domain/birthdays/upcoming-birthday-contracts.js",
  "@bpt-jersey/domain/consents/disclaimers": "../../domain/consents/disclaimer-contracts.js",
  "@bpt-jersey/domain/staff/team-access": "../../domain/staff/team-access-contracts.js",
  "@bpt-jersey/domain/staff/permission-grants": "../../domain/staff/permission-grant-contracts.js",
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
      prepared = prepared
        .replaceAll(`"${specifier}"`, `"${replacement}"`)
        .replaceAll(`'${specifier}'`, `'${replacement}'`);
    }
    if (
      /(?:from\s*|import\s*(?:\(\s*)?(?:[^"'()]*from\s*)?)["']@bpt-jersey\/domain(?:["'/])/u.test(
        prepared,
      )
    ) {
      throw new Error(`Unrewritten domain runtime import in ${outputPath}`);
    }
    await writeFile(outputPath, prepared, "utf8");
  }
}
