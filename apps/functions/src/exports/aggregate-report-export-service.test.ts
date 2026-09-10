import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";
import type { ProgressReport } from "@bpt-jersey/domain/levels";
import { buildOperationalReport } from "@bpt-jersey/domain/reports";

import type { ProgressReportStore } from "../levels/progress-report-service.js";
import type { OperationalReportStore } from "../reports/operational-report-service.js";
import {
  AggregateReportExportServiceError,
  createAggregateReportExportService,
  type AggregateExportDocumentReference,
  type AggregateExportFirestore,
  type AggregateExportTransaction,
} from "./aggregate-report-export-service.js";

const request = {
  from: "2026-08-01T00:00:00.000Z",
  to: "2026-08-31T23:59:59.999Z",
  purpose: "pilot_operations_review",
} as const;

function operationalReport(overrides: Partial<{ from: string; to: string }> = {}) {
  return buildOperationalReport({
    query: {
      from: overrides.from ?? request.from,
      to: overrides.to ?? request.to,
    },
    students: [
      {
        studentId: "private-student-id",
        status: "active",
        participantType: "minor",
        trainingCenter: "West",
      },
    ],
    attendance: [],
    memberships: [],
    invoices: [],
    payments: [],
    now: "2026-08-31T22:00:00.000Z",
  });
}

const progressReport: ProgressReport = {
  activeStudentCount: 1,
  assessedStudentCount: 1,
  unassessedStudentCount: 0,
  totalEvaluationCount: 1,
  assessmentCoveragePercentage: 100,
  recognitionCandidateCount: 0,
  eligibleForPromotionCount: 0,
  levelBreakdown: [
    {
      definitionKey: "private-level-id",
      definitionName: "White belt",
      studentCount: 1,
      assessedStudentCount: 1,
      eligibleForPromotionCount: 0,
    },
  ],
  skillCoverage: [],
  calculatedAt: "2026-08-31T22:00:00.000Z",
} as const;

function createHarness(
  options: {
    operational?: ReturnType<typeof operationalReport>;
    progress?: ProgressReport;
    transactionError?: Error;
    referencePath?: (path: string) => string;
  } = {},
) {
  const writes: Array<{
    ref: AggregateExportDocumentReference;
    data: Readonly<Record<string, unknown>>;
  }> = [];
  const firestore: AggregateExportFirestore = {
    doc: (path) => ({
      id: path.split("/").at(-1) ?? "",
      path: options.referencePath?.(path) ?? path,
    }),
    runTransaction: async (callback) => {
      if (options.transactionError) throw options.transactionError;
      const transaction: AggregateExportTransaction = {
        create: (ref, data) => {
          writes.push({ ref, data });
        },
      };
      return callback(transaction);
    },
  };
  const operationalStore: OperationalReportStore = {
    getOperationalReport: vi.fn(async () => options.operational ?? operationalReport()),
  };
  const progressStore: ProgressReportStore = {
    getProgressReport: vi.fn(async () => options.progress ?? progressReport),
  };
  const auditWriter = vi.fn((transaction, ref, draft) => {
    transaction.create(ref, draft);
  });
  const service = createAggregateReportExportService({
    firestore,
    operationalStore,
    progressStore,
    auditWriter,
    serverTimestamp: () => "SERVER_TIMESTAMP",
    now: () => new Date("2026-08-31T23:00:00.000Z"),
    generateExportId: () => "report-export-1",
    generateAuditId: () => "report-export-audit-1",
  });
  return { service, writes, operationalStore, progressStore, auditWriter };
}

