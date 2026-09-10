import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  aggregateReportExportClassification,
  aggregateReportExportContentType,
  aggregateReportExportScope,
} from "@bpt-jersey/domain/exports";
import { buildOperationalReport } from "@bpt-jersey/domain/reports";

const api = vi.hoisted(() => ({
  httpsCallable: vi.fn(),
  invoke: vi.fn(),
}));

vi.mock("firebase/functions", () => ({
  httpsCallable: api.httpsCallable,
}));

vi.mock("./firebase-client", () => ({
  getFirebaseFunctions: () => ({}),
}));

import { getOperationalReport, prepareAggregateReportExport } from "./reports-client";

const query = {
  from: "2026-08-01T00:00:00.000Z",
  to: "2026-08-31T23:59:59.999Z",
} as const;

const report = buildOperationalReport({
  query,
  students: [],
  attendance: [],
  memberships: [],
  invoices: [],
  payments: [],
  now: "2026-08-31T23:59:59.999Z",
});

describe("operational reports client", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.httpsCallable.mockReturnValue(api.invoke);
    api.invoke.mockResolvedValue({ data: { report } });
  });

  it("sends the validated range and accepts an aggregate-only response", async () => {
    await expect(getOperationalReport(query)).resolves.toEqual(report);
    expect(api.httpsCallable).toHaveBeenCalledWith({}, "getOperationalReport");
    expect(api.invoke).toHaveBeenCalledWith(query);
  });

  it("rejects unexpected response fields with a generic error", async () => {
    api.invoke.mockResolvedValue({
      data: {
        report: {
          ...report,
          studentIds: ["private-student-id"],
        },
      },
    });

    await expect(getOperationalReport(query)).rejects.toThrow(
      "Unable to load operational report. Please try again.",
    );
  });

  it("rejects an otherwise valid report for a different range", async () => {
    api.invoke.mockResolvedValue({
      data: {
        report: {
          ...report,
          query: {
            from: "2026-08-02T00:00:00.000Z",
            to: query.to,
          },
        },
      },
    });

    await expect(getOperationalReport(query)).rejects.toThrow(
      "Unable to load operational report. Please try again.",
    );
  });

  it("rejects an invalid range before calling Firebase", async () => {
    await expect(
      getOperationalReport({
        from: "2026-08-01T00:00:00.000Z",
        to: "2026-10-01T00:00:00.000Z",
      }),
    ).rejects.toThrow("Unable to load operational report. Please try again.");
    expect(api.invoke).not.toHaveBeenCalled();
  });
});


describe("aggregate report export client", () => {
  const exportRequest = { ...query, purpose: "pilot_operations_review" } as const;
  const content = "section,metric,segment,value,unit\r\n";
  const preparedExport = {
    exportId: "report-export-1",
    fileName: "bpt-aggregate-report-2026-08-01-to-2026-08-31.csv",
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

  beforeEach(() => {
    vi.clearAllMocks();
    api.httpsCallable.mockReturnValue(api.invoke);
    api.invoke.mockResolvedValue({ data: { export: preparedExport } });
  });

  it("sends only the validated closed-purpose request", async () => {
    await expect(prepareAggregateReportExport(exportRequest)).resolves.toEqual(preparedExport);
    expect(api.httpsCallable).toHaveBeenCalledWith({}, "prepareAggregateReportExport");
    expect(api.invoke).toHaveBeenCalledWith(exportRequest);
  });

  it("rejects tampered content metadata or a different request binding", async () => {
    for (const exportValue of [
      { ...preparedExport, byteLength: preparedExport.byteLength + 1 },
      { ...preparedExport, purpose: "pilot_progress_review" },
      { ...preparedExport, query: { ...query, from: "2026-08-02T00:00:00.000Z" } },
      { ...preparedExport, recipient: "external@example.test" },
    ]) {
      api.invoke.mockResolvedValueOnce({ data: { export: exportValue } });
      await expect(prepareAggregateReportExport(exportRequest)).rejects.toThrow(
        "Unable to prepare the aggregate export. Please try again.",
      );
    }
  });

  it("rejects invalid or expanded requests before calling Firebase", async () => {
    await expect(
      prepareAggregateReportExport({
        ...exportRequest,
        purpose: "all_member_records",
      } as never),
    ).rejects.toThrow("Unable to prepare the aggregate export. Please try again.");
    expect(api.invoke).not.toHaveBeenCalled();
  });
});
