"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { DailyOperationsDashboard } from "@bpt-jersey/domain/schedule";
import type { OperationalReport } from "@bpt-jersey/domain/reports";
import { upcomingBirthdayMaxWindowDays, type UpcomingBirthday } from "@bpt-jersey/domain/birthdays";

import { AdminMetric, AdminSectionHeader, AdminStatusBadge } from "./admin-ui";
import { AdminDataTable } from "./admin-data-table";
import { useAdminOrStaffSession } from "./admin-gate";
import { recordHref } from "./members/profile/member-record";
import { getOperationalReport } from "../../lib/reports-client";
import { getDailyOperationsDashboard } from "../../lib/schedule-client";
import { birthdayDateLabel, listUpcomingBirthdays } from "../../lib/birthdays-client";

import { AdminNotificationPanel } from "./notifications/admin-notification-panel";

import "./admin.css";

type OverviewClass = Readonly<{
  name: string;
  group: string;
  coach: string;
  time: string;
  capacity: number | null;
  booked: number;
  status: string;
}>;

type OverviewData = Readonly<{
  dashboard: DailyOperationsDashboard;
  report: OperationalReport | null;
}>;

type OverviewState =
  { status: "loading" } | { status: "ready"; data: OverviewData } | { status: "error" };

type BirthdayState =
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "ready"; entries: readonly UpcomingBirthday[] }>
  | Readonly<{ status: "error" }>;

const nextBirthdaysShown = 3;

const classColumns = [
  { key: "name", label: "Activity", render: (item: OverviewClass) => <strong>{item.name}</strong> },
  { key: "group", label: "Class ID", render: (item: OverviewClass) => item.group },
  { key: "time", label: "Time", render: (item: OverviewClass) => item.time },
  { key: "coach", label: "Instructor ID", render: (item: OverviewClass) => item.coach },
  {
    key: "capacity",
    label: "Capacity",
    render: (item: OverviewClass) =>
      item.capacity === null ? "Set capacity" : `${item.booked} / ${item.capacity}`,
  },
  {
    key: "status",
    label: "Status",
    render: (item: OverviewClass) => <AdminStatusBadge status={item.status} />,
  },
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

function BirthdayTodayBand({ entries }: { entries: readonly UpcomingBirthday[] }) {
  const today = entries.filter((entry) => entry.daysAway === 0);
  if (today.length === 0) return null;
  const [first] = today;
  return (
    <aside className="admin-birthday-today" aria-label="Birthday today" role="status">
      <p className="admin-eyebrow">Birthday today</p>
      <h3>
        {today.length === 1 && first
          ? `${first.displayName} turns ${first.turningAge} today`
          : `${today.length} birthdays today`}
      </h3>
      <ul className="admin-birthday-today-names">
        {today.map((entry) => (
          <li key={entry.studentId}>
            <Link className="admin-birthday-badge" href={recordHref(entry.studentId)}>
              {entry.displayName}
            </Link>
          </li>
        ))}
      </ul>
    </aside>
  );
}

function NextBirthdaysCard({ state }: { state: BirthdayState }) {
  return (
    <section className="admin-panel-card" aria-labelledby="next-birthdays-title">
      <div className="admin-panel-card-heading">
        <div>
          <p className="admin-eyebrow">People</p>
          <h3 id="next-birthdays-title">Next birthdays</h3>
        </div>
      </div>
      {state.status === "loading" ? <p role="status">Loading birthdays...</p> : null}
      {state.status === "error" ? (
        <p className="admin-report-state">Birthdays are temporarily unavailable.</p>
      ) : null}
      {state.status === "ready" && state.entries.length === 0 ? (
        <p className="admin-empty-state">No birthdays recorded for the year ahead.</p>
      ) : null}
      {state.status === "ready" && state.entries.length > 0 ? (
        <ol className="admin-birthday-list">
          {state.entries.map((entry) => (
            <li key={entry.studentId}>
              <span className="admin-birthday-date">
                {entry.daysAway === 0 ? "Today" : birthdayDateLabel(entry.daysAway)}
              </span>
              <strong>
                <Link href={recordHref(entry.studentId)}>{entry.displayName}</Link>
              </strong>
              <span className="admin-birthday-age">turns {entry.turningAge}</span>
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}

export function OverviewPage() {
  const session = useAdminOrStaffSession();
  const office = session.role === "owner" || session.role === "administrator";
  const [state, setState] = useState<OverviewState>({ status: "loading" });
  const [birthdays, setBirthdays] = useState<BirthdayState>({ status: "loading" });

  useEffect(() => {
    let active = true;
    const query = getTodayQuery();
    const dashboardPromise = getDailyOperationsDashboard(query);
    const reportPromise = office ? getOperationalReport(query) : Promise.resolve(null);
    void Promise.all([dashboardPromise, reportPromise]).then(
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
  }, [office]);

  useEffect(() => {
    let active = true;
    void listUpcomingBirthdays({ windowDays: upcomingBirthdayMaxWindowDays }).then(
      (entries) => {
        if (active)
          setBirthdays({ status: "ready", entries: entries.slice(0, nextBirthdaysShown) });
      },
      () => {
        if (active) setBirthdays({ status: "error" });
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
        {office ? <AdminNotificationPanel key="notifications" role={session.role} /> : null}
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
        {office ? <AdminNotificationPanel key="notifications" role={session.role} /> : null}
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
    ...(office && report
      ? [
          report.memberships.overdue > 0
            ? `${report.memberships.overdue} overdue memberships`
            : "No overdue memberships",
        ]
      : []),
    attendancePending > 0
      ? `${attendancePending} arrivals pending across today's sessions`
      : "No arrivals pending for today's sessions",
    ...(office && report
      ? [
          report.attendance.noShow > 0
            ? `${report.attendance.noShow} no-shows in today's window`
            : "No no-shows in today's window",
        ]
      : []),
  ];

  return (
    <section className="admin-overview" aria-labelledby="overview-title">
      <AdminSectionHeader
        eyebrow="Academy operations / Connected"
        title="Today's academy view"
        description="Live schedule and canonical student, membership and attendance aggregates for the authenticated academy."
      />
      {office ? <AdminNotificationPanel key="notifications" role={session.role} /> : null}

      {birthdays.status === "ready" ? <BirthdayTodayBand entries={birthdays.entries} /> : null}

      <div className="admin-metrics-grid" aria-label="Academy metrics">
        <AdminMetric
          detail="Connected sessions for today"
          label="Classes today"
          value={dashboard.sessions.length}
        />
        <AdminMetric
          detail="Pending arrival in today's sessions"
          label="Attendance pending"
          value={attendancePending}
        />
        {office && report ? (
          <AdminMetric
            detail="Membership records marked overdue"
            label="Overdue memberships"
            value={report.memberships.overdue}
          />
        ) : null}
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
            {office || session.role === "headCoach" ? (
              <Link className="admin-text-link" href="/admin/classes">
                Manage classes and sessions
              </Link>
            ) : null}
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
          {office ? (
            <Link className="admin-text-link" href="/admin/finance">
              Review finance
            </Link>
          ) : null}
        </section>

        <NextBirthdaysCard state={birthdays} />
      </div>
    </section>
  );
}
