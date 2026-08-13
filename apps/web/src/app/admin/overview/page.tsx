"use client";

import Link from "next/link";

import { AdminMetric, AdminSectionHeader, AdminStatusBadge } from "../admin-ui";
import { AdminDataTable } from "../admin-data-table";
import { previewData, type PreviewClass } from "../preview-data";

import "../admin.css";

const classColumns = [
  { key: "name", label: "Activity", render: (item: PreviewClass) => <strong>{item.name}</strong> },
  { key: "group", label: "Group", render: (item: PreviewClass) => item.group },
  { key: "time", label: "Time", render: (item: PreviewClass) => item.time },
  { key: "coach", label: "Coach", render: (item: PreviewClass) => item.coach },
  {
    key: "capacity",
    label: "Capacity",
    render: (item: PreviewClass) => `${item.booked} / ${item.capacity}`,
  },
  {
    key: "status",
    label: "Status",
    render: (item: PreviewClass) => <AdminStatusBadge status={item.status} />,
  },
] as const;

const quickActions = [
  { label: "Add new member", href: "/admin/members/add" },
  { label: "Search members", href: "/admin/members/search" },
  { label: "Groups / teams", href: "/admin/groups" },
  { label: "Create / manage activities", href: "/admin/activities" },
  { label: "Attendance", href: "/admin/attendance" },
  { label: "Finance", href: "/admin/finance" },
  { label: "Reports", href: "/admin/reports" },
] as const;

export function OverviewPage() {
  const dashboard = previewData.dashboard;

  return (
    <section className="admin-overview" aria-labelledby="overview-title">
      <AdminSectionHeader
        eyebrow="Academy operations / Synthetic preview"
        title="Today's academy view"
        description="A working control room for classes, members, attendance, and payment follow-up. Preview data is local and synthetic until the connected sources are approved."
      />

      <div className="admin-quick-actions" aria-label="Quick actions">
        {quickActions.map((action) => (
          <Link className="admin-quick-action" href={action.href} key={action.href}>
            <span aria-hidden="true">-&gt;</span>
            {action.label}
          </Link>
        ))}
      </div>

      <div className="admin-metrics-grid" aria-label="Academy metrics">
        <AdminMetric
          detail="Scheduled across the academy"
          label="Classes today"
          value={`${dashboard.classesToday}`}
        />
        <AdminMetric
          detail="Active memberships"
          label="Members"
          value={`${dashboard.activeMembers}`}
        />
        <AdminMetric
          detail="Awaiting attendance review"
          label="Attendance pending"
          value={`${dashboard.attendancePending}`}
        />
        <AdminMetric
          detail="Requires follow-up"
          label="Overdue payments"
          value={`${dashboard.overduePayments}`}
        />
      </div>

      <div className="admin-overview-grid">
        <section
          className="admin-panel-card admin-panel-card-wide"
          aria-labelledby="today-classes-title"
        >
          <div className="admin-panel-card-heading">
            <div>
              <p className="admin-eyebrow">Live schedule</p>
              <h3 id="today-classes-title">Today&apos;s classes</h3>
            </div>
            <Link className="admin-text-link" href="/admin/activities">
              View activities
            </Link>
          </div>
          <AdminDataTable
            caption="Today's classes"
            columns={classColumns}
            rowKey={(item) => `${item.name}-${item.time}`}
            rows={dashboard.todaysClasses}
          />
        </section>

        <section className="admin-panel-card" aria-labelledby="attention-title">
          <div className="admin-panel-card-heading">
            <div>
              <p className="admin-eyebrow">Next actions</p>
              <h3 id="attention-title">Needs attention</h3>
            </div>
          </div>
          <ul className="admin-action-list">
            {dashboard.recentActions.map((action) => (
              <li key={action}>
                <span aria-hidden="true">/</span>
                {action}
              </li>
            ))}
          </ul>
          <Link className="admin-text-link" href="/admin/finance">
            Review finance
          </Link>
        </section>
      </div>
    </section>
  );
}

export default function OverviewRoute() {
  return <OverviewPage />;
}
