import { describe, expect, it } from "vitest";

import {
  createFirestoreOperationalReportStore,
  OperationalReportStoreError,
  type OperationalReportFirestore,
} from "./operational-report-service";

const query = {
  from: "2026-08-01T00:00:00.000Z",
  to: "2026-08-31T23:59:59.999Z",
} as const;

function document(id: string, data: Record<string, unknown>) {
  return {
    id,
    data: () => data,
  };
}

function firestoreWith(
  collections: Readonly<Record<string, readonly ReturnType<typeof document>[]>>,
): OperationalReportFirestore {
  return {
    collection(path) {
      const name = path.split("/").at(-1) ?? "";
      return {
        get: async () => ({
          docs: collections[name] ?? [],
        }),
      };
    },
  };
}

describe("Firestore operational report store", () => {
  it("projects tenant-scoped canonical records into an aggregate-only report", async () => {
    const academyId = "academy-1";
    const store = createFirestoreOperationalReportStore({
      firestore: firestoreWith({
        students: [
          document("student-1", {
            academyId,
            studentId: "student-1",
            status: "active",
            participantType: "adult",
            trainingCenter: "Town",
          }),
          document("student-2", {
            academyId,
            studentId: "student-2",
            status: "active",
            participantType: "minor",
            trainingCenter: "West",
          }),
        ],
        attendance: [
          document("attendance-1", {
            academyId,
            attendanceId: "attendance-1",
            state: "attended",
            occurredAt: "2026-08-05T18:00:00.000Z",
            correctionOf: null,
          }),
          document("attendance-2", {
            academyId,
            attendanceId: "attendance-2",
            state: "no_show",
            occurredAt: "2026-08-06T18:00:00.000Z",
            correctionOf: null,
          }),
        ],
        memberships: [
          document("membership-1", {
            academyId,
            membershipId: "membership-1",
            studentId: "student-1",
            status: "active",
            updatedAt: "2026-08-01T00:00:00.000Z",
          }),
          document("membership-2", {
            academyId,
            membershipId: "membership-2",
            studentId: "student-2",
            status: "overdue",
            updatedAt: "2026-08-02T00:00:00.000Z",
          }),
        ],
        invoices: [
          document("invoice-1", {
            academyId,
            invoiceId: "invoice-1",
            status: "partially_paid",
            totalMinor: 12_500,
            createdAt: "2026-08-01T00:00:00.000Z",
          }),
        ],
        payments: [
          document("payment-1", {
            academyId,
            paymentId: "payment-1",
            invoiceId: "invoice-1",
            amountMinor: 5_000,
            method: "bank_transfer",
            occurredAt: "2026-08-10T00:00:00.000Z",
          }),
        ],
      }),
      now: () => "2026-08-31T23:59:59.999Z",
    });

    const report = await store.getOperationalReport(academyId, query);

    expect(report.students.activeStudents).toBe(2);
    expect(report.attendance).toMatchObject({
      checkedIn: 1,
      noShow: 1,
      attendanceRatePercentage: 50,
    });
    expect(report.memberships).toMatchObject({ active: 1, overdue: 1 });
    expect(report.revenue).toMatchObject({
      issuedMinor: 12_500,
      receivedMinor: 5_000,
      outstandingMinor: 7_500,
      paymentsByMethod: { cash: 0, bankTransfer: 1, other: 0 },
    });
    expect(JSON.stringify(report)).not.toContain("student-1");
    expect(JSON.stringify(report)).not.toContain("invoice-1");
  });

  it("fails closed when a canonical record carries another tenant", async () => {
    const store = createFirestoreOperationalReportStore({
      firestore: firestoreWith({
        students: [
          document("student-1", {
            academyId: "academy-2",
            studentId: "student-1",
            status: "active",
            participantType: "adult",
            trainingCenter: "Town",
          }),
        ],
      }),
    });

    await expect(store.getOperationalReport("academy-1", query)).rejects.toEqual(
      expect.objectContaining<Partial<OperationalReportStoreError>>({
        code: "tenant",
      }),
    );
  });
});
