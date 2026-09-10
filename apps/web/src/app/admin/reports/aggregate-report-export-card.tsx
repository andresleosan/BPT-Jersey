"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  aggregateReportExportPurposes,
  type AggregateReportExportPurpose,
  type AggregateReportExportResponse,
} from "@bpt-jersey/domain/exports";

import { prepareAggregateReportExport } from "../../../lib/reports-client";

type ExportDateRange = Readonly<{ from: string; to: string }>;

const purposeLabels: Readonly<Record<AggregateReportExportPurpose, string>> = Object.freeze({
  pilot_operations_review: "Pilot operations review",
  internal_finance_reconciliation: "Internal finance reconciliation",
  pilot_progress_review: "Pilot progress review",
});

function defaultExportRange(now = new Date()): ExportDateRange {
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  const day = String(now.getUTCDate()).padStart(2, "0");
  return {
    from: year + "-" + month + "-01",
    to: year + "-" + month + "-" + day,
  };
}

function toExportRequest(range: ExportDateRange, purpose: AggregateReportExportPurpose) {
  return {
    from: range.from + "T00:00:00.000Z",
    to: range.to + "T23:59:59.999Z",
    purpose,
  } as const;
}

export function downloadAggregateReportCsv(prepared: AggregateReportExportResponse): void {
  const objectUrl = URL.createObjectURL(
    new Blob([prepared.content], { type: prepared.contentType }),
  );
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = prepared.fileName;
  anchor.rel = "noopener";
  anchor.click();
  URL.revokeObjectURL(objectUrl);
}

export function AggregateReportExportCard() {
  const [initialRange] = useState<ExportDateRange>(defaultExportRange);
  const mounted = useRef(true);
  const [range, setRange] = useState<ExportDateRange>(initialRange);
  const [purpose, setPurpose] = useState<AggregateReportExportPurpose>("pilot_operations_review");
  const [state, setState] = useState<"idle" | "preparing" | "ready" | "error">("idle");
  const [lastExport, setLastExport] = useState<AggregateReportExportResponse | null>(null);

  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setState("preparing");
    setLastExport(null);
    try {
      const prepared = await prepareAggregateReportExport(toExportRequest(range, purpose));
      if (!mounted.current) return;
      downloadAggregateReportCsv(prepared);
      setLastExport(prepared);
      setState("ready");
    } catch {
      if (!mounted.current) return;
      setState("error");
    }
  }

  return (
    <article
      className="admin-panel-card admin-aggregate-export-card"
      aria-label="Authorized aggregate export"
    >
      <div className="admin-panel-card-heading">
        <div>
          <p className="admin-eyebrow">Export / Audited aggregate</p>
          <h3>Authorized CSV export</h3>
        </div>
        <span className="admin-status-badge admin-status-scheduled">Owner / admin</span>
      </div>
      <p>
        Download only the aggregate operational and progress metrics already shown here. The export
        excludes names, emails, member records, documents, and source identifiers.
      </p>

      <form className="admin-aggregate-export-form" onSubmit={(event) => void submit(event)}>
        <label>
          Purpose
          <select
            onChange={(event) => setPurpose(event.target.value as AggregateReportExportPurpose)}
            value={purpose}
          >
            {aggregateReportExportPurposes.map((value) => (
              <option key={value} value={value}>
                {purposeLabels[value]}
              </option>
            ))}
          </select>
        </label>
        <label>
          From
          <input
            max={range.to}
            onChange={(event) => setRange((current) => ({ ...current, from: event.target.value }))}
            required
            type="date"
            value={range.from}
          />
        </label>
        <label>
          To
          <input
            min={range.from}
            onChange={(event) => setRange((current) => ({ ...current, to: event.target.value }))}
            required
            type="date"
            value={range.to}
          />
        </label>
        <button className="admin-home-link" disabled={state === "preparing"} type="submit">
          {state === "preparing" ? "Preparing CSV..." : "Prepare and download CSV"}
        </button>
      </form>

      <p className="admin-report-muted">
        The server journals purpose, requesting actor, scope, checksum, and a ten-minute expiry. It
        does not retain the CSV file.
      </p>

      {state === "preparing" ? (
        <p className="admin-report-state" role="status" aria-live="polite">
          Preparing audited aggregate export...
        </p>
      ) : null}
      {state === "ready" && lastExport ? (
        <p className="admin-report-state" role="status" aria-live="polite">
          CSV downloaded. Authorization expires at{" "}
          {new Date(lastExport.expiresAt).toLocaleTimeString("en-GB", {
            hour: "2-digit",
            minute: "2-digit",
          })}
          .
        </p>
      ) : null}
      {state === "error" ? (
        <p className="admin-report-state" role="alert">
          Unable to prepare the aggregate export. Please try again.
        </p>
      ) : null}
    </article>
  );
}
