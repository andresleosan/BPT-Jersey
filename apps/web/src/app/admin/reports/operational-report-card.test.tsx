import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildOperationalReport } from "@bpt-jersey/domain/reports";

const api = vi.hoisted(() => ({
  getOperationalReport: vi.fn(),
}));

vi.mock("../../../lib/reports-client", () => api);

import { OperationalReportCard } from "./operational-report-card";

const query = {
  from: "2026-08-01T00:00:00.000Z",
  to: "2026-08-31T23:59:59.999Z",
} as const;

const report = buildOperationalReport({
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

describe("OperationalReportCard", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders the connected aggregate without source identifiers", async () => {
    api.getOperationalReport.mockResolvedValue(report);

    render(<OperationalReportCard />);

    expect(
      await screen.findByRole("heading", {
        name: "Students, attendance and finance",
      }),
    ).toBeVisible();
    expect(screen.getByText("Manual revenue").nextElementSibling).toHaveTextContent("£50.00");
    expect(screen.getByRole("heading", { name: "Attendance period" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Membership status" })).toBeVisible();
    expect(screen.queryByText(/private-/i)).not.toBeInTheDocument();
  });

  it("submits the selected report period and shows a safe error", async () => {
    api.getOperationalReport.mockRejectedValue(new Error("backend details"));

    render(<OperationalReportCard />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Unable to load operational report. Please try again.",
    );

    fireEvent.change(screen.getByLabelText("From"), {
      target: { value: "2026-08-01" },
    });
    fireEvent.change(screen.getByLabelText("To"), {
      target: { value: "2026-08-31" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Refresh operational report" }));

    expect(api.getOperationalReport).toHaveBeenLastCalledWith(query);
    expect(screen.queryByText("backend details")).not.toBeInTheDocument();
  });
});
