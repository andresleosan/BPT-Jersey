"use client";

import Link from "next/link";
import type {
  FinancialDashboard,
  FinancialDashboardBalanceRow,
  FinancialDashboardPaymentRow,
  FinancialDashboardRenewalRow,
} from "@bpt-jersey/domain/finance/dashboard";

import { AdminDataTable } from "../admin-data-table";
import { AdminStatusBadge } from "../admin-ui";
import { formatDate, formatMoney } from "../billing/billing-format";
import { recordHref } from "../members/profile/member-record";

export const financeTabs = ["payments", "owed", "renewals", "invoices", "settings"] as const;
export type FinanceTab = (typeof financeTabs)[number];
export const financeTabLabels: Readonly<Record<FinanceTab, string>> = {
  payments: "Payments",
  owed: "Owed",
  renewals: "Renewals",
  invoices: "Invoices",
  settings: "Settings",
};

export function readFinanceTab(search: string): FinanceTab {
  const tab = new URLSearchParams(search).get("tab");
  return (financeTabs as readonly string[]).includes(tab ?? "") ? (tab as FinanceTab) : "payments";
}

const sourceLabels: Readonly<Record<FinancialDashboardPaymentRow["source"], string>> = {
  membership: "Plan",
  payg: "Pay as you go",
  private_lesson: "Private lesson",
  course: "Course",
  shop: "Shop",
  adjustment: "Adjustment",
};
const methodLabels: Readonly<Record<FinancialDashboardPaymentRow["method"], string>> = {
  cash: "Cash",
  bank_transfer: "Bank transfer",
  other: "Other",
  at_collection: "Pay on collection",
};

export type NameOf = (studentId: string | null, fallback: string) => string;

export function PaymentsPanel({
  rows,
  monthLabel,
  nameOf,
  busy,
  onEdit,
  onVoid,
}: {
  rows: FinancialDashboard["payments"];
  monthLabel: string;
  nameOf: NameOf;
  busy: boolean;
  onEdit: (row: FinancialDashboardPaymentRow) => void;
  onVoid: (row: FinancialDashboardPaymentRow) => void;
}) {
  if (rows.length === 0) return <p className="admin-empty-state">No payments in {monthLabel}.</p>;
  return (
    <AdminDataTable
      caption={`Payments in ${monthLabel}`}
      columns={[
        {
          key: "date",
          label: "Date",
          render: (row: FinancialDashboardPaymentRow) => formatDate(row.occurredAt),
        },
        {
          key: "member",
          label: "Member",
          render: (row: FinancialDashboardPaymentRow) =>
            row.source === "shop" ? (
              <Link className="admin-text-link" href="/admin/shop">
                {row.label}
              </Link>
            ) : (
              nameOf(row.studentId, row.label)
            ),
        },
        {
          key: "source",
          label: "Source",
          render: (row: FinancialDashboardPaymentRow) => sourceLabels[row.source],
        },
        {
          key: "method",
          label: "Method",
          render: (row: FinancialDashboardPaymentRow) => methodLabels[row.method],
        },
        {
          key: "amount",
          label: "Amount",
          render: (row: FinancialDashboardPaymentRow) =>
            row.voided ? (
              <s className="finance-voided-amount">{formatMoney(row.amountMinor)}</s>
            ) : (
              formatMoney(row.amountMinor)
            ),
        },
        {
          key: "actions",
          label: "Actions",
          render: (row: FinancialDashboardPaymentRow) =>
            row.voided ? (
              <span className="finance-voided-note">
                Voided — {row.voided.reason} ({row.voided.voidedByName},{" "}
                {formatDate(row.voided.voidedAt)})
              </span>
            ) : (
              <span className="finance-row-actions">
                {row.editable ? (
                  <button
                    className="family-text-button"
                    disabled={busy}
                    onClick={() => onEdit(row)}
                    type="button"
                  >
                    Edit
                  </button>
                ) : null}
                {row.voidable ? (
                  <button
                    className="family-text-button"
                    disabled={busy}
                    onClick={() => onVoid(row)}
                    type="button"
                  >
                    Void
                  </button>
                ) : null}
              </span>
            ),
        },
      ]}
      rowKey={(row) => row.rowId}
      rows={rows}
    />
  );
}

