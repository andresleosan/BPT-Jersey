import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  aggregateReportExportClassification,
  aggregateReportExportContentType,
  aggregateReportExportScope,
  type AggregateReportExportResponse,
} from "@bpt-jersey/domain/exports";

const api = vi.hoisted(() => ({
  prepareAggregateReportExport: vi.fn(),
}));

vi.mock("../../../lib/reports-client", () => api);

import { AggregateReportExportCard } from "./aggregate-report-export-card";

const query = {
  from: "2026-08-01T00:00:00.000Z",
  to: "2026-08-31T23:59:59.999Z",
} as const;
const content = "section,metric,segment,value,unit\r\n";
const preparedExport: AggregateReportExportResponse = {
  exportId: "report-export-1",
  fileName: "bpt-aggregate-report-2026-08-01-to-2026-08-31.csv",
  contentType: aggregateReportExportContentType,
  content,
  byteLength: new TextEncoder().encode(content).byteLength,
  contentSha256: "a".repeat(64),
  expiresAt: "2026-08-31T23:10:00.000Z",
  purpose: "internal_finance_reconciliation",
  scope: aggregateReportExportScope,
  classification: aggregateReportExportClassification,
  query,
};

describe("AggregateReportExportCard", () => {
  let downloaded: { fileName: string; href: string } | undefined;

  beforeEach(() => {
    downloaded = undefined;
    api.prepareAggregateReportExport.mockResolvedValue(preparedExport);
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn(() => "blob:aggregate-report"),
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn(),
    });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      downloaded = { fileName: this.download, href: this.href };
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it("submits a closed purpose and downloads only the validated CSV", async () => {
    render(<AggregateReportExportCard />);

    expect(screen.getByText(/excludes names, emails, member records/i)).toBeVisible();
    fireEvent.change(screen.getByLabelText("Purpose"), {
      target: { value: "internal_finance_reconciliation" },
    });
    fireEvent.change(screen.getByLabelText("From"), {
      target: { value: "2026-08-01" },
    });
    fireEvent.change(screen.getByLabelText("To"), {
      target: { value: "2026-08-31" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Prepare and download CSV" }));

    expect(await screen.findByText(/CSV downloaded/i)).toBeVisible();
    expect(api.prepareAggregateReportExport).toHaveBeenCalledWith({
      ...query,
      purpose: "internal_finance_reconciliation",
    });
    expect(URL.createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:aggregate-report");
    expect(downloaded).toEqual({
      fileName: preparedExport.fileName,
      href: "blob:aggregate-report",
    });
    expect(screen.queryByText(content)).not.toBeInTheDocument();
  });

  it("shows a safe error and never exposes backend details", async () => {
    api.prepareAggregateReportExport.mockRejectedValue(
      new Error("private-student-id failed in database"),
    );

    render(<AggregateReportExportCard />);
    fireEvent.click(screen.getByRole("button", { name: "Prepare and download CSV" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Unable to prepare the aggregate export. Please try again.",
    );
    expect(screen.queryByText(/private-student-id/i)).not.toBeInTheDocument();
    await waitFor(() => expect(URL.createObjectURL).not.toHaveBeenCalled());
  });
});
