"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  FinancialDashboard,
  FinancialDashboardBalance,
  FinancialDashboardRenewal,
} from "@bpt-jersey/domain/finance/dashboard";
import type { RecentPaymentRow } from "@bpt-jersey/domain/finance";
import type { MemberNameRow } from "@bpt-jersey/domain/members/directory";

import {
  getFamilyFinancialAccount,
  getFinancialDashboard,
  listRecentPayments,
} from "../../../lib/finance-client";
import {
  listFinancialAccount,
  voidManualInvoice,
  type FinancialAccount,
  type InvoiceView,
} from "../../../lib/billing-client";
import { listMemberships, type AdminMembership } from "../../../lib/membership-admin-client";
import { listMemberNames } from "../../../lib/members-client";
import { AdminDataTable } from "../admin-data-table";
import { AdminMetric, AdminSectionHeader, AdminStatusBadge } from "../admin-ui";
import { formatDate, formatMoney, methodLabel } from "./billing-format";
import { IssueInvoiceDialog } from "./issue-invoice-dialog";
import { InvoiceRowActions, MemberAccountPanel } from "./member-account-panel";
import { MemberPicker } from "./member-picker";
import { NoShowPenaltyQueue } from "./no-show-penalty-queue";
import { PaymentInstructionsPanel } from "./payment-instructions-panel";
import { RecordPaymentDialog } from "./record-payment-dialog";
import { IntroApplicationsPanel } from "./intro-applications-panel";

import "../admin.css";
import "./billing.css";

type RequestState = "loading" | "ready" | "error";

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

type DialogState =
  Readonly<{ kind: "invoice" }> | Readonly<{ kind: "payment"; invoice: InvoiceView | null }>;

