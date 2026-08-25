import { describe, expect, it } from "vitest";

import { buildOperationalReport } from "../reports/operational-report";
import {
  aggregateReportExportClassification,
  aggregateReportExportContentType,
  aggregateReportExportFileName,
  aggregateReportExportScope,
  buildAggregateReportCsv,
  isAggregateReportExportResponse,
  parseAggregateReportExportRequest,
} from "./aggregate-report-export";

const query = {
  from: "2026-08-01T00:00:00.000Z",
  to: "2026-08-31T23:59:59.999Z",
} as const;

const operational = buildOperationalReport({
  query,
  students: [
    {
      studentId: "private-student-id",
      status: "active",
      participantType: "minor",
      trainingCenter: "West",
    },
  ],
  attendance: [
    {
      attendanceId: "private-attendance-id",
      state: "attended",
      occurredAt: "2026-08-10T18:00:00.000Z",
      correctionOf: null,
    },
  ],
  memberships: [
    {
      membershipId: "private-membership-id",
      studentId: "private-student-id",
      status: "active",
      updatedAt: "2026-08-01T00:00:00.000Z",
    },
  ],
  invoices: [
    {
      invoiceId: "private-invoice-id",
      status: "partially_paid",
      totalMinor: 10_000,
      createdAt: "2026-08-01T00:00:00.000Z",
    },
  ],
  payments: [
    {
      paymentId: "private-payment-id",
      invoiceId: "private-invoice-id",
      amountMinor: 5_000,
      method: "cash",
      occurredAt: "2026-08-02T00:00:00.000Z",
    },
  ],
  now: "2026-08-31T23:59:59.999Z",
});

const progress = {
  activeStudentCount: 1,
  assessedStudentCount: 1,
  unassessedStudentCount: 0,
  totalEvaluationCount: 2,
  assessmentCoveragePercentage: 100,
  recognitionCandidateCount: 1,
  eligibleForPromotionCount: 0,
  levelBreakdown: [
    {
      definitionKey: "private-level-id",
      definitionName: "  =SUM(1,1)",
      studentCount: 1,
      assessedStudentCount: 1,
      eligibleForPromotionCount: 0,
    },
  ],
  skillCoverage: [
    {
      skillKey: "private-skill-id",
      displayLabel: "@private-formula",
      assessedStudentCount: 1,
      coveragePercentage: 100,
    },
  ],
  calculatedAt: "2026-08-31T22:00:00.000Z",
} as const;

describe("aggregate report export contract", () => {
  it("accepts only an exact closed-purpose request and keeps the report range bound", () => {
    const parsed = parseAggregateReportExportRequest({
      ...query,
      purpose: "pilot_operations_review",
    });

    expect(parsed).toEqual({
      ok: true,
      value: { ...query, purpose: "pilot_operations_review" },
    });
    expect(Object.isFrozen(parsed.ok ? parsed.value : undefined)).toBe(true);

    for (const candidate of [
      { ...query, purpose: "bulk_member_export" },
      { ...query, purpose: "pilot_operations_review", recipient: "other@example.test" },
      { ...query, to: "2026-10-01T00:00:00.000Z", purpose: "pilot_operations_review" },
      Object.assign(Object.create({ inherited: true }), {
        ...query,
        purpose: "pilot_operations_review",
      }),
    ]) {
      expect(parseAggregateReportExportRequest(candidate).ok).toBe(false);
    }
  });

  it("builds deterministic aggregate-only CSV and neutralizes spreadsheet formulas", () => {
    const csv = buildAggregateReportCsv({ operational, progress });

    expect(csv).toContain("section,metric,segment,value,unit\r\n");
    expect(csv).toContain("students,activeStudents,all,1,count");
    expect(csv).toContain("revenue,receivedMinor,selected_period,5000,GBP_minor");
    expect(csv).toContain("progress,assessmentCoveragePercentage,current,100,percentage");
    expect(csv).toContain('progress_level,studentCount,"\'  =SUM(1,1)",1,count');
    expect(csv).toContain("progress_skill,coveragePercentage,'@private-formula,100,percentage");
    expect(csv).not.toMatch(
      /private-(student|attendance|membership|invoice|payment|level|skill)-id/u,
    );
    expect(csv.endsWith("\r\n")).toBe(true);
  });

  it("validates an exact bounded response and rejects tampering or server extras", () => {
    const content = buildAggregateReportCsv({ operational, progress });
    const response = {
      exportId: "report-export-1",
      fileName: aggregateReportExportFileName(query),
      contentType: aggregateReportExportContentType,
      content,
      byteLength: new TextEncoder().encode(content).byteLength,
      contentSha256: "a".repeat(64),
      expiresAt: "2026-08-31T23:10:00.000Z",
      purpose: "pilot_operations_review",
      scope: aggregateReportExportScope,
      classification: aggregateReportExportClassification,
      query,
    } as const;

    expect(isAggregateReportExportResponse(response)).toBe(true);
    expect(
      isAggregateReportExportResponse({ ...response, byteLength: response.byteLength + 1 }),
    ).toBe(false);
    expect(isAggregateReportExportResponse({ ...response, contentSha256: "A".repeat(64) })).toBe(
      false,
    );
    expect(isAggregateReportExportResponse({ ...response, recipient: "actor:owner-1" })).toBe(
      false,
    );
    expect(
      isAggregateReportExportResponse({
        ...response,
        fileName: "formula.csv",
      }),
    ).toBe(false);
  });
});
