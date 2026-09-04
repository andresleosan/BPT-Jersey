"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { DailyOperationsDashboard } from "@bpt-jersey/domain/schedule";
import type { OperationalReport } from "@bpt-jersey/domain/reports";

import { AdminMetric, AdminSectionHeader, AdminStatusBadge } from "../admin-ui";
import { AdminDataTable } from "../admin-data-table";
import { getOperationalReport } from "../../../lib/reports-client";
import { getDailyOperationsDashboard } from "../../../lib/schedule-client";

import "../admin.css";

type OverviewClass = Readonly<{
  name: string;
  group: string;
  coach: string;
  time: string;
  capacity: number;
  booked: number;
  status: string;
}>;

type OverviewData = Readonly<{
  dashboard: DailyOperationsDashboard;
  report: OperationalReport;
}>;

type OverviewState =
  { status: "loading" } | { status: "ready"; data: OverviewData } | { status: "error" };

const classColumns = [
  { key: "name", label: "Activity", render: (item: OverviewClass) => <strong>{item.name}</strong> },
  { key: "group", label: "Class ID", render: (item: OverviewClass) => item.group },
  { key: "time", label: "Time", render: (item: OverviewClass) => item.time },
  { key: "coach", label: "Instructor ID", render: (item: OverviewClass) => item.coach },
  {
    key: "capacity",
    label: "Capacity",
    render: (item: OverviewClass) => `${item.booked} / ${item.capacity}`,
  },
  {
    key: "status",
    label: "Status",
    render: (item: OverviewClass) => <AdminStatusBadge status={item.status} />,
  },
] as const;

const quickActions = [
  { label: "Add new member", href: "/admin/members/add" },
  { label: "Search members", href: "/admin/members/search" },
  { label: "Classes", href: "/admin/classes" },
  { label: "Create / manage activities", href: "/admin/activities" },
  { label: "Attendance", href: "/admin/attendance" },
  { label: "Finance", href: "/admin/finance" },
  { label: "Reports", href: "/admin/reports" },
] as const;

function getTodayQuery() {
  const date = new Date().toISOString().slice(0, 10);
  return {
    from: date + "T00:00:00.000Z",
    to: date + "T23:59:59.999Z",
  } as const;
}

function toClassRows(dashboard: DailyOperationsDashboard): readonly OverviewClass[] {
  return dashboard.sessions.map(({ session, summary }) => ({
    name: session.title,
    group: session.classId ?? "Not linked",
    coach: session.instructorId,
    time: `${session.startAt.slice(11, 16)} - ${session.endAt.slice(11, 16)}`,
    capacity: summary.capacity,
    booked: summary.totalBookings,
    status: session.status,
  }));
}

export function OverviewPage() {
  const [state, setState] = useState<OverviewState>({ status: "loading" });

  useEffect(() => {
    let active = true;
    const query = getTodayQuery();
    void Promise.all([getDailyOperationsDashboard(query), getOperationalReport(query)]).then(
      ([dashboard, report]) => {
        if (active) setState({ status: "ready", data: { dashboard, report } });
      },
      () => {
        if (active) setState({ status: "error" });
      },
    );
    return () => {
      active = false;
    };
  }, []);

  if (state.status === "loading") {
    return (
      <section className="admin-overview" aria-labelledby="overview-title">
        <AdminSectionHeader
          eyebrow="Academy operations / Connected"
          title="Today's academy view"
          description="Loading the academy's connected schedule, student and membership data."
        />
        <p role="status" aria-live="polite">
          Loading connected dashboard...
        </p>
      </section>
    );
  }

  if (state.status === "error") {
    return (
      <section className="admin-overview" aria-labelledby="overview-title">
        <AdminSectionHeader
          eyebrow="Academy operations / Connected"
          title="Today's academy view"
          description="The dashboard only displays data returned by the connected backend."
        />
        <p className="admin-report-state" role="alert">
          Unable to load today&apos;s connected dashboard. No synthetic data was displayed.
        </p>
      </section>
    );
  }

  const { dashboard, report } = state.data;
  const classes = toClassRows(dashboard);
  const attendancePending = dashboard.sessions.reduce(
    (total, snapshot) => total + snapshot.summary.totalPendingArrival,
    0,
  );
  const attention = [
    report.memberships.overdue > 0
      ? `${report.memberships.overdue} overdue memberships`
      : "No overdue memberships",
    attendancePending > 0
      ? `${attendancePending} arrivals pending across today's sessions`
      : "No arrivals pending for today's sessions",
    report.attendance.noShow > 0
      ? `${report.attendance.noShow} no-shows in today's window`
      : "No no-shows in today's window",
  ];

  return (
    <section className="admin-overview" aria-labelledby="overview-title">
      <AdminSectionHeader
        eyebrow="Academy operations / Connected"
        title="Today's academy view"
        description="Live schedule and canonical student, membership and attendance aggregates for the authenticated academy."
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
          detail="Connected sessions for today"
          label="Classes today"
          value={dashboard.sessions.length}
        />
        <AdminMetric
          detail="Active student profiles"
          label="Members"
          value={report.students.activeStudents}
        />
        <AdminMetric
          detail="Pending arrival in today's sessions"
          label="Attendance pending"
          value={attendancePending}
        />
        <AdminMetric
          detail="Membership records marked overdue"
          label="Overdue memberships"
          value={report.memberships.overdue}
        />
      </div>

      <div className="admin-overview-grid">
        <section
          className="admin-panel-card admin-panel-card-wide"
          aria-labelledby="today-classes-title"
        >
          <div className="admin-panel-card-heading">
            <div>
              <p className="admin-eyebrow">Connected schedule</p>
              <h3 id="today-classes-title">Today&apos;s classes</h3>
            </div>
            <Link className="admin-text-link" href="/admin/activities">
              View activities
            </Link>
          </div>
          {classes.length === 0 ? (
            <p className="admin-empty-state">No connected sessions are scheduled for today.</p>
          ) : (
            <AdminDataTable
              caption="Today's classes"
              columns={classColumns}
              rowKey={(item) => `${item.name}-${item.time}`}
              rows={classes}
            />
          )}
        </section>

        <section className="admin-panel-card" aria-labelledby="attention-title">
          <div className="admin-panel-card-heading">
            <div>
              <p className="admin-eyebrow">Next actions</p>
              <h3 id="attention-title">Needs attention</h3>
            </div>
          </div>
          <ul className="admin-action-list">
            {attention.map((action) => (
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
