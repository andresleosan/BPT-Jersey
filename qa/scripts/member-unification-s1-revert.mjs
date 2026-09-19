// Emergency S1 rollback; dry run by default, counts only.
// Build first: corepack pnpm --filter @bpt-jersey/domain build:runtime
// usage:
//   S1_ACADEMY_ID=<academyId> S1_TARGET=emulator|production \
//   node qa/scripts/member-unification-s1-revert.mjs
// Apply: add S1_REVERT_APPLY=yes. Emulator requires a loopback FIRESTORE_EMULATOR_HOST.
// Production requires GCLOUD_PROJECT=bptjersey-f5a25, no emulator host and, to apply,
//   MEMBER_UNIFICATION_CONFIRMATION=member-unification-s1-revert-v1
// Production execution is reserved for the operator after explicit authorization.
// Never touches members, regyfitMemberRecords, auditEvents or memberDirectoryStates.
// Known limitation (spec "Vuelta atrás"): rollbackEligibleStudentCount does not decrease.
// Its signed integrity chain is advanced only by canonical registration. With a limit of
// 400, reverting about 245 registrations leaves room for about 155 more. A second full
// migration needs a control-plane transition outside S1. This is not a migration reset.

import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { MEMBER_MIGRATION_ID } from "../../packages/domain/lib/members/member-migration-contracts.js";
import { resolveTarget as resolveReportTarget } from "./member-unification-s1-report.mjs";

export const revertConfirmation = "member-unification-s1-revert-v1";

export function resolveTarget(env) {
  const resolved = resolveReportTarget(env);
  const apply = env.S1_REVERT_APPLY === "yes";
  if (
    resolved.target === "production" &&
    apply &&
    env.MEMBER_UNIFICATION_CONFIRMATION !== revertConfirmation
  ) {
    throw new Error("Applying in production requires the operator confirmation value");
  }
  return { ...resolved, apply };
}

export function revertPlan({ decisions, identityKeys, officeLinks }) {
  const paths = new Set();
  const add = (collection, id) => {
    if (typeof id !== "string" || !id || id.includes("/") || id === "." || id === "..") {
      throw new Error("Invalid rollback document segment");
    }
    paths.add(`${collection}/${id}`);
  };
  for (const decision of decisions) {
    if (decision.migrationId !== MEMBER_MIGRATION_ID) continue;
    if (decision.studentId) {
      const studentId = decision.studentId;
      add("students", studentId);
      add("studentAdminProfiles", studentId);
      add("families", `office-${studentId}`);
      for (const key of identityKeys) {
        if (key.ownerStudentId === studentId) add("studentIdentityKeys", key.id);
      }
      for (const link of officeLinks) {
        if (link.studentId === studentId) add("regyfitOfficeLinks", link.id);
      }
    }
    add("memberMigrationDecisions", decision.id);
  }
  return [...paths];
}

export async function runRevert(firestore, root, apply) {
  const loadPlan = async () => {
    const [decisions, identityKeys, officeLinks] = await Promise.all(
      ["memberMigrationDecisions", "studentIdentityKeys", "regyfitOfficeLinks"].map(
        async (name) => {
          const snapshot = await firestore.collection(`${root}/${name}`).get();
          return snapshot.docs.map((document) => ({ ...document.data(), id: document.id }));
        },
      ),
    );
    return revertPlan({ decisions, identityKeys, officeLinks });
  };
  const printCounts = (paths, prefix = "") => {
    for (const name of [
      "students",
      "studentAdminProfiles",
      "families",
      "studentIdentityKeys",
      "regyfitOfficeLinks",
      "memberMigrationDecisions",
    ]) {
      const label = prefix ? `${prefix}${name[0].toUpperCase()}${name.slice(1)}` : name;
      console.log(`${label}: ${paths.filter((path) => path.startsWith(`${name}/`)).length}`);
    }
  };
  const plan = await loadPlan();
  printCounts(plan);
  if (!apply) return;
  // Keep decision journals until all owned documents are deleted, so a failed batch can be retried.
  const paths = [
    ...plan.filter((path) => !path.startsWith("memberMigrationDecisions/")),
    ...plan.filter((path) => path.startsWith("memberMigrationDecisions/")),
  ];
  for (let index = 0; index < paths.length; index += 400) {
    const batch = firestore.batch();
    for (const path of paths.slice(index, index + 400))
      batch.delete(firestore.doc(`${root}/${path}`));
    await batch.commit();
  }
  printCounts(await loadPlan(), "remaining");
}

async function main() {
  const academyId = process.env.S1_ACADEMY_ID?.trim();
  if (!academyId || academyId.includes("/")) throw new Error("Invalid S1_ACADEMY_ID");
  const { projectId, apply } = resolveTarget(process.env);
  const requireFromFunctions = createRequire(
    new URL("../../apps/functions/package.json", import.meta.url),
  );
  const { initializeApp } = requireFromFunctions("firebase-admin/app");
  const { getFirestore } = requireFromFunctions("firebase-admin/firestore");
  const firestore = getFirestore(initializeApp({ projectId }));
  await runRevert(firestore, `academies/${academyId}`, apply);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {
    // Never echo SDK errors: they may contain document paths or personal data.
    console.error("errors: 1");
    process.exitCode = 1;
  });
}
