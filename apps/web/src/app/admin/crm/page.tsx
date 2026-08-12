"use client";

import { useState } from "react";

import { AdminFilterBar, AdminSectionHeader } from "../admin-ui";
import { AdminGate } from "../admin-gate";

import "../admin.css";

const leads = [
  {
    name: "Morgan family",
    stage: "Trial booked",
    nextAction: "Confirm Thursday class",
    owner: "Reception",
  },
  {
    name: "Jamie Carter",
    stage: "New enquiry",
    nextAction: "Call back today",
    owner: "Admin team",
  },
  {
    name: "Riley Stone",
    stage: "Follow-up",
    nextAction: "Send membership options",
    owner: "Reception",
  },
] as const;

export function CrmPage() {
  const [stage, setStage] = useState("All stages");
  const [owner, setOwner] = useState("All owners");
  const filteredLeads = leads.filter(
    (lead) =>
      (stage === "All stages" || lead.stage === stage) &&
      (owner === "All owners" || lead.owner === owner),
  );

  return (
    <section className="admin-module-page" aria-labelledby="crm-title">
      <AdminSectionHeader
        description="Keep enquiries, trials, follow-ups, and retention actions visible to the academy team."
        eyebrow="CRM / Synthetic preview"
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
      <div className="admin-lead-list">
        {filteredLeads.map((lead) => (
          <article aria-label={lead.name} className="admin-panel-card" key={lead.name}>
            <p className="admin-eyebrow">{lead.stage}</p>
            <h3>{lead.name}</h3>
            <p>{lead.nextAction}</p>
            <span className="admin-status-badge admin-status-active">Owner: {lead.owner}</span>
          </article>
        ))}
        {filteredLeads.length === 0 ? (
          <p className="admin-empty-state">No leads match these filters.</p>
        ) : null}
      </div>
    </section>
  );
}

export default function CrmRoute() {
  return (
    <AdminGate>
      <CrmPage />
    </AdminGate>
  );
}