export function OwedPanel({
  rows,
  nameOf,
  busy,
  onRecordPayment,
}: {
  rows: FinancialDashboard["balances"];
  nameOf: NameOf;
  busy: boolean;
  onRecordPayment: (row: FinancialDashboardBalanceRow) => void;
}) {
  if (rows.length === 0) {
    return <p className="admin-empty-state">Nobody owes anything right now.</p>;
  }
  return (
    <AdminDataTable
      caption="Invoices with a balance"
      columns={[
        {
          key: "member",
          label: "Member",
          render: (row: FinancialDashboardBalanceRow) => nameOf(row.studentId, row.label),
        },
        {
          key: "invoice",
          label: "Invoice",
          render: (row: FinancialDashboardBalanceRow) => row.invoiceReference,
        },
        {
          key: "due",
          label: "Due",
          render: (row: FinancialDashboardBalanceRow) => formatDate(row.dueAt),
        },
        {
          key: "balance",
          label: "Balance",
          render: (row: FinancialDashboardBalanceRow) => formatMoney(row.balanceMinor),
        },
        {
          key: "status",
          label: "Status",
          render: (row: FinancialDashboardBalanceRow) => (
            <AdminStatusBadge status={row.overdue ? "Overdue" : "Due later"} />
          ),
        },
        {
          key: "actions",
          label: "Actions",
          render: (row: FinancialDashboardBalanceRow) => (
            <span className="finance-row-actions">
              <button
                className="family-text-button"
                disabled={busy}
                onClick={() => onRecordPayment(row)}
                type="button"
              >
                Record payment
              </button>
            </span>
          ),
        },
      ]}
      rowKey={(row) => row.invoiceId}
      rows={rows}
    />
  );
}

const renewalStatusLabels: Readonly<Record<FinancialDashboardRenewalRow["status"], string>> = {
  overdue: "Overdue",
  trial: "Trial",
  active: "Active",
};

function RenewalTable({
  caption,
  rows,
  nameOf,
  empty,
}: {
  caption: string;
  rows: readonly FinancialDashboardRenewalRow[];
  nameOf: NameOf;
  empty: string;
}) {
  return (
    <>
      <h3 className="finance-subheading">{caption}</h3>
      {rows.length === 0 ? (
        <p className="admin-empty-state">{empty}</p>
      ) : (
        <AdminDataTable
          caption={caption}
          columns={[
            {
              key: "member",
              label: "Member",
              render: (row: FinancialDashboardRenewalRow) => nameOf(row.studentId, "Member record"),
            },
            {
              key: "plan",
              label: "Plan",
              render: (row: FinancialDashboardRenewalRow) => row.planName,
            },
            {
              key: "date",
              label: "Renews",
              render: (row: FinancialDashboardRenewalRow) =>
                row.nextBillingAt ? formatDate(row.nextBillingAt) : "Not set",
            },
            {
              key: "status",
              label: "Status",
              render: (row: FinancialDashboardRenewalRow) => (
                <AdminStatusBadge status={renewalStatusLabels[row.status]} />
              ),
            },
            {
              key: "actions",
              label: "Actions",
              render: (row: FinancialDashboardRenewalRow) => (
                <Link className="admin-text-link" href={recordHref(row.studentId, "plan")}>
                  Open plan
                </Link>
              ),
            },
          ]}
          rowKey={(row) => row.membershipId}
          rows={rows}
        />
      )}
    </>
  );
}

export function RenewalsPanel({
  renewals,
  nameOf,
}: {
  renewals: FinancialDashboard["renewals"];
  nameOf: NameOf;
}) {
  return (
    <>
      <RenewalTable
        caption="Overdue"
        empty="No plan is past its renewal date."
        nameOf={nameOf}
        rows={renewals.overdue}
      />
      <RenewalTable
        caption="Due in the next 30 days"
        empty="No renewals are due in the next 30 days."
        nameOf={nameOf}
        rows={renewals.dueSoon}
      />
    </>
  );
}
