"use client";

import { useEffect, useMemo, useState } from "react";

import type { LeadRecord } from "@bpt-jersey/domain/crm";
import { AdminFilterBar, AdminSectionHeader } from "../admin-ui";
import { listCrmLeads } from "../../../lib/crm-client";

import "../admin.css";

const stageLabels: Record<LeadRecord["status"], string> = {
  new_enquiry: "New enquiry",
  trial_booked: "Trial booked",
  trial_attended: "Trial attended",
  follow_up: "Follow-up",
  won: "Won",
  lost: "Lost",
};

const ownerLabels: Record<string, string> = {
  "reception-f": "Reception",
  "admin-team-f": "Admin team",
};

type CrmState =
  { status: "loading" } | { status: "ready"; leads: readonly LeadRecord[] } | { status: "error" };

export function CrmPage() {
  const [stage, setStage] = useState("All stages");
  const [owner, setOwner] = useState("All owners");
  const [state, setState] = useState<CrmState>({ status: "loading" });

  useEffect(() => {
    let active = true;
    void listCrmLeads().then(
      (leads) => {
        if (active) setState({ status: "ready", leads });
      },
      () => {
        if (active) setState({ status: "error" });
      },
    );
    return () => {
      active = false;
    };
  }, []);

  const filteredLeads = useMemo(
    () =>
      (state.status === "ready" ? state.leads : []).filter(
        (lead) =>
          (stage === "All stages" || stageLabels[lead.status] === stage) &&
          (owner === "All owners" || (ownerLabels[lead.ownerId] ?? lead.ownerId) === owner),
      ),
    [state, owner, stage],
  );

  return (
    <section className="admin-module-page" aria-labelledby="crm-title">
      <AdminSectionHeader
        description="Keep enquiries, trials, follow-ups, and retention actions visible to the academy team."
        eyebrow="CRM / Connected"
        title="CRM"
      />
      <AdminFilterBar>
        <label className="admin-filter-control">
          Stage
          <select
            aria-label="CRM stage"
            onChange={(event) => setStage(event.target.value)}
            value={stage}
          >
            <option>All stages</option>
            <option>New enquiry</option>
            <option>Trial booked</option>
            <option>Follow-up</option>
          </select>
        </label>
        <label className="admin-filter-control">
          Owner
          <select
            aria-label="CRM owner"
            onChange={(event) => setOwner(event.target.value)}
            value={owner}
          >
            <option>All owners</option>
            <option>Reception</option>
            <option>Admin team</option>
          </select>
        </label>
      </AdminFilterBar>
      {state.status === "loading" ? <p role="status">Loading connected CRM leads...</p> : null}
      {state.status === "error" ? (
        <p className="admin-report-state" role="alert">
          Unable to load connected CRM leads. No synthetic data was displayed.
        </p>
      ) : null}
      {state.status === "ready" ? (
        <div className="admin-lead-list">
          {filteredLeads.map((lead) => (
            <article
              aria-label={lead.contactReference}
              className="admin-panel-card"
              key={lead.leadId}
            >
              <p className="admin-eyebrow">{stageLabels[lead.status]}</p>
              <h3>{lead.contactReference}</h3>
              <p>
                {lead.nextActionAt ? `Next action: ${lead.nextActionAt}` : "No next action set"}
              </p>
              <span className="admin-status-badge admin-status-active">
                Owner: {ownerLabels[lead.ownerId] ?? lead.ownerId}
              </span>
            </article>
          ))}
          {filteredLeads.length === 0 ? (
            <p className="admin-empty-state">No leads available.</p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

export default function CrmRoute() {
  return <CrmPage />;
}
