import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  buildMemberPdfImportPlan,
  compareMemberPdfFileNames,
  discoverMemberPdfFiles,
  executeMemberPdfImport,
  MAX_MEMBER_PDF_BYTES,
  parseMemberPdfImportReport,
  parseMemberPdfImportCliArguments,
  planMemberPdfImportRollback,
  runMemberPdfImportCli,
  serializeMemberPdfImportReceipt,
  sanitizeMemberPdfImportReceipt,
  stableMemberPdfImportOperationId,
  validateMemberPdfImportCliEnvironment,
  validateMemberPdfImportFileSize,
  validateMemberPdfImportReportSet,
  validateMemberPdfImportTarget,
  validateFirebaseAdminProjectId,
} from "./member-pdf-import-runner.js";
import type { MemberPdfImportPlan, MemberPdfImportReceipt } from "./member-pdf-import-runner.js";
import type { ParsedMemberReport } from "./member-pdf-import.js";
import type { MemberReportKey } from "@bpt-jersey/domain";

const approvedTarget = {
  target: "staging" as const,
  projectId: "bptjersey-f5a25",
  academyId: "demo-academy",
};
const syntheticPlan = {
  sourceRoot: "synthetic-source-root",
  target: "staging" as const,
  projectId: "bptjersey-f5a25" as const,
  academyId: "demo-academy" as const,
  runId: "synthetic-run-1",
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
    sourceHash: "a".repeat(64),
  })),
  rows: [],
  sourceRows: 0,
  canonicalRows: 0,
  duplicates: 0,
  conflicts: 0,
  rowsWithoutMembershipNumber: 0,
  statusCounts: { active: 0, inactive: 0, suspended: 0 },
  sourceHash: "a".repeat(64),
  operationId: "member-pdf-import-" + "b".repeat(64),
} satisfies MemberPdfImportPlan;

const syntheticReceipt = sanitizeMemberPdfImportReceipt(syntheticPlan, "2026-08-12T12:00:00.000Z");

function executionInput(overrides: Partial<Parameters<typeof executeMemberPdfImport>[0]> = {}) {
  return {
    sourceRoot: syntheticPlan.sourceRoot,
    target: syntheticPlan.target,
    projectId: syntheticPlan.projectId,
    academyId: syntheticPlan.academyId,
    runId: syntheticPlan.runId,
    capturedAt: syntheticPlan.capturedAt,
    importRunId: syntheticPlan.runId,
    mode: "dry-run" as const,
    now: "2026-08-12T12:00:00.000Z",
    ...overrides,
  };
}

function fakeExecutionServices(applyCalls: { count: number }) {
  return {
    buildPlan: async () => syntheticPlan,
    apply: async () => {
      applyCalls.count += 1;
      return { imported: 0, updated: 0, conflicts: 0 };
    },
  };
}

const syntheticReportDefinitions = [
  { fileName: "01-total.pdf", report: "total", ids: range(1, 243) },
  { fileName: "02-active.pdf", report: "active", ids: range(1, 114) },
  { fileName: "03-with-number.pdf", report: "withNumber", ids: range(1, 147) },
  { fileName: "04-no-number.pdf", report: "noNumber", ids: range(148, 243) },
  { fileName: "05-inactive.pdf", report: "inactive", ids: range(115, 242) },
  { fileName: "06-regularized.pdf", report: "regularized", ids: range(1, 68) },
  { fileName: "07-active-regularized.pdf", report: "activeRegularized", ids: [] },
  { fileName: "08-suspended.pdf", report: "suspended", ids: [243] },
] as const;

const reportTitles = {
  total: "TOTAL MEMBERS IN DATABASE",
  active: "ACTIVE MEMBERS IN DATABASE",
  withNumber: "MEMBERS WITH MEMBER NUMBER IN DATABASE",
  noNumber: "MEMBERS WITHOUT MEMBER NUMBER IN DATABASE",
  inactive: "INACTIVE MEMBERS IN DATABASE",
  regularized: "REGULARIZED MEMBERS IN DATABASE",
  activeRegularized: "ACTIVE REGULARIZED MEMBERS IN DATABASE",
  suspended: "SUSPENDED MEMBERS IN DATABASE",
} as const;

const syntheticHeader = "Member Nº | Name | ID Card Nº | Birthdate | VAT Number | Mobile nº";
const syntheticInactiveHeader = `${syntheticHeader} | Data inativo`;
const syntheticFooter = "Document produced by www.regyfit.com on 11-08-2026 at 10:30 Page 1/1";
const temporaryRoots: string[] = [];

