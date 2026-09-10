import { AdminSectionHeader } from "../admin-ui";
import { AggregateReportExportCard } from "./aggregate-report-export-card";
import { OperationalReportCard } from "./operational-report-card";
import { ProgressReportCard } from "./progress-report-card";

import "../admin.css";

export function ReportsPage() {
  return (
    <section className="admin-module-page" aria-labelledby="reports-title">
      <AdminSectionHeader
        description="Review connected operational aggregates for students, attendance, memberships, manual finance, and progress."
        eyebrow="Reports / Connected"
        title="Reports"
      />
      <div className="admin-report-grid">
        <OperationalReportCard />

        <ProgressReportCard />
        <AggregateReportExportCard />
      </div>
    </section>
  );
}

export default function ReportsRoute() {
  return <ReportsPage />;
}
