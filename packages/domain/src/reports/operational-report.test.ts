import { describe, expect, it } from "vitest";

import {
  buildOperationalReport,
  isOperationalReport,
  parseOperationalReportQuery,
} from "./operational-report";

const query = {
  from: "2026-08-01T00:00:00.000Z",
  to: "2026-08-31T23:59:59.999Z",
} as const;

describe("operational report contracts", () => {
  it("validates an exact report range capped at 31 days", () => {
    expect(parseOperationalReportQuery(query)).toEqual({ ok: true, value: query });
    expect(
      parseOperationalReportQuery({
        ...query,
        unexpected: true,
      }).ok,
    ).toBe(false);
    expect(
      parseOperationalReportQuery({
        from: "2026-08-01T00:00:00.000Z",
        to: "2026-10-01T00:00:00.000Z",
      }).ok,
    ).toBe(false);
    expect(
      parseOperationalReportQuery({
        from: "not-a-date",
        to: query.to,
      }).ok,
    ).toBe(false);
  });

  it("builds aggregate-only student, attendance, membership and manual revenue metrics", () => {
    const report = buildOperationalReport({
      query,
      students: [
        {
          studentId: "student-1",
          status: "active",
          participantType: "adult",
          trainingCenter: "Town",
        },
        {
          studentId: "student-2",
          status: "active",
          participantType: "minor",
          trainingCenter: "West",
        },
        {
          studentId: "student-3",
          status: "inactive",
          participantType: "adult",
          trainingCenter: "Town",
        },
      ],
      attendance: [
        {
          attendanceId: "attendance-1",
          state: "attended",
          occurredAt: "2026-08-03T10:00:00.000Z",
          correctionOf: null,
        },
        {
          attendanceId: "attendance-2",
          state: "late",
          occurredAt: "2026-08-04T10:00:00.000Z",
          correctionOf: null,
        },
        {
          attendanceId: "attendance-3",
          state: "no_show",
          occurredAt: "2026-08-05T10:00:00.000Z",
          correctionOf: null,
        },
        {
          attendanceId: "attendance-4",
          state: "excused",
          occurredAt: "2026-08-06T10:00:00.000Z",
          correctionOf: null,
        },
        {
          attendanceId: "correction-1",
          state: "attended",
          occurredAt: "2026-08-06T11:00:00.000Z",
          correctionOf: "attendance-3",
        },
      ],
      memberships: [
        {
          membershipId: "membership-old",
          studentId: "student-1",
          status: "cancelled",
          updatedAt: "2026-07-01T00:00:00.000Z",
        },
        {
          membershipId: "membership-current",
          studentId: "student-1",
          status: "active",
          updatedAt: "2026-08-01T00:00:00.000Z",
        },
        {
          membershipId: "membership-overdue",
          studentId: "student-2",
          status: "overdue",
          updatedAt: "2026-08-02T00:00:00.000Z",
        },
      ],
      invoices: [
        {
          invoiceId: "invoice-1",
          status: "open",
          totalMinor: 10_000,
          createdAt: "2026-08-02T00:00:00.000Z",
        },
        {
          invoiceId: "invoice-void",
          status: "void",
          totalMinor: 5_000,
          createdAt: "2026-08-03T00:00:00.000Z",
        },
      ],
      payments: [
        {
          paymentId: "payment-period",
          invoiceId: "invoice-1",
          amountMinor: 4_000,
          method: "cash",
          occurredAt: "2026-08-10T00:00:00.000Z",
        },
        {
          paymentId: "payment-later",
          invoiceId: "invoice-1",
          amountMinor: 2_000,
          method: "bank_transfer",
          occurredAt: "2026-09-02T00:00:00.000Z",
        },
      ],
      now: "2026-08-31T23:59:59.999Z",
    });

    expect(report.students).toEqual({
      totalStudents: 3,
      activeStudents: 2,
      inactiveStudents: 1,
      suspendedStudents: 0,
      activeAdults: 1,
      activeMinors: 1,
      activeTown: 1,
      activeWest: 1,
    });
    expect(report.attendance).toMatchObject({
      totalRecords: 4,
      checkedIn: 2,
      noShow: 1,
      excused: 1,
      attendanceRatePercentage: 67,
    });
    expect(report.memberships).toEqual({
      currentMemberships: 2,
      trial: 0,
      active: 1,
      paused: 0,
      overdue: 1,
      cancelled: 0,
    });
    expect(report.revenue).toMatchObject({
      currency: "GBP",
      issuedMinor: 10_000,
      receivedMinor: 4_000,
      outstandingMinor: 4_000,
      invoiceCount: 2,
      voidedInvoiceCount: 1,
      paymentCount: 1,
      paymentsByMethod: { cash: 1, bankTransfer: 0, other: 0 },
    });
    expect(isOperationalReport(report)).toBe(true);
    expect(JSON.stringify(report)).not.toContain("student-1");
  });

  it("rejects report responses containing unexpected fields", () => {
    const empty = buildOperationalReport({
      query,
      students: [],
      attendance: [],
      memberships: [],
      invoices: [],
      payments: [],
      now: "2026-08-31T23:59:59.999Z",
    });

    expect(isOperationalReport({ ...empty, studentIds: ["private-id"] })).toBe(false);
  });

  it("rejects internally inconsistent aggregate subtotals", () => {
    const empty = buildOperationalReport({
      query,
      students: [],
      attendance: [],
      memberships: [],
      invoices: [],
      payments: [],
      now: "2026-08-31T23:59:59.999Z",
    });

    expect(
      isOperationalReport({
        ...empty,
        students: { ...empty.students, totalStudents: 1 },
      }),
    ).toBe(false);
    expect(
      isOperationalReport({
        ...empty,
        attendance: { ...empty.attendance, checkedIn: 1 },
      }),
    ).toBe(false);
    expect(
      isOperationalReport({
        ...empty,
        revenue: { ...empty.revenue, invoiceCount: 1 },
      }),
    ).toBe(false);
  });
});
