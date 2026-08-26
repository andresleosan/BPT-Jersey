"use client";

import { useEffect, useMemo, useState } from "react";

import type { LeadRecord } from "@bpt-jersey/domain/crm";
import { AdminFilterBar, AdminSectionHeader } from "../admin-ui";
import { listCrmLeads } from "../../../lib/crm-client";

import "../admin.css";

const syntheticLeads: readonly LeadRecord[] = [
  {
    academyId: "demo-academy",
    leadId: "lead-morgan-f",
    schemaVersion: "1",
    createdBy: "synthetic-seed",
    updatedBy: "synthetic-seed",
    contactReference: "Morgan family",
    source: "website-f",
    ownerId: "reception-f",
    status: "trial_booked",
    nextActionAt: "2026-08-27T10:00:00Z",
    consentState: "unknown",
    createdAt: "2026-08-25T10:00:00Z",
    updatedAt: "2026-08-25T10:00:00Z",
  },
  {
    academyId: "demo-academy",
    leadId: "lead-jamie-f",
    schemaVersion: "1",
    createdBy: "synthetic-seed",
    updatedBy: "synthetic-seed",
    contactReference: "Jamie Carter",
    source: "referral-f",
    ownerId: "admin-team-f",
    status: "new_enquiry",
    nextActionAt: "2026-08-26T10:00:00Z",
    consentState: "unknown",
    createdAt: "2026-08-25T10:00:00Z",
    updatedAt: "2026-08-25T10:00:00Z",
  },
  {
    academyId: "demo-academy",
    leadId: "lead-riley-f",
    schemaVersion: "1",
    createdBy: "synthetic-seed",
    updatedBy: "synthetic-seed",
    contactReference: "Riley Stone",
    source: "walk_in-f",
    ownerId: "reception-f",
    status: "follow_up",
    nextActionAt: "2026-08-28T10:00:00Z",
    consentState: "unknown",
    createdAt: "2026-08-25T10:00:00Z",
    updatedAt: "2026-08-25T10:00:00Z",
  },
];

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

const backendEnabled = process.env.NEXT_PUBLIC_CRM_BACKEND === "true";

export function CrmPage() {
  const [stage, setStage] = useState("All stages");
  const [owner, setOwner] = useState("All owners");
  const [leads, setLeads] = useState<readonly LeadRecord[]>(syntheticLeads);
  const [loadState, setLoadState] = useState<"synthetic" | "loading" | "ready" | "error">(
    backendEnabled ? "loading" : "synthetic",
  );

  useEffect(() => {
    if (!backendEnabled) return;
    let active = true;
    void listCrmLeads()
      .then((result) => {
        if (!active) return;
        setLeads(result);
        setLoadState("ready");
      })
      .catch(() => {
        if (!active) return;
        setLoadState("error");
      });
    return () => {
      active = false;
    };
  }, []);

  const filteredLeads = useMemo(
    () =>
      leads.filter(
        (lead) =>
          (stage === "All stages" || stageLabels[lead.status] === stage) &&
          (owner === "All owners" || (ownerLabels[lead.ownerId] ?? lead.ownerId) === owner),
      ),
    [leads, owner, stage],
  );

  return (
    <section className="admin-module-page" aria-labelledby="crm-title">
      <AdminSectionHeader
        description="Keep enquiries, trials, follow-ups, and retention actions visible to the academy team."
        eyebrow={loadState === "synthetic" ? "CRM / Synthetic preview" : "CRM / Callable backend"}
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
          <article
            aria-label={lead.contactReference}
            className="admin-panel-card"
            key={lead.leadId}
          >
            <p className="admin-eyebrow">{stageLabels[lead.status]}</p>
            <h3>{lead.contactReference}</h3>
            <p>{lead.nextActionAt ? `Next action: ${lead.nextActionAt}` : "No next action set"}</p>
            <span className="admin-status-badge admin-status-active">
              Owner: {ownerLabels[lead.ownerId] ?? lead.ownerId}
            </span>
          </article>
        ))}
        {filteredLeads.length === 0 ? (
          <p className="admin-empty-state">
            {loadState === "error"
              ? "CRM backend unavailable; showing no live leads."
              : "No leads match these filters."}
          </p>
        ) : null}
      </div>
    </section>
  );
}

export default function CrmRoute() {
  return <CrmPage />;
}