describe("aggregate report export service", () => {
  it("journals metadata and audit atomically before returning aggregate-only CSV", async () => {
    const harness = createHarness();

    const result = await harness.service.prepare({
      academyId: "academy-1",
      actorId: "owner-1",
      request,
    });

    expect(harness.operationalStore.getOperationalReport).toHaveBeenCalledWith("academy-1", {
      from: request.from,
      to: request.to,
    });
    expect(harness.progressStore.getProgressReport).toHaveBeenCalledWith("academy-1");
    expect(result.exportId).toBe("report-export-1");
    expect(result.expiresAt).toBe("2026-08-31T23:10:00.000Z");
    expect(result.contentSha256).toBe(
      createHash("sha256").update(result.content, "utf8").digest("hex"),
    );
    expect(result.content).not.toMatch(/private-(student|level)-id/u);
    expect(harness.writes).toHaveLength(2);
    expect(harness.writes[0]).toMatchObject({
      ref: {
        id: "report-export-audit-1",
        path: "academies/academy-1/auditEvents/report-export-audit-1",
      },
      data: {
        action: "report.export.prepared",
        targetRef: "academies/academy-1/exports/report-export-1",
        recipient: "actor:owner-1",
        contentSha256: result.contentSha256,
        byteLength: result.byteLength,
      },
    });
    expect(harness.writes[1]).toEqual({
      ref: {
        id: "report-export-1",
        path: "academies/academy-1/exports/report-export-1",
      },
      data: {
        exportId: "report-export-1",
        academyId: "academy-1",
        requestedBy: "owner-1",
        purpose: "pilot_operations_review",
        scope: "operational_and_progress_aggregates",
        classification: "Confidential",
        recipient: "actor:owner-1",
        expiresAt: "2026-08-31T23:10:00.000Z",
        status: "delivered_inline",
        schemaVersion: 1,
        createdAt: "SERVER_TIMESTAMP",
        createdBy: "owner-1",
        updatedAt: "SERVER_TIMESTAMP",
        updatedBy: "owner-1",
      },
    });
    expect(harness.writes[1]?.data).not.toHaveProperty("content");
  });

  it("fails closed when a source returns a different report range", async () => {
    const harness = createHarness({
      operational: operationalReport({ from: "2026-08-02T00:00:00.000Z" }),
    });

    await expect(
      harness.service.prepare({
        academyId: "academy-1",
        actorId: "owner-1",
        request,
      }),
    ).rejects.toEqual(expect.objectContaining({ code: "tenant" }));
    expect(harness.writes).toHaveLength(0);
    expect(harness.auditWriter).not.toHaveBeenCalled();
  });

  it("rejects a Firestore adapter that redirects a reference cross-tenant", async () => {
    const harness = createHarness({
      referencePath: (path) => path.replace("academies/academy-1/", "academies/academy-2/"),
    });

    await expect(
      harness.service.prepare({
        academyId: "academy-1",
        actorId: "owner-1",
        request,
      }),
    ).rejects.toEqual(expect.objectContaining({ code: "tenant" }));
    expect(harness.writes).toHaveLength(0);
  });

  it("rejects oversized output before journal writes", async () => {
    const hugeProgress = {
      ...progressReport,
      levelBreakdown: Array.from({ length: 700 }, (_, index) => ({
        definitionKey: "level-" + index,
        definitionName: "Level " + index + " " + "x".repeat(80),
        studentCount: 1,
        assessedStudentCount: 1,
        eligibleForPromotionCount: 0,
      })),
    };
    const harness = createHarness({ progress: hugeProgress });

    await expect(
      harness.service.prepare({
        academyId: "academy-1",
        actorId: "owner-1",
        request,
      }),
    ).rejects.toEqual(expect.objectContaining({ code: "limit" }));
    expect(harness.writes).toHaveLength(0);
  });

  it("returns a generic store error when the atomic journal cannot commit", async () => {
    const harness = createHarness({ transactionError: new Error("private database detail") });

    await expect(
      harness.service.prepare({
        academyId: "academy-1",
        actorId: "owner-1",
        request,
      }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<AggregateReportExportServiceError>>({
        code: "store",
        message: "Unable to journal aggregate export",
      }),
    );
  });
});