function range(start: number, end: number): number[] {
  return Array.from({ length: end - start + 1 }, (_, index) => start + index);
}

function syntheticReportText(report: keyof typeof reportTitles, ids: readonly number[]): string {
  const inactive = report === "inactive";
  const rows = ids.map((id) => {
    const membershipNumber = id >= 148 ? "" : `M-${String(id).padStart(3, "0")}`;
    const inactiveAt = inactive ? " | 02 Feb 2025" : "";
    return `${membershipNumber} | Synthetic Member ${id} | ID-${id} | 01 Jan 2000 | VAT-${id} | +4470000000${inactiveAt}`;
  });
  return [
    `${reportTitles[report]} (${ids.length})`,
    inactive ? syntheticInactiveHeader : syntheticHeader,
    ...rows,
    syntheticFooter,
  ].join("\n");
}

async function createSyntheticPdfSource(): Promise<{
  root: string;
  texts: ReadonlyMap<string, string>;
}> {
  const root = await mkdtemp(join(tmpdir(), "member-pdf-runner-"));
  temporaryRoots.push(root);
  const texts = new Map<string, string>();
  for (const definition of syntheticReportDefinitions) {
    const filePath = join(root, definition.fileName);
    await writeFile(filePath, "synthetic PDF placeholder");
    texts.set(filePath, syntheticReportText(definition.report, definition.ids));
  }
  return { root, texts };
}

