"use client";

import { useState } from "react";

import { AdminSectionHeader } from "../admin-ui";
import { previewData } from "../preview-data";
import { AdminGate } from "../admin-gate";

import "../admin.css";

export function ReportsPage() {
  const [preparedReport, setPreparedReport] = useState<string>();

  return (
    <section className="admin-module-page" aria-labelledby="reports-title">
      <AdminSectionHeader
        description="Prepare operational summaries for members, attendance, memberships, finance, CRM, and progress."
        eyebrow="Reports / Synthetic preview"
        title="Reports"
      />
      <div className="admin-report-grid">
        {[
          ...previewData.reports,
          {
            title: "CRM follow-up",
            description: "Review enquiries, trials, and next actions.",
            updated: "Ready for preview",
          },
          {
            title: "Progress coverage",
            description: "Review assessment coverage and coach updates.",
            updated: "Ready for preview",
          },
          {
            title: "Membership status",
            description: "Review active, paused, overdue, and cancelled plans.",
            updated: "Ready for preview",
          },
        ].map((report) => (
          <article
            className="admin-panel-card"
            aria-label={`${report.title} report`}
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
      </div>
    </section>
  );
}

export default function ReportsRoute() {
  return (
    <AdminGate>
      <ReportsPage />
    </AdminGate>
  );
}
