"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { ChargeKind, ManualPaymentMethod } from "@bpt-jersey/domain/finance";

import {
  issueManualInvoice,
  listFinancialAccount,
  recordManualPayment,
  voidManualInvoice,
  type FinancialAccount,
  type InvoiceView,
} from "../../../lib/billing-client";
import { listMemberships, type AdminMembership } from "../../../lib/membership-admin-client";
import { listMembers } from "../../../lib/members-client";
import { AdminDataTable } from "../admin-data-table";
import { AdminMetric, AdminSectionHeader, AdminStatusBadge } from "../admin-ui";
import { NoShowPenaltyQueue } from "./no-show-penalty-queue";

import "../admin.css";

type RequestState = "loading" | "ready" | "error";
type MembershipOptions = Readonly<{
  state: RequestState;
  memberships: readonly AdminMembership[];
  studentNames: ReadonlyMap<string, string>;
}>;

function membershipLabel(membership: AdminMembership, studentNames: ReadonlyMap<string, string>) {
  const student = studentNames.get(membership.studentId) ?? membership.studentId;
  return `${student} · ${membership.planId} · ${membership.status}`;
}

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

function parseMoney(value: string): number | undefined {
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/u.test(value)) return undefined;
  const [whole = "0", fraction = ""] = value.split(".");
  const amount = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(amount) && amount > 0 ? amount : undefined;
}

function toUtcDateTime(value: string): string | undefined {
  if (value.length === 0) return undefined;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? undefined : new Date(timestamp).toISOString();
}

function isOpaqueId(value: string | null): value is string {
  return value !== null && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u.test(value);
}

