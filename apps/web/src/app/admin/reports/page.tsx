"use client";

import { useState } from "react";

import { AdminSectionHeader } from "../admin-ui";
import { AggregateReportExportCard } from "./aggregate-report-export-card";
import { OperationalReportCard } from "./operational-report-card";
import { ProgressReportCard } from "./progress-report-card";

import "../admin.css";

const previewReports = [
  {
    title: "CRM follow-up",
    description: "Review enquiries, trials, and next actions after the pilot.",
    updated: "Post-pilot preview",
  },
] as const;

export function ReportsPage() {
  const [preparedReport, setPreparedReport] = useState<string>();

  return (
    <section className="admin-module-page" aria-labelledby="reports-title">
      <AdminSectionHeader
        description="Review connected operational aggregates for students, attendance, memberships, manual finance, and progress."
        eyebrow="Reports / Connected and preview"
        title="Reports"
      />
      <div className="admin-report-grid">
        <OperationalReportCard />

        {previewReports.map((report) => (
          <article
            className="admin-panel-card"
            aria-label={report.title + " report"}
            key={report.title}
          >
            <p className="admin-eyebrow">Report / Preview</p>
            <h3>{report.title}</h3>
            <p>{report.description}</p>
            <div className="admin-report-card-footer">
              <span role={preparedReport === report.title ? "status" : undefined}>
                {preparedReport === report.title ? "Report ready for preview" : report.updated}
              </span>
              <button
                className="admin-home-link"
                onClick={() => setPreparedReport(report.title)}
                type="button"
              >
                Prepare {report.title.toLowerCase()} report
              </button>
            </div>
          </article>
        ))}

        <ProgressReportCard />
        <AggregateReportExportCard />
      </div>
    </section>
  );
}

export default function ReportsRoute() {
  return <ReportsPage />;
}
