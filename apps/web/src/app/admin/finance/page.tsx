"use client";

import { useEffect, useMemo, useState } from "react";
import type {
  FinancialDashboard,
  FinancialDashboardBalance,
  FinancialDashboardPayment,
  FinancialDashboardRenewal,
} from "@bpt-jersey/domain/finance/dashboard";

import { getFinancialDashboard } from "../../../lib/finance-client";
import { AdminDataTable } from "../admin-data-table";
import { AdminFilterBar, AdminMetric, AdminSectionHeader, AdminStatusBadge } from "../admin-ui";

import "../admin.css";

type BalanceFilter = "All balances" | "Overdue only" | "Due later";

const moneyFormatter = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
});
const dateFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

function formatMoney(amountMinor: number): string {
  return moneyFormatter.format(amountMinor / 100);
}

function formatDate(timestamp: string): string {
  return dateFormatter.format(new Date(timestamp));
}

const balanceColumns = [
  {
    key: "reference",
    label: "Invoice reference",
    render: (item: FinancialDashboardBalance) => <strong>{item.invoiceReference}</strong>,
  },
  {
    key: "due",
    label: "Due date",
    render: (item: FinancialDashboardBalance) => formatDate(item.dueAt),
  },
  {
    key: "balance",
    label: "Balance",
    render: (item: FinancialDashboardBalance) => formatMoney(item.balanceMinor),
  },
  {
    key: "status",
    label: "Status",
    render: (item: FinancialDashboardBalance) => (
      <AdminStatusBadge status={item.overdue ? "Overdue" : "Due later"} />
    ),
  },
] as const;

const renewalColumns = [
  {
    key: "plan",
    label: "Membership plan",
    render: (item: FinancialDashboardRenewal) => <strong>{item.planId}</strong>,
  },
  {
    key: "date",
    label: "Billing date",
    render: (item: FinancialDashboardRenewal) => formatDate(item.nextBillingAt),
  },
  {
    key: "status",
    label: "Membership status",
    render: (item: FinancialDashboardRenewal) => <AdminStatusBadge status={item.status} />,
  },
] as const;

const paymentColumns = [
  {
    key: "reference",
    label: "Invoice reference",
    render: (item: FinancialDashboardPayment) => <strong>{item.invoiceReference}</strong>,
  },
  {
    key: "date",
    label: "Recorded date",
    render: (item: FinancialDashboardPayment) => formatDate(item.occurredAt),
  },
  {
    key: "amount",
    label: "Amount",
    render: (item: FinancialDashboardPayment) => formatMoney(item.amountMinor),
  },
  { key: "status", label: "Status", render: () => <AdminStatusBadge status="Recorded" /> },
] as const;