function InvoiceActions({
  view,
  busy,
  onPayment,
  onVoid,
}: {
  view: InvoiceView;
  busy: boolean;
  onPayment: (view: InvoiceView) => void;
  onVoid: (view: InvoiceView) => void;
}) {
  const canReceivePayment =
    view.invoice.status === "open" || view.invoice.status === "partially_paid";
  const canVoid = view.invoice.status === "open" && view.payments.length === 0;
  return (
    <div className="admin-table-actions">
      {canReceivePayment && view.balanceMinor > 0 ? (
        <button
          aria-label={`Record payment for ${view.invoice.invoiceReference}`}
          className="family-text-button"
          disabled={busy}
          onClick={() => onPayment(view)}
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

export function BillingPage() {
  const [account, setAccount] = useState<FinancialAccount>();
  const [state, setState] = useState<RequestState>("loading");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Readonly<{ kind: "success" | "error"; text: string }>>();
  const [selectedInvoice, setSelectedInvoice] = useState<InvoiceView>();
  const [options, setOptions] = useState<MembershipOptions>({
    state: "loading",
    memberships: [],
    studentNames: new Map(),
  });
  const [invoiceForm, setInvoiceForm] = useState({
    membershipId: "",
    amount: "",
    dueAt: "",
    chargeKind: "membership" as Exclude<ChargeKind, "payg_session">,
    invoiceReference: "",
    description: "",
  });
  const [paymentForm, setPaymentForm] = useState({
    amount: "",
    method: "bank_transfer" as ManualPaymentMethod,
    manualReference: "",
    occurredAt: "",
  });

  useEffect(() => {
    // The memberships link preselects the membership; its family comes from the connected record.
    const membershipId = new URLSearchParams(window.location.search).get("membershipId");
    if (!isOpaqueId(membershipId)) return;
    setInvoiceForm((current) => ({ ...current, membershipId }));
  }, []);

  useEffect(() => {
    let mounted = true;
    void Promise.all([listMemberships(), listMembers(50).catch(() => undefined)])
      .then(([memberships, page]) => {
        if (!mounted) return;
        setOptions({
          state: "ready",
          memberships,
          studentNames: new Map((page?.rows ?? []).map((row) => [row.studentId, row.fullName])),
        });
      })
      .catch(() => {
        if (mounted) setOptions({ state: "error", memberships: [], studentNames: new Map() });
      });
    return () => {
      mounted = false;
    };
  }, []);

  const loadAccount = useCallback(async () => {
    setState("loading");
    try {
      setAccount(await listFinancialAccount());
      setState("ready");
    } catch {
      setAccount(undefined);
      setState("error");
    }
  }, []);

  useEffect(() => {
    void loadAccount();
  }, [loadAccount]);

  const columns = [
    {
      key: "reference",
      label: "Invoice",
      render: (view: InvoiceView) => <strong>{view.invoice.invoiceReference}</strong>,
    },
    {
      key: "student",
      label: "Student",
      render: (view: InvoiceView) => {
        const membership = options.memberships.find(
          (candidate) => candidate.membershipId === view.invoice.membershipId,
        );
        return membership
          ? (options.studentNames.get(membership.studentId) ?? membership.studentId)
          : view.invoice.membershipId;
      },
    },
    {
      key: "membership",
      label: "Plan",
      render: (view: InvoiceView) =>
        options.memberships.find(
          (candidate) => candidate.membershipId === view.invoice.membershipId,
        )?.planId ?? view.invoice.membershipId,
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
        <InvoiceActions
          busy={busy}
          onPayment={(invoice) => {
            setSelectedInvoice(invoice);
            setPaymentForm((current) => ({
              ...current,
              amount: (invoice.balanceMinor / 100).toFixed(2),
            }));
            setFeedback(undefined);
          }}
          onVoid={(invoice) => void handleVoid(invoice)}
          view={view}
        />
      ),
    },
  ];

  async function handleInvoiceSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const totalMinor = parseMoney(invoiceForm.amount);
    const dueAt = toUtcDateTime(invoiceForm.dueAt);
    const membership = options.memberships.find(
      (candidate) => candidate.membershipId === invoiceForm.membershipId,
    );
    if (membership === undefined) {
      setFeedback({ kind: "error", text: "Select a connected membership." });
      return;
    }
    if (totalMinor === undefined || dueAt === undefined) {
      setFeedback({ kind: "error", text: "Enter a valid positive amount and due date." });
      return;
    }
    setBusy(true);
    setFeedback(undefined);
    try {
      await issueManualInvoice({
        familyId: membership.familyId,
        membershipId: membership.membershipId,
        totalMinor,
        dueAt,
        chargeKind: invoiceForm.chargeKind,
        invoiceReference: invoiceForm.invoiceReference.trim(),
        description: invoiceForm.description.trim(),
      });
      setFeedback({ kind: "success", text: "Invoice issued and added to the ledger." });
      setInvoiceForm((current) => ({
        ...current,
        amount: "",
        dueAt: "",
        invoiceReference: "",
        description: "",
      }));
      await loadAccount();
    } catch {
      setFeedback({
        kind: "error",
        text: "The invoice could not be issued. Check the membership and try again.",
      });
    } finally {
      setBusy(false);
    }
  }

  async function handlePaymentSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (selectedInvoice === undefined) return;
    const amountMinor = parseMoney(paymentForm.amount);
    const occurredAt = toUtcDateTime(paymentForm.occurredAt);
    if (
      amountMinor === undefined ||
      occurredAt === undefined ||
      amountMinor > selectedInvoice.balanceMinor
    ) {
      setFeedback({ kind: "error", text: "Enter a valid payment no greater than the balance." });
      return;
    }
    setBusy(true);
    setFeedback(undefined);
    try {
      await recordManualPayment({
        invoiceId: selectedInvoice.invoice.invoiceId,
        amountMinor,
        method: paymentForm.method,
        manualReference: paymentForm.manualReference.trim(),
        occurredAt,
      });
      setFeedback({ kind: "success", text: "Payment recorded in the manual ledger." });
      setSelectedInvoice(undefined);
      setPaymentForm({
        amount: "",
        method: "bank_transfer",
        manualReference: "",
        occurredAt: "",
      });
      await loadAccount();
    } catch {
      setFeedback({
        kind: "error",
        text: "The payment could not be recorded. Refresh the balance and try again.",
      });
    } finally {
      setBusy(false);
    }
  }

  async function handleVoid(view: InvoiceView) {
    if (!window.confirm(`Void invoice ${view.invoice.invoiceReference}? This cannot be undone.`)) {
      return;
    }
    setBusy(true);
    setFeedback(undefined);
    try {
      await voidManualInvoice(view.invoice.invoiceId);
      if (selectedInvoice?.invoice.invoiceId === view.invoice.invoiceId) {
        setSelectedInvoice(undefined);
      }
      setFeedback({ kind: "success", text: "Invoice voided." });
      await loadAccount();
    } catch {
      setFeedback({
        kind: "error",
        text: "The invoice could not be voided. Refresh and try again.",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="admin-module-page finance-dashboard-page" aria-labelledby="billing-title">
      <AdminSectionHeader
        actions={
          <button
            className="admin-home-link"
            disabled={busy || state === "loading"}
            onClick={() => void loadAccount()}
            type="button"
          >
            Refresh account
          </button>
        }
        description="Issue GBP invoices and record manual receipts. No card details or online checkout are stored here."
        eyebrow="Finance / Operations"
        title="Billing and payments"
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

      <NoShowPenaltyQueue />

      {state === "loading" && account === undefined ? (
        <p role="status">Loading billing account…</p>
      ) : null}
      {state === "error" ? (
        <section className="finance-dashboard-state finance-dashboard-error" role="alert">
          <h3>Billing account could not be loaded</h3>
          <p>No invoice or payment details were displayed.</p>
          <button className="admin-home-link" onClick={() => void loadAccount()} type="button">
            Try again
          </button>
        </section>
      ) : null}

      {account ? (
        <>
          <div className="admin-metrics-grid">
            <AdminMetric
              detail={`${account.invoices.length} invoices`}
              label="Outstanding balance"
              value={formatMoney(account.balanceMinor)}
            />
            <AdminMetric
              detail="Session charges only"
              label="PAYG debt"
              value={formatMoney(account.paygDebtMinor)}
            />
          </div>

          <section className="admin-panel-card" aria-labelledby="invoice-ledger-title">
            <div className="admin-panel-card-heading">
              <div>
                <p className="admin-eyebrow">Connected ledger</p>
                <h3 id="invoice-ledger-title">Invoices</h3>
              </div>
              <AdminStatusBadge status="Connected" />
            </div>
            <AdminDataTable
              caption="Billing invoices"
              columns={columns}
              rowKey={(view) => view.invoice.invoiceId}
              rows={account.invoices}
            />
            {account.invoices.length === 0 ? (
              <p className="admin-empty-state">No invoices have been issued.</p>
            ) : null}
          </section>
        </>
      ) : null}

      <div className="finance-horizon-grid">
        <form
          className="admin-panel-card family-admin-form"
          onSubmit={(event) => void handleInvoiceSubmit(event)}
        >
          <div className="admin-panel-card-heading">
            <div>
              <p className="admin-eyebrow">Manual charge</p>
              <h3>Issue invoice</h3>
            </div>
          </div>
          <label className="family-field">
            Membership
            <select
              aria-label="Membership"
              disabled={options.state !== "ready"}
              onChange={(event) =>
                setInvoiceForm({ ...invoiceForm, membershipId: event.target.value })
              }
              required
              value={invoiceForm.membershipId}
            >
              <option value="">
                {options.state === "loading"
                  ? "Loading memberships..."
                  : options.state === "error"
                    ? "Memberships unavailable"
                    : "Select a membership"}
              </option>
              {options.memberships.map((membership) => (
                <option key={membership.membershipId} value={membership.membershipId}>
                  {membershipLabel(membership, options.studentNames)}
                </option>
              ))}
            </select>
          </label>
          {options.state === "error" ? (
            <p className="family-error" role="alert">
              Unable to load memberships. Refresh before issuing invoices.
            </p>
          ) : null}
          <label className="family-field">
            Invoice amount (GBP)
            <input
              aria-label="Invoice amount (GBP)"
              inputMode="decimal"
              onChange={(event) => setInvoiceForm({ ...invoiceForm, amount: event.target.value })}
              placeholder="75.00"
              required
              value={invoiceForm.amount}
            />
          </label>
          <label className="family-field">
            Due at
            <input
              aria-label="Due at"
              onChange={(event) => setInvoiceForm({ ...invoiceForm, dueAt: event.target.value })}
              required
              type="datetime-local"
              value={invoiceForm.dueAt}
            />
          </label>
          <label className="family-field">
            Charge type
            <select
              aria-label="Charge type"
              onChange={(event) =>
                setInvoiceForm({
                  ...invoiceForm,
                  chargeKind: event.target.value as Exclude<ChargeKind, "payg_session">,
                })
              }
              value={invoiceForm.chargeKind}
            >
              <option value="membership">Membership</option>
              <option value="manual_adjustment">Manual adjustment</option>
            </select>
          </label>
          <label className="family-field">
            Invoice reference
            <input
              aria-label="Invoice reference"
              autoComplete="off"
              onChange={(event) =>
                setInvoiceForm({ ...invoiceForm, invoiceReference: event.target.value })
              }
              required
              value={invoiceForm.invoiceReference}
            />
          </label>
          <label className="family-field">
            Description
            <textarea
              aria-label="Description"
              maxLength={200}
              onChange={(event) =>
                setInvoiceForm({ ...invoiceForm, description: event.target.value })
              }
              required
              value={invoiceForm.description}
            />
          </label>
          <button className="admin-auth-button" disabled={busy} type="submit">
            Issue invoice
          </button>
        </form>

        <form
          className="admin-panel-card family-admin-form"
          onSubmit={(event) => void handlePaymentSubmit(event)}
        >
          <div className="admin-panel-card-heading">
            <div>
              <p className="admin-eyebrow">Manual receipt</p>
              <h3>Record payment</h3>
            </div>
          </div>
          {selectedInvoice ? (
            <p>
              Selected: <strong>{selectedInvoice.invoice.invoiceReference}</strong> · balance{" "}
              {formatMoney(selectedInvoice.balanceMinor)}
            </p>
          ) : (
            <p>Select Record payment from an open invoice.</p>
          )}
          <label className="family-field">
            Payment amount (GBP)
            <input
              aria-label="Payment amount (GBP)"
              disabled={!selectedInvoice}
              inputMode="decimal"
              onChange={(event) => setPaymentForm({ ...paymentForm, amount: event.target.value })}
              required
              value={paymentForm.amount}
            />
          </label>
          <label className="family-field">
            Method
            <select
              aria-label="Payment method"
              disabled={!selectedInvoice}
              onChange={(event) =>
                setPaymentForm({
                  ...paymentForm,
                  method: event.target.value as ManualPaymentMethod,
                })
              }
              value={paymentForm.method}
            >
              <option value="bank_transfer">Bank transfer</option>
              <option value="cash">Cash</option>
              <option value="other">Other</option>
            </select>
          </label>
          <label className="family-field">
            Manual payment reference
            <input
              aria-label="Manual payment reference"
              autoComplete="off"
              disabled={!selectedInvoice}
              onChange={(event) =>
                setPaymentForm({ ...paymentForm, manualReference: event.target.value })
              }
              required
              value={paymentForm.manualReference}
            />
          </label>
          <label className="family-field">
            Payment occurred at
            <input
              aria-label="Payment occurred at"
              disabled={!selectedInvoice}
              onChange={(event) =>
                setPaymentForm({ ...paymentForm, occurredAt: event.target.value })
              }
              required
              type="datetime-local"
              value={paymentForm.occurredAt}
            />
          </label>
          <div className="admin-table-actions">
            <button className="admin-auth-button" disabled={busy || !selectedInvoice} type="submit">
              Save payment
            </button>
            {selectedInvoice ? (
              <button
                className="family-text-button"
                disabled={busy}
                onClick={() => setSelectedInvoice(undefined)}
                type="button"
              >
                Cancel
              </button>
            ) : null}
          </div>
        </form>
      </div>
    </section>
  );
}

export default function BillingRoute() {
  return <BillingPage />;
}
