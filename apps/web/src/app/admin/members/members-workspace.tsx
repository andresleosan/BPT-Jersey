"use client";

import Link from "next/link";
import { startTransition, useEffect, useMemo, useState } from "react";
import type { MemberOverview, MemberOverviewRow } from "@bpt-jersey/domain/members/overview";
import { getMemberOverview } from "../../../lib/member-overview-client";
import { AdminSectionHeader } from "../admin-ui";
import { AdminDataTable } from "../admin-data-table";
import { MemberNameSearch } from "./member-name-search";
import { DataReview } from "./data-review";
import { flagLabels, levelLabel } from "./member-overview-labels";
import { FamiliesView } from "./families-view";
import { recordHref } from "./profile/member-record";

import "../admin.css";

export const memberViews = [
  { value: "all", label: "All members" },
  { value: "families", label: "Families" },
  { value: "review", label: "Data review" },
] as const;
export type MemberView = (typeof memberViews)[number]["value"];

/** Counter tiles double as the status filter; the directory opens on Active. */
const statusFilters = [
  { value: "active", label: "Active", detail: "Current plan" },
  { value: "expiring", label: "Expiring in 30 days", detail: "Plan ends soon" },
  { value: "review", label: "Details to review", detail: "Missing data" },
  { value: "inactive", label: "Inactive", detail: "No longer training" },
] as const;
type StatusFilter = (typeof statusFilters)[number]["value"] | "everyone";

function groupLabel(row: MemberOverviewRow): string {
  const band = row.ageBand === "kids" ? "Kids" : row.ageBand === "teens" ? "Teens" : row.ageBand === "adult" ? "Adults" : "Group to be confirmed";
  return row.centreConfirmed ? `${band} · ${row.trainingCenter}` : `${band} · centre to be confirmed`;
}

