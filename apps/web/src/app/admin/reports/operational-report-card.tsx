"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import type { OperationalReport, OperationalReportQuery } from "@bpt-jersey/domain/reports";

import { getOperationalReport } from "../../../lib/reports-client";

type ReportDateRange = Readonly<{
  from: string;
  to: string;
}>;

function defaultReportRange(now = new Date()): ReportDateRange {
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  const day = String(now.getUTCDate()).padStart(2, "0");
  return {
    from: year + "-" + month + "-01",
    to: year + "-" + month + "-" + day,
  };
}

function toReportQuery(range: ReportDateRange): OperationalReportQuery {
  return {
    from: range.from + "T00:00:00.000Z",
    to: range.to + "T23:59:59.999Z",
  };
}

function formatGbp(amountMinor: number): string {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
  }).format(amountMinor / 100);
}

function HeadlineMetric({ label, value }: Readonly<{ label: string; value: string | number }>) {
  return (
    <div className="admin-operational-report-metric">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function BreakdownRow({ label, value }: Readonly<{ label: string; value: string | number }>) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

export function OperationalReportCard() {
  const [initialRange] = useState<ReportDateRange>(defaultReportRange);
  const mounted = useRef(true);
  const [range, setRange] = useState<ReportDateRange>(initialRange);
  const [report, setReport] = useState<OperationalReport | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");

  async function loadReport(query: OperationalReportQuery): Promise<void> {
    try {
      const nextReport = await getOperationalReport(query);
      if (!mounted.current) return;
      setReport(nextReport);
      setState("ready");
    } catch {
      if (!mounted.current) return;
      setReport(null);
      setState("error");
    }
  }

  useEffect(() => {
    let active = true;
    mounted.current = true;
    void getOperationalReport(toReportQuery(initialRange)).then(
      (nextReport) => {
        if (!active) return;
        setReport(nextReport);
        setState("ready");
      },
      () => {
        if (!active) return;
        setReport(null);
        setState("error");
      },
    );
    return () => {
      active = false;
      mounted.current = false;
    };
  }, [initialRange]);

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    setState("loading");
    void loadReport(toReportQuery(range));
  }

  return (
    <article
      className="admin-panel-card admin-operational-report-card"
      aria-label="Operational reports"
    >
      <div className="admin-panel-card-heading">
        <div>
          <p className="admin-eyebrow">Operations / Connected aggregate</p>
          <h3>Students, attendance and finance</h3>
        </div>
        <span className="admin-status-badge admin-status-scheduled">Owner / admin</span>
      </div>
      <p>
        Current student and membership status, plus attendance and manual GBP finance for the
        selected period.
      </p>

      <form className="admin-operational-report-filter" onSubmit={submit}>
        <label>
          From
          <input
            max={range.to}
            onChange={(event) => setRange((current) => ({ ...current, from: event.target.value }))}
            required
            type="date"
            value={range.from}
          />
        </label>
        <label>
          To
          <input
            min={range.from}
            onChange={(event) => setRange((current) => ({ ...current, to: event.target.value }))}
            required
            type="date"
            value={range.to}
          />
        </label>
        <button className="admin-home-link" disabled={state === "loading"} type="submit">
          Refresh operational report
        </button>
      </form>

      {state === "loading" ? (
        <p className="admin-report-state" role="status" aria-live="polite">
          Loading operational report...
        </p>
      ) : null}

      {state === "error" ? (
        <div className="admin-report-state" role="alert">
          <p>Unable to load operational report. Please try again.</p>
          <button
            className="admin-home-link"
            onClick={() => {
              setState("loading");
              void loadReport(toReportQuery(range));
            }}
            type="button"
          >
            Retry operational report
          </button>
        </div>
      ) : null}

      {state === "ready" && report ? (
        <>
          <dl
            className="admin-operational-report-metrics"
            aria-label="Operational report headline metrics"
          >
            <HeadlineMetric label="Active students" value={report.students.activeStudents} />
            <HeadlineMetric label="Checked in" value={report.attendance.checkedIn} />
            <HeadlineMetric label="Active memberships" value={report.memberships.active} />
            <HeadlineMetric
              label="Manual revenue"
              value={formatGbp(report.revenue.receivedMinor)}
            />
          </dl>

          <div className="admin-operational-report-sections">
            <section aria-labelledby="student-report-title">
              <h4 id="student-report-title">Students now</h4>
              <dl>
                <BreakdownRow label="Total profiles" value={report.students.totalStudents} />
                <BreakdownRow label="Active adults" value={report.students.activeAdults} />
                <BreakdownRow label="Active minors" value={report.students.activeMinors} />
                <BreakdownRow
                  label="Town / West"
                  value={report.students.activeTown + " / " + report.students.activeWest}
                />
                <BreakdownRow label="Inactive" value={report.students.inactiveStudents} />
                <BreakdownRow label="Suspended" value={report.students.suspendedStudents} />
              </dl>
            </section>

            <section aria-labelledby="attendance-report-title">
              <h4 id="attendance-report-title">Attendance period</h4>
              <dl>
                <BreakdownRow
                  label="Attendance rate"
                  value={report.attendance.attendanceRatePercentage + "%"}
                />
                <BreakdownRow label="Attended" value={report.attendance.attended} />
                <BreakdownRow label="Late" value={report.attendance.late} />
                <BreakdownRow label="No-show" value={report.attendance.noShow} />
                <BreakdownRow label="Absent" value={report.attendance.absent} />
                <BreakdownRow label="Excused" value={report.attendance.excused} />
              </dl>
            </section>

            <section aria-labelledby="membership-report-title">
              <h4 id="membership-report-title">Membership status</h4>
              <dl>
                <BreakdownRow
                  label="Current records"
                  value={report.memberships.currentMemberships}
                />
                <BreakdownRow label="Trial" value={report.memberships.trial} />
                <BreakdownRow label="Active" value={report.memberships.active} />
                <BreakdownRow label="Paused" value={report.memberships.paused} />
                <BreakdownRow label="Overdue" value={report.memberships.overdue} />
                <BreakdownRow label="Cancelled" value={report.memberships.cancelled} />
              </dl>
            </section>

            <section aria-labelledby="revenue-report-title">
              <h4 id="revenue-report-title">Manual finance period</h4>
              <dl>
                <BreakdownRow label="Issued" value={formatGbp(report.revenue.issuedMinor)} />
                <BreakdownRow label="Received" value={formatGbp(report.revenue.receivedMinor)} />
                <BreakdownRow
                  label="Outstanding"
                  value={formatGbp(report.revenue.outstandingMinor)}
                />
                <BreakdownRow label="Invoices" value={report.revenue.invoiceCount} />
                <BreakdownRow label="Payments" value={report.revenue.paymentCount} />
                <BreakdownRow
                  label="Cash / bank / other"
                  value={
                    report.revenue.paymentsByMethod.cash +
                    " / " +
                    report.revenue.paymentsByMethod.bankTransfer +
                    " / " +
                    report.revenue.paymentsByMethod.other
                  }
                />
              </dl>
            </section>
          </div>
        </>
      ) : null}
    </article>
  );
}
