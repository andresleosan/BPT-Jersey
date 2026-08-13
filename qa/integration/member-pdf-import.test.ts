import { afterAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

import {
  executeMemberPdfImport,
  planMemberPdfImportRollback,
  sanitizeMemberPdfImportReceipt,
  type MemberPdfImportPlan,
} from "../../apps/functions/src/members/member-pdf-import-runner.js";
import {
  attachMemberImportPreviewSource,
  createFirestoreMemberStore,
  createMemberService,
} from "../../apps/functions/src/members/member-service.js";
import type { MemberReportKey } from "@bpt-jersey/domain";

const plan = {
  sourceRoot: "synthetic-source-root",
  target: "staging" as const,
  projectId: "bptjersey-f5a25" as const,
  academyId: "demo-academy" as const,
  runId: "emulator-run-1",
  capturedAt: "2026-08-12T12:00:00.000Z",
  reports: [
    "total",
    "active",
    "withNumber",
    "noNumber",
    "inactive",
    "regularized",
    "activeRegularized",
    "suspended",
  ].map((report) => ({
    report: report as MemberReportKey,
    declaredCount: 0,
    rows: [],
    sourceHash: "d".repeat(64),
  })),
  rows: [],
  sourceRows: 0,
  canonicalRows: 0,
  duplicates: 0,
  conflicts: 0,
  rowsWithoutMembershipNumber: 0,
  statusCounts: { active: 0, inactive: 0, suspended: 0 },
  sourceHash: "d".repeat(64),
  operationId: "member-pdf-import-" + "e".repeat(64),
} satisfies MemberPdfImportPlan;

const runId = `member-pdf-emulator-${process.pid}`;
const academyId = `demo-academy-${runId}`;
const app = initializeApp({ projectId: "demo-bpt-jersey" }, runId);
const firestore = getFirestore(app);
const service = createMemberService(createFirestoreMemberStore(firestore), {
  pageTokenSecret: "synthetic-member-pdf-emulator-page-secret",
});

function previewFor(
  rows: readonly { fullName: string; sourceReport: "total"; sourceRowNumber: number }[],
) {
  return attachMemberImportPreviewSource(
    {
      previewId: `123e4567-e89b-42d3-a456-${runId.slice(-12).padStart(12, "0")}`,
      expiresAt: "2026-08-12T13:00:00.000Z",
      sourceReports: [{ source: "member-pdf-import", report: "total", rowCount: rows.length }],
      additions: [],
      updates: [],
      duplicates: [],
      conflicts: [],
    },
    { rows, sourceHash: "f".repeat(64) },
  );
}

afterAll(async () => {
  const memberSnapshot = await firestore.collection(`academies/${academyId}/members`).get();
  const auditSnapshot = await firestore.collection(`academies/${academyId}/auditEvents`).get();
  const operationSnapshot = await firestore
    .collection(`academies/${academyId}/memberImportOperations`)
    .get();
  await Promise.all([
    ...memberSnapshot.docs.map((document) => document.ref.delete()),
    ...auditSnapshot.docs.map((document) => document.ref.delete()),
    ...operationSnapshot.docs.map((document) => document.ref.delete()),
  ]);
  await deleteApp(app);
});

describe("member PDF import emulator contract", () => {
  it("loads the compiled runner after building the domain runtime without source TypeScript", () => {
    const root = resolve(import.meta.dirname, "../..");
    const packageManager = "corepack";
    execFileSync(packageManager, ["pnpm", "--filter", "@bpt-jersey/domain", "build:runtime"], {
      cwd: root,
      stdio: "pipe",
      shell: process.platform === "win32",
    });
    execFileSync(packageManager, ["pnpm", "--filter", "@bpt-jersey/functions", "build"], {
      cwd: root,
      stdio: "pipe",
      shell: process.platform === "win32",
    });
    expect(() =>
      execFileSync(
        process.execPath,
        [
          "--input-type=module",
          "-e",
          'await import("./apps/functions/lib/src/members/member-pdf-import-runner.js")',
        ],
        { cwd: root, stdio: "pipe" },
      ),
    ).not.toThrow();
  });

  it("keeps dry-run bounded to metadata and performs no apply write", async () => {
    let applyCalls = 0;
    const receipt = sanitizeMemberPdfImportReceipt(plan, "2026-08-12T12:00:00.000Z");
    const result = await executeMemberPdfImport(
      {
        sourceRoot: plan.sourceRoot,
        target: plan.target,
        projectId: plan.projectId,
        academyId: plan.academyId,
        runId: plan.runId,
        importRunId: plan.runId,
        capturedAt: plan.capturedAt,
        mode: "dry-run",
        now: "2026-08-12T12:00:00.000Z",
      },
      {
        buildPlan: async () => plan,
        apply: async () => {
          applyCalls += 1;
          return { imported: 0, updated: 0, conflicts: 0 };
        },
      },
    );

    expect(result.receipt).toEqual(receipt);
    expect(applyCalls).toBe(0);
    expect(JSON.stringify(result)).not.toMatch(/sourceRoot|fullName|email|memberId/u);
  });

  it("selects only exact rollback scope and does not delete", async () => {
    const result = await planMemberPdfImportRollback(
      {
        target: "staging",
        projectId: "bptjersey-f5a25",
        academyId: "demo-academy",
        runId: "emulator-run-1",
      },
      {
        listMembers: async () => [
          { academyId: "demo-academy", source: "member-pdf-import", importRunId: "emulator-run-1" },
          { academyId: "demo-academy", source: "member-pdf-import", importRunId: "other" },
        ],
      },
    );

    expect(result.selectedCount).toBe(1);
  });

  it("plans rollback from the Firestore member adapter with exact scope", async () => {
    const collection = firestore.collection("academies/demo-academy/members");
    const matching = collection.doc("rollback-matching");
    const wrongSource = collection.doc("rollback-wrong-source");
    const wrongRun = collection.doc("rollback-wrong-run");
    const otherAcademy = firestore.doc("academies/other-academy/members/rollback-other-tenant");
    const base = {
      fullName: "Synthetic Rollback Member",
      paymentStatus: "unknown",
      gender: "unknown",
      membershipStatus: "active",
      createdAt: "2026-08-12T12:00:00.000Z",
      createdBy: "synthetic-import-operator",
      updatedAt: "2026-08-12T12:00:00.000Z",
      updatedBy: "synthetic-import-operator",
      schemaVersion: "1",
    } as const;
    await Promise.all([
      matching.set({
        ...base,
        memberId: matching.id,
        academyId: "demo-academy",
        source: "member-pdf-import",
        importRunId: "rollback-run",
      }),
      wrongSource.set({
        ...base,
        memberId: wrongSource.id,
        academyId: "demo-academy",
        source: "admin",
        importRunId: "rollback-run",
      }),
      wrongRun.set({
        ...base,
        memberId: wrongRun.id,
        academyId: "demo-academy",
        source: "member-pdf-import",
        importRunId: "other-run",
      }),
      otherAcademy.set({
        ...base,
        memberId: otherAcademy.id,
        academyId: "other-academy",
        source: "member-pdf-import",
        importRunId: "rollback-run",
      }),
    ]);
    try {
      const result = await planMemberPdfImportRollback(
        {
          target: "staging",
          projectId: "bptjersey-f5a25",
          academyId: "demo-academy",
          runId: "rollback-run",
        },
        {
          listMembers: async () => createFirestoreMemberStore(firestore).list("demo-academy", 20),
        },
      );
      expect(result.selectedCount).toBe(1);
    } finally {
      await Promise.all([
        matching.delete(),
        wrongSource.delete(),
        wrongRun.delete(),
        otherAcademy.delete(),
      ]);
    }
  });

  it("applies idempotently with one metadata-only audit and one tenant scope", async () => {
    const operationId = "member-pdf-import-emulator-operation";
    const preview = previewFor([
      { fullName: "Synthetic Emulator Member", sourceReport: "total", sourceRowNumber: 1 },
    ]);
    const input = {
      academyId,
      actorId: "synthetic-import-operator",
      preview,
      now: "2026-08-12T12:00:00.000Z",
      createId: () => "synthetic-emulator-member-1",
      operationId,
      importRunId: "emulator-run-1",
    };

    await expect(service.applyImportPreview(input)).resolves.toEqual({
      imported: 1,
      updated: 0,
      conflicts: 0,
    });
    await expect(service.applyImportPreview(input)).resolves.toEqual({
      imported: 1,
      updated: 0,
      conflicts: 0,
    });
    await expect(service.list(academyId)).resolves.toHaveLength(1);
    const imported = await firestore
      .doc(`academies/${academyId}/members/synthetic-emulator-member-1`)
      .get();
    expect(imported.data()).toEqual(
      expect.objectContaining({
        source: "member-pdf-import",
        importRunId: "emulator-run-1",
      }),
    );
    await expect(service.list("other-tenant")).resolves.toHaveLength(0);

    const audits = await firestore.collection(`academies/${academyId}/auditEvents`).get();
    expect(audits.docs).toHaveLength(1);
    expect(audits.docs[0]?.data()).toEqual(
      expect.objectContaining({
        academyId,
        correlationId: operationId,
        sourceHash: "f".repeat(64),
        reportKeys: ["total"],
      }),
    );
    expect(audits.docs[0]?.data()).not.toHaveProperty("fullName");
    expect(audits.docs[0]?.data()).not.toHaveProperty("memberId");
    expect(audits.docs[0]?.data()).not.toHaveProperty("sourceRoot");
  });

  it("rejects more than 400 bounded writes before Firestore mutation", async () => {
    const rows = Array.from({ length: 401 }, (_, index) => ({
      sourceReport: "total" as const,
      sourceRowNumber: index + 1,
      fullName: `Synthetic bounded member ${index + 1}`,
    }));

    await expect(
      service.applyImportPreview({
        academyId,
        actorId: "synthetic-import-operator",
        preview: previewFor(rows),
        now: "2026-08-12T12:00:00.000Z",
        createId: (() => {
          let index = 0;
          return () => `synthetic-bounded-member-${++index}`;
        })(),
        operationId: "member-pdf-import-bounded-operation",
      }),
    ).rejects.toMatchObject({ code: "resource-exhausted" });
    await expect(service.list(academyId)).resolves.toHaveLength(1);
  });
});