function planLabel(row: MemberOverviewRow): { title: string; detail: string } {
  if (!row.plan) return { title: row.flags.includes("plan-to-confirm") ? "Previous plan" : "No plan", detail: row.flags.includes("plan-to-confirm") ? "Validity to be confirmed" : "—" };
  const ends = row.plan.endsAt ? new Date(row.plan.endsAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : null;
  const detail =
    row.planState === "expired" ? `Expired on ${ends ?? "—"}` : ends ? `Valid until ${ends}` : "Ongoing";
  return { title: row.plan.displayName, detail };
}

export function matchesStatus(row: MemberOverviewRow, filter: StatusFilter): boolean {
  switch (filter) {
    case "everyone":
      return true;
    case "active":
      return row.active && (row.planState === "current" || row.planState === "expiring");
    case "expiring":
      return row.planState === "expiring";
    case "review":
      return row.flags.length > 0;
    case "inactive":
      return !row.active;
  }
}

export function filterRows(
  rows: readonly MemberOverviewRow[],
  filters: { query: string; status: StatusFilter; centre: string; band: string; source: string },
): MemberOverviewRow[] {
  const query = filters.query.trim().toLowerCase();
  return rows.filter(
    (row) =>
      (query === "" || row.fullName.toLowerCase().includes(query) || row.guardian?.fullName.toLowerCase().includes(query)) &&
      // The search always looks across everyone: a returning member must be findable at once.
      (query !== "" || matchesStatus(row, filters.status)) &&
      (filters.centre === "" || row.trainingCenter === filters.centre) &&
      (filters.band === "" || row.ageBand === filters.band) &&
      (filters.source === "" || row.source === filters.source),
  );
}

type WorkspaceState = { status: "loading" } | { status: "ready"; overview: MemberOverview } | { status: "error"; message: string };

function readView(search: string): MemberView {
  const view = new URLSearchParams(search).get("view");
  return memberViews.some((item) => item.value === view) ? (view as MemberView) : "all";
}

export function MembersWorkspace() {
  const [state, setState] = useState<WorkspaceState>({ status: "loading" });
  const [reloadToken, setReloadToken] = useState(0);
  const [view, setView] = useState<MemberView>("all");
  const [status, setStatus] = useState<StatusFilter>("active");
  const [query, setQuery] = useState("");
  const [centre, setCentre] = useState("");
  const [band, setBand] = useState("");
  const [source, setSource] = useState("");

  useEffect(() => {
    setView(readView(window.location.search));
  }, []);

  useEffect(() => {
    let live = true;
    void getMemberOverview()
      .then((overview) => live && startTransition(() => setState({ status: "ready", overview })))
      .catch((error: unknown) =>
        live && startTransition(() => setState({ status: "error", message: error instanceof Error ? error.message : "Unable to load the member directory." })),
      );
    return () => {
      live = false;
    };
  }, [reloadToken]);

  const rows = state.status === "ready" ? state.overview.rows : [];
  const visible = useMemo(() => filterRows(rows, { query, status, centre, band, source }), [rows, query, status, centre, band, source]);
  const counters = state.status === "ready" ? state.overview.counters : undefined;
  const reload = () => setReloadToken((token) => token + 1);

  function selectView(next: MemberView) {
    setView(next);
    const url = new URL(window.location.href);
    if (next === "all") url.searchParams.delete("view");
    else url.searchParams.set("view", next);
    window.history.replaceState(null, "", url);
  }

  const columns = [
    {
      key: "member",
      label: "Member",
      render: (row: MemberOverviewRow) => (
        <div className="members-cell">
          <Link className="member-record-link" href={recordHref(row.studentId)}>
            {row.fullName}
          </Link>
          <span className="members-cell-detail">
            {row.age === undefined ? "Age unknown" : `${row.age} years`} · {row.source === "regyfit" ? "Regyfit" : "BPT registration"}
          </span>
        </div>
      ),
    },
    {
      key: "level",
      label: "Level / group",
      render: (row: MemberOverviewRow) => (
        <div className="members-cell">
          <span>{levelLabel(row.levelKey)}</span>
          <span className="members-cell-detail">{groupLabel(row)}</span>
        </div>
      ),
    },
    {
      key: "plan",
      label: "Plan and status",
      render: (row: MemberOverviewRow) => {
        const plan = planLabel(row);
        return (
          <div className="members-cell">
            <span>{plan.title}</span>
            <span className={`members-cell-detail members-plan-${row.planState}`}>{plan.detail}</span>
          </div>
        );
      },
    },
    {
      key: "guardian",
      label: "Guardian / account",
      render: (row: MemberOverviewRow) => (
        <div className="members-cell">
          <span>{row.guardian ? row.guardian.fullName : row.ownAccount ? "Own account" : row.ageBand === "adult" ? "No account yet" : "—"}</span>
          <span className="members-cell-detail">
            {row.guardian ? (row.guardian.online ? "Online access" : "Office contact only") : row.ownAccount ? "Online access" : "No online access"}
          </span>
        </div>
      ),
    },
    {
      key: "review",
      label: "Review",
      render: (row: MemberOverviewRow) =>
        row.flags[0] === undefined ? (
          <span className="members-cell-detail">—</span>
        ) : (
          <span className="member-review-badge">
            <span aria-hidden="true" className="member-review-dot" />
            {flagLabels[row.flags[0]]}
            {row.flags.length > 1 ? ` +${row.flags.length - 1}` : ""}
          </span>
        ),
    },
  ];

  return (
    <section className="admin-module-page" aria-labelledby="members-title">
      <AdminSectionHeader
        actions={
          <>
            <Link className="admin-auth-button" href="/admin/members/add">
              Add member
            </Link>
            <Link className="admin-home-link" href="/admin/members/requests">
              Enrolment requests
            </Link>
          </>
        }
        description="Every athlete, their family and their history. New registrations appear here once approved; pending requests are in Enrolment requests."
        eyebrow="Members"
        title="Members"
      />

      <div className="members-counters" role="group" aria-label="Member status filters">
        {statusFilters.map((item) => (
          <button
            key={item.value}
            aria-pressed={status === item.value}
            className={`admin-metric members-counter${status === item.value ? " members-counter-selected" : ""}`}
            onClick={() => {
              setStatus((current) => (current === item.value ? "everyone" : item.value));
              if (view !== "all") selectView("all");
            }}
            type="button"
          >
            <span className="admin-card-label">{item.label}</span>
            <strong>{counters ? counters[item.value] : "—"}</strong>
            <span>{item.detail}</span>
          </button>
        ))}
      </div>

      <nav aria-label="Members views" className="members-tabs">
        <ul role="tablist">
          {memberViews.map((item) => (
            <li key={item.value} role="presentation">
              <button
                aria-selected={view === item.value}
                className="members-tab"
                onClick={() => selectView(item.value)}
                role="tab"
                type="button"
              >
                {item.label}
                {item.value === "review" && counters ? <span className="members-tab-count">{counters.review}</span> : null}
              </button>
            </li>
          ))}
        </ul>
      </nav>

      {state.status === "loading" ? (
        <p aria-live="polite" className="admin-no-results" role="status">
          Loading members...
        </p>
      ) : state.status === "error" ? (
        <div className="admin-no-results">
          <p aria-live="assertive" role="alert">
            {state.message}
          </p>
          <button className="button" onClick={reload} type="button">
            Try again
          </button>
        </div>
      ) : view === "families" ? (
        <FamiliesView rows={state.overview.rows} />
      ) : view === "review" ? (
        <DataReview rows={state.overview.rows.filter((row) => row.flags.length > 0)} onSaved={reload} />
      ) : (
        <section className="admin-panel-card" aria-label="Member directory">
          <div className="admin-filter-bar members-filters">
            <label className="admin-filter-control members-search">
              Search
              <input
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search members or guardians"
                type="search"
                value={query}
              />
            </label>
            <label className="admin-filter-control">
              Status
              <select onChange={(event) => setStatus(event.target.value as StatusFilter)} value={status}>
                <option value="everyone">Everyone</option>
                {statusFilters.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="admin-filter-control">
              Centre
              <select onChange={(event) => setCentre(event.target.value)} value={centre}>
                <option value="">Town and West</option>
                <option value="Town">Town</option>
                <option value="West">West</option>
              </select>
            </label>
            <label className="admin-filter-control">
              Group
              <select onChange={(event) => setBand(event.target.value)} value={band}>
                <option value="">All groups</option>
                <option value="kids">Kids</option>
                <option value="teens">Teens</option>
                <option value="adult">Adults</option>
              </select>
            </label>
            <label className="admin-filter-control">
              Source
              <select onChange={(event) => setSource(event.target.value)} value={source}>
                <option value="">All sources</option>
                <option value="regyfit">Regyfit linked</option>
                <option value="bpt">New BPT registration</option>
              </select>
            </label>
          </div>
          <p className="members-count" role="status">
            {visible.length} of {rows.length} members
          </p>
          {visible.length === 0 ? (
            <p aria-live="polite" className="admin-no-results" role="status">
              No members match these filters.
            </p>
          ) : (
            <AdminDataTable caption="Member directory" columns={columns} rowKey={(row) => row.studentId} rows={visible} />
          )}
          <details className="members-legacy-tools">
            <summary>Migration tools</summary>
            <p>
              Legacy members not yet in this directory are decided in the <Link href="/admin/members/migration">migration queue</Link>;
              the imported archive stays readable from each member record. Exact-name lookup:
            </p>
            <MemberNameSearch />
          </details>
        </section>
      )}
    </section>
  );
}
