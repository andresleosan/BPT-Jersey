import {
  isAggregateReportExportResponse,
  parseAggregateReportExportRequest,
  type AggregateReportExportRequest,
  type AggregateReportExportResponse,
} from "@bpt-jersey/domain/exports";
import {
  isOperationalReport,
  parseOperationalReportQuery,
  type OperationalReport,
  type OperationalReportQuery,
} from "@bpt-jersey/domain/reports";
import { httpsCallable } from "firebase/functions";

import { getFirebaseFunctions } from "./firebase-client";

const safeOperationalReportError =
  "Unable to load operational report. Please try again.";

export async function getOperationalReport(
  query: OperationalReportQuery,
): Promise<OperationalReport> {
  const parsed = parseOperationalReportQuery(query);
  if (!parsed.ok) {
    throw new Error(safeOperationalReportError);
  }

  const callable = httpsCallable<
    OperationalReportQuery,
    { report: unknown }
  >(getFirebaseFunctions(), "getOperationalReport");

  try {
    const response = await callable(parsed.value);
    if (
      !isOperationalReport(response.data.report) ||
      response.data.report.query.from !== parsed.value.from ||
      response.data.report.query.to !== parsed.value.to
    ) {
      throw new Error(safeOperationalReportError);
    }
    return response.data.report;
  } catch {
    throw new Error(safeOperationalReportError);
  }
}


const safeAggregateExportError =
  "Unable to prepare the aggregate export. Please try again.";

export async function prepareAggregateReportExport(
  request: AggregateReportExportRequest,
): Promise<AggregateReportExportResponse> {
  const parsed = parseAggregateReportExportRequest(request);
  if (!parsed.ok) {
    throw new Error(safeAggregateExportError);
  }

  const callable = httpsCallable<
    AggregateReportExportRequest,
    { export: unknown }
  >(getFirebaseFunctions(), "prepareAggregateReportExport");

  try {
    const response = await callable(parsed.value);
    const prepared = response.data.export;
    if (
      !isAggregateReportExportResponse(prepared) ||
      prepared.query.from !== parsed.value.from ||
      prepared.query.to !== parsed.value.to ||
      prepared.purpose !== parsed.value.purpose
    ) {
      throw new Error(safeAggregateExportError);
    }
    return prepared;
  } catch {
    throw new Error(safeAggregateExportError);
  }
}