function FinanceDashboard({ dashboard }: { dashboard: FinancialDashboard }) {
  const [balanceFilter, setBalanceFilter] = useState<BalanceFilter>("All balances");
  const balances = useMemo(
    () =>
      dashboard.balanceAttention.filter(
        (balance) =>
          balanceFilter === "All balances" ||
          (balanceFilter === "Overdue only" && balance.overdue) ||
          (balanceFilter === "Due later" && !balance.overdue),
      ),
    [balanceFilter, dashboard.balanceAttention],
  );

  return (
    <>
      <div className="admin-metrics-grid">
        <AdminMetric
          detail={`${dashboard.metrics.paymentsReceived} payments this month`}
          label="Collected revenue"
          value={formatMoney(dashboard.metrics.collectedMinor)}
        />
        <AdminMetric
          detail="Current active plans"
          label="Active memberships"
          value={dashboard.metrics.activeMemberships}
        />
        <AdminMetric
          detail={`${dashboard.metrics.overdueBalances} overdue invoice balances`}
          label="Outstanding balance"
          value={formatMoney(dashboard.metrics.outstandingMinor)}
        />
        <AdminMetric
          detail="Next 30 days"
          label="Renewals due"
          value={dashboard.metrics.renewalsDue}
        />
      </div>

      <section className="finance-horizon" aria-labelledby="finance-horizon-title">
        <div className="finance-horizon-heading">
          <div>
            <p className="admin-eyebrow">Manual finance horizon</p>
            <h3 id="finance-horizon-title">Next financial actions</h3>
          </div>
          <p>
            {formatDate(dashboard.renewalWindow.from)} — {formatDate(dashboard.renewalWindow.to)}
          </p>
        </div>

        <AdminFilterBar>
          <label className="admin-filter-control">
            Balance status
            <select
              aria-label="Balance status"
              onChange={(event) => setBalanceFilter(event.target.value as BalanceFilter)}
              value={balanceFilter}
            >
              <option>All balances</option>
              <option>Overdue only</option>
              <option>Due later</option>
            </select>
          </label>
        </AdminFilterBar>

        <div className="finance-horizon-grid">
          <section className="admin-panel-card" aria-labelledby="balance-table-title">
            <div className="admin-panel-card-heading">
              <div>
                <p className="admin-eyebrow">Balance attention</p>
                <h3 id="balance-table-title">Outstanding invoices</h3>
              </div>
              <span className="admin-status-badge admin-status-overdue">
                {dashboard.metrics.overdueBalances} overdue
              </span>
            </div>
            <AdminDataTable
              caption="Outstanding invoice balances"
              columns={balanceColumns}
              rowKey={(item) => item.invoiceReference}
              rows={balances}
            />
            {balances.length === 0 ? (
              <p className="admin-empty-state">No balances match this filter.</p>
            ) : null}
          </section>

          <section className="admin-panel-card" aria-labelledby="renewal-table-title">
            <div className="admin-panel-card-heading">
              <div>
                <p className="admin-eyebrow">Billing dates</p>
                <h3 id="renewal-table-title">Upcoming renewals</h3>
              </div>
              <span className="admin-status-badge admin-status-active">
                {dashboard.metrics.renewalsDue} due
              </span>
            </div>
            <AdminDataTable
              caption="Upcoming membership renewals"
              columns={renewalColumns}
              rowKey={(item, index) => `${item.planId}:${item.nextBillingAt}:${index}`}
              rows={dashboard.upcomingRenewals}
            />
            {dashboard.upcomingRenewals.length === 0 ? (
              <p className="admin-empty-state">No renewals are due in the next 30 days.</p>
            ) : null}
          </section>
        </div>
      </section>

      <section className="admin-panel-card" aria-labelledby="payments-table-title">
        <div className="admin-panel-card-heading">
          <div>
            <p className="admin-eyebrow">Manual receipts</p>
            <h3 id="payments-table-title">Recent payments</h3>
          </div>
          <span className="admin-status-badge admin-status-active">Connected</span>
        </div>
        <AdminDataTable
          caption="Recent recorded payments"
          columns={paymentColumns}
          rowKey={(item, index) =>
            `${item.invoiceReference}:${item.occurredAt}:${item.amountMinor}:${index}`
          }
          rows={dashboard.recentPayments}
        />
        {dashboard.recentPayments.length === 0 ? (
          <p className="admin-empty-state">No manual payments have been recorded yet.</p>
        ) : null}
      </section>

      <p className="finance-dashboard-footnote">
        Snapshot refreshed {formatDate(dashboard.generatedAt)}. Renewal dates are for manual review;
        this dashboard does not charge members automatically.
      </p>
    </>
  );
}

export function FinancePage() {
  const [dashboard, setDashboard] = useState<FinancialDashboard>();
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [requestVersion, setRequestVersion] = useState(0);

  useEffect(() => {
    let current = true;
    void getFinancialDashboard()
      .then((result) => {
        if (!current) return;
        setDashboard(result);
        setStatus("ready");
      })
      .catch(() => {
        if (!current) return;
        setDashboard(undefined);
        setStatus("error");
      });
    return () => {
      current = false;
    };
  }, [requestVersion]);

  const refreshDashboard = () => {
    setStatus("loading");
    setRequestVersion((version) => version + 1);
  };

  return (
    <section className="admin-module-page finance-dashboard-page" aria-labelledby="finance-title">
      <AdminSectionHeader
        actions={
          <button
            className="admin-home-link"
            disabled={status === "loading"}
            onClick={refreshDashboard}
            type="button"
          >
            Refresh finance
          </button>
        }
        description="Review manual GBP receipts, derived balances, and upcoming billing dates without exposing member identity or card data."
        eyebrow="Finance / Connected"
        title="Finance"
      />

      {status === "loading" ? (
        <section className="finance-dashboard-state" aria-live="polite" role="status">
          <p className="admin-eyebrow">Loading</p>
          <h3>Preparing the finance ledger</h3>
          <p>Validating memberships, invoices, and manual payments.</p>
        </section>
      ) : null}

      {status === "error" ? (
        <section className="finance-dashboard-state finance-dashboard-error" role="alert">
          <p className="admin-eyebrow">Unavailable</p>
          <h3>Financial dashboard could not be loaded</h3>
          <p>No financial details were displayed. Try the request again.</p>
          <button className="admin-home-link" onClick={refreshDashboard} type="button">
            Try again
          </button>
        </section>
      ) : null}

      {status === "ready" && dashboard ? <FinanceDashboard dashboard={dashboard} /> : null}
    </section>
  );
}

export default function FinanceRoute() {
  return <FinancePage />;
}
