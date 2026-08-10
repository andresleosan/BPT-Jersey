import { AdminGate } from "./admin-gate";
import { AdminAccessRecordsContent } from "./regyfit-access-records/page";
export { AdminShell } from "./admin-shell";

import "./admin.css";

const uncapturedModules = [
  {
    id: "members",
    label: "Members",
    description: "Profiles, families, and academy relationships will appear here.",
  },
  {
    id: "attendance",
    label: "Attendance",
    description: "Class check-ins and attendance history will appear here.",
  },
  {
    id: "reports",
    label: "Reports",
    description: "Operational summaries will appear here.",
  },
  {
    id: "crm",
    label: "CRM",
    description: "Follow-ups and academy communications will appear here.",
  },
  {
    id: "finance",
    label: "Finance",
    description: "Membership and payment summaries will appear here.",
  },
  {
    id: "regyfit-access-records-preview",
    label: "Regyfit Access Records",
    description: "Imported access records will appear here when the source is verified.",
  },
] as const;

export function AdminOverview() {
  return (
    <section className="admin-overview" id="overview" aria-labelledby="overview-title">
      <header className="admin-page-heading">
        <p className="admin-eyebrow">Academy operations</p>
        <h2 id="overview-title">A clear view of the work.</h2>
        <p>
          The administrative workspace is ready for verified academy data. Nothing is shown until
          its source and access rules are in place.
        </p>
      </header>

      <div className="admin-module-grid" aria-label="Administrative modules">
        {uncapturedModules.map((module) => (
          <article className="admin-module-card" id={module.id} key={module.id}>
            <div className="admin-module-card-header">
              <p className="admin-card-index" aria-hidden="true">
                / / /
              </p>
              <p className="admin-card-label">Module</p>
            </div>
            <h3>{module.label}</h3>
            <p>{module.description}</p>
            <div className="admin-empty-state" data-testid="admin-empty-state">
              <span className="admin-empty-mark" aria-hidden="true">
                0
              </span>
              <strong>Not yet imported</strong>
            </div>
          </article>
        ))}
      </div>

      <AdminAccessRecordsContent />
    </section>
  );
}

export default function AdminPage() {
  return (
    <AdminGate>
      <AdminOverview />
    </AdminGate>
  );
}
