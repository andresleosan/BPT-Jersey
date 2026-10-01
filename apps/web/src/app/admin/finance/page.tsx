"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  currentFinancialMonth,
  shiftFinancialMonth,
  type FinancialDashboard,
  type FinancialDashboardBalanceRow,
  type FinancialDashboardPaymentRow,
} from "@bpt-jersey/domain/finance/dashboard";
import type { ManualPaymentMethod } from "@bpt-jersey/domain/finance";
import type { MemberNameRow } from "@bpt-jersey/domain/members/directory";

import { getFamilyFinancialAccount, getFinancialDashboard } from "../../../lib/finance-client";
import {
  getInvoice,
  listFinancialAccount,
  voidManualInvoice,
  type FinancialAccount,
  type InvoiceView,
} from "../../../lib/billing-client";
import { listMemberships, type AdminMembership } from "../../../lib/membership-admin-client";
import { listMemberNames } from "../../../lib/members-client";
import { AdminDataTable } from "../admin-data-table";
import { AdminMetric, AdminSectionHeader, AdminStatusBadge } from "../admin-ui";
import { formatDate, formatMoney } from "../billing/billing-format";
import { IssueInvoiceDialog } from "../billing/issue-invoice-dialog";
import { InvoiceRowActions, MemberAccountPanel } from "../billing/member-account-panel";
import { MemberPicker } from "../billing/member-picker";
import { PaymentInstructionsPanel } from "../billing/payment-instructions-panel";
import { PrivateLessonsPanel } from "../billing/private-lessons-panel";
import { RecordPaymentDialog } from "../billing/record-payment-dialog";
import { VoidPaymentDialog } from "../billing/void-payment-dialog";
import { EditPaymentDialog } from "../members/profile/payment-dialogs";
import {
  financeTabLabels,
  financeTabs,
  OwedPanel,
  PaymentsPanel,
  readFinanceTab,
  RenewalsPanel,
  type FinanceTab,
} from "./finance-tabs";

import "../admin.css";
import "../billing/billing.css";

type RequestState = "loading" | "ready" | "error";

const monthFormat = new Intl.DateTimeFormat("en-GB", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});
const monthLabelOf = (month: string) => monthFormat.format(new Date(`${month}-01T00:00:00.000Z`));

type DialogState =
  | Readonly<{ kind: "invoice" }>
  | Readonly<{ kind: "payment"; invoice: InvoiceView | null }>
  | Readonly<{ kind: "edit"; row: FinancialDashboardPaymentRow }>
  | Readonly<{ kind: "void"; row: FinancialDashboardPaymentRow }>;

/** The dashboard together with the month it was asked for, so a stale month never shows. */
type LoadedDashboard = Readonly<{ month: string; data: FinancialDashboard }>;