export function BillingPage() {
  const [dashboard, setDashboard] = useState<FinancialDashboard>();
  const [dashboardState, setDashboardState] = useState<RequestState>("loading");
  const [recent, setRecent] = useState<readonly RecentPaymentRow[]>();
  const [recentState, setRecentState] = useState<RequestState>("loading");
  const [account, setAccount] = useState<FinancialAccount>();
  const [accountState, setAccountState] = useState<RequestState>("loading");
  const [memberships, setMemberships] = useState<readonly AdminMembership[]>([]);
  const [members, setMembers] = useState<readonly MemberNameRow[] | null>(null);
  const [membersError, setMembersError] = useState<string>();
  const [member, setMember] = useState<MemberNameRow | null>(null);
  const [familyAccount, setFamilyAccount] = useState<FinancialAccount>();
  const [familyState, setFamilyState] = useState<RequestState>("ready");
  const [dialog, setDialog] = useState<DialogState>();
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Readonly<{ kind: "success" | "error"; text: string }>>();
  const [version, setVersion] = useState(0);

  const refreshAll = useCallback(() => setVersion((current) => current + 1), []);

  useEffect(() => {
    let mounted = true;
    setDashboardState("loading");
    void getFinancialDashboard()
      .then((result) => {
        if (!mounted) return;
        setDashboard(result);
        setDashboardState("ready");
      })
      .catch(() => {
        if (!mounted) return;
        setDashboard(undefined);
        setDashboardState("error");
      });
    return () => {
      mounted = false;
    };
  }, [version]);

  useEffect(() => {
    let mounted = true;
    setRecentState("loading");
    void listRecentPayments()
      .then((result) => {
        if (!mounted) return;
        setRecent(result);
        setRecentState("ready");
      })
      .catch(() => {
        if (!mounted) return;
        setRecent(undefined);
        setRecentState("error");
      });
    return () => {
      mounted = false;
    };
  }, [version]);

  useEffect(() => {
    let mounted = true;
    setAccountState("loading");
    void listFinancialAccount()
      .then((result) => {
        if (!mounted) return;
        setAccount(result);
        setAccountState("ready");
      })
      .catch(() => {
        if (!mounted) return;
        setAccount(undefined);
        setAccountState("error");
      });
    return () => {
      mounted = false;
    };
  }, [version]);

  useEffect(() => {
    let mounted = true;
    void listMemberships()
      .then((result) => {
        if (mounted) setMemberships(result);
      })
      .catch(() => {
        if (mounted) setMemberships([]);
      });
    return () => {
      mounted = false;
    };
  }, [version]);

  useEffect(() => {
    let mounted = true;
    void listMemberNames()
      .then((result) => {
        if (!mounted) return;
        setMembers(result);
        setMembersError(undefined);
      })
      .catch((cause: unknown) => {
        if (!mounted) return;
        setMembers(null);
        setMembersError(
          cause instanceof Error
            ? cause.message
            : "Unable to load the member list. Please try again.",
        );
      });
    return () => {
      mounted = false;
    };
  }, [version]);

  useEffect(() => {
    if (member === null || member.familyId === null) {
      setFamilyAccount(undefined);
      setFamilyState("ready");
      return;
    }
    let mounted = true;
    setFamilyState("loading");
    void getFamilyFinancialAccount(member.familyId)
      .then((result) => {
        if (!mounted) return;
        setFamilyAccount(result);
        setFamilyState("ready");
      })
      .catch(() => {
        if (!mounted) return;
        setFamilyAccount(undefined);
        setFamilyState("error");
      });
    return () => {
      mounted = false;
    };
  }, [member, version]);

  async function handleVoid(view: InvoiceView) {
    if (!window.confirm(`Void invoice ${view.invoice.invoiceReference}? This cannot be undone.`)) {
      return;
    }
    setBusy(true);
    setFeedback(undefined);
    try {
      await voidManualInvoice(view.invoice.invoiceId);
      setFeedback({ kind: "success", text: "Invoice voided." });
      refreshAll();
    } catch {
      setFeedback({
        kind: "error",
        text: "The invoice could not be voided. Refresh and try again.",
      });
    } finally {
      setBusy(false);
    }
  }

  function openRecordPayment(view: InvoiceView) {
    setDialog({ kind: "payment", invoice: view });
    setFeedback(undefined);
  }

  const memberNames = useMemo(
    () => new Map((members ?? []).map((row) => [row.studentId, row.fullName])),
    [members],
  );

  const allInvoiceColumns = [
    {
      key: "reference",
      label: "Invoice",
      render: (view: InvoiceView) => <strong>{view.invoice.invoiceReference}</strong>,
    },
    {
      key: "student",
      label: "Student",
      render: (view: InvoiceView) => {
        const membership = memberships.find(
          (candidate) => candidate.membershipId === view.invoice.membershipId,
        );
        return membership
          ? (memberNames.get(membership.studentId) ?? membership.studentId)
          : view.invoice.description;
      },
    },
    { key: "due", label: "Due", render: (view: InvoiceView) => formatDate(view.invoice.dueAt) },
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
          onRecordPayment={openRecordPayment}
          onVoid={(invoice) => void handleVoid(invoice)}
          view={view}
        />
      ),
    },
  ];

  return (
    <section className="admin-module-page finance-dashboard-page" aria-labelledby="billing-title">
      <AdminSectionHeader
        actions={
          <>
            <button className="button" onClick={() => setDialog({ kind: "invoice" })} type="button">
              Issue invoice
            </button>
            <button
              className="button button-secondary"
              onClick={() => setDialog({ kind: "payment", invoice: null })}
              type="button"
            >
              Record payment
            </button>
          </>
        }
        description="Manual GBP invoices and receipts. No card details are stored here."
        eyebrow="Money / Billing"
        title="Billing"
      />

      {feedback ? (
        <p
          aria-live="polite"
          className={feedback.kind === "error" ? "family-error" : "family-success"}
          role={feedback.kind === "error" ? "alert" : "status"}
        >
          {feedback.text}
        </p>
      ) : null}

      <IntroApplicationsPanel />

      {dashboardState === "loading" ? (
        <div aria-label="Loading billing" className="admin-metrics-grid" role="status">
          <div aria-hidden="true" className="billing-skeleton" />
          <div aria-hidden="true" className="billing-skeleton" />
          <div aria-hidden="true" className="billing-skeleton" />
          <div aria-hidden="true" className="billing-skeleton" />
        </div>
      ) : null}
      {dashboardState === "error" ? (
        <p className="family-error" role="alert">
          The finance summary is unavailable. Try again.
        </p>
      ) : null}
      {dashboardState === "ready" && dashboard ? (
        <div className="admin-metrics-grid">
          <AdminMetric
            detail={`${dashboard.metrics.paymentsReceived} payments`}
            label="Collected this month"
            value={formatMoney(dashboard.metrics.collectedMinor)}
          />
          <AdminMetric
            detail={`${dashboard.metrics.overdueBalances} overdue invoice balances`}
            label="Outstanding"
            value={formatMoney(dashboard.metrics.outstandingMinor)}
          />
          <AdminMetric
            detail="Currently overdue"
            label="Overdue invoices"
            value={dashboard.metrics.overdueBalances}
          />
          <AdminMetric
            detail="Next 30 days"
            label="Renewals due"
            value={dashboard.metrics.renewalsDue}
          />
        </div>
      ) : null}

      <section aria-labelledby="latest-payments-title" className="admin-panel-card" role="region">
        <div className="admin-panel-card-heading">
          <div>
            <p className="admin-eyebrow">Manual receipts</p>
            <h3 id="latest-payments-title">Latest payments</h3>
          </div>
        </div>
        {recentState === "loading" ? <div aria-busy="true" className="billing-skeleton" /> : null}
        {recentState === "error" ? (
          <p className="family-error" role="alert">
            The latest payments are unavailable. Try again.
          </p>
        ) : null}
        {recentState === "ready" && recent ? (
          <>
            <AdminDataTable
              caption="Latest payments"
              columns={[
                {
                  key: "date",
                  label: "Date",
                  render: (row: RecentPaymentRow) => formatDate(row.occurredAt),
                },
                {
                  key: "member",
                  label: "Member",
                  render: (row: RecentPaymentRow) => row.memberName ?? row.description,
                },
                {
                  key: "invoice",
                  label: "Invoice",
                  render: (row: RecentPaymentRow) => row.invoiceReference,
                },
                {
                  key: "method",
                  label: "Method",
                  render: (row: RecentPaymentRow) => methodLabel[row.method],
                },
                {
                  key: "amount",
                  label: "Amount",
                  render: (row: RecentPaymentRow) => formatMoney(row.amountMinor),
                },
              ]}
              rowKey={(row) => row.paymentId}
              rows={recent}
            />
            {recent.length === 0 ? (
              <p className="admin-empty-state">No manual payments have been recorded yet.</p>
            ) : null}
          </>
        ) : null}
      </section>

      <section aria-labelledby="find-member-title" className="admin-panel-card">
        <div className="admin-panel-card-heading">
          <div>
            <p className="admin-eyebrow">Member account</p>
            <h3 id="find-member-title">Find a member</h3>
          </div>
        </div>
        <MemberPicker
          error={membersError}
          members={members}
          onSelect={setMember}
          selected={member}
        />
      </section>

      {member ? (
        <MemberAccountPanel
          account={familyAccount}
          busy={busy}
          member={member}
          onRecordPayment={openRecordPayment}
          onVoid={(invoice) => void handleVoid(invoice)}
          status={familyState}
        />
      ) : null}

      <details className="billing-details" aria-label="Outstanding invoices">
        <summary>Outstanding invoices</summary>
        {dashboard ? (
          <>
            <AdminDataTable
              caption="Outstanding invoice balances"
              columns={balanceColumns}
              rowKey={(item) => item.invoiceReference}
              rows={dashboard.balanceAttention}
            />
            {dashboard.balanceAttention.length === 0 ? (
              <p className="admin-empty-state">No balances need attention.</p>
            ) : null}
          </>
        ) : null}
      </details>

      <details className="billing-details" aria-label="Upcoming renewals">
        <summary>Upcoming renewals</summary>
        {dashboard ? (
          <>
            <AdminDataTable
              caption="Upcoming membership renewals"
              columns={renewalColumns}
              rowKey={(item, index) => `${item.planId}:${item.nextBillingAt}:${index}`}
              rows={dashboard.upcomingRenewals}
            />
            {dashboard.upcomingRenewals.length === 0 ? (
              <p className="admin-empty-state">No renewals are due in the next 30 days.</p>
            ) : null}
          </>
        ) : null}
      </details>

      <details className="billing-details" aria-label="No-show penalties">
        <summary>No-show penalties</summary>
        <NoShowPenaltyQueue />
      </details>

      <details className="billing-details" aria-label="Payment instructions">
        <summary>Payment instructions</summary>
        <PaymentInstructionsPanel
          current={account?.paymentInstructions ?? null}
          onSaved={refreshAll}
        />
      </details>

      <details className="billing-details" aria-label="All invoices">
        <summary>All invoices</summary>
        {accountState === "loading" ? <div aria-busy="true" className="billing-skeleton" /> : null}
        {accountState === "error" ? (
          <p className="family-error" role="alert">
            Unable to load invoices. Please try again.
          </p>
        ) : null}
        {accountState === "ready" && account ? (
          <>
            <AdminDataTable
              caption="All invoices"
              columns={allInvoiceColumns}
              rowKey={(view) => view.invoice.invoiceId}
              rows={account.invoices}
            />
            {account.invoices.length === 0 ? (
              <p className="admin-empty-state">No invoices have been issued.</p>
            ) : null}
          </>
        ) : null}
      </details>

      {dialog?.kind === "invoice" ? (
        <IssueInvoiceDialog
          members={members}
          membersError={membersError}
          memberships={memberships}
          onClose={() => setDialog(undefined)}
          onIssued={() => {
            setFeedback({ kind: "success", text: "Invoice issued." });
            setDialog(undefined);
            refreshAll();
          }}
        />
      ) : null}
      {dialog?.kind === "payment" ? (
        <RecordPaymentDialog
          invoice={dialog.invoice}
          members={members}
          membersError={membersError}
          onClose={() => setDialog(undefined)}
          onRecorded={() => {
            setFeedback({ kind: "success", text: "Payment recorded." });
            setDialog(undefined);
            refreshAll();
          }}
        />
      ) : null}
    </section>
  );
}

export default function BillingRoute() {
  return <BillingPage />;
}
