"use client";

import { useState } from "react";

import { AdminFilterBar, AdminMetric, AdminSectionHeader, AdminStatusBadge } from "../admin-ui";
import { AdminDataTable } from "../admin-data-table";
import { previewData, type PreviewPayment } from "../preview-data";

import "../admin.css";

const columns = [
  {
    key: "member",
    label: "Member",
    render: (item: PreviewPayment) => <strong>{item.member}</strong>,
  },
  { key: "reference", label: "Reference", render: (item: PreviewPayment) => item.reference },
  { key: "date", label: "Date", render: (item: PreviewPayment) => item.date },
  { key: "amount", label: "Amount", render: (item: PreviewPayment) => item.amount },
  {
    key: "status",
    label: "Status",
    render: (item: PreviewPayment) => <AdminStatusBadge status={item.status} />,
  },
] as const;

export function FinancePage() {
  const [status, setStatus] = useState("All statuses");
  const [period, setPeriod] = useState("This month");
  const payments = previewData.payments.filter(
    (payment) =>
      (status === "All statuses" || payment.status === status) &&
      (period === "This month" ||
        period === "This year" ||
        (period === "Last month" && payment.date.includes("Jul"))),
  );

  return (
    <section className="admin-module-page" aria-labelledby="finance-title">
      <AdminSectionHeader
        description="Track membership revenue, overdue balances, renewals, invoices, and receipts without exposing card data."
        eyebrow="Finance / Synthetic preview"
        title="Finance"
      />
      <div className="admin-metrics-grid">
        <AdminMetric detail="This month" label="Membership revenue" value="£8,420" />
        <AdminMetric detail="Current plans" label="Active memberships" value="126" />
        <AdminMetric detail="Requires follow-up" label="Outstanding balance" value="£1,260" />
        <AdminMetric detail="Last 30 days" label="Payments received" value="94" />
      </div>
      <AdminFilterBar>
        <label className="admin-filter-control">
          Payment status
          <select
            aria-label="Payment status"
            onChange={(event) => setStatus(event.target.value)}
            value={status}
          >
            <option>All statuses</option>
            <option>Paid</option>
            <option>Pending</option>
            <option>Overdue</option>
          </select>
        </label>
        <label className="admin-filter-control">
          Period
          <select
            aria-label="Finance period"
            onChange={(event) => setPeriod(event.target.value)}
            value={period}
          >
            <option>This month</option>
            <option>Last month</option>
            <option>This year</option>
          </select>
        </label>
      </AdminFilterBar>
      <section className="admin-panel-card" aria-labelledby="payments-table-title">
        <div className="admin-panel-card-heading">
          <div>
            <p className="admin-eyebrow">Recent activity</p>
            <h3 id="payments-table-title">Payment history</h3>
          </div>
          <span className="admin-status-badge admin-status-active">Synthetic preview</span>
        </div>
        <AdminDataTable
          caption="Payment history"
          columns={columns}
          rowKey={(item) => item.reference}
          rows={payments}
        />
        {payments.length === 0 ? (
          <p className="admin-empty-state">No payments match these filters.</p>
        ) : null}
      </section>
    </section>
  );
}

export default function FinanceRoute() {
  return <FinancePage />;
}