export function FinancePage() {
  const [currentMonth] = useState(() => currentFinancialMonth(new Date().toISOString()));
  const [month, setMonth] = useState(currentMonth);
  const [tab, setTab] = useState<FinanceTab>("payments");
  const [dashboard, setDashboard] = useState<LoadedDashboard>();
  const [dashboardState, setDashboardState] = useState<RequestState>("loading");
  const [account, setAccount] = useState<FinancialAccount>();
  const [accountState, setAccountState] = useState<RequestState>("loading");
  const [accountNeeded, setAccountNeeded] = useState(false);
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
    setTab(readFinanceTab(window.location.search));
  }, []);

  function selectTab(next: FinanceTab) {
    setTab(next);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", next);
    window.history.replaceState(null, "", url);
  }

  useEffect(() => {
    let mounted = true;
    setDashboardState("loading");
    void getFinancialDashboard(month === currentMonth ? undefined : month)
      .then((result) => {
        if (!mounted) return;
        setDashboard({ month, data: result });
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
  }, [month, currentMonth, version]);

  // Invoices and memberships are only fetched once a view or dialog that needs them is opened.
  const wantsAccount = tab === "invoices" || tab === "settings" || dialog?.kind === "invoice";
  useEffect(() => {
    if (wantsAccount) setAccountNeeded(true);
  }, [wantsAccount]);

  useEffect(() => {
    if (!accountNeeded) return;
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
  }, [accountNeeded, version]);

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
  }, []);

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

  async function handleVoidInvoice(view: InvoiceView) {
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

  function openOwedPayment(row: FinancialDashboardBalanceRow) {
    setBusy(true);
    setFeedback(undefined);
    void getInvoice(row.invoiceId)
      .then((view) => setDialog({ kind: "payment", invoice: view }))
      .catch(() =>
        setFeedback({
          kind: "error",
          text: "That invoice could not be opened. Refresh and try again.",
        }),
      )
      .finally(() => setBusy(false));
  }

  function closeDialogWith(text: string) {
    setFeedback({ kind: "success", text });
    setDialog(undefined);
    refreshAll();
  }

  const names = useMemo(
    () => new Map((members ?? []).map((row) => [row.studentId, row.fullName])),
    [members],
  );
  const nameOf = useCallback(
    (studentId: string | null, fallback: string) =>
      (studentId === null ? undefined : names.get(studentId)) ?? fallback,
    [names],
  );

  const monthLabel = monthLabelOf(month);
  const loaded = dashboard?.month === month ? dashboard.data : undefined;
  const metrics = loaded?.metrics;

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
          ? nameOf(membership.studentId, view.invoice.description)
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
          onVoid={(invoice) => void handleVoidInvoice(invoice)}
          view={view}
        />
      ),
    },
  ];

  function dashboardTabView() {
    if (!loaded) {
      return dashboardState === "loading" ? (
        <div aria-busy="true" className="billing-skeleton" />
      ) : null;
    }
    if (tab === "payments") {
      return (
        <PaymentsPanel
          busy={busy}
          monthLabel={monthLabel}
          nameOf={nameOf}
          onEdit={(row) => setDialog({ kind: "edit", row })}
          onVoid={(row) => setDialog({ kind: "void", row })}
          rows={loaded.payments}
        />
      );
    }
    if (tab === "owed") {
      return (
        <OwedPanel
          busy={busy}
          nameOf={nameOf}
          onRecordPayment={openOwedPayment}
          rows={loaded.balances}
        />
      );
    }
    return <RenewalsPanel nameOf={nameOf} renewals={loaded.renewals} />;
  }
  const dashboardView =
    tab === "payments" || tab === "owed" || tab === "renewals" ? dashboardTabView() : null;

  return (
    <section aria-label="Financial dashboard" className="admin-module-page finance-dashboard-page">
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
        description="Manual GBP invoices, receipts and shop payments. No card details are stored here."
        eyebrow="Money / Finance"
        title="Financial dashboard"
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

      <div aria-label="Month" className="finance-month-nav" role="group">
        <button
          aria-label="Previous month"
          className="button button-secondary"
          onClick={() => setMonth(shiftFinancialMonth(month, -1))}
          type="button"
        >
          Previous
        </button>
        <p aria-live="polite" className="finance-month-label">
          {monthLabel}
        </p>
        <button
          aria-label="Next month"
          className="button button-secondary"
          disabled={month >= currentMonth}
          onClick={() => setMonth(shiftFinancialMonth(month, 1))}
          type="button"
        >
          Next
        </button>
      </div>

      {dashboardState === "loading" && !loaded ? (
        <div
          aria-label="Loading the financial dashboard"
          className="admin-metrics-grid"
          role="status"
        >
          <div aria-hidden="true" className="billing-skeleton" />
          <div aria-hidden="true" className="billing-skeleton" />
          <div aria-hidden="true" className="billing-skeleton" />
          <div aria-hidden="true" className="billing-skeleton" />
        </div>
      ) : null}
      {dashboardState === "error" ? (
        <div className="finance-error-band">
          <p className="family-error" role="alert">
            The finance summary is unavailable. Try again.
          </p>
          <button className="button button-secondary" onClick={refreshAll} type="button">
            Retry
          </button>
        </div>
      ) : null}
      {metrics ? (
        <div className="admin-metrics-grid">
          <AdminMetric
            detail={`${metrics.paymentsReceived} ${metrics.paymentsReceived === 1 ? "payment" : "payments"} in ${monthLabel}`}
            label="Collected"
            value={formatMoney(metrics.collectedMinor)}
          />
          <AdminMetric
            detail="Owed today"
            label="Outstanding"
            value={formatMoney(metrics.outstandingMinor)}
          />
          <AdminMetric
            detail="Past their due date"
            label="Overdue invoices"
            value={metrics.overdueBalances}
          />
          <AdminMetric
            detail={`${metrics.renewalsOverdue} overdue · ${metrics.renewalsDue} due in 30 days`}
            label="Renewals"
            value={metrics.renewalsOverdue + metrics.renewalsDue}
          />
        </div>
      ) : null}

      <nav aria-label="Finance views" className="shop-admin-tabs">
        <ul role="tablist">
          {financeTabs.map((item) => (
            <li key={item} role="presentation">
              <button
                aria-controls="finance-tabpanel"
                aria-selected={tab === item}
                className="shop-admin-tab"
                id={`finance-tab-${item}`}
                onClick={() => selectTab(item)}
                role="tab"
                type="button"
              >
                {financeTabLabels[item]}
              </button>
            </li>
          ))}
        </ul>
      </nav>

      <div
        aria-labelledby={`finance-tab-${tab}`}
        className="finance-tabpanel"
        id="finance-tabpanel"
        role="tabpanel"
      >
        {dashboardView ? <section className="admin-panel-card">{dashboardView}</section> : null}

        {tab === "invoices" ? (
          <>
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
                onVoid={(invoice) => void handleVoidInvoice(invoice)}
                status={familyState}
              />
            ) : null}

            <section aria-labelledby="all-invoices-title" className="admin-panel-card">
              <div className="admin-panel-card-heading">
                <div>
                  <p className="admin-eyebrow">Every family</p>
                  <h3 id="all-invoices-title">All invoices</h3>
                </div>
              </div>
              {accountState === "loading" ? (
                <div aria-busy="true" className="billing-skeleton" />
              ) : null}
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
            </section>
          </>
        ) : null}

        {tab === "settings" ? (
          <>
            {accountState === "loading" ? (
              <div aria-busy="true" className="billing-skeleton" />
            ) : null}
            {accountState === "error" ? (
              <p className="family-error" role="alert">
                The payment instructions are unavailable. Please try again.
              </p>
            ) : null}
            {accountState === "ready" ? (
              <PaymentInstructionsPanel
                current={account?.paymentInstructions ?? null}
                onSaved={refreshAll}
              />
            ) : null}
            <section className="admin-panel-card">
              <PrivateLessonsPanel />
            </section>
          </>
        ) : null}
      </div>

      {dialog?.kind === "invoice" ? (
        <IssueInvoiceDialog
          members={members}
          membersError={membersError}
          memberships={memberships}
          onClose={() => setDialog(undefined)}
          onIssued={() => closeDialogWith("Invoice issued.")}
        />
      ) : null}
      {dialog?.kind === "payment" ? (
        <RecordPaymentDialog
          invoice={dialog.invoice}
          members={members}
          membersError={membersError}
          onClose={() => setDialog(undefined)}
          onRecorded={() => closeDialogWith("Payment recorded.")}
        />
      ) : null}
      {dialog?.kind === "edit" && dialog.row.paymentId !== null ? (
        <EditPaymentDialog
          onClose={() => setDialog(undefined)}
          onSaved={() => closeDialogWith("Payment updated.")}
          payment={{
            paymentId: dialog.row.paymentId,
            amountMinor: dialog.row.amountMinor,
            // Only editable rows open this dialog, and those are never paid on collection.
            method: dialog.row.method as ManualPaymentMethod,
            reference: dialog.row.reference ?? "",
            occurredAt: dialog.row.occurredAt,
          }}
        />
      ) : null}
      {dialog?.kind === "void" && dialog.row.paymentId !== null ? (
        <VoidPaymentDialog
          memberLabel={nameOf(dialog.row.studentId, dialog.row.label)}
          onClose={() => setDialog(undefined)}
          onVoided={() => closeDialogWith("Payment voided.")}
          payment={{
            paymentId: dialog.row.paymentId,
            amountMinor: dialog.row.amountMinor,
            occurredAt: dialog.row.occurredAt,
          }}
        />
      ) : null}
    </section>
  );
}

export default function FinanceRoute() {
  return <FinancePage />;
}
