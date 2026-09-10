"use client";

import { useEffect, useMemo, useState } from "react";

import type { RetentionAlertKind } from "@bpt-jersey/domain";
import { AdminFilterBar, AdminSectionHeader } from "../admin-ui";
import {
  listRetentionAlerts,
  type RetentionInboxAlert,
} from "../../../lib/retention-alerts-client";

import "../admin.css";

const kindLabels: Record<RetentionAlertKind, string> = {
  attendance_gap: "Attendance gap",
  repeated_no_show: "Repeated no-show",
  membership_expiring: "Membership expiring",
};

const kindDescriptions: Record<RetentionAlertKind, string> = {
  attendance_gap: "No attended or late session was found inside the configured activity window.",
  repeated_no_show: "The configured no-show threshold was reached inside the review window.",
  membership_expiring: "The active membership ends inside the configured renewal horizon.",
};

function formatDate(value: string | null): string {
  if (value === null) return "Not recorded";
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "Europe/Jersey",
  }).format(new Date(value));
}

export default function RetentionInboxPage() {
  const [alerts, setAlerts] = useState<readonly RetentionInboxAlert[]>([]);
  const [kind, setKind] = useState<RetentionAlertKind | "all">("all");
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    let active = true;
    void listRetentionAlerts()
      .then((result) => {
        if (!active) return;
        setAlerts(result);
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

  const visibleAlerts = useMemo(
    () => alerts.filter((alert) => kind === "all" || alert.kind === kind),
    [alerts, kind],
  );

  return (
    <section className="admin-module-page" aria-labelledby="retention-inbox-title">
      <AdminSectionHeader
        description="Review explainable retention signals generated from attendance and membership snapshots. This first slice is read-only."
        eyebrow="Member care / Internal signal queue"
        title="Retention inbox"
      />

      <div className="admin-retention-summary" aria-label="Retention inbox summary">
        <div>
          <strong>{alerts.length}</strong>
          <span>open signals</span>
        </div>
        <p>
          Owner and administrator access only. No email, SMS, automatic assignment, or external CRM
          action is available here.
        </p>
      </div>

      <AdminFilterBar>
        <label className="admin-filter-control">
          Signal
          <select
            aria-label="Retention signal"
            onChange={(event) => setKind(event.target.value as RetentionAlertKind | "all")}
            value={kind}
          >
            <option value="all">All signals</option>
            <option value="attendance_gap">Attendance gap</option>
            <option value="repeated_no_show">Repeated no-show</option>
            <option value="membership_expiring">Membership expiring</option>
          </select>
        </label>
      </AdminFilterBar>

      {loadState === "loading" ? (
        <p className="admin-empty-state" role="status">
          Loading retention signals...
        </p>
      ) : null}
      {loadState === "error" ? (
        <p className="admin-empty-state" role="alert">
          Retention signals could not be loaded. Please try again later.
        </p>
      ) : null}
      {loadState === "ready" && visibleAlerts.length === 0 ? (
        <p className="admin-empty-state">No retention signals match this filter.</p>
      ) : null}

      {loadState === "ready" && visibleAlerts.length > 0 ? (
        <div className="admin-retention-list" aria-label="Open retention signals">
          {visibleAlerts.map((alert) => (
            <article
              aria-label={kindLabels[alert.kind] + " for " + alert.studentReference}
              className="admin-panel-card admin-retention-card"
              key={alert.studentReference + ":" + alert.kind + ":" + alert.createdAt}
            >
              <div className="admin-retention-card-heading">
                <p className="admin-eyebrow">{kindLabels[alert.kind]}</p>
                <span className="admin-status-badge admin-status-attention">Open</span>
              </div>
              <h3>{alert.studentReference}</h3>
              <p>{kindDescriptions[alert.kind]}</p>
              <dl className="admin-retention-evidence">
                <div>
                  <dt>Last attended</dt>
                  <dd>{formatDate(alert.evidence.lastAttendedAt)}</dd>
                </div>
                <div>
                  <dt>No-shows</dt>
                  <dd>{alert.evidence.noShowCount}</dd>
                </div>
                <div>
                  <dt>Membership ends</dt>
                  <dd>{formatDate(alert.evidence.membershipEndsAt)}</dd>
                </div>
                <div>
                  <dt>Signal date</dt>
                  <dd>{formatDate(alert.createdAt)}</dd>
                </div>
              </dl>
            </article>
          ))}
        </div>
      ) : null}
    </section>
  );
}
