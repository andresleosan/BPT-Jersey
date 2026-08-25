"use client";

import { useEffect, useState } from "react";
import type { DailyOperationsDashboard } from "@bpt-jersey/domain/schedule";

import { getDailyOperationsDashboard } from "../../../lib/schedule-client";

import "../admin.css";

function getTodayQuery() {
  const date = new Date().toISOString().slice(0, 10);
  return {
    from: date + "T00:00:00.000Z",
    to: date + "T23:59:59.999Z",
  } as const;
}

export function LiveOperationsPanel() {
  const [dashboard, setDashboard] = useState<DailyOperationsDashboard | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    let mounted = true;

    void getDailyOperationsDashboard(getTodayQuery())
      .then((result) => {
        if (!mounted) return;
        setDashboard(result);
        setState("ready");
      })
      .catch(() => {
        if (!mounted) return;
        setState("error");
      });

    return () => {
      mounted = false;
    };
  }, []);

  return (
    <section
      className="admin-panel-card admin-panel-card-wide"
      aria-labelledby="live-operations-title"
    >
      <div className="admin-panel-card-heading">
        <div>
          <p className="admin-eyebrow">Connected operational source</p>
          <h3 id="live-operations-title">Today&apos;s live operations</h3>
        </div>
        <span className="admin-status-badge admin-status-scheduled">Staff view</span>
      </div>

      {state === "loading" ? <p role="status">Loading connected sessions...</p> : null}
      {state === "error" ? (
        <p role="status">
          Connected operational data is unavailable. Preview data remains visible above.
        </p>
      ) : null}
      {state === "ready" && dashboard?.sessions.length === 0 ? (
        <p role="status">No connected sessions are scheduled for today.</p>
      ) : null}
      {dashboard?.sessions.length ? (
        <div className="admin-data-table-wrap">
          <table className="admin-data-table">
            <caption className="sr-only">Connected sessions for today</caption>
            <thead>
              <tr>
                <th scope="col">Activity</th>
                <th scope="col">Time</th>
                <th scope="col">Bookings</th>
                <th scope="col">Checked in</th>
                <th scope="col">Checked out</th>
                <th scope="col">Arrival queue</th>
              </tr>
            </thead>
            <tbody>
              {dashboard.sessions.map((snapshot) => (
                <tr key={snapshot.session.sessionId}>
                  <th scope="row">{snapshot.session.title}</th>
                  <td>
                    {snapshot.session.startAt.slice(11, 16)} -{" "}
                    {snapshot.session.endAt.slice(11, 16)}
                  </td>
                  <td>
                    {snapshot.summary.totalBookings} / {snapshot.summary.capacity}
                  </td>
                  <td>{snapshot.summary.totalCheckedIn}</td>
                  <td>{snapshot.summary.totalCheckedOut}</td>
                  <td>{snapshot.summary.totalPendingArrival}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}
