"use client";

import type { ManualPaymentRecord } from "@bpt-jersey/domain/finance";
import type { MemberNameRow } from "@bpt-jersey/domain/members/directory";

import type { FinancialAccount, InvoiceView } from "../../../lib/billing-client";
import { AdminDataTable } from "../admin-data-table";
import { AdminStatusBadge } from "../admin-ui";
import { formatDate, formatMoney, methodLabel } from "./billing-format";

type Props = Readonly<{
  member: MemberNameRow;
  account: FinancialAccount | undefined;
  status: "loading" | "ready" | "error";
  busy: boolean;
  onRecordPayment: (view: InvoiceView) => void;
  onVoid: (view: InvoiceView) => void;
}>;

type PaymentRow = Readonly<{ payment: ManualPaymentRecord; invoice: InvoiceView["invoice"] }>;

export function MemberAccountPanel({
  member,
  account,
  status,
  busy,
  onRecordPayment,
  onVoid,
}: Props) {
  const payments: readonly PaymentRow[] = account
    ? account.invoices
        .flatMap((view) =>
          view.payments.map((payment) => ({ payment, invoice: view.invoice }) as PaymentRow),
        )
        .sort((a, b) => b.payment.occurredAt.localeCompare(a.payment.occurredAt))
    : [];
  const titleId = `member-account-${member.studentId}`;
  return (
    <section aria-labelledby={titleId} className="admin-panel-card" role="region">
      <div className="admin-panel-card-heading">
        <div>
          <p className="admin-eyebrow">Member account</p>
          <h3 id={titleId}>{member.fullName}&apos;s account</h3>
        </div>
        {account ? (
          <strong className="billing-balance">Balance {formatMoney(account.balanceMinor)}</strong>
        ) : null}
      </div>
      {status === "loading" ? <div aria-busy="true" className="billing-skeleton" /> : null}
      {status === "error" ? (
        <p className="family-error" role="alert">
          Unable to load this family&apos;s account. Please try again.
        </p>
      ) : null}
      {member.familyId === null ? (
        <p className="family-error" role="alert">
          This member has no billing family yet, so there is no account to show.
        </p>
      ) : null}
      {account ? (
        <>
          <AdminDataTable
            caption="All payments"
            columns={[
              {
                key: "date",
                label: "Date",
                render: (row: PaymentRow) => formatDate(row.payment.occurredAt),
              },
              {
                key: "invoice",
                label: "Invoice",
                render: (row: PaymentRow) => (
                  <>
                    <strong>{row.invoice.invoiceReference}</strong>
                    <small className="billing-cell-note">{row.invoice.description}</small>
                  </>
                ),
              },
              {
                key: "method",
                label: "Method",
                render: (row: PaymentRow) => methodLabel[row.payment.method],
              },
              {
                key: "amount",
                label: "Amount",
                render: (row: PaymentRow) => formatMoney(row.payment.amountMinor),
              },
            ]}
            rowKey={(row) => row.payment.paymentId}
            rows={payments}
          />
          {payments.length === 0 ? (
            <p className="admin-empty-state">No payments recorded for this family yet.</p>
          ) : null}
          <AdminDataTable
            caption="Invoices"
            columns={[
              {
                key: "reference",
                label: "Invoice",
                render: (view: InvoiceView) => <strong>{view.invoice.invoiceReference}</strong>,
              },
              {
                key: "due",
                label: "Due",
                render: (view: InvoiceView) => formatDate(view.invoice.dueAt),
              },
              {
                key: "total",
                label: "Total",
                render: (view: InvoiceView) => formatMoney(view.invoice.totalMinor),
              },
              {
                key: "balance",
                label: "Balance",
                render: (view: InvoiceView) => formatMoney(view.balanceMinor),
              },
              {
                key: "status",
                label: "Status",
                render: (view: InvoiceView) => <AdminStatusBadge status={view.invoice.status} />,
              },
              {
                key: "actions",
                label: "Actions",
                render: (view: InvoiceView) => (
                  <InvoiceRowActions
                    busy={busy}
                    onRecordPayment={onRecordPayment}
                    onVoid={onVoid}
                    view={view}
                  />
                ),
              },
            ]}
            rowKey={(view) => view.invoice.invoiceId}
            rows={account.invoices}
          />
          {account.invoices.length === 0 ? (
            <p className="admin-empty-state">No invoices have been issued to this family.</p>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

export function InvoiceRowActions({
  view,
  busy,
  onRecordPayment,
  onVoid,
}: {
  view: InvoiceView;
  busy: boolean;
  onRecordPayment: (view: InvoiceView) => void;
  onVoid: (view: InvoiceView) => void;
}) {
  const canReceivePayment =
    view.invoice.schemaVersion !== 2 && (view.invoice.status === "open" || view.invoice.status === "partially_paid") &&
    view.balanceMinor > 0;
  const canVoid = view.invoice.schemaVersion !== 2 && view.invoice.status === "open" && view.payments.length === 0;
  return (
    <div className="admin-table-actions">
      {view.invoice.schemaVersion === 2 ? <a href="/admin/courses">Course payment</a> : null}
      {canReceivePayment ? (
        <button
          aria-label={`Record payment for ${view.invoice.invoiceReference}`}
          className="family-text-button"
          disabled={busy}
          onClick={() => onRecordPayment(view)}
          type="button"
        >
          Record payment
        </button>
      ) : null}
      {canVoid ? (
        <button
          aria-label={`Void ${view.invoice.invoiceReference}`}
          className="family-text-button"
          disabled={busy}
          onClick={() => onVoid(view)}
          type="button"
        >
          Void
        </button>
      ) : null}
    </div>
  );
}
