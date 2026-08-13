import { createRequire } from "node:module";
import { readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";

const requireFromFunctions = createRequire(
  new URL("../../apps/functions/package.json", import.meta.url),
);
const { getApps, initializeApp } = requireFromFunctions("firebase-admin/app");
const { getFirestore } = requireFromFunctions("firebase-admin/firestore");

const { attachMemberImportPreviewSource, createFirestoreMemberStore, createMemberService } =
  await import("../../apps/functions/lib/src/members/member-service.js");
const {
  buildMemberPdfImportPlan,
  runMemberPdfImportCli,
  serializeMemberPdfImportReceipt,
  validateFirebaseAdminProjectId,
  validateMemberPdfImportCliEnvironment,
} = await import("../../apps/functions/lib/src/members/member-pdf-import-runner.js");

validateMemberPdfImportCliEnvironment(process.env.FIRESTORE_EMULATOR_HOST);
async function readReceipt(path) {
  if (!path) throw new Error("A matching dry-run receipt is required");
  try {
    const parsed = JSON.parse(await readFile(path, "utf8"));
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new Error("Dry-run receipt is invalid");
    }
    return parsed;
  } catch {
    throw new Error("Dry-run receipt is unavailable or invalid");
  }
}

function createApplyServices() {
  return {
    buildPlan: buildMemberPdfImportPlan,
    apply: async (plan, importRunId) => {
      const projectId = plan.projectId;
      validateFirebaseAdminProjectId(projectId);
      const existingApp = getApps()[0];
      const app = existingApp ?? initializeApp({ projectId });
      if (app.options.projectId !== projectId) {
        throw new Error("Firebase Admin project is not allowed");
      }
      const service = createMemberService(createFirestoreMemberStore(getFirestore(app)), {
        pageTokenSecret: `${plan.operationId}:member-pdf-import-cli`,
      });
      const now = new Date().toISOString();
      const preview = attachMemberImportPreviewSource(
        {
          previewId: randomUUID(),
          expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
          sourceReports: plan.reports.map((report) => ({
            source: "member-pdf-import",
            report: report.report,
            rowCount: report.rows.length,
          })),
          additions: [],
          updates: [],
          duplicates: [],
          conflicts: [],
        },
        { rows: plan.rows, sourceHash: plan.sourceHash },
      );
      return service.applyImportPreview({
        academyId: plan.academyId,
        actorId: "member-pdf-import-cli",
        preview,
        now,
        createId: randomUUID,
        operationId: plan.operationId,
        importRunId,
      });
    },
  };
}

async function main() {
  const run = await runMemberPdfImportCli(process.argv.slice(2), createApplyServices(), {
    readReceipt,
    writeReceipt: async (path, content) =>
      writeFile(path, `${content}\n`, { encoding: "utf8", flag: "wx" }),
  });
  console.log(
    JSON.stringify({
      ...JSON.parse(serializeMemberPdfImportReceipt(run.result.receipt)),
      ...(run.result.result === undefined ? {} : { result: run.result.result }),
    }),
  );
}

main().catch(() => {
  console.error("Member PDF import failed");
  process.exitCode = 1;
});
