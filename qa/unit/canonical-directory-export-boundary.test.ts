import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { buildAggregateReportCsv } from "@bpt-jersey/domain/exports";
import { buildOperationalReport } from "@bpt-jersey/domain/reports";

const projectRoot = fileURLToPath(new URL("../../", import.meta.url));

function readProjectFile(relativePath: string): string {
  return readFileSync(
    new URL(relativePath, `file:///${projectRoot.replaceAll("\\", "/")}/`),
    "utf8",
  );
}

/**
 * RED matrix R09 for T093: every export surface must omit the Restricted directory set.
 *
 * The general row and the purpose-bound detail are asserted field by field in
 * `packages/domain/src/members/member-directory-contracts.test.ts`, and the callable error
 * projections in `apps/functions/src/members/member-directory-callables.test.ts`. This file closes
 * the remaining half: the two byte-producing surfaces an administrator can take out of the system,
 * the aggregate CSV export and the printable member report.
 */

/** Participant-level fields the RED matrix classifies as Restricted. */
const participantRestrictedFields = Object.freeze([
  "membershipNumber",
  "idCardNumber",
  "vatNumber",
  "frequencyNote",
  "dateOfBirth",
  "phoneNumber",
  "emergencyContact",
  "postalAddress",
  "gender",
  "legacyMemberId",
  "importRunId",
  "migrationId",
] as const);

/**
 * Every module that turns academy data into a file or a printable document. None of them may reach
 * the canonical directory: the aggregate export is aggregate-only, and the member report is bound to
 * the legacy `members` projection approved under T079/T080, which is a separate read surface.
 */
const exportSurfaces = Object.freeze([
  "packages/domain/src/exports/aggregate-report-export.ts",
  "apps/functions/src/exports/aggregate-report-export-service.ts",
  "apps/functions/src/exports/aggregate-report-export-callables.ts",
  "apps/functions/src/members/member-report-pdf.ts",
] as const);

/** Surfaces that must carry no participant field at all, not even a legacy one. */
const aggregateOnlySurfaces = Object.freeze([
  "packages/domain/src/exports/aggregate-report-export.ts",
  "apps/functions/src/exports/aggregate-report-export-service.ts",
  "apps/functions/src/exports/aggregate-report-export-callables.ts",
] as const);

describe("canonical directory export boundary", () => {
  it("keeps every export surface away from the canonical directory projections", () => {
    for (const surface of exportSurfaces) {
      const source = readProjectFile(surface);

      expect(source, `${surface} must not import the canonical directory contracts`).not.toMatch(
        /member-directory-contracts|members\/directory/u,
      );
      expect(source, `${surface} must not read the restricted directory collections`).not.toMatch(
        /studentAdminProfiles|studentIdentityKeys|studentRestrictedReadLimits/u,
      );
      expect(source, `${surface} must not build a canonical directory projection`).not.toMatch(
        /toAdminDirectoryRow|toMemberRecordMaintenanceDetail|StudentAdminProfile/u,
      );
    }
  });

  it("keeps every participant field out of the aggregate export surfaces", () => {
    const forbidden = new RegExp(`\\b(${participantRestrictedFields.join("|")})\\b`, "u");

    for (const surface of aggregateOnlySurfaces) {
      const source = readProjectFile(surface);
      expect(source, `${surface} must not name a participant field`).not.toMatch(forbidden);
    }
  });

  it("binds the printable member report to the legacy projection only", () => {
    const source = readProjectFile("apps/functions/src/members/member-report-pdf.ts");

    // The report prints legacy `members` rows under administrative access. Its column list is
    // typed against MemberProjection, so a canonical directory row can never be passed in.
    expect(source).toMatch(/import type \{ MemberProjection \} from "\.\/member-service\.js"/u);
    expect(source).toMatch(
      /satisfies readonly \(readonly \[keyof MemberProjection, string\]\)\[\]/u,
    );
  });

  it("emits only the five aggregate CSV columns and never a participant value", () => {
    const query = {
      from: "2026-08-01T00:00:00.000Z",
      to: "2026-08-31T23:59:59.999Z",
    } as const;

    const operational = buildOperationalReport({
      query,
      students: [
        {
          studentId: "student-sentinel-id",
          status: "active",
          participantType: "minor",
          trainingCenter: "West",
        },
      ],
      attendance: [
        {
          attendanceId: "attendance-sentinel-id",
          state: "attended",
          occurredAt: "2026-08-10T18:00:00.000Z",
          correctionOf: null,
        },
      ],
      memberships: [
        {
          membershipId: "membership-sentinel-id",
          studentId: "student-sentinel-id",
          status: "active",
          updatedAt: "2026-08-01T00:00:00.000Z",
        },
      ],
      invoices: [
        {
          invoiceId: "invoice-sentinel-id",
          status: "partially_paid",
          totalMinor: 10_000,
          createdAt: "2026-08-01T00:00:00.000Z",
        },
      ],
      payments: [
        {
          paymentId: "payment-sentinel-id",
          invoiceId: "invoice-sentinel-id",
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
          definitionKey: "level-sentinel-id",
          definitionName: "White",
          studentCount: 1,
          assessedStudentCount: 1,
          eligibleForPromotionCount: 0,
        },
      ],
      skillCoverage: [
        {
          skillKey: "skill-sentinel-id",
          displayLabel: "Guard retention",
          assessedStudentCount: 1,
          coveragePercentage: 100,
        },
      ],
      calculatedAt: "2026-08-31T22:00:00.000Z",
    } as const;

    const csv = buildAggregateReportCsv({ operational, progress });
    const rows = csv.split(/\r?\n/u).filter((row) => row.length > 0);

    expect(rows[0]).toBe("section,metric,segment,value,unit");
    for (const row of rows.slice(1)) {
      expect(row.split(",").length, `row must keep the five aggregate columns: ${row}`).toBe(5);
    }

    // No per-participant identifier or actor reaches the file, not even the synthetic ones above.
    expect(csv).not.toMatch(/sentinel-id/u);
    expect(csv).not.toMatch(/actor|createdBy|updatedBy/iu);
    expect(csv).not.toMatch(new RegExp(participantRestrictedFields.join("|"), "iu"));
  });
});