describe("member PDF import runner", () => {
  afterEach(async () => {
    await Promise.all(
      temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
    );
  });

  it("discovers the eight approved regular PDFs in deterministic order", async () => {
    const { root } = await createSyntheticPdfSource();
    const files = await discoverMemberPdfFiles(root);

    expect(files).toHaveLength(8);
    expect(files).toEqual([...files].sort(compareMemberPdfFileNames));
    expect(files.every((file) => file.toLocaleLowerCase().endsWith(".pdf"))).toBe(true);
  });

  it("orders filenames by stable code-point comparison instead of locale", () => {
    expect(["á.pdf", "z.pdf", "a.pdf", "B.pdf"].sort(compareMemberPdfFileNames)).toEqual([
      "B.pdf",
      "a.pdf",
      "z.pdf",
      "á.pdf",
    ]);
  });

  it("rejects every target except the allowlisted staging project and academy", () => {
    expect(() =>
      validateMemberPdfImportTarget({
        target: "production",
        projectId: approvedTarget.projectId,
        academyId: approvedTarget.academyId,
      }),
    ).toThrow("Member PDF import target is not allowed");
    expect(() =>
      validateMemberPdfImportTarget({
        ...approvedTarget,
        target: "emulator",
      }),
    ).toThrow("Member PDF import target is not allowed");
    expect(() =>
      validateMemberPdfImportTarget({
        ...approvedTarget,
        projectId: "unknown-project",
      }),
    ).toThrow("Member PDF import target is not allowed");
    expect(() =>
      validateMemberPdfImportTarget({
        ...approvedTarget,
        academyId: "unknown-academy",
      }),
    ).toThrow("Member PDF import target is not allowed");
  });

  it("rejects a report set that is not exactly the eight approved keys", () => {
    const report = (key: ParsedMemberReport["report"]): ParsedMemberReport => ({
      report: key,
      declaredCount: 0,
      rows: [],
      sourceHash: key,
    });

    expect(() => validateMemberPdfImportReportSet([report("total"), report("active")])).toThrow(
      "Member PDF import report set is not approved",
    );
    expect(() =>
      validateMemberPdfImportReportSet([
        report("total"),
        report("active"),
        report("withNumber"),
        report("noNumber"),
        report("inactive"),
        report("regularized"),
        report("activeRegularized"),
        report("activeRegularized"),
      ]),
    ).toThrow("Member PDF import report set is not approved");
  });

  it("rejects oversized PDFs before parsing and bounds parsed report rows", () => {
    expect(() => validateMemberPdfImportFileSize(MAX_MEMBER_PDF_BYTES + 1)).toThrow(
      "Member PDF import PDF is too large",
    );
    expect(() => parseMemberPdfImportReport("TOTAL MEMBERS IN DATABASE (2)", 1)).toThrow(
      /row limit/i,
    );
  });

  it("builds the approved eight-report plan with safe aggregate metadata", async () => {
    const { root, texts } = await createSyntheticPdfSource();
    const plan = await buildMemberPdfImportPlan({
      sourceRoot: root,
      ...approvedTarget,
      runId: "member-pdf-20260812-01",
      capturedAt: "2026-08-12T12:00:00.000Z",
      extractText: async (filePath) => {
        const text = texts.get(filePath);
        if (text === undefined) throw new Error(`Missing synthetic report: ${basename(filePath)}`);
        return text;
      },
    });

    expect(plan.reports).toHaveLength(8);
    expect(plan.sourceRows).toBe(797);
    expect(plan.canonicalRows).toBe(243);
    expect(plan.duplicates).toBe(554);
    expect(plan.conflicts).toBe(0);
    expect(plan.rowsWithoutMembershipNumber).toBe(96);
    expect(plan.statusCounts).toEqual({ active: 114, inactive: 128, suspended: 1 });
    expect(plan.sourceHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(plan.operationId).toBe(stableMemberPdfImportOperationId(plan.runId, plan.sourceHash));

    const receipt = sanitizeMemberPdfImportReceipt(plan);
    expect(receipt).toMatchObject({
      target: "staging",
      projectId: "bptjersey-f5a25",
      academyId: "demo-academy",
      runId: "member-pdf-20260812-01",
      reports: 8,
      sourceRows: 797,
      canonicalRows: 243,
      duplicates: 554,
      conflicts: 0,
      rowsWithoutMembershipNumber: 96,
      statusCounts: { active: 114, inactive: 128, suspended: 1 },
      reportKeys: expect.arrayContaining([
        "active",
        "activeRegularized",
        "withNumber",
        "inactive",
        "noNumber",
        "regularized",
        "suspended",
        "total",
      ]),
    });
    expect(receipt).not.toHaveProperty("rows");
    expect(JSON.stringify(receipt)).not.toMatch(/fullName|email|membershipNumber|idCardNumber/u);
  });

  it("derives a stable operation ID from the run and ordered source hash", () => {
    const first = stableMemberPdfImportOperationId("run-1", "a".repeat(64));

    expect(first).toBe(stableMemberPdfImportOperationId("run-1", "a".repeat(64)));
    expect(first).not.toBe(stableMemberPdfImportOperationId("run-2", "a".repeat(64)));
    expect(first).toMatch(/^member-pdf-import-[a-f0-9]{64}$/u);
  });

  it("does not call the Firestore apply operation in dry-run mode", async () => {
    const applyCalls = { count: 0 };

    await expect(
      executeMemberPdfImport(executionInput(), fakeExecutionServices(applyCalls)),
    ).resolves.toMatchObject({ mode: "dry-run", receipt: syntheticReceipt });
    expect(applyCalls.count).toBe(0);
  });

  it("serializes an already-safe receipt without treating it as an import plan", () => {
    const serialized = serializeMemberPdfImportReceipt(syntheticReceipt);

    expect(JSON.parse(serialized)).toEqual(syntheticReceipt);
    expect(serialized).not.toMatch(/fullName|email|membershipNumber|sourceRoot/u);
  });

  it("runs dry-run CLI wiring without Admin initialization or apply and writes a safe receipt", async () => {
    let applyCalls = 0;
    let adminInitializationCalls = 0;
    let writtenPath: string | undefined;
    let writtenReceipt = "";
    const result = await runMemberPdfImportCli(
      [
        "--dry-run",
        "--target",
        "staging",
        "--project-id",
        "bptjersey-f5a25",
        "--academy-id",
        "demo-academy",
        "--source-root",
        "F:\\Proyectos\\BPT Jersey\\Varios",
        "--run-id",
        "synthetic-run-1",
        "--captured-at",
        "2026-08-12T12:00:00.000Z",
        "--receipt",
        "synthetic-receipt.json",
      ],
      {
        buildPlan: async () => syntheticPlan,
        apply: async () => {
          applyCalls += 1;
          return { imported: 0, updated: 0, conflicts: 0 };
        },
      },
      {
        now: "2026-08-12T12:00:00.000Z",
        initializeAdmin: () => {
          adminInitializationCalls += 1;
        },
        writeReceipt: async (path, content) => {
          writtenPath = path;
          writtenReceipt = content;
        },
      },
    );

    expect(result.result.mode).toBe("dry-run");
    expect(JSON.parse(writtenReceipt)).toEqual(result.result.receipt);
    expect(writtenPath).toBe("synthetic-receipt.json");
    expect(applyCalls).toBe(0);
    expect(adminInitializationCalls).toBe(0);
  });

  it("rejects unknown and duplicate CLI flags and scopes receipt to the selected mode", () => {
    expect(() =>
      parseMemberPdfImportCliArguments([
        "--dry-run",
        "--target",
        "staging",
        "--project-id",
        "bptjersey-f5a25",
        "--academy-id",
        "demo-academy",
        "--source-root",
        "F:\\Proyectos\\BPT Jersey\\Varios",
        "--run-id",
        "run-1",
        "--captured-at",
        "2026-08-12T12:00:00.000Z",
        "--unknown",
        "value",
      ]),
    ).toThrow("Unknown member PDF import flag");
    expect(() =>
      parseMemberPdfImportCliArguments([
        "--dry-run",
        "--dry-run",
        "--target",
        "staging",
        "--project-id",
        "bptjersey-f5a25",
        "--academy-id",
        "demo-academy",
        "--source-root",
        "F:\\Proyectos\\BPT Jersey\\Varios",
        "--run-id",
        "run-1",
        "--captured-at",
        "2026-08-12T12:00:00.000Z",
      ]),
    ).toThrow("Duplicate member PDF import flag");
    expect(() =>
      parseMemberPdfImportCliArguments([
        "--dry-run",
        "--target",
        "staging",
        "--project-id",
        "bptjersey-f5a25",
        "--academy-id",
        "demo-academy",
        "--source-root",
        "F:\\Proyectos\\BPT Jersey\\Varios",
        "--run-id",
        "run-1",
        "--captured-at",
        "2026-08-12T12:00:00.000Z",
        "--receipt",
        "receipt.json",
      ]),
    ).not.toThrow();
    expect(() =>
      parseMemberPdfImportCliArguments([
        "--confirm",
        "--target",
        "staging",
        "--project-id",
        "bptjersey-f5a25",
        "--academy-id",
        "demo-academy",
        "--source-root",
        "F:\\Proyectos\\BPT Jersey\\Varios",
        "--run-id",
        "run-1",
        "--captured-at",
        "2026-08-12T12:00:00.000Z",
        "--yes-confirm-staging",
      ]),
    ).toThrow("Confirm requires --receipt");
  });

  it("accepts only the allowlisted Firebase Admin project", () => {
    expect(() => validateFirebaseAdminProjectId("bptjersey-f5a25")).not.toThrow();
    expect(() => validateFirebaseAdminProjectId("demo-bpt-jersey")).toThrow(
      "Firebase Admin project is not allowed",
    );
  });

  it("rejects emulator execution at the CLI environment boundary", () => {
    expect(() => validateMemberPdfImportCliEnvironment("127.0.0.1:8080")).toThrow(
      "Firebase emulator target is not allowed",
    );
    expect(() => validateMemberPdfImportCliEnvironment(undefined)).not.toThrow();
  });

  it("rejects missing or ambiguous execution modes", async () => {
    const services = fakeExecutionServices({ count: 0 });

    await expect(
      executeMemberPdfImport(executionInput({ mode: undefined as never }), services),
    ).rejects.toThrow("mode is required and must be unambiguous");
    await expect(
      executeMemberPdfImport(
        executionInput({ mode: "confirm", yesConfirmStaging: false }),
        services,
      ),
    ).rejects.toThrow("Explicit confirmation is required");
  });

  it.each(["run/id", "run id", "run@id", "r".repeat(129)])(
    "rejects an unsafe CLI run ID before planning: %j",
    (runId) => {
      expect(() =>
        parseMemberPdfImportCliArguments([
          "--dry-run",
          "--target",
          "staging",
          "--project-id",
          "bptjersey-f5a25",
          "--academy-id",
          "demo-academy",
          "--source-root",
          "F:\\Proyectos\\BPT Jersey\\Varios",
          "--run-id",
          runId,
          "--captured-at",
          "2026-08-12T12:00:00.000Z",
        ]),
      ).toThrow("Invalid member PDF import run ID");
    },
  );

  it("rejects an unsafe import run ID before planning", async () => {
    await expect(
      executeMemberPdfImport(
        executionInput({ importRunId: "run/id" }),
        fakeExecutionServices({ count: 0 }),
      ),
    ).rejects.toThrow("Invalid member PDF import run ID");
  });

  it("requires explicit confirmation before a staging apply", async () => {
    const applyCalls = { count: 0 };

    await expect(
      executeMemberPdfImport(
        executionInput({ mode: "confirm", receipt: syntheticReceipt }),
        fakeExecutionServices(applyCalls),
      ),
    ).rejects.toThrow("Explicit confirmation is required");
    expect(applyCalls.count).toBe(0);
  });

  it("rejects a confirm receipt whose source metadata no longer matches", async () => {
    const applyCalls = { count: 0 };
    const changedReceipt: MemberPdfImportReceipt = {
      ...syntheticReceipt,
      sourceHash: "c".repeat(64),
    };

    await expect(
      executeMemberPdfImport(
        executionInput({
          mode: "confirm",
          yesConfirmStaging: true,
          receipt: changedReceipt,
        }),
        fakeExecutionServices(applyCalls),
      ),
    ).rejects.toThrow("dry-run receipt does not match");
    expect(applyCalls.count).toBe(0);
  });

  it("rejects an expired or future dry-run receipt before apply", async () => {
    const applyCalls = { count: 0 };
    const services = fakeExecutionServices(applyCalls);
    const expired = { ...syntheticReceipt, generatedAt: "2026-08-12T11:00:00.000Z" };
    await expect(
      executeMemberPdfImport(
        executionInput({
          mode: "confirm",
          yesConfirmStaging: true,
          receipt: expired,
          now: "2026-08-12T12:00:00.000Z",
          importRunId: syntheticPlan.runId,
        }),
        services,
      ),
    ).rejects.toThrow("dry-run receipt is not fresh");
    const future = { ...syntheticReceipt, generatedAt: "2026-08-12T12:01:00.000Z" };
    await expect(
      executeMemberPdfImport(
        executionInput({
          mode: "confirm",
          yesConfirmStaging: true,
          receipt: future,
          now: "2026-08-12T12:00:00.000Z",
          importRunId: syntheticPlan.runId,
        }),
        services,
      ),
    ).rejects.toThrow("dry-run receipt is not fresh");
    expect(applyCalls.count).toBe(0);
  });

  it("rejects an unsafe target before planning or applying", async () => {
    const applyCalls = { count: 0 };
    let buildCalls = 0;
    const services = {
      ...fakeExecutionServices(applyCalls),
      buildPlan: async () => {
        buildCalls += 1;
        return syntheticPlan;
      },
    };

    await expect(
      executeMemberPdfImport(executionInput({ target: "production" }), services),
    ).rejects.toThrow("Member PDF import target is not allowed");
    expect(buildCalls).toBe(0);
    expect(applyCalls.count).toBe(0);
  });

  it("selects rollback records only for the exact academy, source, and run", async () => {
    const result = await planMemberPdfImportRollback(
      {
        ...approvedTarget,
        runId: "synthetic-run-1",
      },
      {
        listMembers: async () => [
          {
            academyId: "demo-academy",
            source: "member-pdf-import",
            importRunId: "synthetic-run-1",
          },
          { academyId: "demo-academy", source: "admin", importRunId: "synthetic-run-1" },
          { academyId: "demo-academy", source: "member-pdf-import", importRunId: "other-run" },
          {
            academyId: "other-academy",
            source: "member-pdf-import",
            importRunId: "synthetic-run-1",
          },
        ],
      },
    );

    expect(result).toEqual({
      target: "staging",
      projectId: "bptjersey-f5a25",
      academyId: "demo-academy",
      runId: "synthetic-run-1",
      selectedCount: 1,
    });
    expect(JSON.stringify(result)).not.toMatch(/memberId|fullName|email|sourceRoot/u);
  });

  it("passes the CLI run ID separately from the operation ID to apply", async () => {
    let received: MemberPdfImportPlan | undefined;
    let receivedImportRunId: string | undefined;
    await executeMemberPdfImport(
      executionInput({
        mode: "confirm",
        yesConfirmStaging: true,
        receipt: syntheticReceipt,
      }),
      {
        buildPlan: async () => syntheticPlan,
        apply: async (plan, importRunId) => {
          received = plan;
          receivedImportRunId = importRunId;
          return { imported: 0, updated: 0, conflicts: 0 };
        },
      },
    );
    expect(received?.runId).toBe("synthetic-run-1");
    expect(received?.operationId).not.toBe(received?.runId);
    expect(receivedImportRunId).toBe("synthetic-run-1");
  });
});
